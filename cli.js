#!/usr/bin/env node

var glob = require( 'redstar' )
var fs = require( 'fs' )
var path = require( 'path' )
var childProcess = require( 'child_process' )

var miteru = require( path.join( __dirname, 'src', 'index.js' ) )

var argv = require( 'minimist' )( process.argv.slice( 2 ), {
  boolean: [ 'help', 'version', 'init', 'add', 'change', 'unlink' ],
  alias: {
    h: 'help',
    v: 'version',

    s: 'server',

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
  '  WORK IN PROGRESS',
  '  miteru -e "npm run build" "src/*.js"',
  ''
]

if ( argv.help ) {
  console.log( usage.join( '\n' ) )
  return process.exit( 0 )
}

var _pendingRequests = []
var _server
if ( argv.s ) {
  if ( typeof argv.s !== 'string' ) {
    argv.s = ''
  }

  var miteruPath = path.join( __dirname, 'dist', 'miteru.js' )
  var publicPath = path.join( process.cwd(), argv.s, 'miteru.js' )

  var buffer = fs.readFileSync( miteruPath )
  fs.writeFileSync( publicPath, buffer )

  var http = require( 'http' )
  _server = http.createServer( function ( req, res ) {
    var r = {
      req: req,
      res: res
    }
    _pendingRequests.push( r )
    setTimeout( function () {
      var i = _pendingRequests.indexOf( r )
      if ( i >= 0 ) {
        _pendingRequests.splice( i, 1 )
      }
      res.end()
    }, 1000 * 25 )
  } )

}

function startServer () {
  if ( _server ) {
    _server.listen( 4050, function () {
      console.log( 'miteru server listening on *:' + _server.address().port )
    } )
  }
}

function triggerReload ( attempts ) {
  attempts = ( attempts || 0 )

  if (
    ( _pendingRequests.length < 1 ) &&
    ( attempts < 10 )
  ) {
    return setTimeout( function () {
      triggerReload( attempts + 1 )
    }, 100 )
  }

  _pendingRequests.forEach( function ( r ) {
    var req = r.req
    var res = r.res
    // Set CORS headers
    // res.setHeader( 'Access-Control-Allow-Origin', req.headers.origin )
    res.setHeader( 'Access-Control-Allow-Origin', '*' )
    res.setHeader( 'Access-Control-Request-Method', '*' )
    res.setHeader( 'Access-Control-Allow-Methods', 'OPTIONS, GET')
    res.setHeader( 'Access-Control-Allow-Headers', '*' )
    res.writeHead( '200' )
    res.end()
  } )

  _pendingRequests = []
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

var opts = {}

if ( argv.limit ) {
  opts.minInterval = argv.limit
}

var watcher = miteru.watch( opts )

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
    startServer()
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

        triggerReload()
      }

      showInitMessage()
      break

    case 'unlink':
      if ( argv.u ) {
        console.log( timestring + ' - CLI: unlink at: ' + filepath )

        if ( argv.e ) {
          exec( argv.e, filepath )
        }

        triggerReload()
      }
      break

    case 'add':
      if ( argv.a ) {
        console.log( timestring + ' - CLI: add at: ' + filepath )

        if ( argv.e ) {
          exec( argv.e, filepath )
        }

        triggerReload()
      }
      break

    case 'change':
      if ( argv.c ) {
        console.log( timestring + ' - CLI: change at: ' + filepath )

        if ( argv.e ) {
          exec( argv.e, filepath )
        }

        triggerReload()
      }
      break
  }
}
