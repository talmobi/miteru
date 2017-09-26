/* global XMLHttpRequest */

longpoll()

function retry () {
  var delta = ( Date.now() - _startTime )

  if ( delta < 1000 ) {
    delta = ( 1000 - delta )
  } else {
    delta = 0
  }

  setTimeout( function () {
    longpoll()
  }, delta )
}

var _startTime = Date.now()
function longpoll () {
  _startTime = Date.now()

  var req = new XMLHttpRequest()
  req.open( 'GET', 'http://' + window.location.hostname + ':4050', true )

  req.onload = function () {
    if ( req.status === 200 ) {
      // Success
      console.log( ' === got reload trigger from miteru === ' )
      window.location.reload()
    } else {
      retry()
    }
  }

  req.onerror = function () {
    retry()
  }

  req.send()
}
