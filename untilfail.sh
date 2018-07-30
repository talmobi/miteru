#!/bin/bash

count=0; while npm run test:only; do (( count++ )); echo ""; echo "======="; echo "$count"; echo "======="; echo ""; done && say Tests have finished
