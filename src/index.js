// var rimraf = require('rimfraf')
// rimraf.sync('tmp')

var fs = require( 'fs' )
var path = require( 'path' )

var minimatch = require( 'minimatch' )

var ALWAYS_COMPARE_FILECONTENT = false

var NOEXISTS_SLEEP_DELAY = ( 1000 * 15 )
var NOEXIST_INTERVAL = 400 // special polling interval for files that do not exist

var MAX_ATTEMPTS = 5
var ATTEMPT_INTERVAL = 10 // milliseconds

var TRIGGER_DELAY = 1

var glob = require( 'redstar' )

// some file systems round up to the nearest full second (e.g. OSX)
// for file mtime, atime, ctime etc -- so in order to account for
// this edge case ( very edgy ) we need to diff the file contents
// to determine if the file has been changed during this time
var EDGE_CASE_INTERVAL = 1000 // milliseconds

// diffing HUGE files hurts the soul so we cap it at a reasonable (TM) size..
var EDGE_CASE_MAX_SIZE = ( 1024 * 1024 * 10 ) // 15mb

// polling interval intensities based on delta time ( time since last change )
var TEMPERATURE = {
  HOT: {
    AGE: ( 1000 * 60 * 1 ), // 1 min
    INTERVAL: 50
  },
  SEMI_HOT: {
    AGE: ( 1000 * 60 * 15 ), // 15 min
    INTERVAL: 88
  },
  WARM: {
    AGE: ( 1000 * 60 * 60 * 4 ), // 4 hours
    INTERVAL: 200
  },
  COLD: {
    AGE: ( 1000 * 60 * 60 * 24 ), // 24 hours
    INTERVAL: 333
  },
  COLDEST_INTERVAL: 625,
  DORMANT_INTERVAL: 200
}

var DEBUG = {
  FILE: true,
  LOG: true,
  EVT: true
}

DEBUG = {
  EVT: true
}

// set verbosity based on getEnv variable MITERU_LOGLEVEL
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
    DEBUG = {
      TEMPERATURE: true
    }
    break

  case 'full':
  case 'all':
    DEBUG = {
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

  case 'dev':
    DEBUG = DEBUG || {}
    DEBUG.DEV = true
    break

  default:
    DEBUG = {}
    break
}

DEBUG.DEV = false
// DEBUG.TEMPERATURE = true

function getEnv ( key ) {
  var v = process.env[ key ]

  if ( v == null ) return false

  try {
    return !!JSON.parse( v )
  } catch ( err ) {
    return false
  }
}

function log ( msg ) {
  console.log( msg )
}

// user created watchers TODO
// (buckets of files to watch and a)
var _watchers = []

var _running = true

// cleanup
process.on( 'exit', function () {
  _running = false
  _watchers.forEach( function ( watcher ) {
    Object.keys( watcher.files )
      .forEach( function ( filepath ) {
        unwatchFile( watcher, filepath )
        // var fw = watcher.files[ filepath ]
        // fw.close()
        // delete watcher.files[ fw.filepath ]
      } )
  } )
} )

var api = module.exports = {}

api.watch = function watch ( file, opts, callback ) {
  if ( typeof file !== 'string' ) {
    callback = opts
    opts = file
  }

  if ( typeof opts !== 'object' ) {
    callback = opts
    opts = {}
  }

  if ( typeof callback !== 'function' ) callback = undefined

  // this object is returned by this function
  var watcher = {
    opts: opts || {},
    files: {},
    callback: callback,
    evtCallbacks: {},
    fileCounter: 0,
    stats: {
      report: opts.report || getEnv( 'MITERU_STATS' ),
      cpu: 45,
      cpus: [ 45, 45, 45 ],
      pollCounter: 0,
      maxPollTime: 0,
      minPollTime: 999999,
      extraTime: 100 // extra polling time based on number of files watched
    },
    activeList: []
  }

  var _lastCpuUsage = process.cpuUsage()
  var _lastCpuUsageTime = Date.now()

  function usage () {
    var cpuUsage = process.cpuUsage()
    var now = Date.now()

    var prevTotal = ( _lastCpuUsage.user + _lastCpuUsage.system )
    var total = ( cpuUsage.user + cpuUsage.system )
    var diff = ( total - prevTotal ) + 0.01

    var delta = ( now - _lastCpuUsageTime )
    var limit = ( delta * 1000 ) + 0.1 // microseconds to milliseconds

    var pct = (
      String( 100 * ( diff / limit ) )
        .trim()
        .slice( 0, 6 )
    )

    _lastCpuUsage = cpuUsage
    _lastCpuUsageTime = now

    return pct
  }

  var _statsTimeout
  var _statsTime = Date.now()
  function statsTick () {
    var stats = watcher.stats

    if ( Object.keys( watcher.files ).length > 0 ) {
      var now = Date.now()
      var delta = ( now - _statsTime )

      if ( delta >= 1000 ) {
        _statsTime = now

        stats.cpus.push( usage() )
        while ( stats.cpus.length > 3 ) stats.cpus.shift()

        var sum = 0
        stats.cpus.forEach( function ( cpu ) {
          sum += Number( cpu )
        } )
        stats.cpu = Math.round( sum / stats.cpus.length )

        stats.extraTime = Math.round( Math.pow( watcher.fileCounter / 75, 1.45 ) )

        if ( stats.report ) {
          console.log( '[miteru]: files: ' + watcher.fileCounter )
          console.log( '[miteru]: cpu usage: ' + stats.cpu )
          console.log( '[miteru]: poll counter: ' + stats.pollCounter )
          console.log( '[miteru]: max poll time: ' + stats.maxPollTime )
          console.log( '[miteru]: min poll time: ' + stats.minPollTime )
          console.log( '[miteru]: extra time: ' + stats.extraTime )
          console.log( '[miteru]: active files: ' + watcher.activeList.length )

          if ( getEnv( 'MITERU_PROMOTION_LIST' ) ) {
            watcher.activeList.forEach( function ( fw ) {
              console.log( 'mtime: ' + new Date( fw.mtime ).toLocaleString() + ' , filepath: ' + path.relative( process.cwd(), fw.filepath ) )
            } )
          }
        }

        stats.pollCounter = 0
        stats.maxPollTime = 0
        stats.minPollTime = 999999
      }

      clearTimeout( _statsTimeout )
      _statsTimeout = setTimeout( statsTick, 1000 - delta )
    }
  }

  _watchers.push( watcher )

  var _initFlagged = true
  setTimeout( function () {
    _initFlagged = false
  }, 0 )

  watcher.add = function ( file ) {
    var isPattern = glob.hasMagic( file )

    // scope _initFlagged for these files
    var initFlagged = _initFlagged

    if ( isPattern ) {
      // is glob pattern for zero or multiple files
      var pattern = file
      glob(
        pattern,
        {
          ignore: [ 'node_modules' ]
        },
        function ( err, files ) {
          if ( err ) throw err

          // console.log( 'glob finished' )

          files.forEach( function ( file ) {
            // console.log( 'file: ' + file )
            // ignore patterns matching node_modules files
            if ( file.indexOf( 'node_modules' ) === -1 ) {
              watchFile( watcher, file, initFlagged )
            }
          } )

          statsTick()
        }
      )
    } else {
      // is a single file path
      watchFile( watcher, file, initFlagged )
      statsTick()
    }

    return watcher // chaining
  }

  watcher.on = function ( evt, callback ) {
    watcher.evtCallbacks[ evt ] = watcher.evtCallbacks[ evt ] || []
    watcher.evtCallbacks[ evt ].push( callback )

    // return off function
    return function () {
      var i = watcher.evtCallbacks[ evt ].indexOf( callback )
      if ( i !== -1 ) {
        return watcher.evtCallbacks[ evt ].splice( i, 1 )
      }
    }
  }

  watcher._setDebugFlag = function ( file, key, value ) {
    var filepath = path.resolve( file )

    var fw = watcher.files[ filepath ]

    if ( !fw ) {
      throw new Error(
        'no fileWatcher for [$1] found'.replace( '$1', filepath )
      )
    } else {
      fw._debug = fw._debug || {}
      fw._debug[ key ] = value
    }
  }

  watcher.unwatch = function ( file ) {
    var isPattern = glob.hasMagic( file )

    if ( isPattern ) {
      // is glob pattern for zero or multiple files
      var pattern = file

      var files = Object.keys( watcher.files )

      files.forEach( function ( file ) {
        var shouldRemove = minimatch( file, pattern )
        if ( shouldRemove ) {
          unwatchFile( watcher, file )
        }
      } )
    } else {
      // is a single file path
      unwatchFile( watcher, file )
    }

    if ( Object.keys( watcher.files ).length === 0 ) {
      clearTimeout( _statsTimeout )
    }

    return watcher // chaining
  }

  watcher.getWatched = function () {
    // TODO caching? premature optimization?
    // JavaScript doesn't guarantee ordering here so we sort
    // it alphabetically for consistency
    return Object.keys( watcher.files ).sort()
  }

  watcher.getLog = function ( file ) {
    var filepath = path.resolve( file )

    var fw = watcher.files[ filepath ]
    var o = {}

    if ( !fw ) return undefined

    Object.keys( fw.log ).forEach( function ( key ) {
      o[ key ] = fw.log[ key ]
    } )

    return fw.log
  }

  watcher.close = function () {
    watcher.clear()

    Object.keys( watcher.files ).forEach( function ( filepath ) {
      var fw = watcher.files[ filepath ]
      fw.close()
    } )

    // JavaScript functions return 'undefined' by default -- but
    // explicitly writing it here as it is intended
    // behaviour because after a watcher is closed it stays closed.
    // And attempting to chain it is, and is supposed to be, an error.
    return undefined // ( default behavour ) ( no chaining )
  }

  // helper function
  watcher.clear = function () {
    watcher.unwatch( '**' )

    if ( watcher.getWatched().length !== 0 ) {
      throw new Error( 'a clear attempt did not remove all watched files!' )
    }

    return watcher // chaining
  }

  if ( file ) {
    if ( typeof file === 'string' ) {
      watcher.add( file )
    } else if ( file instanceof Array ) {
      file.forEach( function ( f ) {
        if ( f && typeof f === 'string' ) {
          watcher.add( f )
        }
      } )
    }
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
    fw = createFileWatcher( watcher, filepath )

    // initFlagged indicates that this file was added to the watch list
    // during the same tick (nodejs process tick)
    if ( initFlagged === true ) {
      fw.initFlagged = true
    }

    fw.exists = false

    promote( fw )

    watcher.fileCounter++
    watcher.files[ filepath ] = fw
  }
}

function unwatchFile ( watcher, file ) {
  var filepath = path.resolve( file )

  var fw = watcher.files[ filepath ]

  if ( fw ) {
    fw.close()
    watcher.fileCounter--
    delete watcher.files[ filepath ]
  } else {
    // already unwatched
    DEBUG.LOG && log( '(ignored) file already unwatched' )
  }
}

function createFileWatcher ( watcher, filepath ) {
  // console.log( 'creating fileWatcher: ' + filepath )
  filepath = path.resolve( filepath )

  var fw = {
    watcher: watcher,
    filepath: filepath,
    log: {}
  }

  fw.close = function () {
    clearTimeout( fw.timeout )
    fw.closed = true
  }

  // start polling the filepath
  schedulePoll( fw, 1 )

  return fw
}

function unlockFile ( fw ) {
  if ( fw.locked !== true ) throw new Error( 'fw was not locked when attempting to unlock' )
  fw.locked = false
}

function schedulePoll ( fw, forcedInterval ) {
  if ( fw.closed ) throw new Error( 'fw is closed' )
  if ( fw.locked ) throw new Error( 'fw locked' )

  var interval = (
    fw.pollInterval ||
    100
  )

  if ( fw.exists !== true ) {
    var now = Date.now()
    if ( fw._netime ) {
      var delta = ( now - fw._netime )

      // slow down polling for nonexistent files
      // that aren't hot
      if ( delta > NOEXISTS_SLEEP_DELAY ) {
        if ( interval < NOEXIST_INTERVAL ) {
          interval = NOEXIST_INTERVAL
        }
      }
    } else {
      fw._netime = now
    }
  } else {
    delete fw._netime
  }

  // if fw is not awake then cap the polling interval
  // this prevents recently modified/created files prior to watching
  // from being considered as HOT FILES, i.e., files that are
  // actively being modified
  if ( !fw._awake && !fw.active ) {
    if ( interval < TEMPERATURE.DORMANT_INTERVAL ) {
      interval = TEMPERATURE.DORMANT_INTERVAL
    }
  }

  var opts = fw.watcher.opts
  if ( opts.minInterval && interval < opts.minInterval ) {
    interval = opts.minInterval
  }

  if ( forcedInterval != null ) interval = forcedInterval

  // event is ready to be fired, FIRE FIRE FIRE!!! :D
  if ( fw._eventReadyToFire ) {
    // console.log( ' events are ready to fire, polling ASAP!' )
    interval = 1 // poll ASAP ( if the next poll is unchaged aka "stable", we fire the pending event
  }

  if ( fw.timeout !== undefined ) throw new Error( 'fw.timeout already in progress' )

  clearTimeout( fw.timeout )
  fw.timeout = setTimeout( function () {
    fw.timeout = undefined
    pollFile( fw )
  }, interval )
}

function pollFile ( fw ) {
  if ( !_running ) return undefined

  if ( fw.closed ) throw new Error( 'fw is closed' )

  if ( fw.locked ) throw new Error( 'fw is locked' )
  fw.locked = true

  getEnv( 'DEV' ) && console.log( ' == fs.stat:ing == ' )

  // var isEdgy = ( fw.mtime && ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )
  // TODO rethink fs.readFileSync situation
  // ( could be that fs.stat is outdated when fs.readFileSync is performed )

  fs.stat( fw.filepath, function ( err, stats ) {
    if ( fw.closed ) {
      DEBUG.LOG && log( 'fw has been closed' )
      return undefined
    }

    if ( fw.locked !== true ) throw new Error( 'fw was not locked prior to fs.stat' )

    if ( !fw.watcher.files[ fw.filepath ] ) {
      // TODO -- this isn't a legit error probably
      // -> file was just removed from the watch list
      // during its polling
      //
      // fileWatcher has been removed
      var msg = 'fileWatcher has been removed'
      throw new Error( msg )
      // return undefined
    }

    // TODO stats
    var now = Date.now()
    if ( fw._lastPollTime ) {
      var delta = ( now - fw._lastPollTime )

      var _wstats = fw.watcher.stats
      _wstats.pollCounter++

      if ( delta > _wstats.maxPollTime ) _wstats.maxPollTime = delta
      if ( delta < _wstats.minPollTime ) _wstats.minPollTime = delta
    }
    fw._lastPollTime = now

    if ( err ) {
      switch ( err.code ) {
        case 'EPERM':
        case 'ENOENT':
          DEBUG.ENOENT && log( ' === POLL ENOENT === ' )
          handleFSStatError( fw )
          break

        default: throw err
      }
    } else { // no error
      if ( !stats.size && ( fw.size !== stats.size ) ) {
        getEnv( 'DEV' ) && console.log( ' ============ size was falsy: ' + stats.size )
        if ( fw.attempts < MAX_ATTEMPTS ) {
          // handle as an unreliable ENOENT error, i.e., increment
          // error counter but this event alone cannot consider the file
          // non-existent -- it's a good indication that the file will be
          return handleFSStatError( fw, 'unreliable' )
        } else {
          // if we've exceeded attempts then assume the file exists
          // and it's intentionally empty ( of size 0 )
          getEnv( 'DEV' ) && console.log( ' consider file empty ' )
        }
      }

      getEnv( 'DEV' ) && console.log( ' == fs.stat OK == ' )

      // debugging helpers
      var debug = fw.watcher.files[ fw.filepath ]._debug
      if ( debug ) {
        if ( debug.removeAfterFSStat ) {
          debug.removeAfterFSStat = false
          // related test:
          // 'watch a new file after init removed between FSStat:ing'
          try {
            fs.unlinkSync( fw.filepath )
          } catch ( err ) {
            throw err
          }
        }

        if ( debug.changeContentAfterFSStat ) {
          debug.changeContentAfterFSStat = false
          // related test:
          // 'watch a single file -- file content appended between FSStat:ing'

          try {
            var text = fs.readFileSync( fw.filepath ).toString( 'utf8' )
            // console.log( 'text was: ' + text )
            text += ' + "-FSStatDebug"'
            fs.writeFileSync( fw.filepath, text )
          } catch ( err ) {
            throw err
          }
          DEBUG.DEV && console.log( 'written: ' + text )
        }
      }

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
      // file contents -- or perhaps when a flag is set? ( ALWAYS_COMPARE_FILECONTENT? )
      // TODO
      var sizeChanged = ( stats.size !== fw.size )
      var mtimeChanged = ( stats.mtime > fw.mtime )

      var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
      var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )

      var shouldCompareFileContents = ALWAYS_COMPARE_FILECONTENT || false

      if ( isEdgy && !skipEdgeCase ) {
        getEnv( 'DEV' ) && console.log( 'is edgy' )
        // during edge case period we can't rely on mtime or file size alone
        // and we need to compare the actual contents of the file
        shouldCompareFileContents = true
      }

      var fileContentHasChanged

      var shouldReadFileContents = (
        !existedPreviously ||
        sizeChanged ||
        mtimeChanged ||
        shouldCompareFileContents
      )

      if ( shouldReadFileContents ) {
        DEBUG.FILE && log( 'FILE WILL READ CONTENT   : ' + fw.filepath )
      }

      if ( shouldCompareFileContents ) {
        DEBUG.FILE && log( 'FILE WILL COMPARE CONTENT   : ' + fw.filepath )
      }

      var fileContent

      // only fs.readFileSync fileContent if necessary
      if ( shouldReadFileContents ) {
        try {
          // NOTE
          // there's a caveat here that fs.stat and fs.readFileSync
          // may be out of sync -- in other words fs.readFileSync may return
          // an updated file content that may not be reflected by the
          // size and mtime reported by the fs.stat results that came before it
          // -> this may result in two change events being emitted if left as is
          // -> in order to combat this, if we will update the mtime and size
          // to the most recent values if we detect that the file contents
          // have been updated [#1]
          fileContent = fs.readFileSync( fw.filepath )

          getEnv( 'DEV' ) && console.log( 'read file contents: ' + fileContent.toString( 'utf8' ) )
        } catch ( err ) {
          switch ( err.code ) {
            case 'EPERM':
            case 'ENOENT':
              fw.attempts++
              // possibly if file is removed between a succesful fs.stat
              // and fs.readFileSync
              // -- simply let pollFile handle it ( and any errors ) again
              // -- if the file has really been removed then the next fs.stat will
              // be able to handle it
              // console.log( 'removed between fs.stat and fs.readFileSync' )
              fw.log[ 'FSStatReadFileSyncErrors' ] = (
                ( fw.log[ 'FSStatReadFileSyncErrors' ] || 0 ) + 1
              )

              process.nextTick( function () {
                unlockFile( fw )
                schedulePoll( fw, ATTEMPT_INTERVAL )
                // pollFile( fw )
              } )
              return undefined

            default:
              console.error( 'Error between fs.stat and fs.readFileSync' )
              throw err
          }
        }
      }

      fileContentHasChanged = (
        existedPreviously &&
        fileContent &&
        fw.fileContent &&
        !( fw.fileContent.equals( fileContent ) )

        // !existedPreviously || (
        //   fileContent &&
        //   fw.fileContent &&
        //   !( fw.fileContent.equals( fileContent ) )
        // )
      )

      getEnv( 'DEV' ) && console.log( ' == 1 == ' )

      if ( fileContentHasChanged ) {
        getEnv( 'DEV' ) && console.log( 'content was: ' + fw.fileContent.toString( 'utf8' ) )
        getEnv( 'DEV' ) && console.log( 'content now: ' + fileContent.toString( 'utf8' ) )
      }

      getEnv( 'DEV' ) && console.log( ' == 2 == ' )

      if ( sizeChanged ) {
        getEnv( 'DEV' ) && console.log( 'size was: ' + fw.size )
        getEnv( 'DEV' ) && console.log( 'size now: ' + stats.size )
      }

      getEnv( 'DEV' ) && console.log( ' == 3 == ' )

      if ( mtimeChanged ) {
        getEnv( 'DEV' ) && console.log( 'mtime was: ' + fw.mtime )
        getEnv( 'DEV' ) && console.log( 'mtime now: ' + stats.mtime )
      }

      getEnv( 'DEV' ) && console.log( ' == 4 == ' )

      // update fileContent if necessary
      if ( fileContent && ( !existedPreviously || fileContentHasChanged ) ) {
        getEnv( 'DEV' ) && console.log( 'fileContent updated: ' + fileContent.toString( 'utf8' ) )
        // console.log( fileContent.toString( 'utf8' ) )
        setFileContent( fw, fileContent )
      }

      getEnv( 'DEV' ) && console.log( ' == 5 == ' )

      if ( fileContentHasChanged ) {
        // [#1]
        // update mtime and size to homogenize the
        // potential diffs between calls to fs.stat and fs.readFileSync
        //
        // Another solution could be to debounce or throttle
        // event triggering
        //
        // related test:
        // 'watch a single file -- file content appended between FSStat:ing'
        //
        // Another solution could be to test during stats.size or stats.mtime
        // change if fileContent equals to fw.fileContent then skip
        // triggering a 'change' event
        var newMtime = Date.now()
        if ( stats.mtime < newMtime ) {
          getEnv( 'DEV' ) && console.log( '  updated stats.mtime' )
          stats.mtime = new Date( newMtime )
        }

        if ( stats.size !== fileContent.length ) {
          getEnv( 'DEV' ) && console.log(
            '  updated stats.size -- was: $was, is: $is'
              .replace( '$was', stats.size )
              .replace( '$is', fileContent.length )
          )
          stats.size = fileContent.length
        }
      }

      getEnv( 'DEV' ) && console.log( ' == 6 == ' )

      // update stats
      fw.type = type
      fw.exists = true
      fw.size = stats.size
      fw.mtime = stats.mtime

      fw._stats = stats // remember stats object

      getEnv( 'DEV' ) && console.log( ' == 7 == ' )

      // change the polling interval dynamically
      // based on how often the file is changed
      updatePollingInterval( fw )

      getEnv( 'DEV' ) && console.log( ' == 8 == ' )

      // schedule next poll
      unlockFile( fw )
      schedulePoll( fw )

      getEnv( 'DEV' ) && console.log( ' == 9 == ' )

      // trigger events
      if ( existedPreviously ) {
        getEnv( 'DEV' ) && console.log( ' == 10 == ' )

        if ( sizeChanged || mtimeChanged || fileContentHasChanged ) {
          DEBUG.EVT && log( 'change: ' + fw.filepath )
          getEnv( 'DEV' ) && console.log(
            'change evt --  size $1, mtime $2, fileContent $3: [$4]'
              .replace( '$1', sizeChanged )
              .replace( '$2', mtimeChanged )
              .replace( '$3', fileContentHasChanged )
              .replace( '$4', fw.filepath )
          )

          loadEvent( fw, 'change' )
        } else {
          // fire away events ( add, change ) when file is stable
          if ( debug ) {
            if ( !debug.keepUnstable ) {
              dispatchPendingEvent( fw )
            }
          } else {
            dispatchPendingEvent( fw )
          }
        }

        getEnv( 'DEV' ) && console.log( ' == 11 == ' )
      } else {
        getEnv( 'DEV' ) && console.log( ' == 12 == ' )

        if ( fw.initFlagged === true ) {
          fw.initFlagged = false
          DEBUG.EVT && log( 'init: ' + fw.filepath )
          getEnv( 'DEV' ) && console.log(
            'init evt -- size $1, mtime $2, fileContent $3: [$4]'
              .replace( '$1', sizeChanged )
              .replace( '$2', mtimeChanged )
              .replace( '$3', fileContentHasChanged )
              .replace( '$4', fw.filepath )
          )
          loadEvent( fw, 'init' )
          dispatchPendingEvent( fw ) // init is safe to fire straight away
        } else {
          DEBUG.EVT && log( 'add: ' + fw.filepath )
          getEnv( 'DEV' ) && console.log(
            'add evt -- size $1, mtime $2, fileContent $3: [$4]'
              .replace( '$1', sizeChanged )
              .replace( '$2', mtimeChanged )
              .replace( '$3', fileContentHasChanged )
              .replace( '$4', fw.filepath )
          )
          loadEvent( fw, 'add' )
        }

        getEnv( 'DEV' ) && console.log( ' == 13 == ' )
      }
    }
  } )
}

function handleFSStatError ( fw, info ) {
  var existedPreviously = ( fw.exists === true )
  var unreliable = ( info === 'unreliable' )

  if ( existedPreviously || fw.initFlagged ) {
    // file existed previously, assume that it should still
    // exist and attempt to fs.stat it again.
    // or if the file was added on init -- assume that it should
    // exist ( or will exist within a few milliseconds [*] )
    // [*] within (MAX_ATTEMPTS * ATTEMPT_INTERVAL) milliseconds
    fw.attempts = ( fw.attempts || 0 ) + 1 // increment attempts

    // MAX_ATTEMPTS exceeded and not uncertain error event type
    if ( fw.attempts > MAX_ATTEMPTS && ( unreliable === false ) ) {
      // after a number of failed attempts
      // consider the file truly non-existent
      fw.exists = false

      if ( fw.initFlagged ) {
        // TODO -- throw error since file on init didn't exist?
        // perhaps user expects it to exist since it was added on init?
        // --
        // in any case the init phase has ended
        // for this file did it exist or not
        fw.initFlagged = false
      }

      // TODO trigger 'unlink' event
      DEBUG.EVT && log( 'unlink: ' + fw.filepath )
      getEnv( 'DEV' ) && console.log(
        'unlink evt -- [$4]'
          .replace( '$4', fw.filepath )
      )
      loadEvent( fw, 'unlink' )

      // schedule next poll
      unlockFile( fw )
      schedulePoll( fw )
    } else {
      // schedule next poll faster than normal ( ATTEMPT_INTERVAL )
      unlockFile( fw )
      schedulePoll( fw, ATTEMPT_INTERVAL )
    }
  } else {
    // in any case the init phase has ended
    // for this file did it exist or not
    fw.initFlagged = false

    // fire away events ( unlink ) when file is stable
    dispatchPendingEvent( fw )

    // file didn't exist previously so it's safe to assume
    // it still doesn't and isn't supposed to exist
    // schedule next poll normally
    unlockFile( fw )
    schedulePoll( fw )
  }
}

function dispatchPendingEvent ( fw ) {
  if ( fw._eventReadyToFire ) {
    var evt = fw._eventReadyToFire
    fw._eventReadyToFire = undefined

    clearTimeout( fw.triggerTimeout )
    fw.triggerTimeout = setTimeout( function () {
      if ( evt !== 'init' ) fw._awake = true

      if ( evt === 'init' || evt === 'add' || evt === 'change' ) {
        promote( fw )
      }

      if ( typeof fw.watcher.callback === 'function' ) {
        fw.watcher.callback( evt, fw.filepath, fw._stats )
      }

      var evtCallbacks = fw.watcher.evtCallbacks[ evt ] || []
      evtCallbacks.forEach( function ( evtCallback ) {
        return evtCallback( fw.filepath, fw._stats )
      } )
    }, TRIGGER_DELAY )
  }
}

function loadEvent ( fw, evt ) {
  // do not overwrite with 'change' events
  if ( fw._eventReadyToFire && evt === 'change' ) return undefined

  // 'add' and 'unlink' cancels each other out ( rare* )
  // *this can happen if a file is being written without being stable
  // and is then deleted ( since events are dispatched AFTER the file is stable )
  // and by stable we mean the file has not changed between two polls ( ~10 milliseconds )
  if ( fw._eventReadyToFire === 'add' && evt === 'unlink' ) {
    // console.log( ' == GIRAFFE == ' )
    fw._eventReadyToFire = undefined

    fw.log[ 'loadEventsAbortedCount' ] = (
      ( fw.log[ 'loadEventsAbortedCount' ] || 0 ) + 1
    )

    return undefined
  }

  if ( getEnv( 'DEV' ) ) {
    if ( fw._eventReadyToFire ) {
      console.log(
        'unfired triggered overriden with new [$1] -> [$2]'
          .replace( '$1', fw._eventReadyToFire )
          .replace( '$2', evt )
      )
    }
  }

  fw._eventReadyToFire = evt
}

function setFileContent ( fw, content ) {
  fw.fileContent = content

  // clear fileContent once EDGE_CASE_INTERVAL is no longer relevant
  clearTimeout( fw.fileContentTimeout )
  fw.fileContentTimeout = setTimeout( function () {
    delete fw.fileContent
  }, EDGE_CASE_INTERVAL )
}

// function updateStats ( fw, stats ) {
//   fw.size = stats.size
//   fw.mtime = stats.mtime
// }

function promote ( fw ) {
  if ( fw.active ) return

  var list = fw.watcher.activeList
  var inserted = false

  if ( fw.mtime ) {
    for ( var i = 0; i < list.length; ++i ) {
      var item = list[ i ]
      if ( ( !item.mtime || item.mtime < fw.mtime ) && item !== fw ) {
        list.splice( i, 0, fw ) // insert that shit
        fw.active = true
        // console.log( item.mtime )
        // console.log( fw.mtime )
        // console.log( 'promotion! [' + fw.filepath + ']' )
        inserted = true
        break
      }
    }
  }

  if ( !inserted && list.length < 10 ) {
    list.push( fw )
    fw.active = true
    // console.log( 'promotion pushed [' + fw.filepath + ']' )
  }

  while ( list.length > 10 ) {
    var pop = list.pop()
    pop.active = false
  }
}

function updatePollingInterval ( fw ) {
  var filepath = fw.filepath

  // if ( fw.type === 'directory' ) {
  //   fw.pollInterval = 300
  //   return
  // }

  if ( fw.type !== 'file' ) {
    throw new Error( 'trying to update pollInterval on non-file type [' + fw.type + ']' )
  }

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
    } else {
      if ( fw.pollInterval !== TEMPERATURE.COLDEST_INTERVAL ) {
        DEBUG.TEMPERATURE && log( 'COLDEST file: ' + filepath )
        fw.pollInterval = TEMPERATURE.COLDEST_INTERVAL
      }
    }
  }

  var stats = fw.watcher.stats

  if ( stats.cpu ) {
    fw.pollInterval = (
      fw.pollInterval + Math.pow( 1 + stats.cpu, 1.75 )
    )
  }

  fw.pollInterval += stats.extraTime

  if ( fw.active ) {
    // active files should always be fast
    if ( fw.pollInterval > TEMPERATURE.WARM.INTERVAL ) {
      fw.pollInterval = TEMPERATURE.WARM.INTERVAL
    }
  }

  // fw.pollInterval = fw.pollInterval * Math.log( Math.E + ( 100 / fw.pollInterval ) )
}
