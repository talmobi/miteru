var miteru = require( './dist/miteru.js' )
var watcher = miteru.watch( function ( evt, filepath ) {
  switch ( evt ) {
    case 'init':
      // only emitted once during the first polling cycle ( if the file exists )
      console.log( 'init: ' + filepath )
      break
    case 'add':
      // file was added ( did not exists previously, exists now )
      console.log( 'add: ' + filepath )
      break
    case 'change':
      // file was changed ( existed previously, exists now, mtime or content changed )
      console.log( 'change: ' + filepath )
      break
    case 'unlink':
      // file was removed ( existed previously, does not exist now )
      console.log( 'unlink: ' + filepath )
      break
  }
} )

watcher.add( 'src/**/*.js' )

setTimeout( function () {
  console.log( watcher.getWatched() )
  watcher.clear()
  console.log( watcher.getWatched() )

  setTimeout( function () {
    watcher.add( 'package.json' )

    setTimeout( function () {
      watcher.clear() // will exit naturally because no files are being watched
    }, 3000 )
  }, 3000 )
}, 5000 )
