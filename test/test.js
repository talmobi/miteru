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
