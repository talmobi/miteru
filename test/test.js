var rimraf = require('rimraf')
var mkdirp = require('mkdirp')

var fs = require('fs')
var path = require('path')

var miteru = require('../index.js')

var test = require('tape')

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

test('watch single file once', function (t) {
  t.plan(5 + 3)

  cleanup(function () {
    var filepath = path.resolve('./test/tmp/app.js')
    fs.writeFileSync(filepath, 'hello world')
    var now = new Date()

    var events = [
      function (info) {
        t.equal(
          info.filepath,
          filepath,
          'filepath OK'
        )
        t.ok(
          info.mtime.getTime() >= now.getTime() &&
          info.mtime.getTime() < (now.getTime() + 1500),
          'mtime OK'
        )
        t.ok(
          info.last_mtime.getTime() >= (now.getTime() - 1500) &&
          info.last_mtime.getTime() < now.getTime(),
          'last_mtime OK'
        )
        t.ok(
          info.delta_mtime >= 900,
          info.delta_mtime < 1500,
          'delta_mtime OK'
        )
        t.equal(
          info.type,
          'modification',
          'type OK'
        )
      }
    ]

    var w = miteru.create()
    w.watch('./test/tmp/app.js')

    w.on('modification', function (info) {
      var e = events.shift()

      if (e) {
        e(info)
      }

      // should exit process since nothing else is left to watch
      w.unwatch('./test/tmp/app.js')
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
    }

    var actions = [
      function () {
        fs.writeFileSync(filepath, 'hello world')
        console.log('file written: ' + filepath)
        setTimeout(next, 1000)
      }
    ]

    setTimeout(next, 1000)
  })
})

test('watch single file many times', function (t) {
  t.plan(5 * 3 + 3 + 4)

  cleanup(function () {
    var filepath = path.resolve('./test/tmp/app.js')
    fs.writeFileSync(filepath, 'hello world')
    var now = new Date()

    var events = [
      function (info) {
        t.equal(
          info.filepath,
          filepath,
          'filepath OK'
        )
        t.ok(
          info.mtime.getTime() >= now.getTime() &&
          info.mtime.getTime() < (now.getTime() + 1500),
          'mtime OK'
        )
        t.ok(
          info.last_mtime.getTime() >= (now.getTime() - 1500) &&
          info.last_mtime.getTime() < now.getTime(),
          'last_mtime OK'
        )
        t.ok(
          info.delta_mtime >= 900,
          info.delta_mtime < 1500,
          'delta_mtime OK'
        )
        t.equal(
          info.type,
          'modification',
          'type OK'
        )
        now = new Date() // update now for next event
      }
    ]

    var w = miteru.create()
    w.watch('./test/tmp/app.js')

    w.on('modification', function (info) {
      var e = events[0]

      if (e) {
        e(info)
      }
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
        t.equal(
          miteru.getStatus().files_length,
          1,
          'file still being watched'
        )
        t.equal(
          miteru.getStatus().listeners_length,
          1,
          '1 event listener active'
        )

        var w2 = miteru.create()
        w2.watch('./test/tmp/app.js')
        // w.on('modification', function () {
        //   // do nothing
        // })

        t.equal(
          miteru.getStatus().listeners_length,
          2,
          '2 event listeners active'
        )

        // should exit process since nothing else is left to watch
        w.unwatch('./test/tmp/app.js')


        t.equal(
          miteru.getStatus().listeners_length,
          1,
          '1 event listener active'
        )

        w2.unwatch('./test/tmp/app.js')

        t.equal(
          miteru.getStatus().files_length,
          0,
          'no more files being watched'
        )
        t.equal(miteru.getStatus().listeners_length,
          0,
          'no more file event listeners'
        )
      }
    }

    var actions = [
      function () {
        fs.writeFileSync(filepath, 'hello world')
        console.log('file written: ' + filepath)
        setTimeout(next, 1000)
      },
      function () {
        fs.writeFileSync(filepath, 'hello world')
        console.log('file written: ' + filepath)
        setTimeout(next, 1000)
      },
      function () {
        fs.writeFileSync(filepath, 'hello world')
        console.log('file written: ' + filepath)
        setTimeout(next, 1000)
      }
    ]

    setTimeout(next, 1000)
  })
})

test('watch a bunch of files many times', function (t) {
  t.plan(13)

  cleanup(function () {
    var filepath1 = path.resolve('./test/tmp/giraffe.js')
    var filepath2 = path.resolve('./test/tmp/whale.css')
    var filepath3 = path.resolve('./test/tmp/monkey')
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
    w1.watch('./test/tmp/giraffe.js')
    w1.watch('./test/tmp/whale.css')
    w1.watch('./test/tmp/monkey')

    w2.watch('./test/tmp/whale.css')
    w2.watch('./test/tmp/monkey')

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
        w2.unwatch('./test/tmp/monkey') // unwatch file
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
        w2.watch('./test/tmp/monkey') // rewatch previously unwatched file
        fs.writeFileSync(filepath3, 'hello monkey')
        console.log('file written: ' + filepath3)
        setTimeout(next, 300)
      }
    ]

    setTimeout(next, 1000)
  })
})

// not really necessary since ./test/tmp is .gitignored and .npmignored
test('cleanup test files', function (t) {
  t.plan(1)

  rimraf('./test/tmp', function () {
    console.log('deleted ./test/tmp')
    try {
      fs.readFileSync('./test/tmp')
    } catch (err) {
      t.equal(
        err.code,
        'ENOENT',
        './test/tmp directory not found (as expected)'
      )
    }
  })
})
