// var rimraf = require('rimfraf')
// rimraf.sync('tmp')

var MAX_ATTEMPTS = 10
var ATTEMPT_INTERVAL = 10

var EDGE_CASE_INTERVAL = 1000 // milliseconds
var EDGE_CASE_MAX_SIZE = (1024 * 1024 * 15) // 15mb

var fs = require('fs')
var path = require('path')

var filepath = path.resolve('file')

var _watchers = {}

var DEBUG = {
  EVENT: true
}

var _running = true

process.on('exit', function () {
  _running = false
  var filepaths = Object.keys( _watchers )
  filepaths.forEach(function ( filepath ) {
    unwatch( filepath )
  })
})

function unwatch ( filepath ) {
  filepath = path.resolve( filepath )

  var w = _watchers[ filepath ]
  if (w) {
    clearTimeout( w.timeout )
    delete _watchers[ filepath ]
  }
}

function poll ( filepath ) {
  if ( !_running ) return undefined

  var w = _watchers[ filepath ]
  clearTimeout(w.timeout)

  fs.stat(filepath, function (err, stats) {
    var w = _watchers[ filepath ]
    if (!w) return undefined // watcher has been removed
    clearTimeout(w.timeout) // just in case..

    if (err) {
      switch (err.code) {
        case 'EBUSY':
        case 'ENOTEMPTY':
        case 'EPERM':
        case 'EMFILE':
        case 'ENOENT':
          if (w.fileExists || w.forceAttempts) {
            w.attempts = (w.attempts || 0) + 1 // increment attempts
            if (w.attempts < MAX_ATTEMPTS) {
              w.timeout = setTimeout(function () {
                poll( filepath )
              }, ATTEMPT_INTERVAL) // retry very quickly
            } else { // MAX_ATTEMPTS reached
              if (err.code === 'ENOENT') {
                var shouldTriggerUnlink = w.fileExists
                w.fileExists = false
                w.forceAttempts = false
                w.attempts = 0
                if ( shouldTriggerUnlink ) {
                  // TODO trigger 'unlink'
                  DEBUG.EVENT && console.log('unlink: ' + filepath)
                  // TODO add dir watcher? == #1 ==
                  awaitFile( filepath ) // TODO
                }
              } else {
                throw err // let the user know what's going on
              }
            }
          } else { // file still doesn't exist (as expected)
            if (err.code === 'ENOENT') {
              // file still doesn't exist
              // probably issued by dir watcher on dir change?
              // TODO re-add to dir watcher? == #1 ==
            } else {
              throw err // let the user know what's going on
            }
          }
          break

        default:
          throw err // unexpected error
      }
    } else {
      var shouldTriggerAdd = !w.fileExists
      w.forceAttempts = false
      w.attempts = 0

      if ( w.fileExists ) {
        var hasChanged = ( stats.size !== w.size ) || ( stats.mtime > w.mtime )

        // check edge case
        if ( !hasChanged ) {
          var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
          var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )
          if ( isEdgy && !skipEdgeCase ) {
            // console.log( 'checking edge case, delta: ' + (
            //   Date.now() - stats.mtime
            // ))

            // need to check file contents to determine if something has changed
            if ( w.fileContent ) {
              var fileContent = fs.readFileSync( filepath )
              hasChanged = ( !fileContent.equals( w.fileContent ) )
            }

            // save fileContent temporarily
            // (for as long as the edge case applies)
            w.fileContent = fileContent

            clearTimeout( w.fileContentTimeout )
            w.fileContentTimeout = setTimeout(function () {
              delete w.fileContent // free up memory
              console.log( 'deleted w.fileContent' )
            }, EDGE_CASE_INTERVAL)
          }
        } else {
          // console.log( 'mtime or size changed' )

          var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
          var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )
          if ( isEdgy && !skipEdgeCase ) {
            // save fileContent temporarily
            // (for as long as the edge case applies)
            var fileContent = fs.readFileSync( filepath )
            w.fileContent = fileContent

            clearTimeout( w.fileContentTimeout )
            w.fileContentTimeout = setTimeout(function () {
              delete w.fileContent // free up memory
              console.log( 'deleted w.fileContent' )
            }, EDGE_CASE_INTERVAL)
          }
        }
      }

      w.fileExists = true
      w.size = stats.size
      w.mtime = stats.mtime

      if ( shouldTriggerAdd ) {
        // TODO trigger 'add'
        DEBUG.EVENT && console.log('add: ' + filepath)
      }

      if ( hasChanged ) {
        // TODO trigger 'change'
        DEBUG.EVENT && console.log('change: ' + filepath)
      }

      // var o = {
      //   filepath: filepath,
      //   mtime: stats.mtime,
      //   size: stats.size
      // }
      // console.log( o )

      // TODO support FSEvents API?
      // schedule next poll
      clearTimeout( w.timeout )
      w.timeout = setTimeout(function () {
        poll( filepath )
      }, w.pollInterval)
    }
  })
}

function watch ( filepath ) {
  filepath = path.resolve( filepath )

  var w = _watchers[ filepath ]

  if (w) { // file already being watched
    console.log( 'file already being watched: ' + filepath )
  } else {
    w = _watchers[ filepath ] = {}
    w.filepath = filepath
    w.pollInterval = 100

    try {
      var stats = fs.statSync( filepath )
      w.fileExists = true
      w.size = stats.size
      w.mtime = stats.mtime

      // prepare for edge case if necessary
      var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
      var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )
      if ( isEdgy && !skipEdgeCase ) {
        var fileContent = fs.readFileSync( filepath )
        // save fileContent temporarily
        // (for as long as the edge case applies)
        w.fileContent = fileContent

        clearTimeout( w.fileContentTimeout )
        w.fileContentTimeout = setTimeout(function () {
          delete w.fileContent // free up memory
          console.log( 'deleted w.fileContent' )
        }, EDGE_CASE_INTERVAL)
      }
    } catch (err) {
      switch (err.code) {
        case 'ENOENT':
          w.fileExists = false
          break
        default:
          throw err
      }
    }

    console.log('watching: ' + filepath + ' (exists: ' + w.fileExists + ')')

    // schedule next poll
    clearTimeout( w.timeout )
    w.timeout = setTimeout(function () {
      poll( filepath )
    }, w.pollInterval)
  }

  return w
}

var w2 = watch( filepath )
