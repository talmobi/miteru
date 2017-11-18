var fs = require( 'fs' )
var path = require( 'path' )
var minimatch = require( 'minimatch' )

function log () {
  // console.log.apply( this, arguments )
}

function glob ( pattern, opts, callback ) {
  var filesFound = {}
  opts = opts || {}

  if ( typeof opts === 'function' ) {
    callback = opts
    opts = {}
  }

  var globstar = false

  if ( pattern.indexOf( '**' ) >= 0 ) globstar = true

  var ignoreList = ( opts.ignore || opts.ignored || [] )

  if ( !( ignoreList instanceof Array ) ) ignoreList = [ ignoreList ]

  ignoreList.push( '**/node_modules/**' )
  ignoreList.push( 'node_modules' )

  // ignore dotfiles
  ignoreList.push( '**/.*' )

  var MAX_DEPTH = 6

  var firstStarIndex = pattern.indexOf( '*' )

  var root = ( pattern.slice( 0, firstStarIndex ) || '.' )

  log( 'root: ' + root )

  // yolo into the disk
  yolo( root, 1, MAX_DEPTH )

  var callbacks = 1
  var callbacksFinished = 0

  var _timeout
  function finishCallback () {
    callbacksFinished++

    clearTimeout( _timeout )
    _timeout = setTimeout( function () {
      log( callbacks + ' /  ' + callbacksFinished )
      if ( callbacks === callbacksFinished ) {
        // we're done!
        var keys = Object.keys( filesFound )
        log( 'finished! files found: ' + keys.length )
        callback( null, keys )
      }
    }, 100 )
  }

  function add () {
    callbacks++
  }

  function yolo ( dirpath, depth, MAX_DEPTH ) {
    if ( !MAX_DEPTH ) MAX_DEPTH = 6

    log( 'yoloing ' + depth + ' / ' + MAX_DEPTH )

    add()
    fs.readdir( dirpath, function ( err, files ) {
      finishCallback()

      if ( err ) throw err

      files.forEach( function ( file ) {
        log( 'path: ' + file )
        var filepath = path.join( dirpath, file )
        file = filepath

        add()
        fs.stat( file, function ( err, stats ) {
          finishCallback()

          if ( err ) throw err

          for ( var i = 0; i < ignoreList.length; i++ ) {
            var ignorePattern = ignoreList[ i ]
            var shouldIgnore = minimatch( file, ignorePattern )
            if ( shouldIgnore ) return
          }

          if ( stats.isDirectory() ) {
            log( 'dir: ' + file )

            // TODO yolo level deeper
            if ( globstar ) {
              if ( depth < MAX_DEPTH ) {
                yolo( file, depth + 1 )
              } else {
                log( 'MAX_DEPTH reached: ' + depth + ' / ' + MAX_DEPTH )
              }
            }
          } else if ( stats.isFile() ) {
            log( 'file: ' + file )

            var matches = minimatch( file, pattern )
            if ( matches ) {
              filesFound[ file ] = file
              log( 'found match: ' + file )
            }
          }
        } )
      } )
    } )
  }
}

glob.hasMagic = function ( pattern ) {
  return ( pattern.indexOf( '*' ) >= 0 )
}

module.exports = glob

// myglob( 'test/tmp/**.css', function ( files ) {
//   console.log( files )
// } )
