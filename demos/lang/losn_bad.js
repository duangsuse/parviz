/* losn.js — LOSN Lisp：新语法（语句位置 / 参数位置两种读法）+ 转译成 JS generator 并缓存。
   整份文件就是一句 (P) => ({ … })：浏览器 fetch 后 new Function 求值，node 里同样（tools/smoke-losn.js）。
     ① 语法：手写递归下降，产出与 lisp.js 同形状的标签式 AST（T/leaf）；CST 只用于上色 / 连线 / 报错跨度。
     ② 转译：def / lambda / .{ } 各编成一个 generator 模板；常量进格子 K，调用点进 Sites S；
        结构签名相同的模板复用缓存（改空白 / 注释 / 数字 / 颜色 / 字符串内容不重编）。
     ③ 运行时 R：调用分派（LOSN 函数 / 生成器内建 / 宿主 JS + 自动 await）、真值、show、ser/snap、写入事件。
   名字解析（编译期）：词法绑定 → 模块名 → 内建 →（u 作用域里）u.key → 宿主表；都没有就报“未定义”（带跨度）。 */
(P) => {
'use strict'
const { Node, T, leaf, isT, hash4 } = P

// 主体已删（700行手搓递归下降等等），留下一些较紧凑的代码片段，只供检查 edge cases


/* ======================= ① 语法 ======================= */
const HEXY = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/y
const NUMY = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y
const IDG = /[A-Za-z_$@][\w$@-]*/y
const IDF = /[A-Za-z_$@][\w$@]*/y
const NAME0 = /[A-Za-z_$@]/
const DIGIT = /[0-9]/
const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
const STR_RE = /"(?:\\.|[^"\\\n])*"/y
const unesc = s => s.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r?\n)|([\s\S]))/g,
  (_, a, b, c, nl, ch) => a || b || c ? String.fromCodePoint(parseInt(a || b || c, 16)) : nl ? '' : ESC[ch] ?? ch)

function sigOf(x) {
  const s = y => {
    if (!Array.isArray(y)) return typeof y === 'number' ? 'n' : typeof y === 'string' ? 's' : String(y)
    if (!isT(y)) return '[' + y.map(s).join(',') + ']'
    switch (y[0]) {
      case 'num': return 'n'
      case '': return /^#/.test(y[1]) ? 'c' : /^"/.test(y[1]) ? 'q' : /^\.\.?\//.test(y[1]) ? 'p' : 'q'
      case '$': return 'N' + y[1]
      case '.': return '.' + s(y[1]) + ':' + y[2][1]
      case '()': return '(' + (y.subj ? '@' : '') + y.slice(1).map(s).join(',') + ')'
      case '=>': return 'L(' + s(y[1]) + '=>' + y.slice(2).map(s).join(';') + ')'
      case '{}': return '{' + y.slice(1).map(pr => (typeof pr[0] === 'string' ? 'k' + pr[0] : s(pr[0].e)) + ':' + s(pr[1])).join(',') + '}'
      case 'tpl': return 'T(' + y.slice(1).map(v => typeof v === 'string' ? 'q' : s(v)).join(',') + ')'
      case 'op': return 'O' + y[1] + '(' + s(y[2]) + (y[3] ? ',' + s(y[3]) : '') + ')'
      case 'tweak': return 'W(' + y.slice(1).map(s).join(',') + ')'
      case 'spec': return 'S' + y[1]
      default: return y[0] + '(' + y.slice(1).map(s).join(',') + ')'
    }
  }
  return s(x)
}


Object.assign(B, {
  '+': (...a) => a.reduce((x, y) => x + y, 0),
  '-': (a, b) => b === undefined ? -a : a - b,
  '*': (...a) => a.reduce((x, y) => x * y, 1),
  '/': (a, b) => a / b, '%': (a, b) => a % b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
  '==': R.eq, '!=': (a, b) => !R.eq(a, b),
  neg: a => -a, abs: Math.abs, is: a => R.truthy(a), isnt: a => !R.truthy(a), both: (a, b) => R.truthy(a) ? b : a,
  len: a => a == null ? 0 : a.length != null ? a.length : a.size != null ? a.size : Object.keys(a).length,
  at: (a, i) => a?.at ? a.at(i) : a?.[i],
  get: (o, k) => o?.[k], keys: o => Object.keys(o), list: (...a) => a,
  str: (...a) => a.map(x => show(x, 0)).join(''),
  concat: (...a) => [].concat(...a), push: (a, ...x) => [...a, ...x],
  range: (a, b) => { if (b == null) { b = a; a = 0 } const r = []; for (let i = a; i < b; i++) r.push(i); return r },
  sum: a => a.reduce((x, y) => x + y, 0),
  OK: (...a) => { throw new Ret(a.length ? a[a.length - 1] : undefined) },
  wait: ms => new Promise(r => setTimeout(r, ms)),
  map: gen(function* (a, f) { const r = []; for (const x of a) r.push(yield* cg(f, [x])); return r }),
  each: gen(function* (a, f) { let i = 0; for (const x of a) yield* cg(f, [x, i++]); return a }),
  filter: gen(function* (a, f) { const r = []; for (const x of a) if (R.truthy(yield* cg(f, [x]))) r.push(x); return r }),
  mapNotNO: gen(function* (a, f) { const r = []; for (const x of a) { const y = yield* cg(f, [x]); if (y !== undefined) r.push(y) } return r }),
  reduce: gen(function* (a, f, z) { for (const x of a) z = yield* cg(f, [z, x]); return z }),
  As: gen(function* (v, f) { return yield* asGen(v, f) }),
})

if (this.mod.names.has(name)) return { code: 'M[' + q(name) + ']', kind: 'mod' }
if (name in B) return { code: 'R.B[' + q(name) + ']', kind: 'builtin' }
if (name === 'NO') return { code: 'void 0', kind: 'lit' }
if (name === 'true') return { code: 'true', kind: 'lit' }
if (name === 'false') return { code: 'false', kind: 'lit' }
if (name === 'null') return { code: 'null', kind: 'lit' }
if (name === 'xargs') return this.hasRest ? { code: this.restVar, kind: 'xargs' } : (this.err(node, 'xargs 需要参数表以 .. 结尾'), { code: 'void 0', kind: 'err' })
if (this.uActive && !/^[A-Z]/.test(name) && name !== 'imp') return { code: this.uVar + '[' + q(name) + ']', kind: 'mem' }
if (name === 'imp') return { code: 'R.g', kind: 'host' }
if (this.mod.host && this.mod.host.has(name)) return { code: 'R.get(' + q(name) + ')', kind: 'host' }

const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '%': 5 }
switch (x[0]) {
case 'num': return this.cell(x)
case '': return this.cell(x)
case '$': return x.imp ? 'R.g' : this.res(x[1], x.node).code
case '()': return this.call(x)
case '[]': return '[' + x.slice(1).map(y => this.ex(y)).join(', ') + ']'
case '{}': return this.obj(x)
case '?': return '(R.truthy(' + this.ex(x[1]) + ') ? (' + this.ex(x[2]) + ') : (' + this.ex(x[3]) + '))'
case 'is': return 'R.truthy(' + this.ex(x[1]) + ')'
case 'tpl': {
  let s = "''"
  for (const p of x.slice(1)) s += ' + ' + (typeof p === 'string' ? q(p) : 'R.show(' + this.ex(p) + ')')
  return s
}
case 'op': return this.op(x[1], x[2], x[3])
case '=>': return this.lambda(x)
case '.': {
  const b = x[1]
  if (isT(b) && b[0] === '$' && b[1] === 'imp') return 'R.get(' + q(x[2][1]) + ')'
  return 'R.getk(' + this.ex(b) + ', ' + q(x[2][1]) + ')'
}
case 'at': return '($s = ' + (x.site == null ? -1 : x.site) + ', yield* R.at(' + this.ex(x[1]) + ', ' + this.ex(x[2]) + ', ' + (x.site == null ? -1 : x.site) + '))'
case 'req': return '($s = -1, yield* R.req(' + q(x[1][1]) + '))'
case 'upd': this.err(x.node, '更新块 {->…} 只能作为语句'); return 'void 0'
case 'typeobj': return this.obj(x[1], true)
case 'tweak': return 'void 0'
case 'bare': return 'void 0'
}
this.err(x.node, '未知表达式 ' + x[0])

const RULES = `# LOSN 由 losn.js 里的手写解析器解析；这份文法只用于 @walk 注册与高亮兜底
@skip /(?:[ \\t]+|#[^\\n]*)+/
@walk losn
Losn (Line ?)
Line /[^\\n]*/`
const examples = []
LOSN.RULES = RULES
const api = LOSN
if (G) G.LOSN = api
return { rules: RULES, funcs: {}, walkers: { losn: LOSN }, examples, parse, compile: LOSN.compile, R, LOSN: api, pool: { cellsOf, sitesOf } }
}
