#!/bin/sh

COUNTER=0
while [ $COUNTER -lt $1 ] ; do
  touch "file$COUNTER.js"
  let COUNTER=COUNTER+1
done
