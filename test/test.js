var rimraf = require('rimraf')
var mkdirp = require('mkdirp')
var ncp = require('ncp').ncp

var fs = require('fs')
var path = require('path')

var miteru = require('../src/index.js')

var test = require('tape')

function run ( filepath ) {
  var resolved = require.resolve( filepath )
  delete require.cache[ resolved ]
  return require( resolved )
}

function prepareTestFiles ( next ) {
  rimraf( 'test/tmp', function () {
    mkdirp( 'test/tmp', function ( err ) {
      if (err) throw err
      next()
    })
  })
}

function cleanup ( done ) {
  rimraf('./test/tmp', function ( err ) {
    if (err) throw err
    done()
  })
}

test('watch a single file', function (t) {
  t.timeoutAfter( 2500 )

  prepareTestFiles(function () {
    var filepath = path.join( __dirname, 'tmp', 'main.js' )

    var expected = [
      ''
      , 'init: abra'
      , 'change: 88'
      , 'unlink'
      , 'add: 11'
    ]

    var buffer = ['']

    try {
      fs.readFileSync( filepath )
      t.fail( 'test preparation failure' )
    } catch (err) {
      t.equal( err.code, 'ENOENT', 'test preapred properly' )
    }

    fs.writeFileSync( filepath, 'module.exports = "abra"' )

    var w = miteru.watch( filepath, function ( evt, filepath ) {
      switch ( evt ) {
        case 'init':
          buffer.push( 'init: ' + run( filepath ))
          break

        case 'add':
          buffer.push( 'add: ' + run( filepath ) )
          break

        case 'unlink':
          try {
            fs.readFileSync( filepath )
            t.fail('unlink event FAILURE (File still exists)')
          } catch (err) {
            t.equal(err.code, 'ENOENT', 'unlink event OK (ENOENT)')
            buffer.push('unlink')
          }
          break

        case 'change':
          buffer.push('change: ' + run( filepath ))
          break
      }
    })

    var actions = [
      function () {
        fs.writeFileSync( filepath, 'module.exports = 88' )
      },
      function () {
        rimraf.sync( filepath )
      },
      function () {
        fs.writeFileSync( filepath, 'module.exports = 11' )
      },
    ]

    setTimeout(next, 200)

    function next () {
      var a = actions.shift()
      if ( a ) {
        a()
        setTimeout(next, 200)
      } else {
        finish()
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

      setTimeout(function () {
        t.end()
      }, 100)
    }
  })
})
