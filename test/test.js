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
  t.plan(5 + 1)

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
        t.ok(actions.length === 0, 'no more actions')
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
  t.plan(5 * 3 + 1)

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
        t.ok(actions.length === 0, 'no more actions')

        // should exit process since nothing else is left to watch
        w.unwatch('./test/tmp/app.js')
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
