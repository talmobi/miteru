var fs = require('fs')

var ITERATIONS = 1000 * 1
var startTime = Date.now()
var deltas = []
var name = ''

function test (callback) {
  var now = Date.now()

  fs.readdir( '.' , function (err, files) {
    if (err) throw err

    var delta = Date.now() - now
    callback( delta )
  })
}

function testSync (callback) {
  var now = Date.now()

  var files = fs.readdirSync( '.' )

  var delta = Date.now() - now
  callback( delta )
}

function run ( t, next ) {
  startTime = Date.now()
  deltas = []

  for (var i = 0; i < ITERATIONS; i++) {
    t(function ( delta ) {
      deltas.push( delta )

      if (deltas.length === ITERATIONS) {
        finish()
        next && next()
      }
    })
  }
}

name = '[    ] '
run( test, function () {
name = '[sync] '
  run( testSync )
})

function finish () {
  var sum = 0
  deltas.forEach(function ( delta ) {
    sum += delta
  })
  console.log( name + 'done, avg delta: ' + ( sum / deltas.length ))
  console.log( name + 'total time: ' + ( Date.now() - startTime ))
}
