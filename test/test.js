var rimraf = require('rimraf')
var mkdirp = require('mkdirp')

var fs = require('fs')
var path = require('path')

var miteru = require('../index.js')

var test = require('tape')

test('watch single file', function (t) {
  t.plan(1)

  rimraf('./tmp', function () {
    console.log('deleted ./tmp')

    mkdirp('./tmp', function (err) {
      if (err) throw err
      console.log('created empty directory ./tmp')

      var p = path.resolve('./tmp/app.js')
      fs.writeFileSync(p, 'hello giraffe')

      // TODO 
      var expected = {
        filepath: p,
        mtime: Math.floor(Date.now() / 1000 + 1) * 1000,
        last_mtime: Math.floor(Date.now() / 1000) * 1000,
        delta_mtime: 1000,
        type: 'modification'
      }

      var w = miteru.create()
      w.watch('./tmp/app.js')

      w.on('modification', function (info) {
        console.log(info)
        t.deepEqual(
          info,
          expected,
          'expected info output'
        )

        // should exit process since nothing else is left to watch
        w.unwatch('./tmp/app.js')
      })

      setTimeout(function () {
        console.log('written file')
        fs.writeFileSync(p, 'hello giraffe 2')
      }, 1000)
    })
  })
})
