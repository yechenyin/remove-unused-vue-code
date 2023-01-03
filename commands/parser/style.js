const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const compiler = require('vue-template-compiler')
const { getConfiguration, clone } = require('../utils/index')

function parseUnusedStyle(code) {
  const template = code.match(/<template>[\s\S]*?<\/template>\s*/)?.[0]
  const matched = code.match(/<style[\s\S]*?>([\s\S]+)<\/style>\s*/d)
  let style_offset = matched?.indices[1][0]
  let style = matched?.[1]
  if (!style || !template)
    return
  const template_ast = compiler.compile(template, { outputSourceRange: true }).ast
  console.log(template)
  console.log(template_ast)

  const stack = []
  const scopes = []
  stack.push({
    children: []
  })
  let start = 0
  Array.from(style)?.forEach((char, index) => {
    if (char == ';') {
      start = index + 1
    }
    else if (char == '{') {
      let selector = style.substring(start, index).trim()
      selector = selector.replace(/::v-deep[\s\S]*$/, ' ').replace(/\/deep\/[\s\S]*$/, ' ')
      //分隔字符串，前面的(?<=[\w-\]])[\.\[]匹配非开头或者跟在,后面的.或者[
      //后面的[^\[,"'=](\s+)(?![,="'\]])匹配非属性选择器里的空白字符及,前后的空白字符
      let seperator = /(?<=[\w-\]])[\.\[]|\s*([>+~])\s*|[^\[,"'=](\s+)(?![,="'\]])/g
      let begin = 0
      console.debug(selector)
      let match, selectors = []
      //将选择器字符串分解成独立的选择器便于后面解析,并决定每个独立选择器的开始位置
      while (match = seperator.exec(selector)) {
        console.log(match[0], match[1], selector.substring(begin, match.index))
        if (match[0] == '.' || match[0] == '[' ) {
          selectors.push(selector.substring(begin, match.index))
          begin = match.index
        } else {
          //截取分隔字符串之前的字符串入栈
          selectors.push(selector.substring(begin, match.index))
          console.log(match)
          if (/^\s+$/.test(match[0]))
            selectors.push(' ')
          else
            selectors.push(match[1])
          begin = match.index + match[0].length
        }
      }
      selectors.push(selector.substring(begin, selector.length))
      console.debug(selectors)
      stack.push({
        selector,
        selectors,
        children: [],
        matched: 0,
        start
      })
      console.debug(stack[stack.length - 1])
      start = index + 1
      console.log(style.substr(start))
    }
    else if (char == '}') {
      let selectors = []
      // 不同层级选择器之间添加后代选择器
      for (let i = 1; i < stack.length; i++) {
        selectors = selectors.concat(stack[i].selectors)
        selectors.push(' ')
      }
      selectors.pop()
      console.debug(selectors)
      let node = stack.pop()
      node.end = index + 1
      node.selectors = selectors
      scopes.push(node)
      console.log(style.substr(node.start, node.end))
      stack[stack.length - 1].children.push(node)
      console.debug(stack[stack.length - 1])
      start = index + 1
    }
  })
  // console.clear()
  console.debug(scopes)

  scopes.forEach((scope, index) => {
    let selectors_arr = [[]]
    scope.selectors?.forEach((selector, selectors_index) => {
      //如果是组合选择器，则分裂复制前面的选择器，然后依次填入分割后各个选择器
      if (selector?.includes(',')) {
        let selectors = selector.split(',')
        let prev = selectors_arr
        selectors_arr = []
        for (const i in selectors) {
          selectors_arr = selectors_arr.concat(clone(prev))
        }
        for (let i = 0; i < selectors.length; i++) {
          for (let j = 0; j < prev.length; j++) {
            console.log(i*prev.length + j, selectors_arr[i*prev.length + j], selectors[i])
            selectors_arr[i*prev.length + j].push(selectors[i])
            console.log(selectors_arr)
          }
        }
        console.log(selectors_arr)

        let arr = []
        let begin = style.substring(scope.start, scope.end).match(/^\s*/)[0].length
        for (const i in selectors_arr) {
          let item = clone(scope)
          item.selectors = clone(selectors_arr[i])
          //记录组合选择器的完整开始和结束位置
          item.wholeStart = item.start
          item.wholeEnd = item.end
          item.start = item.start + begin
          let last_selector = item.selectors[item.selectors.length-1]
          //组合选择器分解后的除了最后的选择器的起始位置包含后面的逗号
          item.end = item.start + last_selector.length + 1
          console.log(style.substring(item.start, item.end), last_selector.length, item.start, begin)
          item.selectors[item.selectors.length-1] = last_selector.replace(/\s+/g, '')
          begin += last_selector.length + 1
          arr.push(item)
        }
        //组合选择器分解后的最后选择器的起始位置包含前一个逗号
        arr[arr.length-1].start--
        arr[arr.length-1].end--
        scopes.splice(index, 1, ...arr)
      }
    });
  })
  console.debug(scopes)
  scopes.forEach((item, i) => {
    console.log(style.substring(item.start, item.end))
  })

  //解析template节点及子孙节点，检测是否符合全部选择器
  function findMatchedNode(node, selectors) {
    function isNodeMatched(node, selector) {
      // console.log(selector, node.attrsMap)
      if (selector[0] == '#') {
        if (node?.attrsMap?.id == selector.substr(1))
          return true
      } else if (selector[0] == '.') {
        let classes = node?.attrsMap?.class?.split(/\s+/)
        if (classes?.includes(selector.substr(1)))
          return true
        //支持动态class变量
        let code = node?.attrsMap?.[':class']
        if (code) {
          const ast = parser.parse(code, { sourceType: "script" });
          console.log(selector, code, ast)
          let found = false
          traverse(ast, {
            //对象写法
            LabeledStatement(path) {
              let label = path.node.label.name
              console.log('LabeledStatement', label);
              if (label == selector.substr(1)) {
                found = true
              }
            },
            ArrayExpression(path) {
              let elements = path.node.elements
              console.log('ArrayExpression', elements);
              elements?.forEach(item => {
                if (item.name == selector.substr(1) || item.value == selector.substr(1)) {
                  found = true
                }
              })
            },
            ConditionalExpression(path) {
              let node = path.node
              console.log('ConditionalExpression', node);
              if (node.alternate.value == selector.substr(1) || node.consequent.value == selector.substr(1)) {
                found = true
              }
            },
          });
          return found
        }
      } else if (selector[0] == '[') {
        let match
        if (match = selector.match(/\[\s*([\w-]+)\s*=\s*['"]([^'"]*)['"]\s*]/)) {
          let [, attr, val] = match
          console.log(attr, val, node.attrsMap)
          if (attr && node?.attrsMap?.[attr] === val)
            return true
        } else if (match = selector.match(/\[\s*(\S+)\s*]/)) {
          let [, attr] = match
          if (attr && node.attrsMap && attr in node.attrsMap)
            return true
        }
      } else {
        if (node?.tag === selector)
          return true
      }
      return false
    }
    let found = false
    function searchMatchedNode(node, selectors, matched = 0) {
      //忽略伪元素选择器
      let selector = selectors[matched]?.replace(/:[\s\S]*/, '')
      let ignore = getConfiguration('remove-unused-vue-code.ignoreStylePrefix').replace(' ', ' ').split(' ')
      for (const item of ignore) {
        if (selector?.indexOf(item) >= 0) {
          //如果某个选择器里包含忽略字符串，则删除此选择器及之后的选择器不做检查
          selectors.splice(matched)
          if (matched == 0) {
            found = true
          }
        }
      }
      if (selectors.length > 0 && matched == selectors.length) {
        found = true
      }
      if (found || !selector || !node || !selectors.length)
        return
      // console.debug(matched, selector, node.attrsMap)
      if (selectors[matched + 1]?.[0] == '~' || selectors[matched + 1]?.[0] == '+') {
        let foundMatched = false
        if (node.children) {
          for (const node of node.children) {
            if (!foundMatched) {
              foundMatched = isNodeMatched(node, selector, 0)
              console.log(node.attrsMap, selector, foundMatched)
            } else {
              console.log('sibling is found', node)
              //如果下一个选择器是+,且非空白文本节点，只继续搜索下一个兄弟节点
              if (selectors[matched + 1][0] == '+' && !(node.type == 3 && /^\s+$/.test(node.text)))
                break
            }
          }
          if (!foundMatched)
            node.children?.forEach(node => {
              searchMatchedNode(node, selectors, matched)
            });
        }
      } else if (selector[0] == '*') {
        node.children?.forEach(node => {
          searchMatchedNode(node, selectors, matched + 1)
        });
      } else if (selector[0] == ' ') {
        node.children?.forEach(node => {
          searchMatchedNode(node, selectors, matched + 1)
        });
      } else {
        if (isNodeMatched(node, selector)) {
          console.log('isNodeMatched')
          if (selectors[matched + 1]?.[0] == '>') {
            node.children?.forEach(node => {
              if (isNodeMatched(node, selectors[matched + 2], 0)) {
                console.log('isNodeMatched', selectors[matched + 2])
                searchMatchedNode(node, selectors, matched + 3)
              }
            });
          } else
            searchMatchedNode(node, selectors, matched + 1)
        } else {
            node.children?.forEach(node => {
              searchMatchedNode(node, selectors, matched)
            });
        }
      }
    }
    searchMatchedNode(node, selectors)
    return found
  }

  let removes = [], whole_scopes = []
  scopes.forEach((scope, i) => {
    scope.referenced = findMatchedNode(template_ast, scope.selectors)
    if (!scope.referenced) {
      removes.push(scope)
      if (scope.wholeEnd)
        whole_scopes.push({start: scope.wholeStart, end: scope.wholeEnd})
    }
  })
  console.log(scopes)
  whole_scopes.forEach((item, i) => {
    let whole_no_use = true
    scopes.forEach((scope, i) => {
      if (scope.wholeEnd == item.end && scope.referenced)
        whole_no_use = false
    })
    if (whole_no_use)
    removes.push(item)
  })
  removes.forEach((item, i) => {
    console.log(style.substring(item.start, item.end))
  })

  removes = removes.map(item => {
      item.start += style_offset
      item.end += style_offset
      return item
    })
  return removes
}

module.exports = { parseUnusedStyle }