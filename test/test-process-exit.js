var rimraf = require( 'rimraf' )
var fs = require( 'fs' )
var path = require( 'path' )

var miteru = require( '../src/index.js' )

function run ( filepath ) {
  var resolved = require.resolve( filepath )
  delete require.cache[ resolved ]
  return require( resolved )
}

var filepath = path.join( __dirname, 'tmp', 'cover-process-exit.js' )

rimraf.sync( filepath )

try {
  fs.readFileSync( filepath )
} catch ( err ) {
  console.log( err.code )
}

fs.writeFileSync( filepath, 'module.exports = 777' )

try {
  console.log( fs.readFileSync( filepath ).toString( 'utf8' ) )
} catch ( err ) {
  console.log( err.code )
}

var w = miteru.watch( filepath, function ( evt, filepath ) {
  console.log( evt + ': ' + filepath )
  console.log( 'result: ' + run( filepath ) )
} )

process.on( 'exit', function () {
  console.log( 'exiting: 999' )
} )

setTimeout( function () {
  console.log( 'exiting without closing to cover exit handler' )
  process.exit()
}, 300 )
