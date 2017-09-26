#!/usr/bin/env node

var glob = require( 'glob' )
var fs = require( 'fs' )
var path = require( 'path' )
var childProcess = require( 'child_process' )

var miteru = require( path.join( __dirname, 'src', 'index.js' ) )

var argv = require( 'minimist' )( process.argv.slice( 2 ), {
  boolean: [ 'help', 'version', 'init', 'add', 'change', 'unlink' ],
  alias: {
    h: 'help',
    v: 'version',

    i: 'init',
    c: 'change',
    a: 'add',
    u: 'unlink',

    r: 'replace'
  }
} )

if ( argv.version ) {
  var p = fs.readFileSync( path.join( __dirname, 'package.json' ) )
  var json = JSON.parse( p )
  console.log( json.version )
  return process.exit( 0 )
}

var usage = [
  '',
  'Usage: miteru [options] <cmd>',
  '',
  'Example:',
  '',
  '  miteru -e "npm run build" "src/**.js"',
  ''
]

if ( argv.help ) {
  console.log( usage.join( '\n' ) )
  return process.exit( 0 )
}

if ( !argv.i && !argv.a && !argv.c && !argv.u ) {
  // by default, watch adds and changes
  argv.a = true
  argv.c = true
}

var eventString = ''

if ( argv.i ) eventString += 'i'
if ( argv.a ) eventString += 'a'
if ( argv.c ) eventString += 'c'
if ( argv.u ) eventString += 'u'
console.log( 'events watched: ' + eventString )

var watcher = miteru.watch()

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

var _execTimeout
function exec ( cmd, file ) {
  var r = ( argv.r || '$file' )

  if ( cmd.indexOf( r ) !== -1 && file ) {
    cmd = cmd.split( r ).join( file )
  }

  // kill previous in case they haven't exited themselves yet
  _spawns.forEach( function ( spawn ) {
    try {
      spawn.kill()
    } catch ( err ) {}
  } )

  clearTimeout( _execTimeout )
  _execTimeout = setTimeout( function () {
    console.log( 'running command: ' + cmd )
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
  }, 100 )
}

var _showInitMessageTimeout
function showInitMessage () {
  clearTimeout( _showInitMessageTimeout )
  _showInitMessageTimeout = setTimeout( function () {
    console.log( watcher.getWatched().length + ' files are being watched' )
  }, 200 )
}

watcher.callback = function ( evt, filepath ) {
  var timestring = ( new Date() ).toTimeString().split( ' ' )[ 0 ]

  switch ( evt ) {
    case 'init':
      if ( argv.i ) {
        console.log( timestring + ' - CLI: init at: ' + filepath )

        if ( argv.e ) {
          exec( argv.e, filepath )
        }
      }

      showInitMessage()
      break

    case 'unlink':
      if ( argv.u ) {
        console.log( timestring + ' - CLI: unlink at: ' + filepath )

        if ( argv.e ) {
          exec( argv.e, filepath )
        }
      }
      break

    case 'add':
      if ( argv.a ) {
        console.log( timestring + ' - CLI: add at: ' + filepath )

        if ( argv.e ) {
          exec( argv.e, filepath )
        }
      }
      break

    case 'change':
      if ( argv.c ) {
        console.log( timestring + ' - CLI: change at: ' + filepath )

        if ( argv.e ) {
          exec( argv.e, filepath )
        }
      }
      break
  }
}
