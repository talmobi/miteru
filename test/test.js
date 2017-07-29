var rimraf = require('rimraf')
var mkdirp = require('mkdirp')
var ncp = require('ncp').ncp

var fs = require('fs')
var path = require('path')
var childProcess = require('child_process')

var miteru = require('../src/index.js')

var test = require('tape')

function run ( filepath ) {
  var resolved = require.resolve( filepath )
  delete require.cache[ resolved ]
  return require( resolved )
}

var _env = Object.assign({}, process.env)
function prepare (next) {
  process.env = Object.assign({}, _env)

  rimraf(path.join(__dirname, 'tmp'), function (err) {
    if (err) throw err

    ncp(path.join(__dirname, 'samples'), path.join(__dirname, 'tmp'), function (err) {
      if (err) throw err

      if (run(path.join(__dirname, 'tmp', 'main.js')) !== 42) {
        throw new Error('test preparation failed.')
      }

      if (run(path.join(__dirname, 'tmp', 'animal.js')) !== 'giraffe') {
        throw new Error('test preparation failed.')
      }

      console.log( 'preparation successful' )
      next()
    })
  })
}

function cleanup (done) {
  rimraf('./test/tmp', function () {
    console.log('deleted ./test/tmp')
    mkdirp('./test/tmp', function (err) {
      if (err) throw err
      console.log('created empty directory ./test/tmp')
      done()
    })
  })
}
function exec (cmd, callback) {
  cmd = cmd.split(/\s+/)
  var spawn = childProcess.spawn(cmd[0], cmd.slice(1))

  var buffer = ''

  spawn.stdout.on('data', function (chunk) {
    buffer += chunk.toString('utf8')
  })

  spawn.stderr.on('data', function (chunk) {
    buffer += chunk.toString('utf8')
  })

  spawn.on('exit', function () {
    callback(buffer)
  })

  return spawn
}

test('exit when no files are being watched', function (t) {
  t.timeoutAfter(3000)

  prepare(function () {
    exec('node ' + path.join(__dirname, 'test-unwatch.js'), function (buffer) {
      var expected = [
        'watching filepath: ' + path.join(__dirname, 'tmp', 'unwatch.js'),
        'HOT file: ' + path.join(__dirname, 'tmp', 'unwatch.js'),
        'init [file]: ' + path.join(__dirname, 'tmp', 'unwatch.js'),
        'result: 999',
        'deleted watcher.filepaths[ $fp ] from watcher.id: 1'
        .replace(
          '$fp',
          path.join(__dirname, 'tmp', 'unwatch.js')
        ),
        'fileWatcher without depending watchers -- destroying: ' + path.join( __dirname, 'tmp', 'unwatch.js' ),
        'fileWatcher destroyed -- [file]: ' + path.join(__dirname, 'tmp', 'unwatch.js') + ' (exists: true)',
        ''
      ].join('\n')

      t.equal(
        buffer,
        expected,
        'exited successfully with expected output'
      )

      t.end()
    })
  }) // prepare
})

test('watch a single file', function (t) {
  t.timeoutAfter(2500, 'failed to stop watching')

  prepare(function () {
    var expected = [
      ''
      , 'change: 64'
      , 'change: 88'
      , 'unlink'
      , 'add: 11'
    ]
    var buffer = ['']

    var filepath = path.join(__dirname, 'tmp', 'main.js')
    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'add':
          buffer.push('add: ' + run( filepath ))
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail('unlink event FAILURE (File still exists)')
          } catch (err) {
            t.equal(err.code, 'ENOENT', 'unlink event OK (ENOENT)')
            buffer.push('unlink')
          }
          break

        case 'change':
          buffer.push('change: ' + run( filepath ))
          break
      }
    })

    var actions = [
      function () {
        fs.writeFileSync( filepath, 'module.exports = 64' )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = 88' )
      },
      function () {
        rimraf.sync( filepath )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = 11' )
      },
    ]

    setTimeout(next, 200)
    function next () {
      var a = actions.shift()
      if (a) {
        a()
        setTimeout(next, 200)
      } else {
        setTimeout(finish, 300)
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        miteru.getStatus().files,
        [
          filepath,
          path.join( filepath, '..' ) // due to awaitDirectory function
        ],
        'expected files still being watched'
      )

      t.equal(
        miteru.getStatus().listeners_length,
        2,
        '2 listener still active as expected'
      )

      w.unwatch( filepath )

      t.deepEqual(
        miteru.getStatus().files,
        [
          path.join( filepath, '..' ) // due to awaitDirectory function
        ],
        'only awaitDir file still being watched'
      )

      t.equal(
        miteru.getStatus().listeners_length,
        1,
        '1 listener still active as expected'
      )

      w.close()

      t.deepEqual(
        miteru.getStatus().files,
        [],
        'no more fileWatchers are active'
      )

      t.equal(
        miteru.getStatus().listeners_length,
        0,
        'no more file event listeners'
      )

      t.end()
    }
  })
})

test('watch a bunch of files many times', function (t) {
  t.timeoutAfter(8000, 'failed to stop watching')

  cleanup(function () {
    var filepath1 = path.join(__dirname, 'tmp', 'giraffe.js')
    var filepath2 = path.join(__dirname, 'tmp', 'whale.css')
    var filepath3 = path.join(__dirname, 'tmp', 'monkey')

    fs.writeFileSync(filepath1, 'hello giraffe')
    fs.writeFileSync(filepath2, 'hello whale')
    fs.writeFileSync(filepath3, 'hello monkey')

    var expectations1 = [
      filepath1,
      filepath2,
      filepath3,
      filepath3,
      filepath2,
      filepath1,
      filepath3
    ]

    var expectations2 = [
      filepath2,
      filepath3,
      filepath2,
      filepath3
    ]

    var last_mtime1
    var last_mtime2

    // var w1 = miteru.create()
    // var w2 = miteru.create()

    var w1 = miteru.watch()
    var w2 = miteru.watch()

    w1.add( filepath1 )
    w1.add( filepath2 )
    w1.add( filepath3 )

    w2.add( filepath2 )
    w2.add( filepath3 )

    var buffer1 = []
    var buffer2 = []

    w1.setCallback(function ( evt, filepath ) {

      // if (last_mtime1 && last_mtime1 > info.mtime) t.fail('last_mtime not as expected')
      // last_mtime1 = info.mtime

      if (evt === 'change') {
        buffer1.push( filepath )
      }
    })

    // w1.on('modification', function (info) {
    //   if (last_mtime1 && last_mtime1 > info.mtime) t.fail('last_mtime not as expected')
    //   last_mtime1 = info.mtime
    //   buffer1.push(info.filepath)
    // })

    w2.setCallback(function ( evt, filepath ) {
      var info

      // if (last_mtime2 && last_mtime2 > info.mtime) t.fail('last_mtime not as expected')
      // last_mtime2 = info.mtime

      if (evt === 'change') {
        buffer2.push( filepath )
      }
    })

    // w2.on('modification', function (info) {
    //   if (last_mtime2 && last_mtime2 > info.mtime) t.fail('last_mtime not as expected')
    //   last_mtime2 = info.mtime
    //   buffer2.push(info.filepath)
    // })

    function next () {
      var a = actions.shift()
      if (a) {
        a()
      } else {
        console.log('no more actions')
        t.timeoutAfter(1000, 'failed to stop watching after finishing tests')

        t.equal(
          actions.length,
          0,
          'no more actions'
        )

        t.deepEqual(
          buffer1,
          expectations1,
          'expected output from w1'
        )

        t.deepEqual(
          buffer2,
          expectations2,
          'expected output from w2'
        )

        t.equal(
          miteru.getStatus().files_length,
          3,
          '3 unique files still being watched'
        )

        t.equal(
          miteru.getStatus().listeners_length,
          5,
          '5 event listeners active across the watched files'
        )

        w1.close()
        console.log('w1 cleared')

        t.equal(
          miteru.getStatus().listeners_length,
          2,
          '2 event listeners active across the watched files (w2 still active)'
        )

        t.equal(
          miteru.getStatus().files_length,
          2,
          '2 unique files still being watched (w2 still active)'
        )

        t.deepEqual(
          miteru.getStatus().files,
          [filepath2, filepath3],
          'filepath2 and filepath3 still being watched (w2 still active)'
        )

        console.log('w2 unwatch filepath2')
        w2.unwatch(filepath2)

        t.equal(
          miteru.getStatus().files_length,
          1,
          '1 unique files still being watched (w2 still active)'
        )

        t.deepEqual(
          miteru.getStatus().files,
          [filepath3],
          'filepath3 still being watched (w2 still active)'
        )

        w2.close()
        console.log('w2 cleared')

        t.equal(
          miteru.getStatus().files_length,
          0,
          '0 files being watched'
        )

        t.deepEqual(
          miteru.getStatus().files,
          [],
          'no files being watched'
        )

        t.equal(miteru.getStatus().listeners_length,
          0,
          '0 file event listeners'
        )

        t.end()
      }
    }

    var actions = [
      function () {
        fs.writeFileSync(filepath1, 'hello giraffe')
        console.log('file written: ' + filepath1)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath2, 'hello whale')
        console.log('file written: ' + filepath2)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath3, 'hello monkey')
        console.log('file written: ' + filepath3)
        // mtimes use full second (1000ms intervals) precision
        // so must wait at minimum a full second before 'modification' events
        // can occur on the same file again
        setTimeout(next, 1500)
      },
      function () {
        console.log('w2 unwatch filepath3')
        w2.unwatch( filepath3 ) // unwatch file
        fs.writeFileSync(filepath3, 'hello monkey')
        console.log('file written: ' + filepath3)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath2, 'hello whale')
        console.log('file written: ' + filepath2)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath1, 'hello giraffe')
        console.log('file written: ' + filepath1)
        setTimeout(next, 1500)
      },
      function () {
        console.log('w2 re-watch filepath3')
        w2.add( filepath3 ) // rewatch previously unwatched file
        fs.writeFileSync(filepath3, 'hello monkey')
        console.log('file written: ' + filepath3)
        setTimeout(next, 300)
      }
    ]

    setTimeout(next, 1000)
  })
})

/*
test('watch a single file', function (t) {
  t.timeoutAfter(1500)
  t.plan(2 + 4)

  prepare(function () {
    var expected = [
      ''
      , 'modification: 64'
      , 'modification: 88'
      , 'unlink'
      , 'add: 11'
    ]
    var buffer = ['']

    var filepath = path.join(__dirname, 'tmp', 'main.js')
    var w = miteru.create()
    w.watch( filepath )

    w.on('add', function () {
      buffer.push('add: ' + run( filepath ))
    })

    w.on('unlink', function () {
      try {
        fs.readFileSync( filepath )
        t.fail('unlink event FAILURE (File still exists)')
      } catch (err) {
        t.equal(err.code, 'ENOENT', 'unlink event OK (ENOENT)')
        buffer.push('unlink')
      }
    })

    w.on('modification', function () {
      buffer.push('modification: ' + run( filepath ))
    })

    var actions = [
      function () {
        fs.writeFileSync( filepath, 'module.exports = 64' )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = 88' )
      },
      function () {
        rimraf.sync( filepath )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = 11' )
      },
    ]

    setTimeout(next, 200)
    function next () {
      var a = actions.shift()
      if (a) {
        a()
        setTimeout(next, 200)
      } else {
        setTimeout(finish, 300)
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.equal(
        miteru.getStatus().files_length,
        1,
        '1 file still being watched as expected'
      )
      t.equal(
        miteru.getStatus().listeners_length,
        1,
        '1 listener still active as expected'
      )

      w.close()

      t.equal(
        miteru.getStatus().files_length,
        0,
        'no more files being watched'
      )
      t.equal(
        miteru.getStatus().listeners_length,
        0,
        'no more file event listeners'
      )
    }
  })
})

test('watch a bunch of files many times', function (t) {
  t.plan(13)

  cleanup(function () {
    var filepath1 = path.join(__dirname, 'tmp', 'giraffe.js')
    var filepath2 = path.join(__dirname, 'tmp', 'whale.css')
    var filepath3 = path.join(__dirname, 'tmp', 'monkey')

    fs.writeFileSync(filepath1, 'hello giraffe')
    fs.writeFileSync(filepath2, 'hello whale')
    fs.writeFileSync(filepath3, 'hello monkey')

    var expectations1 = [
      filepath1,
      filepath2,
      filepath3,
      filepath3,
      filepath2,
      filepath1,
      filepath3
    ]

    var expectations2 = [
      filepath2,
      filepath3,
      filepath2,
      filepath3
    ]

    var last_mtime1
    var last_mtime2

    var w1 = miteru.create()
    var w2 = miteru.create()

    w1.watch( filepath1 )
    w1.watch( filepath2 )
    w1.watch( filepath3 )

    w2.watch( filepath2 )
    w2.watch( filepath3 )

    var buffer1 = []
    var buffer2 = []

    w1.on('modification', function (info) {
      if (last_mtime1 && last_mtime1 > info.mtime) t.fail('last_mtime not as expected')
      last_mtime1 = info.mtime
      buffer1.push(info.filepath)
    })

    w2.on('modification', function (info) {
      if (last_mtime2 && last_mtime2 > info.mtime) t.fail('last_mtime not as expected')
      last_mtime2 = info.mtime
      buffer2.push(info.filepath)
    })

    function next () {
      var a = actions.shift()
      if (a) {
        a()
      } else {
        console.log('no more actions')
        t.timeoutAfter(1000, 'failed to stop watching after finishing tests')

        t.equal(
          actions.length,
          0,
          'no more actions'
        )

        t.deepEqual(
          buffer1,
          expectations1,
          'expected output from w1'
        )

        t.deepEqual(
          buffer2,
          expectations2,
          'expected output from w2'
        )

        t.equal(
          miteru.getStatus().files_length,
          3,
          '3 unique files still being watched'
        )

        t.equal(
          miteru.getStatus().listeners_length,
          5,
          '5 event listeners active across the watched files'
        )

        w1.clear()
        console.log('w1 cleared')

        t.equal(
          miteru.getStatus().listeners_length,
          2,
          '2 event listeners active across the watched files (w2 still active)'
        )

        t.equal(
          miteru.getStatus().files_length,
          2,
          '2 unique files still being watched (w2 still active)'
        )

        t.deepEqual(
          miteru.getStatus().files,
          [filepath2, filepath3],
          'filepath2 and filepath3 still being watched (w2 still active)'
        )

        console.log('w2 unwatch filepath2')
        w2.unwatch(filepath2)

        t.equal(
          miteru.getStatus().files_length,
          1,
          '1 unique files still being watched (w2 still active)'
        )

        t.deepEqual(
          miteru.getStatus().files,
          [filepath3],
          'filepath3 still being watched (w2 still active)'
        )

        w2.clear()
        console.log('w2 cleared')

        t.equal(
          miteru.getStatus().files_length,
          0,
          '0 files being watched'
        )

        t.deepEqual(
          miteru.getStatus().files,
          [],
          'no files being watched'
        )

        t.equal(miteru.getStatus().listeners_length,
          0,
          '0 file event listeners'
        )
      }
    }

    var actions = [
      function () {
        fs.writeFileSync(filepath1, 'hello giraffe')
        console.log('file written: ' + filepath1)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath2, 'hello whale')
        console.log('file written: ' + filepath2)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath3, 'hello monkey')
        console.log('file written: ' + filepath3)
        // mtimes use full second (1000ms intervals) precision
        // so must wait at minimum a full second before 'modification' events
        // can occur on the same file again
        setTimeout(next, 1500)
      },
      function () {
        console.log('w2 unwatch filepath3')
        w2.unwatch( filepath3 ) // unwatch file
        fs.writeFileSync(filepath3, 'hello monkey')
        console.log('file written: ' + filepath3)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath2, 'hello whale')
        console.log('file written: ' + filepath2)
        setTimeout(next, 300)
      },
      function () {
        fs.writeFileSync(filepath1, 'hello giraffe')
        console.log('file written: ' + filepath1)
        setTimeout(next, 1500)
      },
      function () {
        console.log('w2 re-watch filepath3')
        w2.watch( filepath3 ) // rewatch previously unwatched file
        fs.writeFileSync(filepath3, 'hello monkey')
        console.log('file written: ' + filepath3)
        setTimeout(next, 300)
      }
    ]

    setTimeout(next, 1000)
  })
})

*/

// not really necessary since ./test/tmp is .gitignored and .npmignored
test('cleanup test files', function (t) {
  t.plan(1)

  t.timeoutAfter(1500, 'failed to stop watching')

  rimraf(path.join(__dirname, 'tmp'), function () {
    try {
      fs.readFileSync( path.join(__dirname, 'tmp') )
    } catch (err) {
      t.equal(
        err.code,
        'ENOENT',
        './test/tmp directory not found (as expected)'
      )
    }
  })
})

