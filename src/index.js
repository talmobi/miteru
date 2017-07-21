// var rimraf = require('rimfraf')
// rimraf.sync('tmp')

var fs = require('fs')
var path = require('path')

var glob = require('glob')
var minimatch = require('minimatch')

var ALWAYS_COMPARE_FILECONTENT = false

// https://github.com/isaacs/node-glob/blob/master/glob.js#L97-L116
function hasMagic ( pattern ) {
  set = new minimatch.Minimatch( pattern ).set

  if ( set.length > 1 ) return true

  for ( var j = 0; j < set[0].length; j++ ) {
    if ( typeof set[ 0 ][ j ] !== 'string') return true
  }

  return false
}

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
var _fileWatchers = {}
var _shared = {}

var DEBUG = {
  WATCHING: true,
  FILE_EVENTS: true,
  DIR_EVENTS: true,
  AWAITDIR: true,
  READDIR: false,
  DIR: true,
  DELETED_FILECONTENT: false
}

DEBUG = {
  INIT: true,
  FILE_EVENTS: true,
  TEMPERATURE: true
}

var _running = true

process.on('exit', function () {
  _running = false
  var filepaths = Object.keys( _fileWatchers )
  filepaths.forEach(function ( filepath ) {
    unwatch( filepath )
  })
})

function unwatch ( filepath ) {
  filepath = path.resolve( filepath )

  var w = _fileWatchers[ filepath ]
  if ( w ) {
    clearTimeout( w.timeout )
    delete _fileWatchers[ filepath ]
  }
}

function updatePollingInterval ( w ) {
  var filepath = w.filepath

  if ( w.type === 'directory' ) {
    w.pollInterval = 300
    return
  }

  if ( w.type !== 'file' ) {
    throw new Error( 'trying to update pollInterval on non-file type [' + w.type + ']' )
  }

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

  // we can clear up the memory used to keep the file contents
  // if ALWAYS_COMPARE_FILECONTENT is false
  if ( ALWAYS_COMPARE_FILECONTENT === false ) {
    clearTimeout( w.fileContentTimeout )
    w.fileContentTimeout = setTimeout(function () {
      delete w.fileContent // free up memory
      DEBUG.DELETED_FILECONTENT && console.log( 'deleted w.fileContent: ' + filepath )
    }, EDGE_CASE_INTERVAL)
  }
}

function awaitDirectory ( filepath ) {
  var dirpath = path.resolve( filepath, '..' )

  DEBUG.AWAITDIR && console.log('AWAITDIR from: ' + filepath + ' at: ' + dirpath)

  var w = _fileWatchers[ dirpath ]

  if ( !w ) {
    w = _fileWatchers[ dirpath ] = {}

    w.filepath = dirpath
    w.pollInterval = 100
    w.type = 'unknown'

    w.dirFiles = {}
    w.awaitingFilepaths = [ filepath ]

    w._locked = true

    fs.stat( dirpath, function (err, stats) {
      w._locked = false

      if (err) {
        switch (err.code) {
          case 'ENOENT':
            w.exists = false
            return awaitDirectory( dirpath  )
            break

          default:
            throw err
        }
      } else {
        if ( stats.isDirectory() ) {
          w.type = 'directory'

          w.exists = true
          w.size = stats.size
          w.mtime = stats.mtime

          DEBUG.READDIR && console.log('fs.readdirSync: ' + dirpath)
          var files = fs.readdirSync( dirpath )
            .filter( ignoreFilter )

          var newFiles = {}
          files.forEach(function ( file ) {
            newFiles[ file ] = file
          })

          w.dirFiles = newFiles

          DEBUG.READDIR && console.log('files: ')
          DEBUG.READDIR && console.log('  ' + files.join('\n  '))
        } else {
          throw new Error( 'awaitDirectory of non-directory' )
        }
      }

      schedulePoll( w, 5 )
    })
  } else {
    if ( w.type !== 'directory' ) throw new Error( 'awaitDirectory of non-directory' )
    w.awaitingFilepaths.push( filepath ) // filepaths to poll on directory change
  }
}

function handleFileStat ( w, stats ) {
  var filepath = w.filepath
  var init = false

  if ( w.type !== 'file' ) {
    init = true
  }

  if ( w.afterInit ) init = false

  var existedPreviously = ( init === false && w.exists === true )

  w.type = 'file'

  // size changes or mtime increase are good indicators that the
  // file has been modified*
  //
  // *not a 100% guarantee -- for example the file content may not have changed
  // from the previous file content -- however, we do not care if the file content
  // has not changed and we will avoid comparing/reading the file contents unless
  // necessary -- for example during EDGE_CASE_INTERVAL we will have to check
  // file contents -- or perhaps when a flag is set? ( ALWAYS_COMPARE_FILECONTENT ) TODO
  var sizeChanged = ( stats.size !== w.size )
  var mtimeChanged = ( stats.mtime > w.mtime )

  if ( sizeChanged || mtimeChanged ) {
    DEBUG.FILE && console.log( 'FILE (size || mtime) CHANGED: ' + filepath )
  }

  var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
  var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )

  var shouldCompareFileContents = ALWAYS_COMPARE_FILECONTENT || false

  if ( isEdgy && !skipEdgeCase ) {
    DEBUG.FILE && console.log( 'FILE IS EDGY      : ' + filepath )

    // during edge case period we can't rely on mtime or file size changes alone
    // but we need to compare the actual contents of the file
    shouldCompareFileContents = true
  }


  if ( shouldCompareFileContents ) {
    DEBUG.FILE && console.log( 'FILE WILL COMPARE CONTENT   : ' + filepath )
  }

  var fileContentHasChanged = false

  // determine if we need to read file contents
  if ( sizeChanged || mtimeChanged || shouldCompareFileContents ) {
    var fileContent = fs.readFileSync( filepath )

    if ( !init && w.fileContent ) {
      fileContentHasChanged = ( !fileContent.equals( w.fileContent ) )
    }

    if ( init || fileContentHasChanged ) {
      // sets file content and sets a timeout of EDGE_CASE_INTERVAL milliseconds
      // to free up the file content memory* ( since it's no longer relevant )
      // ( *if ALWAYS_COMPARE_FILECONTENT is false of course )
      setFileContent( w, fileContent )
    }
  }

  // update watcher values
  w.exists = true
  w.size = stats.size
  w.mtime = stats.mtime

  updatePollingInterval( w )

  // trigger events
  if ( init ) {
    // TODO trigger init and/or addDir event?
    // DEBUG.INIT && DEBUG.FILE_EVENTS && console.log( 'INIT FILE: ' + filepath )
    trigger( 'init', w )
  } else if ( !existedPreviously ) {
    // TODO trigger addDir event?
    // DEBUG.FILE_EVENTS && console.log( 'add: ' + filepath )
    trigger( 'add', w )
  } else if ( existedPreviously ) {
    if ( ALWAYS_COMPARE_FILECONTENT ) {
      // only file content actual byte changes will TODO trigger a change event
      if ( fileContentHasChanged ) {
        // TODO
        DEBUG.FILE_EVENTS && console.log( 'change*: ' + filepath )
      }
    } else {
      // TODO
      // size or mtime changes is sufficient to TODO trigger a change event (default)
      if ( sizeChanged || mtimeChanged || fileContentHasChanged ) {
        // DEBUG.FILE_EVENTS && console.log( 'change: ' + filepath )
        trigger( 'change', w )
      }
    }
  }

  schedulePoll( w )
}

// TODO refactor dirFiles for multiple watcher instances
function handleDirectoryStat ( w, stats ) {
  var filepath = w.filepath
  var init = false

  if ( w.type !== 'directory' ) {
    init = true
  }

  if ( w.afterInit ) init = false

  var existedPreviously = ( init === false && w.exists === true )

  w.type = 'directory'

  // size changes or mtime increase are good indicators that something
  // has changed* so we will need to check and compare the dir contents
  //
  // *not a 100% guarantee -- for example some text editors during
  // saving actually writes to a new file and swaps (renames) the filenames
  // (eg tmp files created/deleted)
  var shouldCheckForChanges = ( stats.size !== w.size ) || ( stats.mtime > w.mtime )

  if ( shouldCheckForChanges ) {
    DEBUG.DIR && console.log( 'DIR (size || mtime) CHANGED: ' + filepath )
  }

  var skipEdgeCase = ( stats.size >= EDGE_CASE_MAX_SIZE )
  var isEdgy = ( ( Date.now() - stats.mtime ) < EDGE_CASE_INTERVAL )

  if ( isEdgy && !skipEdgeCase ) {
    DEBUG.DIR && console.log( 'DIR IS EDGY      : ' + filepath )
    shouldCheckForChanges = true
  }

  if ( shouldCheckForChanges ) {
    DEBUG.DIR && console.log( 'DIR WILL CHECK   : ' + filepath )
  }

  var hasReallyChanged = false

  // need to read/update dir contents/files
  if ( init || shouldCheckForChanges ) {
    var files = fs.readdirSync( filepath ) // Sync is intended and preferred
      .filter( ignoreFilter ) // ignore .dotfiles and *node_modules*

    var counter = 0
    var newFiles = {}

    files.forEach(function ( file ) {
      if ( w.dirFiles[ file ] ) {
        counter++
      }
      newFiles[ file ] = file
    })

    var filesRemoved = ( Object.keys( w.dirFiles ).length !== counter )
    var filesAdded = ( Object.keys( newFiles).length !== Object.keys( w.dirFiles ).length )
    hasReallyChanged = ( existedPreviously && ( filesAdded || filesRemoved ) )

    w.dirFiles = newFiles // update dirFiles
  }

  // update watcher values
  w.exists = true
  w.size = stats.size
  w.mtime = stats.mtime

  updatePollingInterval( w )

  if ( init ) {
    // trigger init and/or addDir event?
    // DEBUG.INIT && DEBUG.DIR_EVENTS && console.log( 'INIT DIR: ' + filepath )
    trigger( 'init', w )
  } else if ( !existedPreviously ) {
    // trigger addDir event?
    // DEBUG.DIR_EVENTS && console.log( 'addDir: ' + filepath )
    trigger( 'add', w )
  }

  if ( w.awaitingFilepaths.length > 0 ) {
    if ( !existedPreviously || init || hasReallyChanged ) {
      // trigger callbacks that have been waiting on this directory
      // to change ( or appear? )
      var awaitingFilepaths = w.awaitingFilepaths
      w.awaitingFilepaths = []
      awaitingFilepaths.forEach(function ( _filepath ) {
        DEBUG.AWAITDIR && console.log( 'AWAITDIR: ' + _filepath )

        var relativePath = path.relative( filepath, _filepath )

        var _w = _fileWatchers[ _filepath ]
        if ( _w ) {
          if ( w.dirFiles[ relativePath ] ) {
            // it exists in the directory, poll it
            DEBUG.AWAITDIR && console.log( '    AWAITDIR (delete & poll): ' + relativePath )
            schedulePoll( _w, 5 )
          } else {
            DEBUG.AWAITDIR && console.log( '    AWAITDIR (keep & ignore): ' + relativePath )
            // it doesn't exist in the directory, polling it would result
            // in ENOENT -> which would lead to it being added to this directorys
            // awaitingFilepaths list -- therefore don't poll and keep it in the
            // awaitingFilepaths
            w.awaitingFilepaths.push( _filepath )
          }
        } else {
          // shouldn't happen.. unless file has been unwatched? TODO
          // a watcher should have been created during w.awaitingFilepaths.push()..
          var msg = ('(ignoring?) dir change awaiting filepath watcher does not exist: ' + _filepath)
          console.log( msg )
          throw new Error( msg )
        }
      })
    }
  }

  if ( hasReallyChanged ) {
    DEBUG.DIR && console.log( 'DIR HAS CHANGED   : ' + filepath )
  }

  // on init or when files added/removed
  if ( init || hasReallyChanged ) {
    // need to check files in the directory.
    // new files need to be matched against patterns
    // and if a pattern has a globstar ( ** ) in it then
    // we need to recursively watch new directories.

    var statsFinished = 0
    var statsInProgress = 0

    Object.keys( w.dirFiles ).forEach(function ( file ) {
      var _filepath = path.join( filepath, file )
      var _w = _fileWatchers[ _filepath ]

      if ( _w ) {
        DEBUG.DIR && console.log( '  (DIR CHANGED) OLD FILE:\n        ' + _filepath )
        // this file is already handled/being watched
        if ( init ) {
          DEBUG.DIR && console.log( '    ON DIR INIT (scheduling poll)' )
          schedulePoll( _w, 5 )
        } else {
          DEBUG.DIR && console.log( '    ALREADY SETUP (ignored)' )
        }
      } else {
        // all other files need to be fs.stat:ed
        // in order to determine:
        // A) If it's a file:
        //    Check if _filepath matches a pattern
        //    and if it does start watching it.
        // B) If it's a directory:
        //    Check if we're in globstar mode ( pattern includes a globstar ),
        //    and if we are, start watching the directory ( i.e. recursively ).

        w._locked = true
        statsInProgress++

        fs.stat( _filepath, function (err, stats) {
          statsFinished++
          if (statsFinished === statsInProgress ) {
            process.nextTick(function () {
              w._locked = false
              schedulePoll( w )
              DEBUG.DIR && console.log( '      dir unlocked: ' + filepath )
            })
          }

          if ( err ) throw err

          var type = 'unknown'

          if ( stats.isFile() ) {
            type = 'file'
          } else if ( stats.isDirectory() ) {
            type = 'directory'
          }

          switch ( type ) {
            case 'directory':
              DEBUG.DIR && console.log( '  (DIR CHANGED) NEW DIR: ' + _filepath )

              Object.keys( _watchers ).forEach(function ( id ) {
                var watcher = _watchers[ id ]

                var patterns = Object.keys( watcher.patterns )
                DEBUG.DIR && console.log( 'patterns: ' + patterns )

                var shouldAddToWatchList = false

                for (var i = 0; i < patterns.length; i++) {
                  var pattern = patterns[ i ]

                  var dirPattern = path.resolve( getDirPattern( pattern ) )
                  DEBUG.DIR && console.log( 'dirPattern: ' + dirPattern )

                  var dirPath = getDirPath( _filepath )
                  DEBUG.DIR && console.log( 'dirPath: ' + dirPath )

                  if ( minimatch( dirPath, dirPattern ) ) {
                    shouldAddToWatchList = true
                    break
                  }
                }

                DEBUG.DIR && console.log( 'matched: ' + ( shouldAddToWatchList ) )

                if ( shouldAddToWatchList ) {
                  var w = watchFile( _filepath, { afterInit: true } )
                  if ( _filepath !== w.filepath ) throw new Error( 'Error: filepath mismwatch' )
                  watcher.filepaths[ _filepath ] = _filepath

                  // TODO trigger addDir?
                }
              })
              break

            case 'file':
              DEBUG.DIR && console.log( '  (DIR CHANGED) NEW FILE:\n        ' + _filepath )

              Object.keys( _watchers ).forEach(function ( id ) {
                var watcher = _watchers[ id ]
                var patterns = Object.keys( watcher.patterns )

                var matched = false

                for (var i = 0; i < patterns.length; i++) {
                  var pattern = patterns[ i ]
                  if ( minimatch( _filepath, path.join( process.cwd(), pattern ) ) ) {
                    matched = true
                    break
                  }
                }

                if ( matched ) {
                  var w = watchFile( _filepath, { afterInit: true } )
                  if ( _filepath !== w.filepath ) throw new Error( 'Error: filepath mismwatch' )
                  watcher.filepaths[ _filepath ] = _filepath

                  DEBUG.PATTERN && console.log( ' + matched: ' + _filepath )
                } else {
                  DEBUG.PATTERN && console.log( ' - nomatch: ' + _filepath )
                }
              })

              break

            default:
              throw new Error( '"unknown" filetype during directory hasReallyChanged event' )
          }
        })
      }
    })
  }

  schedulePoll( w )
}

function getDirPattern ( pattern ) {
  var i = pattern.lastIndexOf( path.sep )
  var dirPattern = pattern.slice( 0, i + 1 )
  return dirPattern
}

function getDirPath ( filepath ) {
  var dirPath = filepath
  if (dirPath[ dirPath.length - 1 ] !== path.sep) dirPath += path.sep
  return dirPath
}

function getDependingWatcherCount ( filepath ) {
  var counter = 0

  Object.keys( _watchers ).forEach(function ( id ) {
    var watcher = _watchers[ id ]
    if ( watcher.filepaths[ filepath ] ) counter++
  })

  return counter
}

function poll ( filepath ) {
  if ( !_running ) return undefined

  var w = _fileWatchers[ filepath ]
  if ( !w ) return undefined // watcher has been removed

  if ( w.type === 'unknown' ) {
    // console.log( '  polling unknown: ' + w.filepath )
  }

  if ( w._locked ) {
    console.log( ' >>> file locked <<< ' ) // TODO
    return undefined // already in progress
  }

  w._locked = true

  fs.stat(filepath, function (err, stats) {
    w = _fileWatchers[ filepath ]
    if ( !w ) return undefined // watcher has been removed

    w._locked = false

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
                var existedPreviously = ( w.exists === true )
                w.exists = false
                w.forceAttempts = false
                w.attempts = 0
                if ( existedPreviously && !w.exists ) {
                  // TODO trigger 'unlink'
                  switch ( w.type ) {
                    case 'directory':
                      // DEBUG.DIR_EVENTS && console.log('unlinkDir: ' + filepath)
                      trigger( 'unlink', w )

                      // TODO
                      // foreach dirFile set w.attempts to MAX_ATTEMPTS
                      // (since we are expecting the file to not exist obviously
                      // since the dir has been removed)
                      break

                    case 'file':
                      // DEBUG.FILE_EVENTS && console.log('unlink: ' + filepath)
                      trigger( 'unlink', w )
                      break

                    default:
                      throw new Error('unlink error -- unknown filetype')
                  }

                  // TODO add dir watcher? == #1 ==
                  // add this filepath to a list that will be polled
                  // when the directory receives a change event
                  awaitDirectory( filepath ) // TODO
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
              // add this filepath to a list that will be polled
              // when the directory receives a change event
              awaitDirectory( filepath ) // TODO
            } else {
              throw err // let the user know what's going on
            }
          }
          break

        default:
          throw err // unexpected error
      }
    } else {
      var existedPreviously = ( w.exists === true )
      w.forceAttempts = false
      w.attempts = 0

      var type = 'unknown'

      // update file type
      if ( stats.isFile() ) {
        type = 'file'
      } else if ( stats.isDirectory() ) {
        type = 'directory'
      }

      if ( type === 'directory' ) {
        return handleDirectoryStat( w, stats )
      }

      if ( type === 'file' ) {
        return handleFileStat( w, stats )
      }

      throw new Error( 'polled unknown filetype [' + type + ']: ' + filepath )
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

function trigger ( evt, w ) {
  DEBUG.FILE_EVENTS && console.log( evt + ' [' + w.type + ']: ' + w.filepath )
}

function watchFile ( filepath, opts ) {
  opts = opts || {}
  filepath = path.resolve( filepath )

  var w = _fileWatchers[ filepath ]

  if ( w ) { // file already being watched
    console.log( 'filepath already being watched: ' + filepath )
  } else {
    w = _fileWatchers[ filepath ] = {}

    // TODO pass in watcher _id's to wathcFile?
    // TODO internal addId API to wathcFile?
    // w.api = opts.api
    // if ( !w.api ) throw new Error( 'no API set' )

    w.filepath = filepath
    w.pollInterval = 100
    w.type = 'unknown'

    w.afterInit = opts.afterInit || false

    w.dirFiles = {}
    w.awaitingFilepaths = []

    // DEBUG.WATCHING && console.log('watching [' + w.type + ']: ' + filepath + ' (exists: ' + w.exists + ')')

    schedulePoll( w, 5 )
  }

  w.destroy = function () {
    console.log('fileWatcher destroyed -- [' + w.type + ']: ' + filepath + ' (exists: ' + w.exists + ')')
    clearTimeout( w.timeout )
    delete _fileWatchers[ filepath ]
  }

  return w
} // watchFile ( filepath )

var userApi = {}

function getAllPatterns () {
  // TODO caching?
  var _patterns = []
  Object.keys( _watchers ).forEach( function ( id ) {
    var watcher = _watchers[ id ]
    Object.keys( watcher.patterns ).forEach( function ( pattern ) {
      _patterns.push( pattern )
    })
  })

  return _patterns
}

var _idCounter = 1
userApi.watch = function ( filepath /* filepath or glob pattern*/ ) {
  var id = _idCounter++
  var watcher = { id: id }
  _watchers[ id ] = watcher

  // init watcher
  watcher.filepaths = {}
  watcher.patterns = {}

  var userApi = {}

  userApi.unwatch = function ( filepath ) {
    var magical = glob.hasMagic( filepath )

    if ( magical ) {
      throw new Error( 'Error: adding patterns not yet implemented' )
    } else {
      var filepath = path.resolve( file )

      if ( watcher.filepaths[ filepath ] ) {
        var w = _fileWatchers[ filepath ]

        if ( !w ) {
          throw new Error( 'Error: depending watcher found without an active fileWatcher...' )
        }

        var count = getDependingWatcherCount( filepath )
        if ( count < 1 ) {
          throw new Error( 'Error: depending watcher found without an active fileWatcher...' )
        }

        delete watcher.filepaths[ filepath ]

        if ( count !== ( getDependingWatcherCount( filepath ) - 1 ) ) {
          throw new Error( 'Error: depending watcher and fileWatcher mismwatch!' )
        }

        if ( getDependingWatcherCount( filepath ) === 0 ) {
          // since it's the last watcher depending on the fileWatcher, we can turn off the fileWatcher
          // (stop polling for changes)
          w.destroy()
        }
      } else {
        console.log( '(ignoring) trying to unwatch a filepath that is not being watched.' )
      }
    }

    var filepaths = Object.keys()
    api.unwatch( filepath )
    return userApi
  }

  userApi.close = function () {
    throw new Error( 'Error: closing watcher not yet implemented ')
    return userApi
  }

  userApi.add = function ( filepath, _opts ) {
    var magical = glob.hasMagic( filepath )
    magical && console.log('magical: ' + ( magical ))

    if ( magical ) {
      // is a pattern for multiple (zero or more) files
      // var pattern = path.join( process.cwd(), filepath )
      var pattern = filepath.trim()

      if ( !watcher.patterns[ pattern ] ) {
        watcher.patterns[ pattern ] = pattern

        var globStarIndex = pattern.indexOf( '**' )
        if ( globStarIndex !== -1 ) {
          var directoriesOnlyPattern = pattern.slice( 0, globStarIndex + 2 ) + '/'

          // watch all directories recursively
          // (the globstart ** is a special case so we need to
          // watch directories recursively from where it roots)
          glob( directoriesOnlyPattern, function ( err, files ) {
            if ( err ) throw err

            files.forEach(function ( file ) {
              var filepath = path.resolve( file )

              if ( glob.hasMagic( filepath ) ) {
                console.log( '(ignoring) recursive filepath was magical: ' + filepath )
              } else {
                console.log( 'watching dir: ' + filepath )
                userApi.add( filepath )
              }
            })
          })
        } else {
          var singleDirectoryPattern = getDirPath( path.dirname( pattern ) )
          var filepath = path.resolve( singleDirectoryPattern )
          userApi.add( filepath )
        }

        // watch/init all files (recursively) matching the pattern
        glob( pattern, function ( err, files ) {
          if ( err ) throw err

          console.log( files )

          files.forEach(function ( file ) {
            var filepath = path.resolve( file )

            if ( glob.hasMagic( filepath ) ) {
              console.log( '(ignoring) recursive filepath was magical: ' + filepath )
            } else {
              userApi.add( filepath )
            }
          })
        }) // glob init
      } else {
        console.log( '(ignoring) pattern already being watched by this watcher [' + id + ']: ' + pattern )
      }
    } else { //  non-magical aka normal single filepath
      filepath = path.resolve( filepath )

      var w = watchFile( filepath, _opts )
      if ( filepath !== w.filepath ) throw new Error( 'Error: filepath mismwatch' )

      if ( !watcher.filepaths[ filepath ] ) {
        console.log( 'watching filepath: ' + filepath )
        watcher.filepaths[ filepath ] = filepath
      } else {
        console.log( '(ignoring) filepath already being watched by this watcher [' + id + ']: ' + filepath )
      }
    }
  }

  userApi.add( filepath )

  return userApi
}

// var w2 = api.watch( path.join( filepath, '..' ) )
// w2.add( filepath )

// var w = api.watch( 'lib/**/*.js' )
var w = userApi.watch( 'lib/foo/bar/*.js' )
// var w = userApi.watch( 'lib/foo/bar/**/*.js' )

setTimeout(function () {
  console.log( 'adding globstar pattern' )
  w.add( 'lib/foo/bar/**/*.js' )
}, 1000 * 10)
