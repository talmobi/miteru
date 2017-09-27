(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

/* global XMLHttpRequest */

longpoll();

function retry() {
  var delta = Date.now() - _startTime;

  if (delta < 1000) {
    delta = 1000 - delta;
  } else {
    delta = 0;
  }

  setTimeout(function () {
    longpoll();
  }, delta);
}

var _startTime = Date.now();
function longpoll() {
  _startTime = Date.now();

  var req = new XMLHttpRequest();
  req.open('GET', 'http://' + window.location.hostname + ':4050', true);

  req.onload = function () {
    if (req.status === 200) {
      // Success
      console.log(' === got reload trigger from miteru === ');
      window.location.reload();
    } else {
      retry();
    }
  };

  req.onerror = function () {
    retry();
  };

  req.send();
}

},{}]},{},[1]);
