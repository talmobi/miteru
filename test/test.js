var rimraf = require('rimraf')
var mkdirp = require('mkdirp')

var fs = require('fs')
var path = require('path')

var miteru = require('../index.js')

var test = require('tape')

test('watch single file', function (t) {
  t.plan(4)

  rimraf('./test/tmp', function () {
    console.log('deleted ./test/tmp')

    mkdirp('./test/tmp', function (err) {
      if (err) throw err
      console.log('created empty directory ./test/tmp')

      var p = path.resolve('./test/tmp/app.js')
      fs.writeFileSync(p, 'hello giraffe')

      // TODO 
      var expected = {
        filepath: p,
        mtime: new Date(Math.floor(Date.now() / 1000 + 1) * 1000),
        last_mtime: new Date(Math.floor(Date.now() / 1000) * 1000),
        delta_mtime: 1000,
        type: 'modification'
      }

      var w = miteru.create()
      w.watch('./test/tmp/app.js')

      w.on('modification', function (info) {
        console.log(info)
        t.equal(
          info.filepath,
          expected.filepath,
          'filepath OK'
        )
        t.ok(
          info.mtime.getTime() >= expected.mtime.getTime()
          && info.mtime.getTime() < expected.mtime.getTime() + 1000,
          'mtime OK'
        )
        t.ok(
          info.last_mtime.getTime() >= expected.last_mtime.getTime()
          && info.last_mtime.getTime() < expected.last_mtime.getTime() + 1000,
          'last_mtime OK'
        )
        t.ok(
          info.delta_mtime >= expected.delta_mtime
          && info.delta_mtime < expected.delta_mtime + 1000,
          'delta_mtime OK'
        )

        // should exit process since nothing else is left to watch
        w.unwatch('./test/tmp/app.js')
      })

      setTimeout(function () {
        console.log('written file')
        fs.writeFileSync(p, 'hello giraffe 2')
      }, 1000)
    })
  })
})
