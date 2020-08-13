var rimraf = require( 'rimraf' )
var mkdirp = require( 'mkdirp' )
var ncp = require( 'ncp' ).ncp

var wtfnode = require( 'wtfnode' )

var fs = require( 'fs' )
var path = require( 'path' )

var childProcess = require( 'child_process' )

var miteru = require( '../dist/miteru.js' )

if ( process.env.TEST_SOURCE ) {
  console.log( 'testing source' )
  miteru = require( '../src/index.js' )
}

var glob = require( 'redstar' )

var test = require( 'tape' )

var ACTION_INTERVAL = 300

// process.env.DEV = true

function run ( filepath ) {
  var resolved = require.resolve( filepath )
  delete require.cache[ resolved ]

  var r = require( resolved )

  if ( typeof r == 'object' ) {
    console.log( "require.resolved was of type 'object'" )
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
    var dirpath = path.join( __dirname, 'tmp' ) // ./test/tmp

    rimraf( dirpath, function () {
      mkdirp( dirpath, function ( err ) {
        if ( err ) throw err

        glob( '**/test/tmp/**' , function ( err, files, dirs ) {
          if ( err ) throw err

          if ( files.length > 0 ) throw new Error( 'test files not clean' )
          if ( dirs.length !== 1 ) throw new Error( 'test directory not clean' )
          if ( dirs[ 0 ] !== 'test/tmp' ) throw new Error( 'test tmp directory not found' )

          miteru.reset()

          if ( miteru.getWatched().length !== 0 ) throw new Error( 'miteru not watch list not clean' )
          if ( miteru._activeList.length !== 0 ) throw new Error( 'miteru not active list not clean' )

          setTimeout( function () {
            next()
          }, 150 )
        } )
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

      // conver already unwatched
      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'cover MITERU_STATS MITERU_PROMOTION_LIST', function ( t ) {
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

    var was = {}
    was.stats = process.env[ 'MITERU_STATS' ]
    was.promotionList = process.env[ 'MITERU_PROMOTION_LIST' ]

    process.env[ 'MITERU_STATS' ] = true
    process.env[ 'MITERU_PROMOTION_LIST' ] = true

    t.equal( miteru._stats.report, false, 'miteru stats report off OK' )
    miteru._stats.report = true

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


    var startTime

    var actions = [
      function ( next ) {
        startTime = Date.now()
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
        var delta = Date.now() - startTime
        setTimeout( function () {
          fs.writeFile( filepath, 'module.exports = "allakhazam"', next )
        }, 1000 - delta ) // wait at least full second for a stats tick to complete
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
      process.env[ 'MITERU_STATS' ] = was.stats
      process.env[ 'MITERU_PROMOTION_LIST' ] = was.promotionList

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'cover NOEXIST_INTERVAL and NOEXISTS_SLEEP_DELAY', function ( t ) {
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

    miteru._disableCpuSmoothing = true
    miteru._NOEXISTS_SLEEP_DELAY = 1000

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
            return setTimeout( testSleepDelay, 300 )
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

    function testSleepDelay () {
      var fw = miteru._getFileWatcher( filepath )
      t.ok( fw._lastPollInterval < 100, '_lastPollInterval before NOEXISTS_SLEEP_DELAY OK' )

      setTimeout( function () {
        console.log( 'fw._lastPollInterval: ' + fw._lastPollInterval )
        t.ok( fw._lastPollInterval === miteru._NOEXIST_INTERVAL, '_lastPollInterval after NOEXISTS_SLEEP_DELAY OK' )
        setTimeout( next, ACTION_INTERVAL )
      }, miteru._NOEXISTS_SLEEP_DELAY + miteru._NOEXIST_INTERVAL )
    }

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a single file using .on apis', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'main.js' )

    var expected = [
      '',
      'init: abra',
      'init2: abra',

      'change: 88',
      'change2: 88',

      'unlink: ' + filepath,
      'unlink2: ' + filepath,

      'add: 11',
      'add2: 11',

      'change: kadabra',
      'change2: kadabra',

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

    var w = miteru.watch( [ filepath ] )
    var w2 = miteru.watch( filepath )

    w.on( 'init', function ( filepath ) {
      buffer.push( 'init: ' + run( filepath ) )
      next()
    } )
    w2.on( 'init', function ( filepath ) {
      buffer.push( 'init2: ' + run( filepath ) )
    } )

    w.on( 'add', function ( filepath ) {
      buffer.push( 'add: ' + run( filepath ) )
      next()
    } )
    w2.on( 'add', function ( filepath ) {
      buffer.push( 'add2: ' + run( filepath ) )
    } )

    w.on( 'unlink', function ( filepath ) {
      try {
        fs.readFileSync( filepath )
        t.fail( 'unlink event FAILURE (File still exists)' )
      } catch ( err ) {
        t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
        buffer.push( 'unlink: ' + filepath )
      }

      setTimeout( next, ACTION_INTERVAL * 2 )
    } )
    w2.on( 'unlink', function ( filepath ) {
      try {
        fs.readFileSync( filepath )
        t.fail( 'unlink event FAILURE (File still exists)' )
      } catch ( err ) {
        t.equal( err.code, 'ENOENT', 'unlink event OK (ENOENT)' )
        buffer.push( 'unlink2: ' + filepath )
      }
    } )

    w.on( 'change', function ( filepath ) {
      buffer.push( 'change: ' + run( filepath ) )
      next()
    } )
    var off2Change = w2.on( 'change', function ( filepath ) {
      buffer.push( 'change2: ' + run( filepath ) )
    } )

    var actions = [
      function ( errorCallback ) {
        fs.writeFile( filepath, 'module.exports = 88', errorCallback )
      },
      function ( errorCallback ) {
        rimraf( filepath, { maxBusyTries: 10 }, function ( err ) {
          if ( err ) throw err
        } )
      },
      function ( errorCallback ) {
        fs.writeFile( filepath, 'module.exports = 11', errorCallback )
      },
      function ( errorCallback ) {
        fs.writeFile( filepath, 'module.exports = "kadabra"', errorCallback )
      },
      function ( errorCallback ) {
        // use returned off function, w2 change listener should not receive this next change
        off2Change()

        fs.writeFile( filepath, 'module.exports = "allakhazam"', errorCallback )
      }
    ]

    function next () {
      var a = actions.shift()
      if ( a ) {
        setTimeout( function () {
          a( function ( err ) {
            if ( err ) throw err
          } )
        }, ACTION_INTERVAL )
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
      t.deepEqual(
        w2.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.unwatch( filepath )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )
      t.deepEqual(
        w2.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w.close()

      t.deepEqual(
        miteru.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      w2.close()

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a single file (without initial file list)', function ( t ) {
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

    var w = miteru.watch( function ( evt, filepath ) {
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

    w.add( filepath )

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'watch a single file with multiple watchers', function ( t ) {
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

    var buffers = [
      [ '' ],
      [ '' ],
      [ '' ]
    ]

    t.ok(
      verifyFileCleaning(
        [
          filepath
        ]
      ),
      'test pre-cleaned properly'
    )

    miteru.options.minInterval = 100

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var watchers = [
      miteru.watch( filepath, createCallback( 0 ) ),
      miteru.watch( filepath, createCallback( 1 ) ),
      miteru.watch( filepath, createCallback( 2 ) )
    ]

    function createCallback ( index ) {
      var buffer = buffers[ index ]

      return function callback ( evt, filepath ) {
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

        // only call next once per cycle
        if ( index === 0 ) {
          setTimeout( function () {
            next()
          }, 1 )
        }
      }
    }

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
        watchers[ 1 ].unwatch( filepath )
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
        buffers[ 0 ],
        expected,
        'expected output OK'
      )

      t.deepEqual(
        buffers[ 1 ],
        // the file was intentionally unwatched early
        expected.slice( 0, -1 ),
        'expected output OK'
      )

      t.deepEqual(
        buffers[ 2 ],
        expected,
        'expected output OK'
      )

      t.deepEqual(
        watchers[ 0 ].getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      t.deepEqual(
        watchers[ 1 ].getWatched(),
        // the file was intentionally unwatched early
        [],
        'expected files (0) still being watched'
      )

      t.deepEqual(
        watchers[ 2 ].getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      t.deepEqual(
        miteru.getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      watchers[ 0 ].unwatch( filepath )

      t.deepEqual(
        watchers[ 0 ].getWatched(),
        [],
        'expected files (0) still being watched'
      )

      t.deepEqual(
        watchers[ 0 ].getWatched(),
        [],
        'expected files (0) still being watched'
      )

      t.deepEqual(
        watchers[ 2 ].getWatched(),
        [ filepath ],
        'expected files (1) still being watched'
      )

      // already unwatched, doesn't throw errors
      watchers[ 1 ].unwatch( filepath )

      watchers[ 2 ].unwatch( filepath )

      t.deepEqual(
        watchers[ 1 ].getWatched(),
        [],
        'expected files (0) still being watched'
      )

      t.deepEqual(
        watchers[ 2 ].getWatched(),
        [],
        'expected files (0) still being watched'
      )

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      watchers[ 0 ].close()
      watchers[ 1 ].close()
      watchers[ 2 ].close()

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'miteru.reset()', function ( t ) {
  t.timeoutAfter( 3000 )

  prepareTestFiles( function () {
    var filepath1 = path.join( __dirname, 'tmp', 'foo.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'bar.js' )
    var filepath3 = path.join( __dirname, 'tmp', 'zoo.txt' )

    var timestamp = Date.now()

    t.equal( miteru.getWatched().length, 0, 'miteru watched is 0 OK' )
    t.equal( miteru._activeList.length, 0, 'miteru actvie list 0 OK' )

    t.equal( miteru._MAX_ACTIVE_LIST_LENGTH, 6, 'miteru _MAX_ACTIVE_LIST_LENGTH OK' )
    t.equal( miteru._CPU_SMOOTHING_DELAY, 3000, 'miteru _CPU_SMOOTHING_DELAY OK' )

    t.equal( miteru._NOEXISTS_SLEEP_DELAY, 1000 * 15, 'miteru _NOEXISTS_SLEEP_DELAY OK' )
    t.equal( miteru._NOEXIST_INTERVAL, 400, 'miteru _NOEXIST_INTERVAL OK' )

    t.equal( miteru.options.minInterval, undefined, 'miteru minInterval OK' )

    miteru._MAX_ACTIVE_LIST_LENGTH = 300
    miteru._CPU_SMOOTHING_DELAY = 5000 // milliseconds

    miteru._NOEXISTS_SLEEP_DELAY = 1000
    miteru._NOEXIST_INTERVAL = 600 // milliseconds

    miteru.options.minInterval = 100 // milliseconds

    t.equal( miteru._MAX_ACTIVE_LIST_LENGTH, 300, 'miteru _MAX_ACTIVE_LIST_LENGTH OK' )
    t.equal( miteru._CPU_SMOOTHING_DELAY, 5000, 'miteru _CPU_SMOOTHING_DELAY OK' )

    t.equal( miteru._NOEXISTS_SLEEP_DELAY, 1000, 'miteru _NOEXISTS_SLEEP_DELAY OK' )
    t.equal( miteru._NOEXIST_INTERVAL, 600, 'miteru _NOEXIST_INTERVAL OK' )

    t.equal( miteru.options.minInterval, 100, 'miteru minInterval OK' )

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

      miteru.reset()

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      t.equal( miteru.getWatched().length, 0, 'miteru watched is 0 OK' )
      t.equal( miteru._activeList.length, 0, 'miteru actvie list 0 OK' )

      t.equal( miteru._MAX_ACTIVE_LIST_LENGTH, 6, 'miteru _MAX_ACTIVE_LIST_LENGTH OK' )
      t.equal( miteru._CPU_SMOOTHING_DELAY, 3000, 'miteru _CPU_SMOOTHING_DELAY OK' )

      t.equal( miteru._NOEXISTS_SLEEP_DELAY, 1000 * 15, 'miteru _NOEXISTS_SLEEP_DELAY OK' )
      t.equal( miteru._NOEXIST_INTERVAL, 400, 'miteru _NOEXIST_INTERVAL OK' )

      t.equal( miteru.options.minInterval, undefined, 'miteru minInterval OK' )

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

      w.clear()

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      try {
        w.watch( filepath1 )
        t.fail( '.watch should throw error when watcher has been closed.' )
      } catch ( err ) {
        t.equal( err.message, 'watcher has been closed.', 'throw error when using .watch on a closed watcher' )
      }

      try {
        w.add( filepath1 )
        t.fail( '.add should throw error when watcher has been closed.' )
      } catch ( err ) {
        t.equal( err.message, 'watcher has been closed.', 'throw error when using .add on a closed watcher' )
      }

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'error EACCESS watch a glob of files', function ( t ) {
  t.timeoutAfter( 3000 )

  prepareTestFiles( function () {
    var filepath1 = path.join( __dirname, 'tmp', 'foo.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'bar.js' )
    var filepath3 = path.join( __dirname, 'tmp', 'zoo.txt' )

    var timestamp = Date.now()

    var expected = [ '' ]

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

    // remove file immediately after while the globber is
    // asynchronously grabbing the files // resulting in an error
    // trying to stat a file that doesn't exist anymore
    fs.unlink( filepath2, function ( err ) {
      if ( err ) throw err
    } )

    var _consoleError = console.error
    var _errorMessage
    console.error = function ( msg ) {
      _errorMessage = msg
      console.error = _consoleError
    }

    var exceptionCaught = false
    function exceptionCallback ( err ) {
      t.equal( path.resolve( err.path ), filepath2, 'error path filepath2 OK' )
      t.equal( err.err.code, 'ENOENT', 'error code ENOENT OK' )
      t.equal( err.err.syscall, 'stat', 'error syscall stat OK' )
      t.equal( exceptionCaught, false, 'exception not caught yet OK' )
      exceptionCaught = true
    }
    process.once( 'uncaughtException', exceptionCallback )

    // rimraf( filepath2, { maxBusyTries: 10 }, function ( err ) {
    //   if ( err ) throw err
    // } )

    setTimeout( finish, ACTION_INTERVAL )

    function finish () {
      t.equal( exceptionCaught, true, 'exception caught OK' )
      process.removeListener( 'uncaughtException', exceptionCallback )

      t.equal( _errorMessage, `ENOENT: no such file or directory, stat 'test/tmp/bar.js'`, 'exception caught OK' )

      t.deepEqual(
        buffer.sort(),
        expected.sort(),
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'check file activity flagging from glob', function ( t ) {
  t.timeoutAfter( 3000 )

  prepareTestFiles( function () {
    var filepath1 = path.join( __dirname, 'tmp', 'foo.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'bar.js' )
    var filepath3 = path.join( __dirname, 'tmp', 'zoo.txt' )

    var timestamp = Date.now()

    var expected = [
      '',
      'init: ' + filepath1,
      'init: ' + filepath2,
      'add: ' + filepath3
    ]

    var buffer = [ '' ]

    miteru.reset()

    t.deepEqual(
      miteru.getWatched(),
      [],
      'miteru clean and ready for next test'
    )

    t.deepEqual(
      miteru._activeList,
      [],
      'miteru._activeList clean before test'
    )

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

    // make sure filepath1 is always oldest in the activity list
    fs.utimesSync( filepath1, Date.now() / 1000, ( Date.now() / 1000 ) - 1 )

    _lastMaxActiveListLength = miteru._MAX_ACTIVE_LIST_LENGTH
    miteru._MAX_ACTIVE_LIST_LENGTH = 2

    var initCounter = 0
    var w = miteru.watch( 'test/tmp/**/*.*', function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          initCounter++
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

      if ( initCounter === 2 ) setTimeout( next, ACTION_INTERVAL )
    } )

    var actions = [
      function () {
        fs.writeFileSync( filepath3, 'foo' )
        w.add( 'test/tmp/**/*.*' )
      },
    ]

    function next () {
      var a = actions.shift()
      if ( a ) {
        a( function ( err ) {
          if ( err ) throw err
          setTimeout( next, ACTION_INTERVAL )
        } )
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    function finish () {
      miteru._MAX_ACTIVE_LIST_LENGTH = _lastMaxActiveListLength

      t.equal(
        miteru._getFileWatcher( filepath1 ).active, false
      )
      t.equal(
        miteru._getFileWatcher( filepath2 ).active, true
      )
      t.equal(
        miteru._getFileWatcher( filepath3 ).active, true
      )

      t.deepEqual(
        buffer.sort(),
        expected.sort(),
        'expected output OK'
      )

      t.deepEqual(
        w.getWatched(),
        [
          filepath1,
          filepath2,
          filepath3
        ].sort(),
        'expected files (3) still being watched'
      )

      w.unwatch( filepath1 )

      t.deepEqual(
        w.getWatched(),
        [
          filepath2, 
          filepath3,
        ],
        'expected files (2) still being watched'
      )

      w.unwatch( '**' )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'check file activity flagging', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath1 = path.join( __dirname, 'tmp', 'filepath1.js' )
    var filepath2 = path.join( __dirname, 'tmp', 'filepath2.js' )
    var filepath3 = path.join( __dirname, 'tmp', 'filepath3.js' )
    var filepath4 = path.join( __dirname, 'tmp', 'filepath4.js' )

    var timestamp = Date.now()

    miteru.reset()

    t.deepEqual(
      miteru.getWatched(),
      [],
      'miteru clean and ready for next test'
    )

    t.deepEqual(
      miteru._activeList,
      [],
      'miteru._activeList clean before test'
    )

    var expected = [
      '',

      filepath1 + ':' + 'true',
      filepath2 + ':' + 'undefined',
      filepath3 + ':' + 'undefined',
      filepath4 + ':' + 'true',

      filepath1 + ':' + 'true',
      filepath2 + ':' + 'true',
      filepath3 + ':' + 'undefined',
      filepath4 + ':' + 'false',

      filepath1 + ':' + 'false',
      filepath2 + ':' + 'true',
      filepath3 + ':' + 'true',
      filepath4 + ':' + 'false',

      filepath1 + ':' + 'true',
      filepath2 + ':' + 'false',
      filepath3 + ':' + 'true',
      filepath4 + ':' + 'false'
    ]

    var expectedEvts = [
      '',

      'init',
      filepath1,

      'init',
      filepath4,

      'add',
      filepath2,

      'add',
      filepath3,

      'change',
      filepath1
    ]

    var buffer = [ '' ]
    var evts = [ '' ]

    t.ok(
      verifyFileCleaning(
        [
          filepath1,
          filepath2,
          filepath3,
          filepath4
        ]
      ),
      'test pre-cleaned properly'
    )

    fs.writeFileSync( filepath1, 'foo' )
    fs.writeFileSync( filepath2, 'foo' )
    fs.writeFileSync( filepath3, 'foo' )
    fs.writeFileSync( filepath4, 'foo' )

    fs.utimesSync( filepath4, Date.now() / 1000, 1 )

    _lastMaxActiveListLength = miteru._MAX_ACTIVE_LIST_LENGTH
    miteru._MAX_ACTIVE_LIST_LENGTH = 2

    var w = miteru.watch( filepath1, function ( evt, filepath ) {
      // do nothing
      console.log( evt + ':' + filepath )
      evts.push( evt )
      evts.push( filepath )

      if ( evt === 'change' || evt === 'add' ) {
        setTimeout( next, 1000 )
      }
    } )

    w.add( filepath4 ) // will be pushed off from the active list for coverage

    setTimeout( next, ACTION_INTERVAL )

    var actions = [
      function ( next ) {
        buffer.push( filepath1 + ':' + miteru._getFileWatcher( filepath1 ).active )
        buffer.push( filepath2 + ':' + miteru._getFileWatcher( filepath2 ) )
        buffer.push( filepath3 + ':' + miteru._getFileWatcher( filepath3 ) )
        buffer.push( filepath4 + ':' + miteru._getFileWatcher( filepath4 ).active )

        fs.writeFileSync( filepath2, 'bar' )
        w.add( filepath2 )
      },
      function ( next ) {
        buffer.push( filepath1 + ':' + miteru._getFileWatcher( filepath1 ).active )
        buffer.push( filepath2 + ':' + miteru._getFileWatcher( filepath2 ).active )
        buffer.push( filepath3 + ':' + miteru._getFileWatcher( filepath3 ) )
        buffer.push( filepath4 + ':' + miteru._getFileWatcher( filepath4 ).active )

        fs.writeFileSync( filepath3, 'bar' )
        w.add( filepath3 )
      },
      function ( next ) {
        buffer.push( filepath1 + ':' + miteru._getFileWatcher( filepath1 ).active )
        buffer.push( filepath2 + ':' + miteru._getFileWatcher( filepath2 ).active )
        buffer.push( filepath3 + ':' + miteru._getFileWatcher( filepath3 ).active )
        buffer.push( filepath4 + ':' + miteru._getFileWatcher( filepath4 ).active )

        fs.writeFileSync( filepath1, 'bar' )
      }
    ]

    function next () {
      var a = actions.shift()
      if ( a ) {
        a( function ( err ) {
          if ( err ) throw err
          setTimeout( next, ACTION_INTERVAL )
        } )
      } else {
        setTimeout( finish, ACTION_INTERVAL )
      }
    }

    function finish () {
      miteru._MAX_ACTIVE_LIST_LENGTH = _lastMaxActiveListLength

      buffer.push( filepath1 + ':' + miteru._getFileWatcher( filepath1 ).active )
      buffer.push( filepath2 + ':' + miteru._getFileWatcher( filepath2 ).active )
      buffer.push( filepath3 + ':' + miteru._getFileWatcher( filepath3 ).active )
      buffer.push( filepath4 + ':' + miteru._getFileWatcher( filepath4 ).active )

      t.deepEqual(
        buffer,
        expected,
        'expected output OK'
      )

      t.deepEqual(
        evts.sort(),
        expectedEvts.sort(),
        'expected events OK'
      )

      t.deepEqual(
        w.getWatched(),
        [
          filepath1,
          filepath2,
          filepath3,
          filepath4
        ],
        'expected files (4) still being watched'
      )

      w.unwatch( filepath1 )

      t.deepEqual(
        w.getWatched(),
        [
          filepath2,
          filepath3,
          filepath4
        ],
        'expected files (3) still being watched'
      )

      w.unwatch( '**' )

      t.deepEqual(
        w.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      w.close()

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

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

    try {
      var www = miteru.watch()
      t.equal( www.getLog( filepath ), undefined, 'cover undefined log of non-watched file OK' )
      www._setDebugFlag( filepath )
      t.fail( 'no expected error thrown' )
    } catch ( err ) {
      t.equal( err.message, 'no fileWatcher for [$1] found'.replace( '$1', filepath ) )
    }

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'attempt watch a directory and fail on error', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp' )

    var expected = [
      ''
      , 'error'
      , 'onError'
    ]

    var buffer = [ '' ]

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'error':
          buffer.push( evt )
          break

        default:
          t.fail( 'non expected evt type found [ ' + evt + ' ]' )
          buffer.push( evt )
          break
      }

      // console.log( 'evt: ' + evt )
      next()
    } )

    w.on( 'error', function ( filepath ) {
      buffer.push( 'onError'  )
    } )

    var actions = []

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
        [],
        'watcher expected files (0) still being watched'
      )

      t.deepEqual(
        miteru.getWatched(),
        [],
        'miteru expected files (0) still being watched'
      )

      setTimeout( function () {
        t.end()
      }, 100 )
    }
  } )
} )

test( 'test polling interval changes based on mtime (temperatures)', function ( t ) {
  t.timeoutAfter( 7500 )

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'main.js' )

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

    var expected = [
      '',
      'init',
      TEMPERATURE.COLDEST.INTERVAL,
      'coldest',
      'change',
      TEMPERATURE.COLD.INTERVAL,
      'cold',
      'change',
      TEMPERATURE.WARM.INTERVAL,
      'warm',
      'change',
      TEMPERATURE.SEMI_HOT.INTERVAL,
      'semi_hot',
      'change',
      TEMPERATURE.HOT.INTERVAL,
      'hot'
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
    fs.utimesSync( filepath, Date.now() / 1000, 1 )

    // don't add any files to active list that gets faster poll intervals
    miteru._MAX_ACTIVE_LIST_LENGTH = 0

    // delay cpu smoothing to never activate during this test so the polling
    // intervals stay constant
    const lastCpuSmoothing = miteru._disableCpuSmoothing
    miteru._disableCpuSmoothing = true

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          break

        case 'change':
          break

        default:
          t.fail( 'unrecognized watch evt: [ ' + evt + ' ]' )
          break
      }

      var interval = miteru.getPollingInterval( filepath )
      var temperature = ( miteru._getFileWatcher( filepath ).temperature )

      console.log( evt )
      console.log( temperature )
      console.log( interval )

      buffer.push( evt )
      buffer.push( interval )
      buffer.push( temperature )

      setTimeout(
        next,
        TEMPERATURE[ temperature.toUpperCase() ] && TEMPERATURE[ temperature.toUpperCase() ].INTERVAL
        )
    } )

    var actions = [
      function ( next ) {
        var time = Date.now() - TEMPERATURE.COLD.AGE
        var unixTime = time / 1000
        fs.utimesSync( filepath, Date.now() / 1000, unixTime + 5 )
      },
      function ( next ) {
        var time = Date.now() - TEMPERATURE.WARM.AGE
        var unixTime = time / 1000
        fs.utimesSync( filepath, Date.now() / 1000, unixTime + 5 )
      },
      function ( next ) {
        var time = Date.now() - TEMPERATURE.SEMI_HOT.AGE
        var unixTime = time / 1000
        fs.utimesSync( filepath, Date.now() / 1000, unixTime + 5 )
      },
      function ( next ) {
        var time = Date.now() - TEMPERATURE.HOT.AGE
        var unixTime = time / 1000
        fs.utimesSync( filepath, Date.now() / 1000, unixTime + 5 )
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
      miteru._disableCpuSmoothing = lastCpuSmoothing

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

      t.deepEqual(
        miteru.getWatched(),
        [],
        'expected files (0) still being watched'
      )

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

test( 'cover process exit handler', function ( t ) {
  t.timeoutAfter( 7500 )

  process.env.DEV = false

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'cover-process-exit.js' )

    var expected = [
      '',
      'ENOENT',
      'module.exports = 777',
      'init: ' + filepath,
      'result: 777',
      'exiting without closing to cover exit handler',
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
      path.join( __dirname, 'test-process-exit.js' )
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

test( 'cover MITERU_LOGLEVEL temp', function ( t ) {
  t.timeoutAfter( 7500 )

  process.env.DEV = false

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'cover-miteru-loglevel.js' )

    var expected = [
      '',
      'ENOENT',
      'module.exports = 777',
      'HOT file: ' + filepath,
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

    process.env.MITERU_LOGLEVEL = 'temp'

    var _t = setTimeout( function () {
      t.fail( 'timed out' )
      try {
        spawn.kill()
      } catch ( err ) {}
    }, 7500 )

    var spawn = childProcess.spawn( 'node', [
      path.join( __dirname, 'test-miteru-loglevel.js' )
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

test( 'cover MITERU_LOGLEVEL full', function ( t ) {
  t.timeoutAfter( 7500 )

  process.env.DEV = false

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'cover-miteru-loglevel.js' )

    var expected = [
      '',
      'ENOENT',
      'module.exports = 777',
      'FILE WILL READ CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL COMPARE CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'HOT file: /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'init: /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'init: /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'result: 777',
      'FILE WILL READ CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL COMPARE CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL READ CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL COMPARE CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL READ CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL COMPARE CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL READ CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL COMPARE CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL READ CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'FILE WILL COMPARE CONTENT   : /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'watched files: /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
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

    process.env.MITERU_LOGLEVEL = 'full'

    var _t = setTimeout( function () {
      t.fail( 'timed out' )
      try {
        spawn.kill()
      } catch ( err ) {}
    }, 7500 )

    var spawn = childProcess.spawn( 'node', [
      path.join( __dirname, 'test-miteru-loglevel.js' )
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

test( 'cover MITERU_LOGLEVEL evt', function ( t ) {
  t.timeoutAfter( 7500 )

  process.env.DEV = false

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'cover-miteru-loglevel.js' )

    var expected = [
      '',
      'ENOENT',
      'module.exports = 777',
      'init: ' + filepath,
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

    process.env.MITERU_LOGLEVEL = 'evt'

    var _t = setTimeout( function () {
      t.fail( 'timed out' )
      try {
        spawn.kill()
      } catch ( err ) {}
    }, 7500 )

    var spawn = childProcess.spawn( 'node', [
      path.join( __dirname, 'test-miteru-loglevel.js' )
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

test( 'cover MITERU_LOGLEVEL dev', function ( t ) {
  t.timeoutAfter( 7500 )

  process.env.DEV = false

  prepareTestFiles( function () {
    var filepath = path.join( __dirname, 'tmp', 'cover-miteru-loglevel.js' )

    var expected = [
      '',
      'ENOENT',
      'module.exports = 777',
      '== fs.stat:ing ==',
      '== fs.stat OK ==',
      'is edgy',
      'read file contents: module.exports = 777',
      '== 1 ==',
      '== 2 ==',
      'size was: undefined',
      'size now: 20',
      '== 3 ==',
      '== 4 ==',
      'fileContent updated: module.exports = 777',
      '== 5 ==',
      '== 6 ==',
      '== 7 ==',
      '== 8 ==',
      '== 9 ==',
      '== 12 ==',
      'init: /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'init evt -- sizeChanged true, mtimeChanged false, fileContentHasChanged false: [/Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js]',
      '== 13 ==',
      'init: /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
      'result: 777',
      '== fs.stat:ing ==',
      '== fs.stat OK ==',
      'is edgy',
      'read file contents: module.exports = 777',
      '== 1 ==',
      '== 2 ==',
      '== 3 ==',
      '== 4 ==',
      '== 5 ==',
      '== 6 ==',
      '== 7 ==',
      '== 8 ==',
      '== 9 ==',
      '== 10 ==',
      '== 11 ==',
      '== fs.stat:ing ==',
      '== fs.stat OK ==',
      'is edgy',
      'read file contents: module.exports = 777',
      '== 1 ==',
      '== 2 ==',
      '== 3 ==',
      '== 4 ==',
      '== 5 ==',
      '== 6 ==',
      '== 7 ==',
      '== 8 ==',
      '== 9 ==',
      '== 10 ==',
      '== 11 ==',
      '== fs.stat:ing ==',
      '== fs.stat OK ==',
      'is edgy',
      'read file contents: module.exports = 777',
      '== 1 ==',
      '== 2 ==',
      '== 3 ==',
      '== 4 ==',
      '== 5 ==',
      '== 6 ==',
      '== 7 ==',
      '== 8 ==',
      '== 9 ==',
      '== 10 ==',
      '== 11 ==',
      '== fs.stat:ing ==',
      '== fs.stat OK ==',
      'is edgy',
      'read file contents: module.exports = 777',
      '== 1 ==',
      '== 2 ==',
      '== 3 ==',
      '== 4 ==',
      '== 5 ==',
      '== 6 ==',
      '== 7 ==',
      '== 8 ==',
      '== 9 ==',
      '== 10 ==',
      '== 11 ==',
      '== fs.stat:ing ==',
      '== fs.stat OK ==',
      'is edgy',
      'read file contents: module.exports = 777',
      '== 1 ==',
      '== 2 ==',
      '== 3 ==',
      '== 4 ==',
      '== 5 ==',
      '== 6 ==',
      '== 7 ==',
      '== 8 ==',
      '== 9 ==',
      '== 10 ==',
      '== 11 ==',
      'watched files: /Users/mollie/code/miteru/test/tmp/cover-miteru-loglevel.js',
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

    process.env.MITERU_LOGLEVEL = 'dev'

    var _t = setTimeout( function () {
      t.fail( 'timed out' )
      try {
        spawn.kill()
      } catch ( err ) {}
    }, 7500 )

    var spawn = childProcess.spawn( 'node', [
      path.join( __dirname, 'test-miteru-loglevel.js' )
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
