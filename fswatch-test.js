var fs = require('fs')
var filepath = './test/tmp/main.js'

var timeouts = {}
var watchers = {}

function watch ( filepath ) {
  var w = fs.watch( filepath )
  var _running = true

  w.on('error', function (err) {
    console.log('err.code: ' + err.code)
    console.log(err)
  })

  w.on('change', function ( type, filename ) {
    if (!_running) return undefined

    if (type === 'rename' || type === 'unlink') {
      w.close()
      _running = false
      clearTimeout(timeouts[ filepath ])
      timeouts[ filepath ] = setTimeout(function () {
        console.log('watching: ' + filepath)
        try {
          watch( filepath )
        } catch (err) {
          console.log(' == in catch == ')
          console.log('err.code: ' + err.code)
          console.log(err)
        }
      }, 25)
    }

    var msg = ' ' + type
    msg += ', file: ' + filename
    console.log(msg)
  })
}

watch( filepath )
