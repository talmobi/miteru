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

function prepareTestFiles ( next ) {
  rimraf( 'test/tmp', function () {
    mkdirp( 'test/tmp', function ( err ) {
      if (err) throw err
      next()
    })
  })
}

function cleanup ( done ) {
  rimraf( './test/tmp', function ( err ) {
    if (err) throw err
    done()
  })
}

function verifyFileCleaning ( files ) {
  if ( !( files instanceof Array ) ) {
    files = [ files ]
  }

  var
      file,
      i,
      counter = 0

  for (i = 0; i < files.length; i++) {
    file = files[ i ]
    try {
      fs.readFileSync()
    } catch ( err ) {
      counter++
    }
  }

  return files.length === counter
}

test( 'watch a single file', function ( t ) {
  t.timeoutAfter( 2500 )

  prepareTestFiles(function () {
    var filepath = path.join( __dirname, 'tmp', 'main.js' )

    var expected = [
      ''
      , 'init: abra'
      , 'change: 88'
      , 'unlink: ' + filepath
      , 'add: 11'
      , 'change: kadabra'
      , 'change: allakhazam'
    ]

    var buffer = ['']

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ))
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break
      }
    })

    var actions = [
      function () {
        fs.writeFileSync( filepath, 'module.exports = 88' )
      },
      function () {
        rimraf.sync( filepath )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = 11' )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = "kadabra"' )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = "allakhazam"' )
      },
    ]

    setTimeout( next, 300 )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a()
        setTimeout( next, 300 )
      } else {
        finish()
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  })
})

test( 'watch a non-existing file', function ( t ) {
  t.timeoutAfter( 2500 )

  prepareTestFiles(function () {
    var filepath = path.join( __dirname, 'tmp', 'blabla.js' )

    var expected = [
      ''
      , 'unlink: ' + filepath
      , 'add: 88'
      , 'unlink: ' + filepath
      , 'add: 11'
    ]

    var buffer = ['']

    t.ok(
      verifyFileCleaning(
        [
          filepath,
        ]
      ),
      'test pre-cleaned properly'
    )

    // fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ) )
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          buffer.push( evt + ': ' + run( filepath ) )
          break
      }
    })

    var actions = [
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

    setTimeout( next, 200 )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a()
        setTimeout( next, 200 )
      } else {
        finish()
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  })
})

test( 'watch a new file after init', function ( t ) {
  t.timeoutAfter( 2500 )

  prepareTestFiles(function () {
    var filepath = path.join( __dirname, 'tmp', 'filepath.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'filepath2.js' )

    var timestamp = Date.now()

    var expected = [
      ''
      , 'init: abra'
      , 'change: 88'
      , 'unlink: ' + filepath
      , 'add: 11'
      , 'add: ' + timestamp // should be of evt type add and not init
      , 'add: 22'
    ]

    var buffer = ['']

    t.ok(
      verifyFileCleaning(
        [
          filepath,
          filepath2
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ))
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break
      }
    })

    var actions = [
      function () {
        fs.writeFileSync( filepath, 'module.exports = 88' )
      },
      function () {
        rimraf.sync( filepath )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = 11' )
      },
      function () {
        w.unwatch( filepath )
        rimraf.sync( filepath )
      },
      function () {
        w.add( filepath2 )
        var content = ( 'module.exports = ' + timestamp )
        fs.writeFileSync( filepath2, content )
      },
      function () {
        w.add( filepath )
        fs.writeFileSync( filepath, 'module.exports = 22' )
      },
    ]

    setTimeout(next, 200)

    function next () {
      var a = actions.shift()
      if ( a ) {
        a()
        setTimeout( next, 200 )
      } else {
        finish()
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [
          filepath,
          filepath2
        ],
        'expected files (2) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [ filepath2 ],
        'expected files (1) still being watched'
      )

      w.unwatch( '**' )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  })
})

test( 'exit process after watcher is closed', function ( t ) {
  t.timeoutAfter( 5000 )

  prepareTestFiles(function () {
    var filepath = path.join( __dirname, 'tmp', 'unwatch.js' )

    var expected = [
      ''
      , 'ENOENT'
      , 'module.exports = 777'
      , 'init: ' + filepath
      , 'result: 777'
      , 'watched files: ' + filepath
      , 'closing watcher instance'
      , 'exiting: 999'
    ]

    var buffer = ['']

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    process.env.MITERU_LOGLEVEL = 'silent'

    var spawn = childProcess.spawn('node', [
      path.join( __dirname, 'test-unwatch.js' )
    ])

    spawn.stdout.on( 'data', function ( data ) {
      buffer.push( data.toString( 'utf8' ) )
    })

    spawn.stderr.on( 'data', function ( data ) {
      buffer.push( data.toString( 'utf8' ) )
    })

    spawn.on( 'exit', function ( code ) {
      finish()
    })

    function finish () {
      t.deepEqual(
        buffer.map(function ( line ) {
          return line.trim()
        }),
        expected,
        'expected output OK'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  })
})
