var rimraf = require( 'rimraf' )
var mkdirp = require( 'mkdirp' )
var ncp = require( 'ncp' ).ncp

var fs = require( 'fs' )
var path = require( 'path' )

var childProcess = require( 'child_process' )

var miteru = require( '../dist/miteru.js' )

if ( process.env.TEST_SOURCE ) {
  console.log( 'testing source' )
  miteru = require( '../src/index.js' )
}

var test = require( 'tape' )

var ACTION_INTERVAL = 300

// process.env.DEV = true

function run ( filepath ) {
  var resolved = require.resolve( filepath )
  delete require.cache[ resolved ]

  var r = require( resolved )

  if ( typeof r === 'object' ) {
    console.log( 'require( resolved ) was of type "object"' )
  }

  var t = fs.readFileSync( filepath, 'utf8' )

  // try and see if there's issue with file content and require.resolve
  // since require.resolve seems to sometimes return as if the filepath was empty when it's not
  console.log( 't: ' + t )
  console.log( 'r: ' + r )


  return r
}

function prepareTestFiles ( next ) {
  setTimeout( function () {
    rimraf( 'test/tmp', function () {
      mkdirp( 'test/tmp', function ( err ) {
        if ( err ) throw err

        setTimeout( function () {
          next()
        }, 150 )
      } )
    } )
  }, 150 )
}

function cleanup ( done ) {
  rimraf( './test/tmp', function ( err ) {
    if ( err ) throw err
    done()
  } )
}

function verifyFileCleaning ( files ) {
  if ( !( files instanceof Array ) ) {
    files = [ files ]
  }

  var
    file,
    i,
    counter = 0

  for ( i = 0; i < files.length; i++ ) {
    file = files[ i ]
    try {
      fs.readFileSync()
    } catch ( err ) {
      counter++
    }
  }

  return files.length === counter
}

test( 'watch a single file', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'main.js' )

    var expected = [
      '',
      'init: abra',
      'change: 88',
      'unlink: ' + filepath,
      'add: 11',
      'change: kadabra',
      'change: allakhazam'
    ]

    var buffer = [ '' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ) )
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          buffer.push( evt + ': ' + run( filepath ) )
          break
      }

      // console.log( 'evt: ' + evt )
      next()
    } )

    var actions = [
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 88', next )
      },
      function ( next ) {
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
        } )
      },
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 11', next )
      },
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = "kadabra"', next )
      },
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = "allakhazam"', next )
        // console.log( 'written allakhazam' )
      }
    ]

    // setTimeout( next, ACTION_INTERVAL )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a( function ( err ) {
          if ( err ) throw err
        } )
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a single file -- file content appended between FSStat:ing', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'main.js' )

    var expected = [
      ''
      , 'init: abra'
      , 'change: 88'
      , 'unlink: ' + filepath
      , 'add: 11'
      , 'change: kadabra-FSStatDebug'
      , 'change: allakhazam'
    ]

    var buffer = [ '' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ) )
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break
      }

      next()
    } )

    var actions = [
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 88', next )
      },
      function ( next ) {
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
        } )
      },
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 11', next )
      },
      function ( next ) {

        fs.writeFile( filepath, 'module.exports = "kadabra"', function ( err ) {
          if ( err ) throw err
          w._setDebugFlag( filepath, 'changeContentAfterFSStat', true )
          next()
        } )
      },
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = "allakhazam"', next )
      }
    ]

    // setTimeout( next, ACTION_INTERVAL )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a( function ( err ) {
          if ( err ) throw err
          // setTimeout( next, ACTION_INTERVAL )
        } )
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a non-existing file', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'blabla.js' )

    var expected = [
      '',
      'unlink: ' + filepath,
      'add: 88',
      'unlink: ' + filepath,
      'add: 11'
    ]

    var buffer = [ '' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    // fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ) )
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          buffer.push( evt + ': ' + run( filepath ) )
          break
      }

      next()
    } )

    var actions = [
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 88', next )
      },
      function ( next ) {
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
        } )
      },
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 11', next )
      }
    ]

    // setTimeout( next, ACTION_INTERVAL )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a( function ( err ) {
          if ( err ) throw err
          // setTimeout( next, ACTION_INTERVAL )
        } )
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a new file after init', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'filepath.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'filepath2.js' )

    var timestamp = Date.now()

    var expected = [
      '',
      'init: abra',
      'change: 88',
      'unlink: ' + filepath,
      'add: 11',
      'add: ' + timestamp, // should be of evt type add and not init
      'add: 22'
    ]

    var buffer = [ '' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath,
          filepath2
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ) )
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          buffer.push( evt + ': ' + run( filepath ) )
          break
      }

      next()
    } )

    var actions = [
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 88', next )
      },
      function ( next ) {
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
        } )
      },
      function ( next ) {
        fs.writeFile( filepath, 'module.exports = 11', next )
      },
      function () {
        w.unwatch( filepath )
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
          setTimeout( next, ACTION_INTERVAL )
        } )
      },
      function ( next ) {
        w.add( filepath2 )
        var content = ( 'module.exports = ' + timestamp )
        fs.writeFile( filepath2, content, next )
      },
      function ( next ) {
        w.add( filepath )
        fs.writeFile( filepath, 'module.exports = 22', next )
      }
    ]

    // setTimeout( next, ACTION_INTERVAL )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a( function ( err ) {
          if ( err ) throw err
          // setTimeout( next, ACTION_INTERVAL )
        } )
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [
          filepath,
          filepath2
        ],
        'expected files (2) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [ filepath2 ],
        'expected files (1) still being watched'
      )

      w.unwatch( '**' )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a glob of files', function ( t ) {
  t.timeoutAfter( 3000 )

  prepareTestFiles( function () {
    var filepath1 = path.join( __dirname, 'tmp', 'foo.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'bar.js' )
    var filepath3 = path.join( __dirname, 'tmp', 'zoo.txt' )

    var timestamp = Date.now()

    var expected = [
      '',
      'init: ' + filepath1,
      'init: ' + filepath2
    ]

    var buffer = [ '' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath1,
          filepath2,
          filepath3
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath1, 'foo' )
    fs.writeFileSync( filepath2, 'foo' )
    fs.writeFileSync( filepath3, 'foo' )

    var w = miteru.watch( 'test/tmp/**/*.js', function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + filepath )
          break

        case 'add':
          buffer.push( 'add: ' + filepath )
          break

        case 'change':
          buffer.push( 'change: ' + filepath )
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          buffer.push( evt + ': ' + filepath )
          break
      }
    } )

    setTimeout( finish, ACTION_INTERVAL )

    function finish () {
      t.deepEqual(
        buffer.sort(),
        expected.sort(),
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [
          filepath1,
          filepath2
        ].sort(),
        'expected files (2) still being watched'
      )

      w.unwatch( filepath1 )

      t.deepEqual(
        w.getWatched(),
        [ filepath2 ],
        'expected files (1) still being watched'
      )

      w.unwatch( '**' )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a new file after init removed between FSStat:ing', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'filepath.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'filepath2.js' )

    var timestamp = Date.now()

    var expected = [
      ''
      , 'init: abra'
      , 'change: 88'
      , 'unlink: ' + filepath
      , 'add: 11'
      , 'add: Restat:' + timestamp // should be of evt type add and not init
      , 'add: 22'
    ]

    var buffer = [ '' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath,
          filepath2
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var callNextOnEvent = false

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ) )
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          buffer.push( evt + ': ' + run( filepath ) )
          break
      }

      // console.log( 'evt: ' + evt )
      if ( callNextOnEvent ) {
        callNextOnEvent = false
        next()
      }
    })

    setTimeout( next, ACTION_INTERVAL )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a()
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    var actions = [
      function () {
        callNextOnEvent = true

        fs.writeFile( filepath, 'module.exports = 88', function ( err ) {
          if ( err ) throw err
        } )
      },
      function () {
        callNextOnEvent = true

        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
        } )
      },
      function () {
        callNextOnEvent = true

        fs.writeFile( filepath, 'module.exports = 11', function ( err ) {
          if ( err ) throw err
        } )
      },
      function () {
        w.unwatch( filepath )
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err

          // no events fired, trigger next manually
          setTimeout( next, ACTION_INTERVAL )
        })
      },
      function () {
        w.add( filepath2 )

        t.equal(
          w.getLog( filepath2 )[ 'FSStatReadFileSyncErrors' ],
          undefined,
          'FSStatReadFileSyncErrors OK ( undefined )'
        )

        var content = ( 'module.exports = "removeAfterFSStat"' )

        w._setDebugFlag( filepath2, 'removeAfterFSStat', true )
        t.equal(
          w.getLog( filepath2 )[ 'FSStatReadFileSyncErrors' ],
          undefined,
          'FSStatReadFileSyncErrors OK ( undefined )'
        )

        fs.writeFile( filepath2, content, function ( err ) {
          if ( err ) {
            t.fail( 'failed to create file' )
          } else {
            t.equal(
              w.getLog( filepath2 )[ 'loadEventsAbortedCount' ],
              undefined,
              'loadEventsAbortedCount OK ( undefined )'
            )

            t.pass(
              'file was created and should be removed soon by debug flag removeAfterFSStat'
            )

            // no events will be fired due to the removeAfterFSStat debug flag
            // so fire it manually after some time
            setTimeout( next, ACTION_INTERVAL )
          }
        } )
      },
      function () {
        fs.readFile( filepath2, function ( err ) {
          if ( err && err.code ) {
            t.equal(
              err.code,
              'ENOENT',
              'file was removed between FSStat correctly'
            )

            t.equal(
              w.getLog( filepath2 )[ 'FSStatReadFileSyncErrors' ],
              1,
              'FSStatReadFileSyncErrors OK ( 1 )'
            )

            // t.equal(
            //   w.getLog( filepath2 )[ 'loadEventsAbortedCount' ],
            //   1,
            //   'loadEventAbortedCount OK ( 1 )'
            // )

            var content = (
              'module.exports = "Restat:$timestamp"'
              .replace( '$timestamp', timestamp )
            )

            callNextOnEvent = true
            fs.writeFile( filepath2, content, function ( err ) {
              if ( err ) throw err
            } )
          } else {
            t.fail( 'file was not removed correctly with debug flag removeAfterFSStat' )
          }
        } )
      },
      function () {
        callNextOnEvent = true

        w.add( filepath )
        fs.writeFile( filepath, 'module.exports = 22', function ( err ) {
          if ( err ) throw err
        } )
      },
    ]

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.equal(
        w.getLog( filepath2 )[ 'FSStatReadFileSyncErrors' ],
        1,
        'FSStatReadFileSyncErrors OK ( 1 )'
      )

      t.deepEqual(
        w.getWatched(),
        [
          filepath,
          filepath2
        ],
        'expected files (2) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [ filepath2 ],
        'expected files (1) still being watched'
      )

      w.unwatch( '**' )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'loadEvent abortion', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'filepath.js' )

    var expected = [
      ''
      , 'init: monkey'
      , 'unlink: ' + filepath
      , 'add: giraffe'
    ]

    var buffer = ['']

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath, 'module.exports = "monkey"' )

    var callNextOnEvent = false

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ) )
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail( 'unlink event FAILURE (File still exists)' )
          } catch ( err ) {
            t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
            buffer.push( 'unlink: ' + filepath )
          }
          break

        case 'change':
          buffer.push( 'change: ' + run( filepath ) )
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          buffer.push( evt + ': ' + run( filepath ) )
          break
      }

      // console.log( 'evt: ' + evt )
      if ( callNextOnEvent ) {
        callNextOnEvent = false
        next()
      }
    })

    setTimeout( next, ACTION_INTERVAL )

    function next () {
      var a = actions.shift()
      if ( a ) {
        a()
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    var actions = [
      function () {
        callNextOnEvent = true

        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
        })
      },
      function () {
        w._setDebugFlag( filepath, 'keepUnstable', true )

        t.equal(
          w.getLog( filepath )[ 'loadEventsAbortedCount' ],
          undefined,
          'loadEventsAbortedCount OK ( undefined )'
        )

        fs.writeFile( filepath, 'module.exports = "batman"', function ( err ) {
          if ( err ) throw err

          setTimeout( next, ACTION_INTERVAL )
        } )
      },
      function () {
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err

          setTimeout( next, ACTION_INTERVAL )
        })
      },
      function () {
        t.equal(
          w.getLog( filepath )[ 'loadEventsAbortedCount' ],
          1,
          'loadEventsAbortedCount OK ( 1 )'
        )

        w._setDebugFlag( filepath, 'keepUnstable', false )

        callNextOnEvent = true

        fs.writeFile( filepath, 'module.exports = "giraffe"', function ( err ) {
          if ( err ) throw err
        } )
      }
    ]

    function finish () {
      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      setTimeout( function () {
        t.end()
      }, 100 )
    }

  } )
} )

test( 'exit process after watcher is closed', function ( t ) {
  t.timeoutAfter( 7500 )

  process.env.DEV = false

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'close.js' )

    var expected = [
      '',
      'ENOENT',
      'module.exports = 777',
      'init: ' + filepath,
      'result: 777',
      'watched files: ' + filepath,
      'closing watcher instance',
      'exiting: 999',
      ''
    ]

    var buffer = [ '\n' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    process.env.MITERU_LOGLEVEL = 'silent'

    var _t = setTimeout( function () {
      t.fail( 'timed out' )
      try {
        spawn.kill()
      } catch ( err ) {}
    }, 7500 )

    var spawn = childProcess.spawn( 'node', [
      path.join( __dirname, 'test-close.js' )
    ] )

    spawn.stdout.on( 'data', function ( data ) {
      buffer.push( data.toString( 'utf8' ) )
    } )

    spawn.stderr.on( 'data', function ( data ) {
      buffer.push( data.toString( 'utf8' ) )
    } )

    spawn.on( 'exit', function ( code ) {
      finish()
    } )

    function finish () {
      clearTimeout( _t )

      t.deepEqual(
        buffer.join( '' ).split( /[\r\n]+/g ).map( function ( line ) {
          return line.trim()
        } ),
        expected,
        'expected output OK'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'process exits when no files being watched', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'unwatch.js' )

    var expected = [
      '',
      'ENOENT',
      'module.exports = 777',
      'init: ' + filepath,
      'result: 777',
      'watched files: ' + filepath,
      'watched files:',
      'process should remain active',
      'exiting: 999',
      ''
    ]

    var buffer = [ '\n' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    process.env.MITERU_LOGLEVEL = 'silent'

    var spawn = childProcess.spawn( 'node', [
      path.join( __dirname, 'test-unwatch.js' )
    ] )

    spawn.stdout.on( 'data', function ( data ) {
      buffer.push( data.toString( 'utf8' ) )
    } )

    spawn.stderr.on( 'data', function ( data ) {
      buffer.push( data.toString( 'utf8' ) )
    } )

    var _exited = false
    var _killed = false

    var _t = setTimeout( function () {
      if ( !_exited ) t.fail( 'spawn failed to exit on its own' )
      var _killed = true
      spawn.kill()
    }, 7500 )

    spawn.on( 'exit', function ( code ) {
      t.equal( _killed, false, 'spawn was not killed' )
      t.equal( _exited, false )
      _exited = true
      finish()
    } )

    function finish () {
      clearTimeout( _t )
      t.deepEqual(
        buffer.join( '' ).split( /[\r\n]+/g ).map( function ( line ) {
          return line.trim()
        } ),
        expected,
        'expected output OK'
      )

      t.ok(
        verifyFileCleaning(
          [
            filepath
          ]
        ),
        'test post-cleaned properly'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )
