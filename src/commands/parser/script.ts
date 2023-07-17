import * as babel from '@babel/types'
import * as parser from '@babel/parser'
import traverse, { NodePath } from '@babel/traverse'
import * as compiler from 'vue-template-compiler'

function parseUnusedScript(code: string) {
  const template = code.match(/<template>[\s\S]*?<\/template>\s*/)?.[0]
  let matched = code.match(/<script[\s\S]*?>([\s\S]+)<\/script>/d)
  let script = matched?.[1]
  if (!script || !template) { return }
  let script_offset = matched!.indices?.[1][0]
  const template_ast = compiler.compile(template, { outputSourceRange: true }).ast
  // console.debug(template)
  console.debug(template_ast)

  let variables = new Set<string>()
  let functions: Set<string> = new Set()
  const references = []
  function generateAst(code: string, type: "script" | "module" | "unambiguous" | undefined = 'script') {
    // console.debug(code)
    const ast = parser.parse(code, {
      sourceType: type,
    })
    // console.debug(ast)
    return ast
  }
  function parseReference(code: string | undefined, exceptions: Array<string> = [], set: Set<string> = variables) {
    if (!code) { return }
    if (/^\s*[A-Za-z_$][A-Za-z0-9_$]*\s*$/.test(code)) { //属性值如果是一个变量
      if (!exceptions.includes(code)) { set.add(code) }
    } else {
      traverse(generateAst(code), {
        CallExpression(path: any) {
          functions.add(path.node.callee.name)
        },
        MemberExpression(path: any) {
          if (!exceptions.includes(path.node.object.name))
            { variables.add(path.node.object.name) }
        },
        BinaryExpression(path) {
          if (path.node.left.type == 'Identifier' && !exceptions.includes(path.node.left.name))
            {variables.add(path.node.left.name)}
          if (path.node.right.type == 'Identifier' && !exceptions.includes(path.node.right.name))
            {variables.add(path.node.right.name)}
        },
      })
    }
  }
  let ifBlocks: Array<[compiler.ASTElement, Array<string>]> = []
  // interface VUENode extends compiler.ASTElement {
  //   vfor_alias?: string,
  //   vfor_iterator?: string
  // }

  type VUENode = compiler.ASTNode & {
    vfor_alias?: string,
    vfor_iterator?: string
  }
  function traverseChildren(node: VUENode | undefined, exceptions: Array<string> = []) {
    if (!node) { return }
    (node as compiler.ASTExpression).tokens?.forEach((token) => {
      let code = (token as Record<string, any>)['@binding']
      console.debug('@binding', code)
      parseReference(code, exceptions)
    })
    if (node.vfor_alias)
      { exceptions.push(node.vfor_alias) }
    if (node.vfor_iterator)
      { exceptions.push(node.vfor_iterator) }
    node = <compiler.ASTElement>node
    parseReference(node.for, exceptions)
    node.ifConditions?.forEach((ifCondition: compiler.ASTIfCondition) => {
      let code = ifCondition.exp
      parseReference(code, exceptions)
      ifBlocks.push([ifCondition.block, exceptions])
    })
    node.attrsList?.forEach((attr) => {
      let code = attr.value
      if (attr.name.startsWith('@')) {
        console.debug(attr.name, code)
        parseReference(code, exceptions, functions)
      } else if (attr.name.startsWith(':') || attr.name.startsWith('v-')) {
        // console.debug(attr.name, code)
        parseReference(code, exceptions)
      }
    })
    node.children?.forEach((child: VUENode) => {
      node = <compiler.ASTElement>node
      if (node.for) {
        child.vfor_alias = node.alias
        child.vfor_iterator = node.iterator1
      }
      traverseChildren(child)
    })
  }
  traverseChildren(template_ast)
  console.debug(ifBlocks)
  ifBlocks.forEach(([blcok, exceptions]) => {
    traverseChildren(blcok, exceptions)
  })
  console.debug(functions)
  console.debug(variables)

  class Reference {
    start: number
    end: number
    #referenced = 0
    constructor(start: number, end: number) {
      this.start = start
      this.end = end
    }
    get referenced() {
      return this.#referenced
    }
    increseRef() {
      this.#referenced++
      // this.referenced = this.#referenced
    }
    decreseRef() {
      if (this.#referenced === 0)
        { console.error('reference amount can not be negative') }
      else
        { this.#referenced-- }
      // this.referenced = this.#referenced
    }
    toString() {
      return 'referenced: ' + this.#referenced
    }
  }

  interface Scope {
    start: number,
    end: number
  }
  let removes: Array<Scope> = []
  const origin = script
  const ast = parser.parse(script, {
    sourceType: 'module',
  })
  console.debug('body', ast.program.body)
  traverse(ast, {
    ImportDeclaration(path) {
      // console.debug(script.substring(path.node.start, path.node.end))
      let specifiers = path.node.specifiers.map((specifier) => {
        const referenced = path.scope.getBinding(specifier.local.name)?.referenced
        // console.debug(specifier, script.substring(specifier.start, specifier.end))
        return {
          referenced,
          start: specifier.start,
          end: specifier.end!,
        }
      })
      let unused = specifiers.filter((specifier) => {
        return !specifier.referenced
      })
      if (unused.length === specifiers.length) {
        removes.push(path.node as Scope)
      } else {
        for (let i = 0; i < specifiers.length; i++) {
          if (!specifiers[i].referenced) {
            if (i == 0) {
              removes.push(specifiers[i] as Scope)
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
      console.debug(path.node)
      const options = (path.node.declaration as any).properties
      const findNode = (name: string) => {
        const data = options?.filter((node: any) => {
          return node.key.name == name
        })
        let node
        if (data?.at(0).body) { node = data[0].body?.body }
        else { node = data[0] }
        console.debug(name, node)
        return node
      }
      const datas: Record<string, Reference> = {}
      findNode('data')
        ?.at(0)
        ?.argument.properties?.forEach((node: any, i: number, arr: any[]) => {
          datas[node.key.name] = new Reference(node.start, node.start)
          if (i != arr.length - 1) {
            datas[node.key.name].end = arr[i + 1].start
          } else {
            let str = script!.substr(node.end).match(/\s*,/)?.[0]
            datas[node.key.name].end = node.end + str?.length
          }
          // console.debug(node.key.name, script.substring(datas[node.key.name].start, datas[node.key.name].end))
        })
      let methods: Record<string, Reference> = {}
      findNode('methods')?.value.properties?.forEach((node: any, i: number, arr: any[]) => {
        methods[node.key.name] = new Reference(node.start, node.end)
        if (i != arr.length - 1) {
          methods[node.key.name].end = arr[i + 1].start
        } else {
          if (i >= 1)
            {methods[node.key.name].start = arr[i - 1].end}
          let str = script!.substr(node.end).match(/\s*,/)?.[0] || ''
          methods[node.key.name].end = node.end + str.length
        }
        // console.debug(node.key.name, script.substring(methods[node.key.name].start, methods[node.key.name].end))
      })

      const parseRef = (node: babel.Expression) => {
        const code = script!.substring(node.start!, node.end!)
        const ast = parser.parse(code, {
          sourceType: 'script',
        })
        // console.debug(code)
        // console.debug(ast)
        traverse(ast, {
          MemberExpression(path) {
            // console.debug('MemberExpression', script.substring(path.node.start, path.node.end))
            let node = path.node
            if (node.object.type == 'ThisExpression') {
              datas[(node.property as any).name]?.increseRef()
              // console.debug(node.property.name, datas[node.property.name]?.referenced)
            }
          },
          CallExpression(path) {
            // console.debug('CallExpression', script.substring(path.node.start, path.node.end))
            let callee = path.node.callee
            if (callee.type == 'MemberExpression' && callee.object.type == 'ThisExpression') {
              methods[(callee.property as any).name]?.increseRef()
              // console.debug(callee.property.name, methods[callee.property.name]?.referenced)
            }
          },
        })
      }
      traverse(ast, {
        IfStatement(path) {
          // console.debug('IfStatement', script.substring(path.node.test.start, path.node.test.end))
          parseRef(path.node.test)
        },
        AssignmentExpression(path) {
          // console.debug('AssignmentExpression', path.node, script.substring(path.node.right.start, path.node.right.end))
          parseRef(path.node.right)
        },
        CallExpression(path) {
          // console.debug('CallExpression', script.substring(path.node.start, path.node.end))
          let callee = path.node.callee
          if (callee.type == 'MemberExpression' && callee.object.type == 'ThisExpression') {
            methods[(callee.property as any).name]?.increseRef()
            // console.debug(callee.property.name, methods[callee.property.name]?.referenced)
          }
        },
      })

      console.debug(script)
      console.debug(functions)
      console.debug(variables)
      console.debug(datas)
      console.debug(methods)
      for (const [key, val] of Object.entries(methods)) {
        // console.debug(key, val.referenced, functions.includes(key), script.substring(val.start, val.end))
        if (!val.referenced && !functions.has(key)) {
          removes.push(val)
          console.debug(key, script!.substring(val.start, val.end))
        }
      }
      for (const [key, val] of Object.entries(datas)) {
        if (!val.referenced && !variables.has(key)) {
          removes.push(val)
          console.debug(key, script!.substring(val.start, val.end))
        }
      }
    },
  })

  removes = removes.map(item => {
    item.start += script_offset!
    item.end += script_offset!
    return item
  })
  return removes
}

module.exports = { parseUnusedScript }