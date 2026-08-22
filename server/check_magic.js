const fs = require('fs');
const buffer = fs.readFileSync('test.png');
console.log(buffer.slice(0, 16).toString('hex'));
