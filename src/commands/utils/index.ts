import * as vscode from 'vscode';

function getConfiguration(property: string): void {
  return vscode.workspace.getConfiguration().get(property);
}

function clone(source: object): object {
  if (source instanceof Array) {
    let copy = [];
    for (const item of source) {
      if (typeof item === "object") { copy.push(clone(item)); }
      else { copy.push(item); }
    }
    return copy;
  }
  else if (source instanceof Object) {
    let copy = {} as { [key: string]: any };
    let value;
    for (let attr in source) {
      value = source[attr as keyof typeof source];
      if (typeof value === "object") { copy[attr] = clone(value); }
      else { copy[attr] = value; }
    }
    return copy as object;
  }
  else { return source; }
}

module.exports = { getConfiguration, clone };
