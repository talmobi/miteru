[![npm](https://img.shields.io/npm/v/miteru.svg?maxAge=3600&style=flat-square)](https://www.npmjs.com/package/miteru)
[![npm](https://img.shields.io/npm/l/miteru.svg?maxAge=3600&style=flat-square)](https://github.com/talmobi/miteru/blob/master/LICENSE)

# miteru

Basic file watcher.

## Easy to use

#### CLI
```bash
miteru '**/*.js' -e 'echo $evt: $file'
```

#### Module
```javascript
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
  console.log( watcher.getWatched() ) // array of files being watched
  watcher.clear()
  console.log( watcher.getWatched() ) // empty array ( no files being watched )

  setTimeout( function () {
    watcher.add( 'package.json' )

    setTimeout( function () {
      watcher.clear() // will exit naturally because no files are being watched
    }, 3000 )
  }, 3000 )
}, 5000 )
```

## Example

```bash
$ miteru '**/*.js' -e 'echo file: $file'
events watched: add,change
watching pattern: **/*.js
10 files are being watched
```

## CLI STDIN commands

The miteru process listens for line separated STDIN commands ( first match algorithm )

### list, files, watched
prints out the files being watched

```bash
$ miteru '**/*.js' -e 'echo file: $file'
events watched: add,change
watching pattern: **/*.js
11 files are being watched
fil
  /Users/mollie/code/miteru/cli.js
  /Users/mollie/code/miteru/dist/miteru.js
  /Users/mollie/code/miteru/sample.js
  /Users/mollie/code/miteru/src/index.js
  /Users/mollie/code/miteru/test/bench-readdir.js
  /Users/mollie/code/miteru/test/samples/animal.js
  /Users/mollie/code/miteru/test/samples/main.js
  /Users/mollie/code/miteru/test/test-close.js
  /Users/mollie/code/miteru/test/test-unwatch.js
  /Users/mollie/code/miteru/test/test.js
  /Users/mollie/code/miteru/test/tmp/unwatch.js
watched files: 11
```

### execute
prints out the execute command being used

```bash
$ ./cli.js '**/*.js' -e 'echo file: $file'
events watched: add,change
watching pattern: **/*.js
11 files are being watched
ex
  -e echo file: $file
```

## Install

locally ( project specific, for use with npm scripts )

```
npm install miteru
```

globally
```
npm install -g miteru
```

## Why

Simple file watching that `just works ™` as fast and as painless as possible.
Intended for watching files during development qickly and easily to trigger rebuilds etc.

## Alternatives

[chokidar](https://github.com/paulmillr/chokidar)

[chokidar-cli](https://github.com/kimmobrunfeldt/chokidar-cli)

## How

Elastic fs.stat polling. Rank orders each file by how often it's changed and sets polling priority accordingly.

## Usage

```
$ miteru --help

Usage: miteru [options] <files>

Options:

-e, --execute <command>         Execute a command when a file event occurs.

-i, --init                      Listen for file init events.
-a, --add                       Listen for file add events.
-c, --change                    Listen for file change events.
-u, --unlink                    Listen for file unlink events.

                                By default --add and --change events
                                are listened to if no events are specified.

--limit <milliseconds>          Minimum allowed polling interval.

-v, --verbose                   Verbose output.
--stats                         Print detailed stats every 1 second.

-V, --version                   Print miteru version and exit.
-h, --help                      Print help ( this text ) and exit.

Examples:
  miteru -e 'npm run build' "src/**/*.js"
  miteru -iacu -e 'echo $evt: $file' "src/**/*.js"
  miteru -e 'sshpass -p "giraffe" scp $file user@10.0.0.6:/home/user/app/$file'

    NOTE: using sshpass -p "password" will add your password to bash history -- use -f to load password from file.
```

## Test

```
npm test
```
