var fs = require('fs')
var path = require('path')

// TODO (filters?)
var _opts = {}

var _watchedFiles = {} // files being watched by miteru

// var _mtimes = {} // file mtimes
// var _files = {} // files being watched
// var _intervals = {} // variable polling intervals
// var _timeouts = {} // polling setTimeouts

// var _touched = {} // touched files (from start of process)

// var _watchers = {}
// var _textContents = {} // TODO

var defaults = {
  polling: true
}

// make sue of fs.watch for improved low cpu polling on OS X by default
var platform = require('os').platform()
if (platform === 'darwin') {
  defaults.polling = false
}

var _running = true
process.on('exit', function () {
  _running = false
  Object.keys( _watchedFiles ).forEach(function ( filepath ) {
    var wfile = _watchedFiles[filepath]
    if (wfile._fsWatch) {
      try {
        wfile._fsWatch.close()
      } catch (err) { /* ignored */ }
    }
  })
})

var HOT_FILE = (1000 * 60 * 5) // 5 minutes in ms
var SEMI_HOT_FILE = (1000 * 60 * 15) // 15 minutes in ms
var WARM_FILE = (1000 * 60 * 60) // 60 minutes in ms
var COLD_FILE = (1000 * 60 * 60 * 3) // 3 hours in ms

var INITIAL_FILE = (1000 * 60 * 1) // 1 minute in ms

var HOT_POLL_INTERVAL = 33
var SEMI_HOT_POLL_INTERVAL = 99
var WARM_POLL_INTERVAL = 200
var COLD_POLL_INTERVAL = 500
var FREEZING_POLL_INTERVAL = 800

var _startTime

// var MAX_ENOENTS = 10
var MAX_BUSY_TRIES = 10
var BUSY_TRY_INTERVAL = 10 // milliseconds

// edge case workaround requires to read in, compare and temporarily
// store the file contents -- only do this for reasonably sized files.
// The edge case applies only if a file has been modified more than once
// within one second (file system file timestamp (mtime) precision/resolution)
// aka mtime and size is the same -- this doesn't mean that the content is necessarily
// the same so we have to compare the file contents
var MAX_EDGE_CASE_FILESIZE = (1024 * 1024 * 10)
var EDGE_CASE_RESOLUTION = 1000 // file timestamp precision

var INFO = {
  STATE_CHANGE: !!process.env.MITERU_DEBUG_STATE_CHANGE,
  TRIGGER: !!process.env.MITERU_DEBUG_TRIGGER,
  INITIAL: !!process.env.MITERU_DEBUG_INITIAL,
  ENOENT: !!process.env.MITERU_DEBUG_ENOENT,
  FSWATCH: !!process.env.MITERU_DEBUG_FSWATCH,
  FIRST_MODIFICATION: !!process.env.MITERU_DEBUG_FIRST_MODIFICATION,
  WARNING: !!process.env.MITERU_DEBUG_WARNING,
  WATCHING: !!process.env.MITERU_DEBUG_WATCHING,
  UNWATCHING: !!process.env.MITERU_DEBUG_UNWATCHING,
  EDGE_FREE: !!process.env.MITERU_DEBUG_EDGE_FREE,
  TIMEOUTS: !!process.env.MITERU_DEBUG_TIMEOUTS,
  POLLING: !!process.env.MITERU_DEBUG_POLLING,
  POLLING_FSSTAT_DELTA: !!process.env.MITERU_DEBUG_POLLING_FSSTAT_DELTA
}

// turn on a bunch of debugging info in debugging mode
if (process.env.DEBUG_MITERU) {
  INFO = {
    STATE_CHANGE: true,
    TRIGGER: true,
    INITIAL: true,
    ENOENT: true,
    FSWATCH: true,
    FIRST_MODIFICATION: true,
    WARNING: true,
    WATCHING: true,
    UNWATCHING: true,
    EDGE_FREE: true,
    TIMEOUTS: true,
    POLLING: false,
    POLLING_FSSTAT_DELTA: false
  }

  if (!defaults.polling) INFO.POLLING = true
}

// TODO
// INFO.TRIGGER = true
// INFO.POLLING = true
// INFO.EDGE_FREE = true

// temporarily set wfile._content to work around edge case scenario
// where file system mtime precision is up to 1000ms (1 second)
function _setContent (wfile, content) {
  // INFO.EDGE_FREE && console.log('set wfile._content')
  wfile._content = content
  clearTimeout(wfile._contentDeleteTimeout)
  wfile._contentDeleteTimeout = setTimeout(function () {
    if (wfile._content) {
      delete wfile._content
      INFO.EDGE_FREE && console.log('freeing up edge case memory (timeout)')
    }
  }, 1000)
}

function poll (filepath) {
  if (!_running) return undefined // exit

  INFO.POLLING && console.log('polling: ' + filepath)
  var pollStartTime = Date.now()

  fs.stat(filepath, function (err, stats) {
    INFO.POLLING_FSSTAT_DELTA && console.log('polling fs.stat delta: ' + (Date.now() - pollStartTime) + ' ms')

    var wfile = _watchedFiles[filepath]
    if (!wfile) {
      INFO.UNWATCHING && console.log('ignoring fs.stat (file removed from watch list: ' + filepath + ')')
      return undefined
    }

    if (err) {
      // increment error counter
      // wfile.errorCounter = (wfile.errorCounter || 0) + 1

      switch (err.code) {
        case 'ENOENT':
        case 'EBUSY':
        case 'ENOTEMPTY':
        case 'EPERM':
        case 'EMFILE':
          // schedule next poll
          clearTimeout(wfile.timeout)
          wfile.timeout = setTimeout(function () {
            poll(filepath)
          }, 300)

          if (wfile.exists) { // file should exist (existed previously)
            // file could be busy/locked temporarily so we so a bit of
            // double checking to make sure the file has been actually removed
            wfile.busyTries = (wfile.busyTries || 0) + 1 // increment attempt counter
            if (wfile.busyTries < MAX_BUSY_TRIES) {
              INFO.ENOENT && console.log('busyTries: ' + wfile.busyTries)
              clearTimeout(wfile.timeout) // recheck quicker
              wfile.timeout = setTimeout(function () {
                poll(filepath)
              }, BUSY_TRY_INTERVAL) // retry very soon
            } else {
              // doubel checks still failling, assume file was removed
              wfile.exists = false
              INFO.STATE_CHANGE && console.log('file removed: ' + filepath)

              // trigger listeners
              wfile.watcher.trigger({
                type: 'unlink',
                filepath: filepath
              })
            }
          }
          break
        default:
          throw err
      }
    } else { // no errors
      wfile.busyTries = 0 // successful read, clear ENOENT counter

      if (!wfile.exists) {
        wfile.exists = true

        // trigger listeners
        INFO.STATE_CHANGE && console.log('file added: ' + filepath)
        wfile.watcher.trigger({
          type: 'add',
          filepath: filepath
        })

        wfile.mtime = stats.mtime
        wfile.atime = stats.atime
        wfile.ctime = stats.ctime
        wfile.size = stats.size
        wfile.interval = 100

        if (stats.size < (MAX_EDGE_CASE_FILESIZE)) {
          _setContent( wfile, fs.readFileSync( filepath ) )
        }
      } else {
        var _interval_override
        var changed = (stats.mtime > wfile.mtime) || (stats.size !== wfile.size)

        // edge case where mtime is within 1000 milliseconds
        // of current time for file systems where file timestamps
        // are stored with 1 second precision (Mac OS comes to mind).
        // In this case, we compare the file contents to determine changes.
        if (!changed && (stats.size < (MAX_EDGE_CASE_FILESIZE))) {
          if ( (Date.now() - stats.mtime.getTime()) < EDGE_CASE_RESOLUTION ) {
            // clearTimeout(wfile._contentDeleteTimeout)

            var _s = Date.now()
            var content = fs.readFileSync( filepath )
            var _t = Date.now() - _s
            if (!wfile._content || !content.equals( wfile._content )) {
              // console.log(' === fallback modification: ' + _t + ', wfile.interval: ' + wfile.interval)
              _interval_override = 200
              // console.log(content.slice(10))
              // console.log(wfile && wfile._content && wfile._content.slice(10))
              changed = true

              if (stats.size < (MAX_EDGE_CASE_FILESIZE)) {
                _setContent( wfile, fs.readFileSync( filepath ) )
              }
            }

            // clearTimeout(wfile._contentDeleteTimeout)
            // wfile._contentDeleteTimeout = setTimeout(function () {
            //   if (wfile._content) {
            //     delete wfile._content
            //     INFO.EDGE_FREE && console.log('freeing up edge case memory (timeout)')
            //   }
            // }, 1000)
          } else {
            // edge case no longer relevant, free up memory
            // if (wfile._content) {
            //   delete wfile._content
            //   INFO.EDGE_FREE && console.log('freeing up edge case memory')
            // }
          }
        }

        if ( changed ) { // file has been modified
          // clearTimeout(wfile._contentDeleteTimeout)

          if (!wfile.touched) {
            wfile.touched = true
            INFO.FIRST_MODIFICATION && console.log('first modification')
          }
          var info = {
            filepath: filepath,
            mtime: stats.mtime,
            last_mtime: wfile.mtime,
            delta_mtime: stats.mtime - wfile.mtime,
            type: 'modification'
          }
          wfile.mtime = stats.mtime
          wfile.atime = stats.atime
          wfile.ctime = stats.ctime
          wfile.size = stats.size

          if (stats.size < (MAX_EDGE_CASE_FILESIZE)) {
            _setContent( wfile, fs.readFileSync( filepath ) )
          }

          wfile.watcher.trigger(info) // trigger all callbacks/listeners on this file
        }

        // slow down or speed up the polling based on how
        // actively (how long ago the file was modified)
        // the file being watched is being modified
        var delta

        // special case when file has never been touched since the start
        if (!wfile.touched) {
          delta = Date.now() - _startTime
          if (delta < INITIAL_FILE) {
            if (wfile.interval !== SEMI_HOT_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('(untouched) SEMI HOT FILE $fp'.replace('$fp', filepath))
              wfile.interval = SEMI_HOT_POLL_INTERVAL
            }
          } else if (delta < WARM_FILE) {
            if (wfile.interval !== WARM_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('(untouched) WARM FILE $fp'.replace('$fp', filepath))
              wfile.interval = WARM_POLL_INTERVAL
            }
          } else if (delta < COLD_FILE) {
            if (wfile.interval !== COLD_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('(untouched) COLD FILE $fp'.replace('$fp', filepath))
              wfile.interval = COLD_POLL_INTERVAL
            }
          } else {
            if (wfile.interval !== FREEZING_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('(untouched) FREEZING FILE $fp'.replace('$fp', filepath))
              wfile.interval = FREEZING_POLL_INTERVAL
            }
          }
        } else {
          delta = Date.now() - stats.mtime.getTime()
          if (delta < HOT_FILE) {
            if (wfile.interval !== HOT_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('HOT FILE $fp'.replace('$fp', filepath))
              wfile.interval = HOT_POLL_INTERVAL
            }
          } else if (delta < SEMI_HOT_FILE) {
            if (wfile.interval !== SEMI_HOT_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('SEMI HOT FILE $fp'.replace('$fp', filepath))
              wfile.interval = SEMI_HOT_POLL_INTERVAL
            }
          } else if (delta < WARM_FILE) {
            if (wfile.interval !== WARM_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('WARM FILE $fp'.replace('$fp', filepath))
              wfile.interval = WARM_POLL_INTERVAL
            }
          } else if (delta < COLD_FILE) {
            if (wfile.interval !== COLD_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('COLD FILE $fp'.replace('$fp', filepath))
              wfile.interval = COLD_POLL_INTERVAL
            }
          } else {
            if (wfile.interval !== FREEZING_POLL_INTERVAL) {
              INFO.STATE_CHANGE && console.log('FREEZING FILE $fp'.replace('$fp', filepath))
              wfile.interval = FREEZING_POLL_INTERVAL
            }
          }
        }
      }

      // schedule next poll
      // clearTimeout(wfile.timeout)
      // wfile.timeout = setTimeout(function () {
      //   poll(filepath)
      // }, _interval_override || wfile.interval)

      // schedule next poll
      if (wfile.options.polling) {
        clearTimeout(wfile.timeout)
        wfile.timeout = setTimeout(function () {
          poll(filepath)
        }, _interval_override || wfile.interval)
      } else {
        if (!wfile._fsWatch) { // fs.watch deleted probably due to rename evt closing previous fs.watch:er
          INFO.FSWATCH && console.log('fs.watch attached: ' + filepath)
          var fsWatch = fs.watch( filepath )
          wfile._fsWatch = fsWatch

          fsWatch.on('change', function ( type ) {
            INFO.FSWATCH && console.log('fs.watch evt: ' + type + ' ' + filepath)
            if (type === 'rename' || type === 'unlink') {
              wfile._fsWatch.close()
              delete wfile._fsWatch
              INFO.FSWATCH && console.log('fs.watch closed: ' + filepath)
              clearTimeout(wfile.timeout)
              wfile.timeout = setTimeout(function () {
                poll( filepath )
              }, 5)
            } else {
              clearTimeout(wfile.timeout)
              wfile.timeout = setTimeout(function () {
                poll( filepath )
              }, 5)
            }
          })
        }
      } // _usePolling

    } // else (no errors)
  }) // fs.stat
}

function startPolling (filepath) {
  if (!_startTime) _startTime = Date.now()
  INFO.POLLING && console.log('starting to poll: ' + filepath)

  var wfile = _watchedFiles[filepath]
  wfile.interval = 100 // initial, default interval

  if (wfile.timeout !== undefined) {
    throw new Error('Error! File is already being watched/polled.')
  }

  fs.stat( filepath, function ( err, stats ) {
    INFO.INITIAL && console.log('initial poll [' + filepath + ']')

    if (err) {
      if (err.code === 'ENOENT') {
        wfile.exists = false
      } else {
        throw err
      }
    } else {
      wfile.exists = true
      // TODO trigger on init?

      wfile.mtime = stats.mtime
      wfile.atime = stats.atime
      wfile.ctime = stats.ctime
      wfile.size = stats.size

      if (stats.size < (MAX_EDGE_CASE_FILESIZE)) {
        _setContent( wfile, fs.readFileSync( filepath ) )
      }
    }

    if (wfile.options.polling || !wfile.exists) {
      clearTimeout(wfile.timeout)
      wfile.timeout = setTimeout(function () {
        poll(filepath)
      }, wfile.interval)
    } else {
      if (wfile._fsWatch) { wfile._fsWatch.close() } // shouldn't happen

      var fsWatch = fs.watch( filepath )
      wfile._fsWatch = fsWatch
      INFO.FSWATCH && console.log('fs.watch attached: ' + filepath)

      fsWatch.on('change', function ( type ) {
        INFO.FSWATCH && console.log('fs.watch evt: ' + type)
        if (type === 'rename' || type === 'unlink') {
          wfile._fsWatch.close()
          delete wfile._fsWatch
          INFO.FSWATCH && console.log('fs.watch closed (due to rename)')
          clearTimeout(wfile.timeout)
          wfile.timeout = setTimeout(function () {
            poll( filepath )
          }, 5)
        } else {
          clearTimeout(wfile.timeout)
          wfile.timeout = setTimeout(function () {
            poll( filepath )
          }, 5)
        }
      })
    }
  })
}

var _recentWarningCount = 0
var _recentWarningTimeout
function watchFile (filepath, options) {
  // if (typeof callback !== 'funciton') {
  //   throw new Error('Callback function must be provided to _watch(filepath:string, callback:funciton)')
  // }

  filepath = path.resolve(filepath) // normalize filepath (absolute filepath)
  // remove trailling path separators
  while (filepath[filepath.length - 1] === path.sep) filepath = filepath.slice(0, -1)

  var wfile = _watchedFiles[filepath] || {}
  wfile.options = options

  // make sure file isn't already being watched
  if (_watchedFiles[filepath] === undefined) {
    _watchedFiles[filepath] = wfile
    wfile.watcher = createFileWatcher(filepath)
    // _watchers[filepath].close = function () {
    //   delete _files[filepath]
    //   delete _mtimes[filepath]
    //   clearTimeout(_timeouts[filepath])
    //   delete _timeouts[filepath]
    //   delete _watchedFiles[filepath].interval
    // }

    wfile.start_time = Date.now()
    // _files[filepath] = Date.now()

    if (/node_modules|^\.|[\/\\]\./i.test(filepath)) {
      // console.log('warning: skipping node_modules or dotfile')
      _recentWarningCount++
    } else {
      if (_recentWarningCount > 0) {
        INFO.WARNING && console.log('warning: skipping node_modules or dotfile, [' + _recentWarningCount + '] times')
        _recentWarningCount = 0
      }
      INFO.WATCHING && console.log('watching $fp'.replace('$fp', filepath))
      startPolling(filepath)
    }
  } else { // TODO already being watched? Do nothing?
    if (/node_modules|^\.|[\/\\]\./i.test(filepath)) {
      _recentWarningCount++
    } else {
      if (_recentWarningCount > 0) {
        INFO.WARNING && console.log('warning: skipping node_modules or dotfile, [' + _recentWarningCount + '] times')
        _recentWarningCount = 0
      }
      INFO.WARNING && console.log('warning: $fp already being watched.'.replace('$fp', filepath))
    }
  }

  clearTimeout(_recentWarningTimeout)
  _recentWarningTimeout = setTimeout(function () {
    if (_recentWarningCount > 0) {
      INFO.WARNING && console.log('warning: skipping node_modules or dotfile, [' + _recentWarningCount + '] times')
      _recentWarningCount = 0
    }
  }, 0)

  // TODO -- separate callbacks for better user api to add/remove/clear?
  // if (_watchers[filepath] && typeof callback === 'function') {
  //   // add callback function to list?
  // }

  return wfile.watcher
}

function unwatchFile (filepath) {
  filepath = path.resolve(filepath) // normalize filepath (absolute filepath)

  // INFO.TIMEOUTS && console.log('timeouts: ' + Object.keys(_timeouts))
  INFO.UNWATCHING && console.log('unwatching: ' + filepath)

  // if (_watchers[filepath]) {
  var wfile = _watchedFiles[ filepath ]
  if (wfile) {
    clearTimeout( wfile.timeout )
    if (wfile._fsWatch) {
      wfile._fsWatch.close()
      delete wfile._fsWatch
    }
    delete _watchedFiles[filepath]
    // delete _files[filepath]
    // delete _mtimes[filepath]
    // clearTimeout(_timeouts[filepath])
    // delete _timeouts[filepath]
    // delete _watchedFiles[filepath].interval
    // delete _watchers[filepath]
  } else {
    INFO.WARNING && console.log('unwatching an unwatched file: ' + filepath)
  }

  // INFO.TIMEOUTS && console.log('timeouts: ' + Object.keys(_timeouts))
}

function createFileWatcher (filepath) {
  filepath = path.resolve(filepath) // normalize filepath (absolute filepath)

  var _listeners = []

  function _trigger (info) {
    INFO.TRIGGER && console.log('triggering type: ' + info.type)
    // trigger callbacks/listeners listening on this file
    _listeners.forEach(function (callback) {
      callback(info)
    })
  }

  function _addEventListener (callback) {
    if (_listeners.indexOf(callback) === -1) _listeners.push(callback)

    var _off = function () { // return off fn
      var i = _listeners.indexOf(callback)
      if (i !== -1) {
        if (_listeners.length === 1) {
          // removing last watcher for file, stop polling
          unwatchFile(filepath)
        }
        return _listeners.splice(i, 1)
      }
    }

    return _off
  }

  function _clear () { // clear callbacks/listeners
    _listeners = []
  }

  function _getListenersLength () {
    return _listeners.length
  }

  return {
    trigger: _trigger,
    addEventListener: _addEventListener,
    getListenersLength: _getListenersLength
  }
}

function _create (options) {
  options = options || {}
  if (options.polling === undefined) options.polling = defaults.polling

  // force polling from env variable
  if (
    process.env.FORCE_POLLING ||
    process.env.MITERU_POLLING ||
    process.env.MITERU_FORCE_POLLING
  ) {
    options.polling = true
  }

  var _files = {}
  var _listeners = {}

  function _trigger (info) {
    var listeners = _listeners[info.type]
    listeners && listeners.forEach(function (callback) {
      callback(info)
    })
  }

  function _watch (filepath) {
    filepath = path.resolve(filepath) // normalize filepath (absolute filepath)

    if (!_files[filepath]) {
      var w = watchFile(filepath, options)
      var off = w.addEventListener(_trigger)
      _files[filepath] = {
        watcher: w,
        off: off
      }
    }

    function unwatch () {
      _unwatch(filepath)
    }

    return {
      close: unwatch,
      unwatch: unwatch
    }
  }

  function _unwatch (filepath) {
    filepath = path.resolve(filepath)

    if (_files[filepath]) {
      var file = _files[filepath]
      var off = file.off
      off()
      _files[filepath] = undefined
      delete _files[filepath]
    }
  }

  function _clear () {
    var files = Object.keys(_files)
    files.forEach(function (filepath) {
      var file = _files[filepath]
      var off = file.off
      off()
    })
    _files = {}
  }

  function _on (type, callback) {
    var listeners = _listeners[type] || []
    if (!_listeners[type]) _listeners[type] = listeners

    listeners.push(callback)

    return function off () {
      var i = listeners.indexOf(callback)
      return _listeners.splice(i, 1)
    }
  }

  // TODO
  function _getFiles () {
    var files = Object.keys(_files)
    return files
  }

  var api = {}
  api.on = _on
  api.watch = _watch
  api.unwatch = _unwatch
  api.clear = _clear
  api.close = _clear
  api.reset = _clear
  api.getFiles = _getFiles // TODO
  return api
}

function _getStatus () {
  var counter = 0
  var files = Object.keys(_watchedFiles)
  files.forEach(function (filepath) {
    var wfile = _watchedFiles[filepath]
    counter += wfile.watcher.getListenersLength()
  })

  return {
    files: files,
    files_length: files.length,
    listeners_length: counter
  }
}

function _watch (file, callback) {
  var w = _create()
  w.watch( file )
  w.on('modification', callback)
  return w
}

module.exports = {
  create: _create,
  // watch: _watch,
  getStatus: _getStatus
}
