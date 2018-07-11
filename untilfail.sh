#!/bin/bash

count=0; while npm run test:only; do (( count++ )); echo "$count"; done && say Tests have finished
