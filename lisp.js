/* lisp.js — 第二/三部分：Lisp 语法的后处理函数（AST + 词法作用域）与生成器求值器（可逐步执行）。
   语法本身用元语言写在 RULES 里；这里只注册 :lit :sym :list :brk :kv :chain :if :prog。 */
(function (G) {
'use strict'
const P = G.P || require('./parse.js')
const { FAIL, bind } = P

/* ---------- 求值用的值 ---------- */
const NO = Object.freeze({ toString: () => 'NO' })
class Ret { constructor(v) { this.v = v } }          // OK 流控返回
class LispErr extends Error { constructor(m, x) { super(m); this.x = x } }
const truthy = v => v !== NO && v !== false && v != null
const show = (v, d = 0) => v === NO ? 'NO' : typeof v == 'string' ? (d ? JSON.stringify(v) : v)
  : Array.isArray(v) ? '[' + v.map(x => show(x, 1)).join(' ') + ']'
  : v && v.t == 'fn' ? `<fn ${v.name || 'λ'}/${v.params.length}>` : typeof v == 'function' ? `<builtin ${v.bname || ''}>`
  : v && typeof v == 'object' ? '{' + Object.entries(v).map(([k, x]) => k + ' ' + show(x, 1)).join(' ') + '}' : String(v)

/* ---------- 内建 ---------- */
const gen = f => (f.gen = 1, f)
const eq = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)
const B = {
  '+': (...a) => a.reduce((x, y) => x + y), '-': (a, ...b) => b.length ? b.reduce((x, y) => x - y, a) : -a,
  '*': (...a) => a.reduce((x, y) => x * y, 1), '/': (a, b) => a / b, '%': (a, b) => a % b,
  '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b,
  '==': eq, '!=': (a, b) => !eq(a, b), not: a => !truthy(a),
  at: (a, i) => { const r = a?.at?.(i); return r === undefined ? NO : r },
  get: (o, k) => o?.[k] ?? NO, len: a => a.length, keys: o => Object.keys(o), list: (...a) => a,
  str: (...a) => a.map(x => show(x)).join(''), concat: (...a) => [].concat(...a), push: (a, ...x) => [...a, ...x],
  range: (a, b) => { if (b == null) [a, b] = [0, a]; const r = []; for (let i = a; i < b; i++) r.push(i); return r },
  sum: a => a.reduce((x, y) => x + y, 0),
  print: null,  // 运行时注入
  map: gen(function* (a, f) { const r = []; for (const x of a) r.push(yield* call(f, [x])); return r }),
  filter: gen(function* (a, f) { const r = []; for (const x of a) if (truthy(yield* call(f, [x]))) r.push(x); return r }),
  mapNotNO: gen(function* (a, f) { const r = []; for (const x of a) { const y = yield* call(f, [x]); if (y !== NO) r.push(y) } return r }),
  reduce: gen(function* (a, f, z) { for (const x of a) z = yield* call(f, [z, x]); return z }),
}
for (const k in B) if (B[k]) B[k].bname = k
const SPECIAL = new Set(['=>', '=', 'OK', 'NO'])

/* ---------- 语法后处理：AST + 作用域 ----------
   作用域在组合层自底向上完成：Sym 产生 free 引用，(=> (参数) 体) 用参数与体内 [= x ..] 绑定，
   [= 名 值] 产生 def（值是 lambda 则为函数，绿色），:prog 做全局绑定，剩余的查内建，否则报未定义。 */
const form = (ast, n) => {
  const [h, ...r] = ast.items
  if (h?.t != 'sym') return ast
  if (h.name == '=>') {
    const ps = r[0] && (r[0].t == 'list' || r[0].t == 'brk') ? r[0].items.filter(p => p.t == 'sym') : []
    const defs = ps.map(p => (p.node.c = 'P', { name: p.name, node: p.node, kind: 'param' }))
    bind(n, [...defs, ...(n.defs || [])]); n.defs = null; ast.lam = true
  } else if (h.name == '=' && r[0]?.t == 'sym') {
    const isFn = !!r[1]?.lam; if (isFn) r[0].node.c = 'G'
    ;(n.defs ||= []).push({ name: r[0].name, node: r[0].node, kind: isFn ? 'fn' : 'var' })
  }
  return ast
}
const funcs = {
  lit: (v, n) => ({ t: 'lit', v, node: n }),
  sym: (v, n) => { if (v == 'Or') return FAIL; n.free = [{ name: v, node: n }]; return { t: 'sym', name: v, node: n } },
  list: (v, n) => form({ t: 'list', items: v || [], node: n }, n),
  brk: (v, n) => form({ t: 'brk', items: v || [], node: n }, n),
  kv: (v, n) => {
    const items = v || [], keys = new Set(items.filter((x, i) => i % 2 == 0 && x.t == 'sym').map(x => x.node))
    if (n.free) n.free = n.free.filter(r => !keys.has(r.node))
    return { t: 'obj', items, node: n }
  },
  chain: (v, n) => v[1].length ? { t: 'chain', base: v[0], calls: v[1], node: n } : v[0],
  if: (v, n) => v[1] === undefined ? v[0] : { t: 'if', c: v[0], a: v[1][0], b: v[1][1], node: n },
  prog: (v, n, ss) => {
    bind(n, n.defs)
    for (const r of n.free || []) {
      if (SPECIAL.has(r.name)) continue
      if (r.name in B) { r.node.c = 'G'; continue }
      r.node.err = `未定义 ${r.name}`
    }
    return { t: 'prog', items: v, node: n }
  },
}
Object.assign(P.funcs, funcs)

/* ---------- 生成器求值器：每个节点 yield 进/出，UI 据此逐步执行 ---------- */
class Env {
  constructor(p) { this.m = new Map; this.p = p }
  find(k) { for (let e = this; e; e = e.p) if (e.m.has(k)) return e }
}
const isForm = x => x && (x.t == 'list' || x.t == 'brk')
function* ev(x, env, stmt = false) {
  yield { x, env, ph: 'in' }
  const v = yield* ev0(x, env, stmt)
  yield { x, env, ph: 'out', v }
  return v
}
function* ev0(x, env, stmt) {
  switch (x.t) {
    case 'lit': return x.v
    case 'sym': { const e = env.find(x.name); if (e) return e.m.get(x.name); if (x.name == 'NO') return NO; if (B[x.name]) return B[x.name]; throw new LispErr(`未定义 ${x.name}`, x) }
    case 'if': return truthy(yield* ev(x.c, env)) ? yield* ev(x.a, env) : yield* ev(x.b, env)
    case 'obj': { const o = {}; for (let i = 0; i < x.items.length; i += 2) { const k = x.items[i]; o[k.t == 'sym' ? k.name : yield* ev(k, env)] = i + 1 < x.items.length ? yield* ev(x.items[i + 1], env) : NO } return o }
    case 'brk': if (!stmt) { const r = []; for (const y of x.items) r.push(yield* ev(y, env)); return r }
    // fallthrough：语句位置的 [..] 是调用形式
    case 'list': return yield* form0(x.items, env, null, x)
    case 'chain': {
      let v = yield* ev(x.base, env, stmt)
      for (const c of x.calls) { if (!isForm(c)) throw new LispErr('. 之后应为 (..) 或 [..]', c); v = yield* form0(c.items, env, [v], c) }
      return v
    }
    case 'prog': return yield* body(x.items, env, x)
  }
  throw new LispErr('无法求值 ' + x.t, x)
}
// (head args..)；pre 是链式调用 a.(f b) 中预先求值的 a，插入为第一个实参
function* form0(items, env, pre, x) {
  if (!items.length) return pre ? pre[0] : NO
  const [h, ...r] = items
  if (h.t == 'sym' && !env.find(h.name)) {
    if (h.name == '=>') {
      const ps = isForm(r[0]) ? r[0].items.map(p => p.name) : []
      return { t: 'fn', params: ps, body: r.slice(1), env, node: x, name: '' }
    }
    if (h.name == '=') {
      if (r[0]?.t != 'sym') throw new LispErr('= 需要名字', x)
      const v = pre ? pre[0] : yield* ev(r[1], env)
      if (v?.t == 'fn' && !v.name) v.name = r[0].name
      env.m.set(r[0].name, v); return v
    }
    if (h.name == 'OK') {
      let v = pre ? pre[0] : NO
      for (const y of r) v = yield* ev(y, env)
      throw new Ret(v)
    }
  }
  const f = yield* ev(h, env), args = pre ? [...pre] : []
  for (const y of r) args.push(yield* ev(y, env))
  return yield* call(f, args, x)
}
function* call(f, args, x) {
  if (f && f.t == 'fn') {
    const e = new Env(f.env); f.params.forEach((p, i) => e.m.set(p, i < args.length ? args[i] : NO))
    return yield* body(f.body, e, f.node)
  }
  if (typeof f == 'function') return f.gen ? yield* f(...args) : f(...args)
  throw new LispErr(`${show(f, 1)} 不可调用`, x)
}
// 多语句时必须用 OK 返回；单语句直接取值
function* body(items, env, x) {
  try {
    if (items.length == 1) return yield* ev(items[0], env, true)
    for (const y of items) yield* ev(y, env, true)
  } catch (e) { if (e instanceof Ret) return e.v; throw e }
  if (items.length) warn(`多语句缺少 OK 返回`, x)
  return NO
}
let LOG = null
const warn = (m, x) => LOG && LOG.push({ warn: m, x })
const globals = log => { const e = new Env(null); e.m.set('print', Object.assign((...a) => { log.push({ out: a.map(x => show(x)).join(' ') }); return a.at(-1) ?? NO }, { bname: 'print' })); return e }
// 逐步执行：返回迭代器，每步 {x, ph, v}；结束时 done.value = {value|err, log}
function* steps(prog) {
  const log = []; LOG = log
  try { const value = yield* ev(prog, globals(log)); return { value, log } }
  catch (e) { if (e instanceof Ret) return { value: e.v, log }; if (e instanceof LispErr || e instanceof RangeError || e instanceof TypeError) return { err: e.message, x: e.x, log }; throw e }
  finally { LOG = null }
}
const run = (prog, max = 300000) => {
  const it = steps(prog); let r, n = 0
  while (!(r = it.next()).done) if (++n > max) return { err: `超过 ${max} 步，已中止`, log: [] }
  return { ...r.value, steps: n }
}

const RULES = `# Lisp —— [= 名 值] 赋值/定义；(=> (参数) 体..) lambda；a.(f b) 即 (f a b)，a.[f b] 同理
# (条件)? A Or B 是 if 表达式；OK 是流控返回（多语句时必须）；表达式位置的 [] {} 是数组/KV
@skip /(?:[\\s,]|;[^\\n]*)+/
@color Num=B Str=Y
Lisp  (Exp *) :prog
Exp   ((Chain ("?" Recur "Or" Recur ?) :if) ~)
Chain Atom (Dot *) :chain
Dot   "." (List Brk <)
Atom  (Num Str List Brk Obj Sym <)
List  ("(" (Recur *) ")" :par :list)
Brk   ("[" (Recur *) "]" :par :brk)
Obj   ("{" (Recur *) "}" :par :kv)
Num   /-?\\d+(\\.\\d+)?/ :num :lit
Str   /"(\\\\.|[^"\\\\])*"/ :str :lit
Sym   /[^\\s()\\[\\]{}",;?.]+/ :sym`
P.examples.splice(4, 0, {
  name: 'Lisp', rules: RULES, input: `; 语句位置的 [..] 是调用；[e1].[e2] 即 (e1).(e2 ..) 即 [e2 [e1] ..]
[= big (=> (xs n) xs.(mapNotNO (=> (x) (> x n)? x Or NO)))]
[= fact (=> (n) (<= n 1)? 1 Or (* n (fact (- n 1))))]
[= inc1 (=> (a) [len a].[+ 1])]
[= user {name "parviz" langs ["js" "lisp"]}]
(print "fact 5 =" (fact 5) "big:" [3 14 15 9 26].(big 10) user.[get "name"] (inc1 [1 2 3]))
(OK [123].(mapNotNO (=>(x) (> x 10)? x Or NO )).[at 0] )`,
}, {
  name: 'Lisp（作用域/错误）', rules: null, same: 'Lisp', input: `[= k 10]
[= add (=> (a b) [= s (+ a b)] (OK s.[+ k]))]
[= twice (=> (f x) (f (f x)))]
(print (twice (=> (y) (add y 1)) 5) undefinedName)
(OK {sum (add 1 2) xs [1 2 (3 ] ok "fine"})`,
})

const L = { NO, Ret, LispErr, B, Env, ev, steps, run, show, truthy, RULES, funcs }
if (typeof module != 'undefined') module.exports = L
G.LISP = L
})(typeof globalThis != 'undefined' ? globalThis : window)
