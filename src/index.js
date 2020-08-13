// var rimraf = require('rimfraf')
// rimraf.sync('tmp')

var fs = require( 'fs' )
var path = require( 'path' )

var minimatch = require( 'minimatch' )

var ALWAYS_COMPARE_FILECONTENT = false

var MAX_ATTEMPTS = 5
var ATTEMPT_INTERVAL = 25 // milliseconds

var START_TIME = Date.now()

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
  COLDEST: {
    INTERVAL: 625
  },
  DORMANT: {
    INTERVAL: 200
  }
}

var DEBUG = {
  FILE: false,
  TEMPERATURE: false,
  ENOENT: false,
  LOG: false,
  EVT: true,
  DEV: false
}

function debugLog ( type, msg ) {
  if ( DEBUG[ type.toUpperCase() ] ) {
    console.log( msg )
  }
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

var _running = true

// list of all files being watched ( and continuously polled )
var _fileWatchers = {}

// list of the most active files being watched ( and are thus
// prioritised for polling ( faster polling ) )
var _activeList = []

var _options = {
  // minimum polling interval per file
  minInterval: undefined
}

// cleanup
process.on( 'exit', function () {
  _running = false

  Object.keys( _fileWatchers ).forEach( function ( key ) {
    var fw = _fileWatchers[ key ]
    fw && fw.close()
  } )
} )

var api = module.exports = {}

api.getWatched = function getWatched () {
  // TODO caching? premature optimization?
  // JavaScript doesn't guarantee ordering here so we sort
  // it alphabetically for consistency
  return Object.keys( _fileWatchers ).sort()
}

api.getPollingInterval = function getPollingInterval ( file ) {
  var filepath = path.resolve( file )
  var fw = _fileWatchers[ filepath ]
  return fw && fw.pollInterval
}

// return internal fw object
// TODO check pollInterval and temperature
api._getFileWatcher = function _getFileWatcher ( file ) {
  var filepath = path.resolve( file )
  return _fileWatchers[ filepath ]
}

api._activeList = _activeList

api.getStats = function getStats () {
  var s = Object.assign( {}, api._stats )
  delete s.report
  return s
}

api.reset = function reset () {
  Object.keys( _fileWatchers ).forEach( function ( key ) {
    var fw = _fileWatchers[ key ]
    fw && fw.close()
    delete _fileWatchers[ key ]
  } )
  _activeList.length = 0

  api._NOEXISTS_SLEEP_DELAY = ( 1000 * 15 )
  api._NOEXIST_INTERVAL = 400 // special polling interval for files that do not exist

  api._MAX_ACTIVE_LIST_LENGTH = 6
  api._CPU_SMOOTHING_DELAY = 3000 // milliseconds

  api._stats = {
    report: !!getEnv( 'MITERU_STATS' ),
    cpu: 45,
    cpus: [ 45, 45, 45 ],
    pollCounter: 0,
    maxPollTime: 0,
    minPollTime: 999999,
    // extra polling time based on number of files watched
    extraTime: 100
  }

  delete api._disableCpuSmoothing
}

api.reset()

var _watcherIds = 1

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
    id: _watcherIds++,
    opts: opts || {},
    files: {},
    callback: callback,
    evtCallbacks: {},
    fileCounter: 0
  }

  // set initFlagged for files added to the watcher within the same tick (event loop) (files added on/during init).
  var _initFlagged = true
  setTimeout( function () {
    // turn the flag off for all other files added after the first tick (event loop) (on/during init).
    _initFlagged = false
  }, 0 )

  watcher.add = function add ( file ) {
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
          if ( err ) {
            if ( !( err instanceof Array ) ) err = [ err ]
            err.forEach( function ( e ) {
              console.error( e && e.err && e.err.message )
              throw e
            } )
          }

          // console.log( 'glob finished' )

          files.forEach( function ( file ) {
            // console.log( 'file: ' + file )
            // ignore patterns matching node_modules files
            if ( file.indexOf( 'node_modules' ) === -1 ) {
              watchFile( watcher, file, initFlagged )
            }
          } )

          statsFunction.start()
        }
      )
    } else {
      // is a single file path
      watchFile( watcher, file, initFlagged )
      statsFunction.start()
    }

    return watcher // chaining
  }

  watcher.on = function on ( evt, callback ) {
    watcher.evtCallbacks[ evt ] = watcher.evtCallbacks[ evt ] || []
    watcher.evtCallbacks[ evt ].push( callback )

    // return off function
    return function off () {
      var i = watcher.evtCallbacks[ evt ].indexOf( callback )
      if ( i !== -1 ) {
        return watcher.evtCallbacks[ evt ].splice( i, 1 )
      }
    }
  }

  watcher._setDebugFlag = function _setDebugFlag ( file, key, value ) {
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

  watcher.unwatch = function unwatch ( file ) {
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

    return watcher // chaining
  }

  watcher.getWatched = function getWatched () {
    // TODO caching? premature optimization?
    // JavaScript doesn't guarantee ordering here so we sort
    // it alphabetically for consistency
    return Object.keys( watcher.files ).sort()
  }

  watcher.getLog = function getLog ( file ) {
    var filepath = path.resolve( file )

    var fw = watcher.files[ filepath ]
    var o = {}

    if ( !fw ) return undefined

    Object.keys( fw.log ).forEach( function ( key ) {
      o[ key ] = fw.log[ key ]
    } )

    return fw.log
  }

  watcher.close = function close () {
    Object.keys( watcher.files ).forEach( function ( filepath ) {
      unwatchFile( watcher, filepath )
    } )

    watcher.add = function () {
      throw new Error( 'watcher has been closed.' )
    }

    watcher.watch = function () {
      throw new Error( 'watcher has been closed.' )
    }

    // JavaScript functions return 'undefined' by default -- but
    // explicitly writing it here as it is intended
    // behaviour because after a watcher is closed it stays closed.
    // And attempting to chain it is, and is supposed to be, an error.
    return undefined // ( default behavour ) ( no chaining )
  }

  // helper function
  watcher.clear = function clear () {
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

function statsFunction () {
  var _lastCpuUsage = {}
  if ( process.cpuUsage ) {
    _lastCpuUsage = process.cpuUsage()
  }

  var _lastCpuUsageTime = Date.now()

  statsFunction.reset = function reset () {
    clearTimeout( statsFunction.timeout )
    statsFunction.timeout = undefined
    statsFunction.time = Date.now()
    _lastCpuUsage = {}
    _lastCpuUsageTime = Date.now()
  }

  function usage () {
    if ( !process.cpuUsage ) {
      return '???'
    }

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

  statsFunction.start = function () {
    if ( statsFunction.timeout === undefined ) {
      clearTimeout( statsFunction.timeout )
      statsFunction.timeout = setTimeout( statsTick, 1000 )
    }
  }

  statsFunction.time = Date.now()
  function statsTick () {
    if ( Object.keys( _fileWatchers ).length > 0 ) {
      var now = Date.now()
      var delta = ( now - statsFunction.time )

      if ( delta >= 1000 ) {
        statsFunction.time = now

        var _stats = api._stats
        _stats.cpus.push( usage() )
        while ( _stats.cpus.length > 3 ) _stats.cpus.shift()

        var sum = 0
        _stats.cpus.forEach( function ( cpu ) {
          sum += Number( cpu )
        } )
        _stats.cpu = Math.round( sum / _stats.cpus.length )

        var fileCount = Object.keys( _fileWatchers ).length

        _stats.extraTime = Math.round( Math.pow( fileCount / 75, 1.45 ) )

        if ( _stats.report ) {
          console.log( '[miteru]: files: ' + fileCount )
          console.log( '[miteru]: cpu usage: ' + _stats.cpu )
          console.log( '[miteru]: poll counter: ' + _stats.pollCounter )
          console.log( '[miteru]: max poll time: ' + _stats.maxPollTime )
          console.log( '[miteru]: min poll time: ' + _stats.minPollTime )
          console.log( '[miteru]: extra time: ' + _stats.extraTime )
          console.log( '[miteru]: active files: ' + _activeList.length )

          if ( getEnv( 'MITERU_PROMOTION_LIST' ) ) {
            _activeList.forEach( function ( fw ) {
              console.log( 'mtime: ' + new Date( fw.mtime ).toLocaleString() + ' , filepath: ' + path.relative( process.cwd(), fw.filepath ) )
            } )
          }
        }

        _stats.pollCounter = 0
        _stats.maxPollTime = 0
        _stats.minPollTime = 999999
      }

      clearTimeout( statsFunction.timeout )
      statsFunction.timeout = setTimeout( statsTick, 1000 - delta )
    }
  }
}
statsFunction()

api.minimatch = minimatch

function watchFile ( watcher, file, initFlagged ) {
  var filepath = path.resolve( file )

  var fw = _fileWatchers[ filepath ]

  if ( fw ) {
    // already watching
    debugLog( 'log', 'file already being globally watched' )
  } else {
    // add new file watcher
    fw = createFileWatcher( filepath )
    _fileWatchers[ filepath ] = fw
  }

  if ( watcher.files[ filepath ] === fw ) {
    debugLog( 'log', '(ignored) local watcher already watching that file' )
    return
  }

  watcher.files[ filepath ] = fw
  fw.watchers[ watcher.id ] = watcher
  watcher.fileCounter++

  // initFlagged indicates that this file was added to the watch list
  // during the same tick (nodejs process tick)
  // TODO handle initFlagged separately for each local watcher?
  if ( initFlagged === true ) {
    fw.initFlagged = true
  }

  // since we have not polled yet we do not know if the
  // file actually exists on the disk already (usually it
  // does)
  fw.exists = false

  fw._promoteOnNextStat = true
}

function unwatchFile ( watcher, file ) {
  var filepath = path.resolve( file )

  var fw = _fileWatchers[ filepath ]
  var wfw = watcher.files[ filepath ]

  if ( !fw && !wfw ) {
    // already unwatched
    debugLog( 'log', '(ignored) file already unwatched' )
    return
  }

  if ( wfw ) {
    delete watcher.files[ filepath ]
    watcher.fileCounter--
  }

  if ( fw ) {
    delete fw.watchers[ watcher.id ]

    if ( isFileWatcherEmpty( fw ) ) {
      // close fileWatcher since nobody is watching it anymore
      fw.close()
    }
  }

  if ( Object.keys( _fileWatchers ).length === 0 ) {
    clearTimeout( statsFunction.timeout )
    statsFunction.timeout = undefined
  }
}

function isFileWatcherEmpty ( fw ) {
  return ( Object.keys( fw.watchers ).length <= 0 )
}

function createFileWatcher ( filepath ) {
  // console.log( 'creating fileWatcher: ' + filepath )
  filepath = path.resolve( filepath )

  var fw = {
    filepath: filepath,
    watchers: {},
    log: {}
  }

  fw.close = function () {
    clearTimeout( fw.timeout )
    // clearTimeout( fw.fileContentTimeout )
    fw.closed = true

    Object.keys( fw.watchers ).forEach( function ( key ) {
      var watcher = fw.watchers[ key ]
      // clear the file from the watch list of the watchers
      delete watcher.files[ fw.filepath ]
    } )

    delete _fileWatchers[ fw.filepath ]
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
    if ( fw._noExistsTime ) {
      var delta = ( now - fw._noExistsTime )

      // slow down polling for nonexistent files
      // that aren't hot
      if ( delta > api._NOEXISTS_SLEEP_DELAY ) {
        if ( interval < api._NOEXIST_INTERVAL ) {
          interval = api._NOEXIST_INTERVAL
        }
      }
    } else {
      fw._noExistsTime = now
    }
  } else {
    delete fw._noExistsTime
  }

  var opts = _options
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
    fw._lastPollInterval = interval
    pollFile( fw )
  }, interval )
}

function pollFile ( fw ) {
  if ( !_running ) return undefined

  if ( fw.closed ) throw new Error( 'fw is closed' )

  if ( fw.locked ) throw new Error( 'fw is locked' )
  fw.locked = true

  debugLog( 'dev', ' == fs.stat:ing == ' )

  // var isEdgy = ( fw.mtime && ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )
  // TODO rethink fs.readFileSync situation
  // ( could be that fs.stat is outdated when fs.readFileSync is performed )

  fs.stat( fw.filepath, function ( err, stats ) {
    if ( fw.closed ) {
      debugLog( 'log', 'fw has been closed' )
      return undefined
    }

    if ( fw.locked !== true ) throw new Error( 'fw was not locked prior to fs.stat' )

    if ( isFileWatcherEmpty( fw ) ) {
      // TODO -- this isn't a legit error probably
      // -> file was just removed from the watch list
      // during its polling
      debugLog( 'log', 'fw is empty during fs.stat' )
      fw.close()
      return undefined
    }

    // TODO stats
    var now = Date.now()
    if ( fw._lastPollTime ) {
      var delta = ( now - fw._lastPollTime )

      var _stats = api._stats
      var _wstats = _stats
      _wstats.pollCounter++

      // TODO keep track of max and min from currently watched files, not
      // historical max/min
      if ( delta > _wstats.maxPollTime ) _wstats.maxPollTime = delta
      if ( delta < _wstats.minPollTime ) _wstats.minPollTime = delta
    }
    fw._lastPollTime = now

    if ( err ) {
      switch ( err.code ) {
        case 'EPERM':
        case 'ENOENT':
          debugLog( 'enoent', ' === POLL ENOENT === ' )
          handleFSStatError( fw )
          break

        default: throw err
      }
    } else { // no error
      if ( stats.size <= 0 && ( fw.size !== stats.size ) ) {
        debugLog( 'dev', ' ============ size was falsy: ' + stats.size )
        if ( fw.attempts < MAX_ATTEMPTS * 2 ) {
          // handle as a potential ENOENT error, i.e., increment
          // error counter but this event alone cannot consider the file
          // non-existent -- it's a good indicator that the file is unstable
          // and might not exist soon
          fw.attempts = ( fw.attempts || 0 ) + 1 // increment attempts

          // schedule next poll faster than normal ( ATTEMPT_INTERVAL )
          unlockFile( fw )
          return schedulePoll( fw, ATTEMPT_INTERVAL * 2 )
        } else {
          // if we've exceeded attempts then assume the file exists
          // and it's intentionally empty ( of size 0 )
          debugLog( 'dev', ' consider file empty ' )
        }
      }

      debugLog( 'dev', ' == fs.stat OK == ' )

      // debugging helpers
      var debug = fw._debug
      if ( debug ) {
        if ( debug.removeAfterFSStat ) {
          debug.removeAfterFSStat = false
          // related test:
          // 'watch a new file after init removed between FSStat:ing'
          fs.unlinkSync( fw.filepath )
        }

        if ( debug.changeContentAfterFSStat ) {
          debug.changeContentAfterFSStat = false
          // related test:
          // 'watch a single file -- file content appended between FSStat:ing'

          var text = fs.readFileSync( fw.filepath ).toString( 'utf8' )
          // console.log( 'text was: ' + text )
          text += ' + "-FSStatDebug"'
          fs.writeFileSync( fw.filepath, text )
          debugLog( 'dev', 'written: ' + text )
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
        var message = ( 'only filetype of "file" is supported, found filetype [ ' + type + ' ]' )

        // emit to watchers
        Object.keys( fw.watchers ).forEach( function ( key ) {
          var watcher = fw.watchers[ key ]

          var evt = 'error'

          if ( typeof watcher.callback === 'function' ) {
            watcher.callback( evt, fw.filepath, message )
          }

          var evtCallbacks = watcher.evtCallbacks[ evt ] || []
          evtCallbacks.forEach( function ( evtCallback ) {
            return evtCallback( fw.filepath, message )
          } )

          // delete the file from being watched anymore
          delete watcher.files[ fw.filepath ]
          // delete the watcher reference from the fw
          delete fw.watchers[ key ]
        } )

        return fw.close() // stop polling the directory
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

      isEdgy && debugLog( 'dev', 'is edgy' )

      var shouldCompareFileContents = (
        ALWAYS_COMPARE_FILECONTENT ||

        // during edge case period we can't rely on mtime or file size alone
        // and we need to compare the actual contents of the file
        ( isEdgy && !skipEdgeCase )
      )

      var fileContentHasChanged

      var shouldReadFileContents = (
        !existedPreviously ||
        sizeChanged ||
        mtimeChanged ||
        shouldCompareFileContents
      )

      if ( shouldReadFileContents ) {
        debugLog( 'file', 'FILE WILL READ CONTENT   : ' + fw.filepath )
      }

      if ( shouldCompareFileContents ) {
        debugLog( 'file', 'FILE WILL COMPARE CONTENT   : ' + fw.filepath )
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

          debugLog( 'dev', 'read file contents: ' + fileContent.toString( 'utf8' ) )
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

      debugLog( 'dev', ' == 1 == ' )

      if ( fileContentHasChanged ) {
        debugLog( 'dev', 'content was: ' + fw.fileContent.toString( 'utf8' ) )
        debugLog( 'dev', 'content now: ' + fileContent.toString( 'utf8' ) )
      }

      debugLog( 'dev', ' == 2 == ' )

      if ( sizeChanged ) {
        debugLog( 'dev', 'size was: ' + fw.size )
        debugLog( 'dev', 'size now: ' + stats.size )
      }

      debugLog( 'dev', ' == 3 == ' )

      if ( mtimeChanged ) {
        debugLog( 'dev', 'mtime was: ' + fw.mtime )
        debugLog( 'dev', 'mtime now: ' + stats.mtime )
      }

      debugLog( 'dev', ' == 4 == ' )

      // update fileContent if necessary
      if ( fileContent && ( !existedPreviously || fileContentHasChanged ) ) {
        debugLog( 'dev', 'fileContent updated: ' + fileContent.toString( 'utf8' ) )
        // console.log( fileContent.toString( 'utf8' ) )
        setFileContent( fw, fileContent )
      }

      debugLog( 'dev', ' == 5 == ' )

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
          debugLog( 'dev', '  updated stats.mtime' )
          stats.mtime = new Date( newMtime )
        }

        if ( stats.size !== fileContent.length ) {
          debugLog( 'dev', (
            '  updated stats.size -- was: $was, is: $is'
              .replace( '$was', stats.size )
              .replace( '$is', fileContent.length )
          ) )
          stats.size = fileContent.length
        }
      }

      debugLog( 'dev', ' == 6 == ' )

      // update stats
      fw.type = type
      fw.exists = true
      fw.size = stats.size
      fw.mtime = stats.mtime

      if ( fw._promoteOnNextStat && fw.mtime ) {
        fw._promoteOnNextStat = false
        promote( fw )
      }

      fw._stats = stats // remember stats object

      debugLog( 'dev', ' == 7 == ' )

      // change the polling interval dynamically
      // based on how often the file is changed
      updatePollingInterval( fw )

      debugLog( 'dev', ' == 8 == ' )

      // schedule next poll
      unlockFile( fw )
      schedulePoll( fw )

      debugLog( 'dev', ' == 9 == ' )

      // trigger events
      if ( existedPreviously ) {
        debugLog( 'dev', ' == 10 == ' )

        if ( sizeChanged || mtimeChanged || fileContentHasChanged ) {
          debugLog( 'evt', 'change: ' + fw.filepath )
          debugLog( 'dev', (
            'change evt -- sizeChanged $1, mtimeChanged $2, fileContentHasChanged $3: [$4]'
              .replace( '$1', sizeChanged )
              .replace( '$2', mtimeChanged )
              .replace( '$3', fileContentHasChanged )
              .replace( '$4', fw.filepath )
          ) )

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

        debugLog( 'dev', ' == 11 == ' )
      } else {
        debugLog( 'dev', ' == 12 == ' )

        if ( fw.initFlagged === true ) {
          fw.initFlagged = false
          debugLog( 'evt', 'init: ' + fw.filepath )
          debugLog( 'dev', (
            'init evt -- sizeChanged $1, mtimeChanged $2, fileContentHasChanged $3: [$4]'
              .replace( '$1', sizeChanged )
              .replace( '$2', mtimeChanged )
              .replace( '$3', fileContentHasChanged )
              .replace( '$4', fw.filepath )
          ) )
          loadEvent( fw, 'init' )
          dispatchPendingEvent( fw ) // init is safe to fire straight away
        } else {
          debugLog( 'evt', 'add: ' + fw.filepath )
          debugLog( 'dev', (
            'add evt -- sizeChanged $1, mtimeChanged $2, fileContentHasChanged $3: [$4]'
              .replace( '$1', sizeChanged )
              .replace( '$2', mtimeChanged )
              .replace( '$3', fileContentHasChanged )
              .replace( '$4', fw.filepath )
          ) )
          loadEvent( fw, 'add' )
        }

        debugLog( 'dev', ' == 13 == ' )
      }
    }
  } )
}

function handleFSStatError ( fw ) {
  var existedPreviously = ( fw.exists === true )

  fw.attempts = ( fw.attempts || 0 ) + 1 // increment attempts

  if ( typeof fw.filepath !== 'string' ) {
    console.log( 'filepath was not a string!' )
    return process.exit( 1 )
  }

  var fileShouldExist = ( existedPreviously || fw.initFlagged )

  if ( fileShouldExist ) {
    // file existed previously, assume that it should still
    // exist and attempt to fs.stat it again.
    // or if the file was added on init -- assume that it should
    // exist ( or will exist within a few milliseconds [*] )
    // [*] within (MAX_ATTEMPTS * ATTEMPT_INTERVAL) milliseconds

    // MAX_ATTEMPTS exceeded and not uncertain error event type
    if ( fw.attempts > MAX_ATTEMPTS ) {
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
      debugLog( 'evt', 'unlink: ' + fw.filepath )
      debugLog( 'dev', (
        'unlink evt -- [$4]'
          .replace( '$4', fw.filepath )
      ) )
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

      // emit to watchers
      Object.keys( fw.watchers ).forEach( function ( key ) {
        var watcher = fw.watchers[ key ]

        if ( typeof watcher.callback === 'function' ) {
          watcher.callback( evt, fw.filepath, fw._stats )
        }

        var evtCallbacks = watcher.evtCallbacks[ evt ] || []
        evtCallbacks.forEach( function ( evtCallback ) {
          return evtCallback( fw.filepath, fw._stats )
        } )
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

  if ( fw._eventReadyToFire ) {
    debugLog( 'dev', (
      'unfired triggered overriden with new [$1] -> [$2]'
        .replace( '$1', fw._eventReadyToFire )
        .replace( '$2', evt )
    ) )
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

// keep track of the top ( _MAX_ACTIVE_LIST_LENGTH ) actively changing files
// by setting their active flag thus prioritizing their polling
function promote ( fw ) {
  if ( fw.active ) return

  var list = _activeList
  var shouldSort = false

  var maxActiveListLength = api._MAX_ACTIVE_LIST_LENGTH

  if ( list.length < maxActiveListLength ) {
    fw.active = true
    list.push( fw )
    shouldSort = true
  } else {
    // only need to compare with the last item because it's
    // pre-sorted
    var lastItem = list[ list.length - 1 ]
    var isMoreRecentlyModified = lastItem && ( fw.mtime > lastItem.mtime )
    if ( !lastItem || isMoreRecentlyModified ) {
      fw.active = true
      list.push( fw )
      shouldSort = true
    }
  }

  if ( shouldSort ) {
    list.sort( function ( a, b ) {
      return b.mtime - a.mtime
    } )
  }

  // trim and deactivate overflowing files
  while ( list.length > maxActiveListLength ) {
    var pop = list.pop()
    pop.active = false
  }
}

function updatePollingInterval ( fw ) {
  var filepath = fw.filepath

  if ( fw.type !== 'file' ) {
    fw.pollInterval = 3000
    return
  }

  var now = Date.now()
  var delta = ( now - fw.mtime )
  if ( fw ) {
    if ( delta < TEMPERATURE.HOT.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.HOT.INTERVAL ) {
        debugLog( 'temperature', 'HOT file: ' + filepath )
        fw.temperature = 'hot'
        fw.pollInterval = TEMPERATURE.HOT.INTERVAL
      }
    } else if ( delta < TEMPERATURE.SEMI_HOT.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.SEMI_HOT.INTERVAL ) {
        debugLog( 'temperature', 'SEMI_HOT file: ' + filepath )
        fw.temperature = 'semi_hot'
        fw.pollInterval = TEMPERATURE.SEMI_HOT.INTERVAL
      }
    } else if ( delta < TEMPERATURE.WARM.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.WARM.INTERVAL ) {
        debugLog( 'temperature', 'WARM file: ' + filepath )
        fw.temperature = 'warm'
        fw.pollInterval = TEMPERATURE.WARM.INTERVAL
      }
    } else if ( delta < TEMPERATURE.COLD.AGE ) {
      if ( fw.pollInterval !== TEMPERATURE.COLD.INTERVAL ) {
        debugLog( 'temperature', 'COLD file: ' + filepath )
        fw.temperature = 'cold'
        fw.pollInterval = TEMPERATURE.COLD.INTERVAL
      }
    } else {
      if ( fw.pollInterval !== TEMPERATURE.COLDEST.INTERVAL ) {
        debugLog( 'temperature', 'COLDEST file: ' + filepath )
        fw.temperature = 'coldest'
        fw.pollInterval = TEMPERATURE.COLDEST.INTERVAL
      }
    }
  }

  // if fw is not awake then cap the polling interval
  // this prevents recently modified/created files prior to watching
  // from being considered as HOT FILES, i.e., files that are
  // actively being modified
  if ( !fw._awake && !fw.active ) {
    if ( fw.pollInterval < TEMPERATURE.DORMANT.INTERVAL ) {
      fw.pollInterval = TEMPERATURE.DORMANT.INTERVAL
      fw.temperature = 'dormant'
    }
  }

  if ( !api._disableCpuSmoothing && ( ( Date.now() - START_TIME ) > api._CPU_SMOOTHING_DELAY ) ) {
    var _stats = api._stats
    var stats = _stats

    if ( stats.cpu ) {
      fw.pollInterval = (
        fw.pollInterval + Math.pow( 1 + stats.cpu, 1.75 )
      )
    }

    fw.pollInterval += stats.extraTime
  }

  if ( fw.active ) {
    // active files should always be fast
    if ( fw.pollInterval > TEMPERATURE.WARM.INTERVAL ) {
      fw.pollInterval = TEMPERATURE.WARM.INTERVAL
      fw.temperature = 'active-warm'
    }
  }

  // fw.pollInterval = fw.pollInterval * Math.log( Math.E + ( 100 / fw.pollInterval ) )
}
