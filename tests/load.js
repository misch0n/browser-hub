// Loads the browser scripts into Node in the same order as index.html.
const path = require('path');
for (const f of ['util', 'store', 'aliases', 'dispatch', 'completion', 'calc', 'units', 'tools', 'ics', 'data', 'importer', 'commands']) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
}
module.exports = globalThis.CC;
