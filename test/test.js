var miteru = require('../index.js')

var w = miteru.create()

w.watch('./samples/app.js')

w.on('modification', function (info) {
  console.log(info)
})
