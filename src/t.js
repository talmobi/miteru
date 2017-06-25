var fs = require('fs')
var path = require('path')

var time
function stamp () {
  var now = Date.now()
  if (time) console.log('delta: ' + (now - time))
  time = now
}


time = undefined
stamp()
var files = fs.readdirSync( '.' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readdirSync( '.' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readdirSync( '.' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readdirSync( '.' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readdirSync( '.' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()


time = undefined
stamp()
var files = fs.readFileSync( 'file' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readFileSync( 'file' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readFileSync( 'file' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readFileSync( 'file' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
var files = fs.readFileSync( 'file' )
stamp()
time = undefined
console.log( 'files.length: ' + files.length )
stamp()
