#!/usr/bin/env node

var miteru = require('./index.js')
var glob = require('glob')
var childProcess = require('child_process')

var argv = require('minimist')(process.argv.slice(2), {
  boolean: ['help', 'version', 'no-color', 'top'],
  alias: {
    h: 'help',
    v: 'version',
    t: 'top'
  }
})

var usage = [
  '',
  'Usage: miteru [options] <cmd>',
  '',
  'Example:',
  '',
  '  miteru -e "npm run build" "src/**.js"',
  ''
]

var watcher = miteru.create()

argv._.forEach(function ( pattern ) {
  var files = glob.sync( pattern )

  if (files.length) {
    files.forEach(function ( file ) {
      console.log('watching file: ' + file)
      watcher.watch( file )
    })
  } else {
    console.log('watching file: ' + pattern)
    watcher.watch( pattern )
  }
})

var _spawns = []
process.on('exit', function () {
  try {
    watcher.close()
  } catch (err) {}

  _spawns.forEach(function ( spawn ) {
    try {
      spawn.kill()
    } catch (err) {}
  })
})

var _timeout
function exec (cmd) {
  // kill previous in case they haven't exited themselves yet
  _spawns.forEach(function ( spawn ) {
    try {
      spawn.kill()
    } catch (err) {}
  })

  clearTimeout(_timeout)
  _timeout = setTimeout(function () {
    console.log('running command: ' + cmd)
    var split = cmd.split(/\s+/g)
    var spawn = childProcess.spawn( split[0], split.slice(1) )
    _spawns.push( spawn )

    spawn.on('exit', function () {
      var i = _spawns.indexOf( spawn )
      _spawns.splice(i, 1)
    })

    spawn.stdout.on('data', function ( chunk ) {
      process.stdout.write( chunk )
    })

    spawn.stderr.on('data', function ( chunk ) {
      process.stderr.write( chunk )
    })
  }, 100)
}

watcher.on('unlink', function (info) {
  console.log('unlink at: ' + info.filepath)
})

watcher.on('add', function (info) {
  console.log('add at: ' + info.filepath)
})

watcher.on('modification', function (info) {
  var cmd = argv.e
  console.log('modification at: ' + info.filepath)
  if ( cmd ) {
    exec( cmd )
  } else {
    console.log()
    // console.log('(no command argument ([-e, --execute] <command string>) supplied -- doing nothing')
  }
})
