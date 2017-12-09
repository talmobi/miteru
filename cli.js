#!/usr/bin/env node

var glob = require( 'redstar' )
var fs = require( 'fs' )
var path = require( 'path' )
var childProcess = require( 'child_process' )

var miteru = require( path.join( __dirname, 'dist/miteru.js' ) )

var argv = require( 'minimist' )( process.argv.slice( 2 ), {
  boolean: [ 'help', 'version', 'init', 'add', 'change', 'unlink', 'stats', 'verbose' ],
  alias: {
    h: 'help',
    V: 'version',
    v: 'verbose',

    e: 'execute',

    i: 'init',
    c: 'change',
    a: 'add',
    u: 'unlink'
  }
} )

if ( argv.version ) {
  var p = fs.readFileSync( path.join( __dirname, 'package.json' ) )
  var json = JSON.parse( p )
  console.log( json.version )
  process.exit( 0 )
}

var verbose = function () {}

if ( argv.verbose ) {
  var self = this
  verbose = function () {
    console.log.apply( self, arguments )
  }
}

if ( argv.help ) {
  console.log( fs.readFileSync( path.join( __dirname, 'usage.txt' ), 'utf8' ) )
  process.exit( 0 )
}

if ( !argv.i && !argv.a && !argv.c && !argv.u ) {
  // by default, watch adds and changes
  argv.a = true
  argv.c = true
}

var eventString = []

if ( argv.i ) eventString.push( 'init' )
if ( argv.a ) eventString.push( 'add' )
if ( argv.c ) eventString.push( 'change' )
if ( argv.u ) eventString.push( 'unlink' )
console.log( 'events watched: ' + eventString.join( ',' ) )

var opts = {}

if ( argv[ 'limit' ] ) {
  opts.minInterval = argv[ 'limit' ]
}

if ( argv.stats ) {
  opts.report = argv.stats
}

var watcher = miteru.watch( opts )

watcher.callback = function ( evt, filepath ) {
  var timestring = ( new Date() ).toTimeString().split( ' ' )[ 0 ]

  switch ( evt ) {
    case 'init':
      if ( argv.i ) {
        verbose(
          timestring + ' init at: ' + path.relative(
            process.cwd(), filepath
          )
        )

        if ( argv.e ) {
          exec( argv.e, evt, filepath )
        }
      }

      showInitMessage()
      break

    case 'unlink':
      if ( argv.u ) {
        verbose(
          timestring + ' unlink at: ' + path.relative(
            process.cwd(), filepath
          )
        )

        if ( argv.e ) {
          exec( argv.e, evt, filepath )
        }
      }
      break

    case 'add':
      if ( argv.a ) {
        verbose(
          timestring + ' add at: ' + path.relative(
            process.cwd(), filepath
          )
        )

        if ( argv.e ) {
          exec( argv.e, evt, filepath )
        }
      }
      break

    case 'change':
      if ( argv.c ) {
        verbose(
          timestring + ' change at: ' + path.relative(
            process.cwd(), filepath
          )
        )

        if ( argv.e ) {
          exec( argv.e, evt, filepath )
        }
      }
      break
  }
}

argv._.forEach( function ( pattern ) {
  var isPattern = ( glob.hasMagic( pattern ) )
  if ( isPattern ) {
    console.log( 'watching pattern: ' + pattern )
  }

  watcher.add( pattern )
} )

var _spawns = []
process.on( 'exit', function () {
  try {
    watcher.close()
  } catch ( err ) {}

  _spawns.forEach( function ( spawn ) {
    try {
      spawn.kill()
    } catch ( err ) {}
  } )
} )

var _commands = []
var _execTimeout
function exec ( cmd, evt, file ) {
  file = path.relative( process.cwd(), path.resolve( file ) )

  // replace $file with relative filename
  cmd = cmd.split( '$file' ).join( file )

  // replace $evt with evt
  cmd = cmd.split( '$evt' ).join( evt )

  // kill previous in case they haven't exited themselves yet
  _spawns.forEach( function ( spawn ) {
    try {
      spawn.kill()
    } catch ( err ) { /* ignore */ }
  } )

  _commands.push( cmd )

  clearTimeout( _execTimeout )
  _execTimeout = setTimeout( function () {
    var commands = _commands.slice()
    _commands = []
    commands.forEach( function ( cmd ) {
      verbose( 'running command: ' + cmd )
      var split = cmd.split( /\s+/g )
      var spawn = childProcess.spawn( split[ 0 ], split.slice( 1 ) )
      _spawns.push( spawn )

      spawn.on( 'exit', function () {
        var i = _spawns.indexOf( spawn )
        _spawns.splice( i, 1 )
      } )

      spawn.stdout.on( 'data', function ( chunk ) {
        process.stdout.write( chunk )
      } )

      spawn.stderr.on( 'data', function ( chunk ) {
        process.stderr.write( chunk )
      } )
    } )
  }, 100 )
}

var _showInitMessageTimeout
function showInitMessage () {
  clearTimeout( _showInitMessageTimeout )
  _showInitMessageTimeout = setTimeout( function () {
    console.log( watcher.getWatched().length + ' files are being watched' )
  }, 500 )
}

function clearConsole () {
  // send special code to clear terminal/console screen
  process.stdout.write( '\x1bc' )
}

function _printWatchedFiles () {
  clearConsole()
  var watched = watcher.getWatched()
  watched.forEach( function ( filepath ) {
    console.log( '  ' + filepath )
  } )
  console.log( 'watched files: ' + watched.length )
}

var commands = {
  'watched': _printWatchedFiles,
  'files': _printWatchedFiles,
  'list': _printWatchedFiles,
  'execute': function () {
    clearConsole()
    var execute = argv.e
    console.log( '  -e ' + execute )
  }
}

var _lastCommand
process.stdin.on( 'data', function ( chunk ) {
  // console.log( 'stdin chunk: ' + chunk )
  var text = chunk.toString( 'utf8' ).toLowerCase().trim()

  var words = text.split( /\s+/ )

  var cmd = words[ 0 ]

  // repeat last command
  if ( !cmd && _lastCommand ) {
    return _lastCommand()
  }

  var args = words.slice( 1 )

  var keys = Object.keys( commands )
    .filter( function ( command ) {
      return ( command.indexOf( cmd ) >= 0 )
    } )
    .sort( function ( a, b ) {
      return ( a.indexOf( cmd ) - b.indexOf( cmd ) )
    } )

  var fn = commands[ keys[ 0 ] ]

  if ( typeof fn === 'function' ) {
    _lastCommand = function () {
      fn( args )
    }
    fn( args )
  } else {
    console.log( 'unknown command: ' + cmd )
  }
} )
