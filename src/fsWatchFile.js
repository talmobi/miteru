// var rimraf = require('rimfraf')
// rimraf.sync('tmp')

var fs = require('fs')
var path = require('path')

function ignoreFilter (file, index, array) {
  var shouldIgnore = (
    file[0] === '.' ||
    file.indexOf('node_modules') !== -1
  )

  var shouldKeep = !shouldIgnore

  return shouldKeep
}

var MAX_ATTEMPTS = 10
var ATTEMPT_INTERVAL = 10

var EDGE_CASE_INTERVAL = 1000 // milliseconds
var EDGE_CASE_MAX_SIZE = (1024 * 1024 * 15) // 15mb

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

var filepath = path.resolve('a/b/file')

var _watchers = {}

var DEBUG = {
  WATCHING: true,
  EVENT: true,
  AWAIT: false,
  READDIR: false,
  DELETED_FILECONTENT: false
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
  if ( w ) {
    clearTimeout( w.timeout )
    delete _watchers[ filepath ]
  }
}

function updatePollingInterval ( filepath ) {
  var w = _watchers[ filepath ]
  var now = Date.now()
  var delta = ( now - w.mtime )
  if ( w ) {
    if (delta < TEMPERATURE.HOT.AGE) {
      if (w.pollInterval !== TEMPERATURE.HOT.INTERVAL) {
        DEBUG.TEMPERATURE && console.log('HOT file: ' + filepath)
        w.pollInterval = TEMPERATURE.HOT.INTERVAL
      }
    } else if (delta < TEMPERATURE.SEMI_HOT.AGE) {
      if (w.pollInterval !== TEMPERATURE.SEMI_HOT.INTERVAL) {
        DEBUG.TEMPERATURE && console.log('SEMI_HOT file: ' + filepath)
        w.pollInterval = TEMPERATURE.SEMI_HOT.INTERVAL
      }
    } else if (delta < TEMPERATURE.WARM.AGE) {
      if (w.pollInterval !== TEMPERATURE.WARM.INTERVAL) {
        DEBUG.TEMPERATURE && console.log('WARM file: ' + filepath)
        w.pollInterval = TEMPERATURE.WARM.INTERVAL
      }
    } else if (delta < TEMPERATURE.COLD.AGE) {
      if (w.pollInterval !== TEMPERATURE.COLD.INTERVAL) {
        DEBUG.TEMPERATURE && console.log('COLD file: ' + filepath)
        w.pollInterval = TEMPERATURE.COLD.INTERVAL
      }
    }
  }
}

function setFileContent ( w, fileContent ) {
  if ( w.type !== 'file' ) {
    throw new Error('Error: attempting to set fileContent on non "file" type [filetype: ' + w.type + ']')
  }

  // save fileContent temporarily
  // (for as long as the edge case applies)
  w.fileContent = fileContent

  clearTimeout( w.fileContentTimeout )
  w.fileContentTimeout = setTimeout(function () {
    delete w.fileContent // free up memory
    DEBUG.DELETED_FILECONTENT && console.log( 'deleted w.fileContent: ' + filepath )
  }, EDGE_CASE_INTERVAL)
}

function awaitDir ( filepath ) {
  var dirpath = path.resolve( filepath, '..' )

  DEBUG.AWAIT && console.log('awaitDir from: ' + filepath + ' at: ' + dirpath)

  var d = _watchers[ dirpath ]

  if (!d) {
    try {
      var stats = fs.statSync( dirpath )
      if ( stats.isDirectory() ) {
        d = _watchers[ dirpath ] = {}

        d.pollInterval = 100

        d.exists = true
        d.size = stats.size
        d.mtime = stats.mtime

        d.type = 'directory'
        d.filepath = dirpath

        d.dirAwaiting = [] // will add filepath to dirAwaiting outside the try/catch block
        d.dirFiles = []

        DEBUG.READDIR && console.log('fs.readdirSync: ' + dirpath)
        var files = fs.readdirSync( dirpath )
          .filter( ignoreFilter )

        var newFiles = {}
        files.forEach(function ( file ) {
          newFiles[ file ] = file
        })

        d.dirFiles = newFiles

        DEBUG.READDIR && console.log('files: ')
        DEBUG.READDIR && console.log('  ' + files.join('\n  '))
      } else {
        throw new Error('awaitDir of non-directory')
      }
    } catch (err) {
      switch (err.code) {
        case 'ENOENT':
          DEBUG.AWAIT && console.log('recursive await (subdir ENOENT): ' + dirpath)

          var w = _watchers[ dirpath ] = {}

          w.pollInterval = 100
          w.exists = false

          w.type = 'unknown'
          w.filepath = dirpath

          w.dirAwaiting = [ filepath ]
          w.dirFiles = []

          return awaitDir( dirpath  )
          break
        default:
          throw err
      }
    }
  }

  // if (d.type !== 'directory') throw new Error('attempting to await from non-directory: ' + d.filepath)

  d.dirAwaiting.push( filepath ) // filepaths to poll on directory change

  if (!d.exists) {
    DEBUG.AWAIT && console.log('recursive await (subdir !d.exists)')
    return awaitDir( dirpath  )
  }

  DEBUG.AWAIT && console.log( 'awaiting ' + filepath + ' at [' + d.type + ']: ' + d.filepath + ' (exists: ' + d.exists + ')' )

  DEBUG.AWAIT && console.log( d.filepath )

  // schedule next poll
  schedulePoll( d )
}

function poll ( filepath ) {
  if ( !_running ) return undefined

  var w = _watchers[ filepath ]
  if (!w) return undefined // watcher has been removed
  clearTimeout(w.timeout)

  // if ( w.type === 'directory' ) {
  //   console.log( 'polling directory: ' + w.filepath )
  // }

  if ( w.type === 'unknown' ) {
    console.log( '  polling unknown: ' + w.filepath )
  }

  if ( w.statInProgress ) return undefined // already in progress
  w.statInProgress = true

  fs.stat(filepath, function (err, stats) {
    var w = _watchers[ filepath ]
    if (!w) return undefined // watcher has been removed
    clearTimeout(w.timeout)

    w.statInProgress = false

    if (err) {
      switch (err.code) {
        case 'EBUSY':
        case 'ENOTEMPTY':
        case 'EPERM':
        case 'EMFILE':
        case 'ENOENT':
          if (w.exists || w.forceAttempts) {
            w.attempts = (w.attempts || 0) + 1 // increment attempts
            if (w.attempts < MAX_ATTEMPTS) {
              w.timeout = setTimeout(function () {
                poll( filepath )
              }, ATTEMPT_INTERVAL) // retry very quickly
            } else { // MAX_ATTEMPTS reached
              if (err.code === 'ENOENT') {
                var existedPreviously = w.exists
                w.exists = false
                w.forceAttempts = false
                w.attempts = 0
                if ( existedPreviously && !w.exists ) {
                  // TODO trigger 'unlink'
                  switch ( w.type ) {
                    case 'directory':
                      DEBUG.EVENT && console.log('unlinkDir: ' + filepath)
                      break
                    case 'file':
                      DEBUG.EVENT && console.log('unlink: ' + filepath)
                      break
                    default:
                      throw new Error('unlink error -- unknown filetype')
                  }

                  // TODO add dir watcher? == #1 ==
                  awaitDir( filepath ) // TODO
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
              awaitDir( filepath ) // TODO
            } else {
              throw err // let the user know what's going on
            }
          }
          break

        default:
          throw err // unexpected error
      }
    } else {
      var existedPreviously = w.exists
      w.forceAttempts = false
      w.attempts = 0

      var type = 'unknown'

      // update file type
      if ( stats.isFile() ) {
        type = 'file'
      } else if ( stats.isDirectory() ) {
        type = 'directory'
      }

      if ( type !== w.type ) {
        var msg = (
          '  warning: watched filepath [$fp] type has changed from [$1] to [$2]'
          .replace('$fp', w.filepath)
          .replace('$1', w.type)
          .replace('$2', type)
        )
        console.log( msg )
        // throw new Error(msg)
        // TODO handle this?

        w.type = type
        w.size = stats.size
        w.mtime = stats.mtime
      }

      if ( true ) {
        var hasChanged = ( stats.size !== w.size ) || ( stats.mtime > w.mtime )

        var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
        var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )

        // check edge case
        if ( hasChanged ) {
          if ( isEdgy && !skipEdgeCase ) {
            switch ( w.type ) {
              case 'file':
                // save fileContent temporarily
                // (for as long as the edge case applies)
                var fileContent = fs.readFileSync( filepath )
                w.fileContent = fileContent

                setFileContent( w, fileContent )
                break

              case 'directory':
                break

              default:
                var m = ('w.type unknown')
                throw new Error( m )
            }
          }
        } else {
          if ( isEdgy && !skipEdgeCase ) {
            switch ( w.type ) {
              case 'file':
                // need to check file contents to determine if something has changed
                if ( w.fileContent ) {
                  var fileContent = fs.readFileSync( filepath )
                  hasChanged = ( !fileContent.equals( w.fileContent ) )
                }

                setFileContent( w, fileContent )
                break

              case 'directory':
                // TODO
                var files = fs.readdirSync( filepath )
                  .filter( ignoreFilter )

                var counter = 0
                var newFiles = {}
                files.forEach(function ( file ) {
                  if ( w.dirFiles[ file ] ) {
                    counter++
                  }
                  newFiles[ file ] = file
                })

                hasChanged = ( counter !== Object.keys( w.dirFiles ).length )
                w.dirFiles = newFiles

                if ( hasChanged && DEBUG.READDIR ) {
                  console.log('fs.readdirSync: ' + filepath + ' (changes)')
                  console.log('files: ')
                  console.log('  ' + files.join('\n  '))
                } else {
                  DEBUG.READDIR && console.log('fs.readdirSync: ' + filepath + ' (nothing changed)')
                }
                break

              default:
                var m = ('w.type unknown')
                throw new Error( m )
            }
          }
        }
      }

      w.exists = true
      w.size = stats.size
      w.mtime = stats.mtime

      if ( !existedPreviously && w.exists ) {
        // TODO trigger 'add'
        switch ( w.type ) {
          case 'directory':
            DEBUG.EVENT && console.log('addDir: ' + filepath)
            break
          case 'file':
            DEBUG.EVENT && console.log('add: ' + filepath)
            break
          default:
            throw new Error('add error -- unknown filetype')
        }
      }

      if ( hasChanged ) {
        // TODO trigger 'change'
        switch ( w.type ) {
          case 'directory':
            DEBUG.DIR && console.log('  change in directory: ' + filepath)

            Object.keys( w.dirFiles ).forEach(function ( file ) {
              var _filepath = path.join( filepath, file )
              var _w = _watchers[ _filepath ]
              if ( _w ) {
                // TODO
                // file is being watched -- trigger poll
                // console.log( 'dir change polling file: ' + _filepath )
                schedulePoll( _w )
              } else {
                // TODO
                // file not being watchd
                // ignore OR check glob pattern if file matches
                // and start watching
                // console.log( 'ignore dir change for file (not being watched): ' + _filepath )
              }
            })
            break

          case 'file':
            DEBUG.EVENT && console.log('change: ' + filepath)
            break

          default:
            throw new Error('hasChanged error -- unknown filetype')
        }
      }

      if ( w.type === 'directory' && ( hasChanged || ( !existedPreviously && w.exists ) ) ) {
        w.dirAwaiting.forEach(function ( _filepath ) {
          var _w = _watchers[ _filepath ]
          if ( _w ) {
            // TODO
            // console.log( 'dir change polling awaiting filepath: ' + _filepath )
            schedulePoll( _w, 5 )
          } else {
            // a watcher should have been created during w.dirAwaiting.push()
            var msg = ('(ignoring) dir change awaiting filepath watcher does not exist: ' + _filepath)
            console.log( msg )
            throw new Error( msg )
          }
        })

        w.dirAwaiting = []
      }


      // var o = {
      //   filepath: filepath,
      //   mtime: stats.mtime,
      //   size: stats.size
      // }
      // console.log( o )

      // TODO support FSEvents API?
      // schedule next poll
      schedulePoll( w )
    }
  })
} // poll ( filepath )

function schedulePoll ( w, forcedInterval ) {
  clearTimeout( w.timeout )
  var interval = w.pollInterval
  if ( w.type !== 'file') interval = 300
  w.timeout = setTimeout(function () {
    poll( w.filepath )
  }, forcedInterval || interval)
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
    w.type = 'unknown'

    w.dirFiles = []
    w.dirAwaiting = []

    try {
      var stats = fs.statSync( filepath )
      w.exists = true
      w.size = stats.size
      w.mtime = stats.mtime

      // update file type
      if ( stats.isFile() ) {
        w.type = 'file'
      } else if ( stats.isDirectory() ) {
        w.type = 'directory'
      }

      // prepare for edge case if necessary
      var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
      var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )

      switch ( w.type ) {
        case 'file':
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
          break

        case 'directory':
          // TODO
          DEBUG.READDIR && console.log('fs.readdirSync: ' + filepath)
          var files = fs.readdirSync( filepath )
            .filter( ignoreFilter )

          var newFiles = {}
          files.forEach(function ( file ) {
            newFiles[ file ] = file
          })

          w.dirFiles = newFiles

          DEBUG.READDIR && console.log('files: ')
          DEBUG.READDIR && console.log('  ' + files.join('\n  '))
          break

        default:
          console.log('w.type unknown')
      }
    } catch (err) {
      switch (err.code) {
        case 'ENOENT':
          w.exists = false
          break
        default:
          throw err
      }
    }

    DEBUG.WATCHING && console.log('watching [' + w.type + ']: ' + filepath + ' (exists: ' + w.exists + ')')

    // schedule next poll
    schedulePoll( w )
  }

  return w
} // watch ( filepath )

var api = {}

api.watch = function ( filepath ) {
  var watchers = {}
  var w = watch( filepath )
  watchers[ w.filepath ] = w

  var a = {}

  a.add = function ( filepath ) {
    var w = watch( filepath )
    watchers[ w.filepath ] = w
  }

  return a
}

api.close = function () {
  _running = false
  var filepaths = Object.keys( _watchers )
  filepaths.forEach(function ( filepath ) {
    unwatch( filepath )
  })
}

var w2 = api.watch( path.join( filepath, '..' ) )
w2.add( filepath )
