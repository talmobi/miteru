// var rimraf = require('rimfraf')
// rimraf.sync('tmp')

var fs = require('fs')
var path = require('path')

var glob = require('glob')
var minimatch = require('minimatch')

var ALWAYS_COMPARE_FILECONTENT = false

var MAX_ATTEMPTS = 5
var ATTEMPT_INTERVAL = 10 // milliseconds

// some file systems round up to the nearest full second (i.e OSX)
// for file mtime, atime, ctime etc -- so in order to account for
// this edge case ( very edgy ) we need to diff the file contents
// to determine if the file has been changed
var EDGE_CASE_INTERVAL = 1000 // milliseconds

// diffing HUGE files hurts the soul so we cap it at a reasonable (TM) size..
var EDGE_CASE_MAX_SIZE = (1024 * 1024 * 15) // 15mb

// polling interval intensities based on delta time ( time since last change )
var TEMPERATURE = {
  HOT: {
    AGE: (1000 * 60 * 5), // 5 min
    INTERVAL: 33
  },
  SEMI_HOT: {
    AGE: (1000 * 60 * 15), // 15 min
    INTERVAL: 99
  },
  WARM: {
    AGE: (1000 * 60 * 60), // 60 min
    INTERVAL: 199
  },
  COLD: {
    AGE: (1000 * 60 * 60 * 3), // 3 hours
    INTERVAL: 499
  }
}

var DEBUG = {
  FILE: true,
  LOG: true,
  EVT: true,
}

DEBUG = {
  EVT: true
}

switch ( ( process.env.MITERU_LOGLEVEL || '' ).toLowerCase() ) {
  case 'silent':
  case 'silence':
  case 'quiet':
  case 'nolog':
  case 'nologging':
    DEBUG = {}
    break

  case 'temp':
  case 'temperature':
    var DEBUG = {
      TEMPERATURE: true
    }
    break

  case 'full':
  case 'all':
    var DEBUG = {
      TEMPERATURE: true,
      ENOENT: true,
      FILE: true,
      LOG: true,
      EVT: true
    }
    break

  case 'evt':
  case 'evts':
  case 'event':
  case 'events':
    DEBUG = {
      EVT: true
    }
    break

  default:
    DEBUG = {}
    break
}


function log ( msg ) {
  console.log( msg )
}

// user created watchers TODO
// (buckets of files to watch and a)
var _watchers = []

var _running = true

// cleanup
process.on('exit', function () {
  _running = false
  _watchers.forEach(function ( watcher ) {
    Object.keys( watcher.files )
      .forEach(function ( filepath ) {
        unwatchFile( watcher, filepath )
        // var fw = watcher.files[ filepath ]
        // fw.close()
        // delete watcher.files[ fw.filepath ]
      })
  })
})

var api = module.exports = {}

api.watch = function watch ( file, callback ) {
  var watcher = {
    files: {},
    callback: callback
  }

  _watchers.push( watcher )

  var initFlagged = true
  process.nextTick(function () {
    initFlagged = false
  })

  watcher.add = function ( file ) {
    var isPattern = glob.hasMagic( file )

    if ( isPattern ) {
      // is glob pattern for zero or multiple files
      var pattern = file
      glob( pattern, function ( err, files ) {
        files.forEach(function ( file ) {
          watchFile( watcher, file, initFlagged )
        })
      })
    } else {
      // is a single file path
      watchFile( watcher, file, initFlagged )
    }

    return watcher // chaining
  }

  watcher.unwatch = function ( file ) {
    var isPattern = glob.hasMagic( file )

    if ( isPattern ) {
      // is glob pattern for zero or multiple files
      var pattern = file

      var files = Object.keys( watcher.files )

      files.forEach(function ( file ) {
        var remove = minimatch( file, pattern )
        if ( remove ) {
          unwatchFile( watcher, file )
        }
      })
    } else {
      // is a single file path
      unwatchFile( watcher, file )
    }

    return watcher // chaining
  }

  watcher.getWatched = function () {
    // TODO caching? premature optimization?
    // JavaScript doesn't guarantee ordering here so we sort
    // it alphabetically for consistency
    return Object.keys( watcher.files ).sort()
  }

  watcher.close = function () {
    Object.keys( watcher.files ).forEach(function ( filepath ) {
      var fw = watcher.files[ filepath ]
      fw.close()
    })

    // JavaScript functions return 'undefined' by default -- but
    // explicitly writing it here as it is intended
    // behaviour because after a watcher is closed it stays closed.
    // And attempting to chain it is, and is supposed to be, an error.
    return undefined // ( default behavour ) ( no chaining )
  }

  // helper function
  watcher.clear = function () {
    watcher.unwatch( '**' )

    return watcher // chaining
  }

  if ( file ) {
    watcher.add( file )
  }

  return watcher
}

function watchFile ( watcher, file, initFlagged ) {
  var filepath = path.resolve( file )

  var fw = watcher.files[ filepath ]

  if ( fw ) {
    // already watching
    DEBUG.LOG && log( '(ignored) file already being watched' )
  } else {
    // add new file watcher
    var fw = createFileWatcher( watcher, filepath )

    if ( initFlagged === true ) {
      fw.initFlagged = true
    }

    watcher.files[ filepath ] = fw
  }
}

function unwatchFile ( watcher, file ) {
  var filepath = path.resolve( file )

  var fw = watcher.files[ filepath ]

  if ( fw ) {
    fw.close()
    delete watcher.files[ filepath ]
  } else {
    // already unwatched
  }
}

function createFileWatcher ( watcher, filepath ) {
  // console.log( 'creating fileWatcher: ' + filepath )
  filepath = path.resolve( filepath )

  var fw = {
    watcher: watcher,
    filepath: filepath
  }

  fw.close = function () {
    clearTimeout( fw.timeout )
    fw.closed = true
  }

  schedulePoll( fw )

  return fw
}

function unlockFile ( fw ) {
  if ( fw.locked !== true ) throw new Error( 'fw was not locked when attempting to unlock' )
  fw.locked = false
}

function schedulePoll ( fw, forcedInterval ) {
  if ( fw.locked ) throw new Error( 'fw locked' )

  var interval = ( forcedInterval || fw.pollInterval || 33 )

  if ( fw.timeout !== undefined ) throw new Error( 'fw.timeout already in progress' )

  clearTimeout( fw.timeout )
  fw.timeout = setTimeout(function () {
    fw.timeout = undefined
    pollFile( fw )
  }, forcedInterval || fw.pollInterval || 33 )
}

function pollFile ( fw ) {
  if ( fw.closed ) throw new Error( 'fw is closed' )

  if ( fw.locked ) throw new Error( 'fw is locked' )
  fw.locked = true
  fs.stat( fw.filepath, function ( err, stats ) {
    if ( fw.closed ) {
      DEBUG.LOG && log( 'fw has been closed' )
      return undefined
    }

    if ( fw.locked !== true ) throw new Error( 'fw was not locked prior to fs.stat' )

    if ( !fw.watcher.files[ fw.filepath ] ) {
      // TODO
      // fileWatcher has been removed
      var msg = 'fileWatcher has been removed'
      throw new Error( msg )
      // return undefined
    }

    if ( err ) {
      switch ( err.code ) {
        case 'ENOENT':
          DEBUG.ENOENT && log( ' === POLL ENOENT === ' )

          var existedPreviously = ( fw.exists === true )

          if ( existedPreviously || fw.initFlagged ) {
            // file existed previously, assume that it should still
            // exist and attempt to fs.stat it again.
            // or if the file was added on init -- assume that it should
            // exist (or will exist within a few milliseconds [*])
            // [*] within (MAX_ATTEMPTS * ATTEMPT_INTERVAL) milliseconds
            fw.attempts = ( fw.attempts || 0 ) + 1 // increment attempts

            if ( fw.attempts > MAX_ATTEMPTS ) { // MAX_ATTEMPTS exceeded
              // after a number of failed attempts
              // consider the file non-existent
              fw.exists = false

              if ( fw.initFlagged ) {
                // TODO -- throw error since file on init didn't exist?
                // perhaps user expects it to exist since it was added on init?
                // --
                // in any case the init phase has ended
                // for this file did it exist or not
              }

              // in any case the init phase has ended
              // for this file did it exist or not, previously or otherwise
              fw.initFlagged = false

              // TODO trigger 'unlink' event
              DEBUG.EVT && log( 'unlink: ' + fw.filepath )
              trigger( fw, 'unlink' )

              // schedule next poll
              unlockFile( fw )
              schedulePoll( fw )
            } else {
              // schedule next poll faster than usual
              unlockFile( fw )
              schedulePoll( fw, ATTEMPT_INTERVAL)
            }
          } else {
            // in any case the init phase has ended
            // for this file did it exist or not
            fw.initFlagged = false

            // file didn't exist previously so it's safe to assume
            // it still doesn't exist
            unlockFile( fw )
            schedulePoll( fw )
          }
          break
        default: throw err
      }
    } else {
      // no errors
      fw.attempts = 0 // reset attempts

      var type = 'unknown'

      if ( stats.isFile() ) {
        type = 'file'
      } else if ( stats.isDirectory() ) {
        type = 'directory'
      }

      if ( type !== 'file' ) {
        throw new Error(
          'only filetype of "file" is supported, found filetype [ ' + type + ' ]'
        )
      }

      var existedPreviously = ( fw.exists === true )

      // size change or mtime increase are good indicators that the
      // file has been modified*
      //
      // *not a 100% guarantee -- for example the file content may not have changed
      // from the previous file content -- however, we do not care if the file content
      // has not changed and we will avoid comparing/reading the file contents unless
      // necessary -- for example during EDGE_CASE_INTERVAL we will have to check
      // file contents -- or perhaps when a flag is set? ( ALWAYS_COMPARE_FILECONTENT ) TODO
      var sizeChanged = ( stats.size !== fw.size )
      var mtimeChanged = ( stats.mtime > fw.mtime )

      var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
      var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )

      var shouldCompareFileContents = ALWAYS_COMPARE_FILECONTENT || false

      if ( isEdgy && !skipEdgeCase ) {
        // during edge case period we can't rely on mtime or file size alone
        // and we need to compare the actual contents of the file
        shouldCompareFileContents = true
      }

      var fileContentHasChanged = undefined

      if ( shouldCompareFileContents ) {
        DEBUG.FILE && log( 'FILE WILL COMPARE CONTENT   : ' + fw.filepath )
      }

      var fileContent

      // only fs.readFileSync fileContent if necessary
      if ( sizeChanged || mtimeChanged || shouldCompareFileContents ) {

        try {
          fileContent = fs.readFileSync( fw.filepath )
        } catch ( err ) {
          switch ( err.code ) {
            case 'ENOENT':
              fw.attempts++
              // possibly if file is removed during a succesful fs.stat
              // -- simply let pollFile handle it (and any errors)  again
              return process.nextTick(function () {
                pollFile( fw )
              })
              break
            default: throw err
          }
        }

        if ( fw.fileContent ) {
          fileContentHasChanged = ( !fileContent.equals( fw.fileContent ) )
        }
      }

      // update fileContent if necessary
      if ( isEdgy && ( fileContentHasChanged || !fw.fileContent ) ) {
        setFileContent( fw, fileContent )
      }

      // update stats
      fw.type = type
      fw.exists = true
      fw.size = stats.size
      fw.mtime = stats.mtime

      // change the polling interval dynamically
      // based on how often the file is changed
      updatePollingInterval( fw )

      // schedule next poll
      unlockFile( fw )
      schedulePoll( fw )

      // trigger events
      if ( existedPreviously ) {
        if ( sizeChanged || mtimeChanged || fileContentHasChanged ) {
          DEBUG.EVT && log( 'change: ' + fw.filepath )
          trigger( fw, 'change' )
        }
      } else {
        if ( fw.initFlagged === true ) {
          fw.initFlagged = false
          DEBUG.EVT && log( 'init: ' + fw.filepath )
          trigger( fw, 'init' )
        } else {
          DEBUG.EVT && log( 'add: ' + fw.filepath )
          trigger( fw, 'add' )
        }
      }
    }
  })
}

function trigger ( fw, evt ) {
  if ( typeof fw.watcher.callback !== 'function' ) {
    throw new Error( 'no callback function provided for watcher instance' )
  }

  fw.watcher.callback( evt, fw.filepath )
}

function setFileContent ( fw, content ) {
  fw.fileContent = content

  // clear fileContent once EDGE_CASE_INTERVAL is no longer relevant
  clearTimeout( fw.fileContentTimeout )
  fw.fileContentTimeout = setTimeout(function () {
    delete fw.fileContent
  }, EDGE_CASE_INTERVAL)
}

// function updateStats ( fw, stats ) {
//   fw.size = stats.size
//   fw.mtime = stats.mtime
// }

function updatePollingInterval ( fw ) {
  var filepath = fw.filepath

  // if ( fw.type === 'directory' ) {
  //   fw.pollInterval = 300
  //   return
  // }

  // if ( w.type !== 'file' ) {
  //   throw new Error( 'trying to update pollInterval on non-file type [' + w.type + ']' )
  // }

  var now = Date.now()
  var delta = ( now - fw.mtime )
  if ( fw ) {
    if ( delta < TEMPERATURE.HOT.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.HOT.INTERVAL ) {
        DEBUG.TEMPERATURE && log( 'HOT file: ' + filepath )
        fw.pollInterval = TEMPERATURE.HOT.INTERVAL
      }
    } else if ( delta < TEMPERATURE.SEMI_HOT.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.SEMI_HOT.INTERVAL ) {
        DEBUG.TEMPERATURE && log( 'SEMI_HOT file: ' + filepath )
        fw.pollInterval = TEMPERATURE.SEMI_HOT.INTERVAL
      }
    } else if ( delta < TEMPERATURE.WARM.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.WARM.INTERVAL ) {
        DEBUG.TEMPERATURE && log( 'WARM file: ' + filepath )
        fw.pollInterval = TEMPERATURE.WARM.INTERVAL
      }
    } else if ( delta < TEMPERATURE.COLD.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.COLD.INTERVAL ) {
        DEBUG.TEMPERATURE && log( 'COLD file: ' + filepath )
        fw.pollInterval = TEMPERATURE.COLD.INTERVAL
      }
    }
  }
}
