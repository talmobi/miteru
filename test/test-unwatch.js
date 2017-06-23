var rimraf = require('rimraf')
var fs = require('fs')
var path = require('path')

var miteru = require('../index.js')

function run ( filepath ) {
  var resolved = require.resolve( filepath )
  delete require.cache[ resolved ]
  return require( resolved )
}

var filepath = path.join(__dirname, 'tmp', 'unwatch.js')

rimraf.sync( filepath )

var w = miteru.create()
w.watch( filepath )

w.on('add', function () {
  console.log('add: ' + run( filepath ))
  setTimeout(function () {
    w.unwatch( filepath )
  }, 100)
})

setTimeout(function () {
  fs.writeFileSync( filepath, 'module.exports = 999' )
}, 300)
