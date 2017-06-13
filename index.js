var fs = require('fs')
var path = require('path')

// TODO (filters?)
var _opts = {}

var _mtimes = {} // file mtimes
var _files = {} // files being watched
var _intervals = {} // variable polling intervals
var _timeouts = {} // polling setTimeouts

var _touched = {} // touched files (from start of process)

var _watchers = {}
// var _textContents = {} // TODO

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

var _errors = {}

var _startTime

var _enoents = {}
var MAX_ENOENTS = 25

var INFO = {
  STATE_CHANGE: false,
  INITIAL: false,
  FIRST_MODIFICATION: false,
  WARNING: false,
  WATCHING: false
}

function poll (filepath) {
  var _mtime = _mtimes[filepath]

  fs.stat(filepath, function (err, stats) {
    if (err) {
      // increment error counter
      _errors[filepath] = (_errors[filepath] || 0) + 1

      switch (err.code) {
        case 'ENOENT':
          // file doesn't exist - probably locked/being modified at the moment
          // so we will try again very soon; therefore this is not a very serious error.
          // However, we will keep track of ENOENT errors and fail when MAX_ENOENTS
          // is reached.
          _enoents[filepath] = (_enoents[filepath] || 0) + 1 // increment
          if (_enoents[filepath] < MAX_ENOENTS) { // retry very soon
            // console.log('ENOENT retry: ' + _enoents[filepath])
            clearTimeout(_timeouts[filepath])
            _timeouts[filepath] = setTimeout(function () {
              poll(filepath)
            }, 5)
          } else {
            throw new Error('Error! Max ENOENT retries: ' + _enoents[filepath])
          }
          break
        default:
          throw err
      }
    } else { // no errors
      _enoents[filepath] = 0 // successful read, clear ENOENT counter

      if (_mtime === undefined) {
        // initial poll
        INFO.INITIAL && console.log('initial poll')
        _mtimes[filepath] = stats.mtime
      } else {
        if (stats.mtime > _mtime) { // file has been modified
          if (!_touched[filepath]) {
            _touched[filepath] = true
            INFO.FIRST_MODIFICATION && console.log('first modification')
          }
          var info = {
            filepath: filepath,
            mtime: stats.mtime,
            last_mtime: _mtime,
            delta_mtime: stats.mtime - _mtime,
            type: 'modification'
          }
          _watchers[filepath].trigger(info) // trigger all callbacks/listeners on this file
          _mtimes[filepath] = stats.mtime
        }
      }


      var delta

      // slow down or speed up the polling based on how actively
      // the file being watched is being modified
      delta = Date.now() - stats.mtime

      // special case when file has never been touched since the start
      if (!_touched[filepath]) {
        delta = Date.now() - _startTime
        if (delta < INITIAL_FILE) {
          if (_intervals[filepath] !== SEMI_HOT_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) SEMI HOT FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = SEMI_HOT_POLL_INTERVAL
          }
        } else if (delta < WARM_FILE) {
          if (_intervals[filepath] !== WARM_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) WARM FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = WARM_POLL_INTERVAL
          }
        } else if (delta < COLD_FILE) {
          if (_intervals[filepath] !== COLD_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) COLD FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = COLD_POLL_INTERVAL
          }
        } else {
          if (_intervals[filepath] !== FREEZING_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('(untouched) FREEZING FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = FREEZING_POLL_INTERVAL
          }
        }
      } else {
        if (delta < HOT_FILE) {
          if (_intervals[filepath] !== HOT_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('HOT FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = HOT_POLL_INTERVAL
          }
        } else if (delta < SEMI_HOT_FILE) {
          if (_intervals[filepath] !== SEMI_HOT_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('SEMI HOT FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = SEMI_HOT_POLL_INTERVAL
          }
        } else if (delta < WARM_FILE) {
          if (_intervals[filepath] !== WARM_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('WARM FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = WARM_POLL_INTERVAL
          }
        } else if (delta < COLD_FILE) {
          if (_intervals[filepath] !== COLD_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('COLD FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = COLD_POLL_INTERVAL
          }
        } else {
          if (_intervals[filepath] !== FREEZING_POLL_INTERVAL) {
            INFO.STATE_CHANGE && console.log('FREEZING FILE $fp'.replace('$fp', filepath))
            _intervals[filepath] = FREEZING_POLL_INTERVAL
          }
        }
      }

      // schedule next poll
      clearTimeout(_timeouts[filepath])
      _timeouts[filepath] = setTimeout(function () {
        poll(filepath)
      }, _intervals[filepath])
    } // else
  }) // fs.stat
}

function startPolling (filepath) {
  if (!_startTime) _startTime = Date.now()

  if (_timeouts[filepath] !== undefined) {
    throw new Error('Error! File is already being watched/polled.')
  }
  _mtimes[filepath] = undefined
  _intervals[filepath] = 300
  _timeouts[filepath] = setTimeout(function () {
    poll(filepath)
  }, _intervals[filepath])
}

var _recentWarningCount = 0
var _recentWarningTimeout
function watchFile (filepath) {
  // if (typeof callback !== 'funciton') {
  //   throw new Error('Callback function must be provided to _watch(filepath:string, callback:funciton)')
  // }

  filepath = path.resolve(filepath) // normalize filepath (absolute filepath)
  // remove trailling path separators
  while (filepath[filepath.length - 1] === path.sep) filepath = filepath.slice(0, -1)

  // make sure file isn't already being watched
  if (_watchers[filepath] === undefined) {
    _watchers[filepath] = createFileWatcher(filepath)
    // _watchers[filepath].close = function () {
    //   delete _files[filepath]
    //   delete _mtimes[filepath]
    //   clearTimeout(_timeouts[filepath])
    //   delete _timeouts[filepath]
    //   delete _intervals[filepath]
    // }

    _files[filepath] = Date.now()

    if (/node_modules|^\.|[\/\\]\./i.test(filepath)) {
      // console.log('warning: skipping node_modules or dotfile')
      _recentWarningCount++
    } else {
      if (_recentWarningCount > 0) {
        INFO.WARNING && console.log('warning: skipping node_modules or dotfile, [' + _recentWarningCount + '] times')
        _recentWarningCount = 0
      }
      INFO.WATCHING && console.log('  \u001b[90mwatching\u001b[0m $fp'.replace('$fp', filepath))
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

  return _watchers[filepath]
}

function createFileWatcher (filepath) {
  filepath = path.resolve(filepath) // normalize filepath (absolute filepath)

  var _listeners = []

  function _trigger (info) {
    // trigger callbacks/listeners listening on this file
    _listeners.forEach(function (callback) {
      callback(info)
    })
  }

  function _addEventListener (callback) {
    if (_listeners.indexOf(callback) === -1) _listeners.push(callback)

    var _off = function () { // return off fn
      var i = _listeners.indexOf(callback)
      if (i !== -1) return _listeners.splice(i, 1)
      return undefined
    }

    return _off
  }

  function _clear () { // clear callbacks/listeners
    _listeners = []
  }

  return {
    trigger: _trigger,
    addEventListener: _addEventListener
  }
}

function _create () {
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
      var w = watchFile(filepath)
      var off = w.addEventListener(_trigger)
      _files[filepath] = {
        watcher: w,
        off: off
      }
    }
  }

  function _unwatch (filepath) {
    filepath = filepath.resolve()

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
    files.forEach(function (file) {
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

  var api = {}
  api.on = _on
  api.watch = _watch
  api.unwatch = _unwatch
  api.clear = _clear
  api.close = _clear
  api.reset = _clear
  return api
}

module.exports = {
  create: _create
}
