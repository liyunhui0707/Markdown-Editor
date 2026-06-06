const fs = require('fs');

function logToStderr(prefix, message) {
  fs.writeSync(process.stderr.fd, `[${prefix}] ${message}\n`);
}

module.exports = { logToStderr };
