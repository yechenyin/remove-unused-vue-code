const vscode = require('vscode')
const { parseUnusedScript } = require('./parser/script')
const { parseUnusedStyle } = require('./parser/style')

module.exports = function () {
  const { activeTextEditor } = vscode.window
  if (activeTextEditor && activeTextEditor.document.languageId.includes('vue')) {
    let code = activeTextEditor.document.getText()

    let removes
    do {
      removes = parseUnusedScript(code)
      code = removeUnused(code, removes)
    } while (removes.length > 0)
    console.log(code)

    removes = parseUnusedStyle(code)
    code = removeUnused(code, removes)
    console.log(code)

    activeTextEditor.edit((editBuilder) => {
      editBuilder.replace(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(activeTextEditor.document.lineCount + 1, 0)), code)
      vscode.commands.executeCommand('workbench.action.files.save')
    })
  }
}

function removeUnused(code, removes) {
  if (!removes?.length)
    return code
  removes = removes.sort((a, b) => b.end - a.end)
  removes = removes.map((item) => {
    let { start, end } = item
    return { start, end }
  })
  console.log(removes)
  removes.forEach((item, i, arr) => {
    if (item.start > item.end) {
      console.error('start index is greater than end index in remove array')
      return
    }
    if (i >= 1 && arr[i].end > arr[i - 1].start && arr[i].start < arr[i - 1].start) {
      console.error('current end index has intersection with last item in remove array')
      return
    }
    if (i >= 1 && arr[i].start > arr[i - 1].start) {
      arr.splice(i, 1)
    }
  })
  for (let i = 1; i < removes.length; i++) {
    if (i >= 1 && removes[i].start > removes[i - 1].start) {
      removes.splice(i, 1)
      i--
    }
  }
  for (const remove of removes) {
    // remove new line and blank before sentence
    let { start, end } = remove
    if (code.charAt(remove.end).match(/\s/)) {
      while (start - 1 > 0 && code.charAt(start - 1).match(/\s/)) {
        if (code.charAt(start - 1) == '\n') {
          start = start - 2
          break
        } else {
          start--
        }
      }
    }
    // remove unused code
    code = code.substring(0, start) + code.substring(end, code.length)
    // console.log(code.substring(start, end))
  }
  console.log(code)
  return code
}
