const vscode = require('vscode')

function getConfiguration(property) {
  return vscode.workspace.getConfiguration().get(property)
}

function clone(a) {
  let b = Array.isArray(a) ? [] : {};
  let value;
  for (const key in a) {
    value = a[key];
    if (typeof value === "object")
      b[key] = clone(value)
    else
      b[key] =  value;
  }
  return b;
}

module.exports = { getConfiguration, clone }
