const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const compiler = require('vue-template-compiler')

function parseUnusedScript(code) {
  const template = code.match(/<template>[\s\S]*?<\/template>\s*/)?.[0]
  let matched = code.match(/<script[\s\S]*?>([\s\S]+)<\/script>/d)
  let script_offset = matched?.indices[1][0]
  let script = matched?.[1]
  if (!script || !template)
    return
  const template_ast = compiler.compile(template, { outputSourceRange: true }).ast
  console.log(template)
  console.log(template_ast)

  let variables = new Set()
  let functions = new Set()
  const references = []
  function generateAst(code, type = 'script') {
    // console.log(code)
    const ast = parser.parse(code, {
      sourceType: type,
    })
    // console.debug(ast)
    return ast
  }
  function parseReference(code, exceptions = [], set = variables) {
    if (!code) return
    if (/^\s*[A-Za-z0-9_]\w*\s*$/.test(code)) {
      if (!exceptions.includes(code)) set.add(code)
    } else {
      traverse(generateAst(code), {
        CallExpression(path) {
          functions.add(path.node.callee.name)
        },
        MemberExpression(path) {
          if (!exceptions.includes(path.node.object.name)) variables.add(path.node.object.name)
        },
      })
    }
  }
  let ifBlocks = []
  function traverseChildren(node, exceptions = []) {
    if (!node) return
    if (node.vfor_alias) exceptions = [node.vfor_alias, node.vfor_iterator]
    parseReference(node.for, exceptions)
    node.ifConditions?.forEach((ifCondition) => {
      let code = ifCondition.exp
      parseReference(code, exceptions)
      ifBlocks.push([ifCondition.block, exceptions])
    })
    node.attrsList?.forEach((attr) => {
      let code = attr.value
      if (attr.name.startsWith('@')) {
        console.log(attr.name, code)
        parseReference(code, exceptions, functions)
      } else if (attr.name.startsWith(':') || attr.name.startsWith('v-')) {
        // console.log(attr.name, code)
        parseReference(code, exceptions)
      }
    })
    node.tokens?.forEach((token) => {
      let code = token['@binding']
      console.log('@binding', code)
      parseReference(code, exceptions)
    })
    node.children?.forEach((child) => {
      if (node.for) {
        child.vfor_alias = node.alias
        child.vfor_iterator = node.iterator1
      }
      traverseChildren(child)
    })
  }
  traverseChildren(template_ast)
  console.log(ifBlocks)
  ifBlocks.forEach(([blcok, exceptions]) => {
    traverseChildren(blcok, exceptions)
  })
  functions = Array.from(functions)
  variables = Array.from(variables)
  console.debug(functions)
  console.debug(variables)

  class Reference {
    #referenced = 0
    constructor(start, end) {
      if (start !== undefined) this.start = start
      if (end !== undefined) this.end = end
    }
    get referenced() {
      return this.#referenced
    }
    increseRef() {
      this.#referenced++
      // this.referenced = this.#referenced
    }
    decreseRef() {
      if (this.#referenced === 0) console.error('reference amount can not be negative')
      else this.#referenced--
      // this.referenced = this.#referenced
    }
    toString() {
      return 'referenced: ' + this.#referenced
    }
  }

  let removes = []
    const origin = script
    const ast = parser.parse(script, {
      sourceType: 'module',
    })
    console.debug('body', ast.program.body)
    traverse(ast, {
      ImportDeclaration(path) {
        // console.log(script.substring(path.node.start, path.node.end))
        let specifiers = path.node.specifiers.map((specifier) => {
          const referenced = path.scope.getBinding(specifier.local.name)?.referenced
          // console.log(specifier, script.substring(specifier.start, specifier.end))
          return {
            referenced,
            start: specifier.start,
            end: specifier.end,
          }
        })
        let unused = specifiers.filter((specifier) => {
          return !specifier.referenced
        })
        if (unused.length === specifiers.length) {
          removes.push(path.node)
        } else {
          for (const i in specifiers) {
            if (!specifiers[i].referenced) {
              if (i == 0) {
                removes.push(specifiers[i])
              } else {
                removes.push({
                  start: specifiers[i - 1].end,
                  end: specifiers[i].end,
                })
              }
            }
          }
        }
      },
      ExportDefaultDeclaration(path) {
        console.log(path.node)
        const options = path.node.declaration.properties
        const findNode = (name) => {
          const data = options?.filter((node) => {
            return node.key.name == name
          })
          let node
          if (data?.at(0).body) node = data[0].body?.body
          else node = data[0]
          console.log(name, node)
          return node
        }
        const datas = {}
        findNode('data')
          ?.at(0)
          ?.argument.properties?.forEach((node, i, arr) => {
            datas[node.key.name] = new Reference(node.start)
            if (i != arr.length - 1) {
              datas[node.key.name].end = arr[i + 1].start
            } else {
              let str = script.substr(node.end).match(/\s*,/)?.[0]
              datas[node.key.name].end = node.end + str?.length
            }
            // console.log(node.key.name, script.substring(datas[node.key.name].start, datas[node.key.name].end))
          })
        let methods = {}
        findNode('methods')?.value.properties?.forEach((node, i, arr) => {
          methods[node.key.name] = new Reference(node.start, node.end)
          if (i != arr.length - 1) {
            methods[node.key.name].end = arr[i + 1].start
          } else {
            let str = script.substr(node.end).match(/\s*,/)?.[0]
            methods[node.key.name].end = node.end + str?.length
          }
          // console.log(node.key.name, script.substring(methods[node.key.name].start, methods[node.key.name].end))
        })

        const parseRef = (node) => {
          const code = script.substring(node.start, node.end)
          const ast = parser.parse(code, {
            sourceType: 'script',
          })
          // console.debug(code)
          // console.debug(ast)
          traverse(ast, {
            MemberExpression(path) {
              // console.log('MemberExpression', script.substring(path.node.start, path.node.end));
              let node = path.node
              if (node?.type == 'MemberExpression' && node.object.type == 'ThisExpression') {
                datas[node.property.name]?.increseRef()
                // console.log(node.property.name, datas[node.property.name]?.referenced);
              }
            },
            CallExpression(path) {
              // console.log('CallExpression', script.substring(path.node.start, path.node.end));
              let callee = path.node.callee
              if (callee.type == 'MemberExpression' && callee.object.type == 'ThisExpression') {
                methods[callee.property.name]?.increseRef()
                // console.log(callee.property.name, methods[callee.property.name]?.referenced);
              }
            },
          })
        }
        traverse(ast, {
          IfStatement(path) {
            // console.log('IfStatement', script.substring(path.node.test.start, path.node.test.end));
            parseRef(path.node.test)
          },
          AssignmentExpression(path) {
            // console.log('AssignmentExpression', path.node, script.substring(path.node.right.start, path.node.right.end));
            parseRef(path.node.right)
          },
          CallExpression(path) {
            // console.log('CallExpression', script.substring(path.node.start, path.node.end));
            let callee = path.node.callee
            if (callee.type == 'MemberExpression' && callee.object.type == 'ThisExpression') {
              methods[callee.property.name]?.increseRef()
              // console.log(callee.property.name, methods[callee.property.name]?.referenced);
            }
          },
        })

        console.log(script)
        console.log(functions)
        console.log(variables)
        console.log(datas)
        console.log(methods)
        for (const [key, val] of Object.entries(methods)) {
          // console.log(key, val.referenced, functions.includes(key), script.substring(val.start, val.end))
          if (!val.referenced && !functions.includes(key)) {
            removes.push(val)
            console.log(key, script.substring(val.start, val.end))
          }
        }
        for (const [key, val] of Object.entries(datas)) {
          if (!val.referenced && !variables.includes(key)) {
            removes.push(val)
            console.log(key, script.substring(val.start, val.end))
          }
        }
      },
    })

    removes = removes.map(item => {
      item.start += script_offset
      item.end += script_offset
      return item
    })
  return removes
}

module.exports = { parseUnusedScript }