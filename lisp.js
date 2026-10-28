/* lisp.js — Lisp：①语法（元语言写成，作用域全用 parse.js 的 Lexscope 工具包）②按 tag 分派的求值 walker。
   AST 是标签式多态调用：(fact 5) 即 ["()", ["$", "fact"], 5]；"$" 名字 "" 字符串字面 "=" "->" "=>" ".." "?" "{}" "." 都只是 tag。 */
(function (G) {
'use strict'
const P = G.P || require('./parse.js')
const { T, leaf, isT, parts, viewOf, FAIL } = P, tr = P.f   // tr`…`：报错文本走 parse.js 的国际化（这里 f 常作函数名，故换名）

/* ======================= ⓪ 四则运算（两种写法） =======================
   CALC：Exp 的 (Atom (- "+" "-"; "*" "/" -)) 是 parse.js 的 TDOP 算符表（; 分级，越往后越紧，左结合）；
         -> y e 是单参 lambda（Lexscope :arg2nth + :fn，y 只在 e 里可见），:global 报未定义；
         f a b 并列即调用（:apply 柯里化：((f a) b)），比算符结合得紧，所以 (-> x (-> n x*n+1)) 10 2 = 21；
         :infix 把 bin 节点转成 Lisp 的调用 [+ a b]，于是直接用 Lisp 的 walker 求值。
   CHAIN：朴素写法，不要作用域。PEG 不支持左递归 Sum ← Sum "+" Prod，改写成链 Sum ← Prod ("+" Prod)*，
         :chainl 在后处理里从左往右折叠，直接算出数值。 */
const CALC = `# 四则运算：(Atom (- "+" "-"; "*" "/" -)) 是 TDOP 风格的算符表，";" 分级，越往后结合越紧，全部左结合
# -> y e 是单参 lambda：:arg2nth 让 y 成为第 0 个参数，:fn 在此闭合作用域；e 里没定义的名字报“未定义”
# f a b 并列即调用（柯里化 ((f a) b)），比任何算符都紧：(-> x (-> n x*n+1)) 10 2
@color Num=B
@walk calc
Calc   (Exp ";" +) :global :tag("..")
Exp    (App (- "+" "-"; "*" "/" -)) :infix
App    Atom (Atom *) :apply
Atom   (Num ("(" Exp ")" :par) Lam Name <)
Lam    "->" Param Exp :fn
Param  /[A-Za-z_]\\w*/ :arg2nth
Num    /\\d+(\\.\\d+)?/ :num
Name   /[A-Za-z_]\\w*/ :ref`
const CHAIN = `# 朴素四则运算：左递归 Sum ← Sum "+" Prod 在 PEG 里会无限递归，于是写成链（chainl）：
# Sum ← Prod (("+"|"-") Prod)*，:chainl 从左往右折叠，解析完直接得到数值；没有作用域，也不需要 walker
@color Num=B Add=P Mul=P
Sum    Prod ((Add Prod) *) :chainl
Prod   Atom ((Mul Atom) *) :chainl
Atom   (Num ("(" Sum ")" :par) <)
Add    /[+-]/
Mul    /[*\\/]/
Num    /\\d+(\\.\\d+)?/ :num`
// bin 节点 [左 算符 右] → ["()", ["$", 算符], 左, 右]；算符查 walker 的内建，不产生作用域引用
// 减法编译为加负数：a - b → (+ a (neg b))
const ref = (name, nd) => leaf('$$', name, nd)   // 内建算符：全局键
const infix = n => {
  if (n.k != 'bin') return n.v
  const [l, o, r] = n.kids, lv = infix(l), rv = infix(r)
  if (o.text != '-') return T('()', [ref(o.text, o), lv, rv], n, [o, l, r])
  return T('()', [ref('+', o), lv, T('()', [ref('neg', o), rv], n, [o, r], false)], n, [o, l, r])
}
const ARITH = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b }

/* ======================= ① 语法 =======================
   Lisp 特有的语法糖：a.(f b) / a.k 链、(c)? A Or B、语句级 (a) b 即 ((a) b)、(> 2x + 3y) 内联中缀。其余（lambda、定义、def 写法）都在规则里用工具包组合。 */
const funcs = {
  infix: (v, n) => infix(n),
  // [函数, [实参...]] → ["()", ["()", 函数, 实参1], 实参2]…（单参 lambda 的柯里化调用）；树里显示为 [() [() f a] b]
  apply: (v, n) => {
    const [f, xs] = v; if (!xs.length) return f
    const pn = parts(n), an = parts(pn[1]); let acc = f, fn = pn[0]
    xs.forEach((x, k) => { acc = T('()', [acc, x], n, [fn, an[k]], false); fn = null })   // 中间层也挂 n：viewOf 才会递归展开成 [() [() f a] b]
    n.view = viewOf(acc); return acc
  },
  // [首项, [[算符, 项]...]] → 左折叠：((首项 o1 项1) o2 项2)…
  chainl: ([x, rest]) => rest.reduce((a, [o, b]) => ARITH[o](a, b), x),
  // [基, [调用...]] → [".", [".", 基, 调用1], 调用2]…；树里显示为脱糖后的 [f 基 ..]
  chain: (v, n) => {
    const [b, cs] = v; if (!cs.length) return b
    const pn = parts(n); let acc = b, an = pn[0]
    cs.forEach((c, k) => { acc = T('.', [acc, c], k == cs.length - 1 ? n : c.node, [an, c.node], false); an = null })
    n.view = viewOf(acc); return acc
  },
  // [条件, [A, B]?] → ["?", 条件, A, B]
  if: (v, n) => { if (v[1] === undefined) return v[0]; const pn = parts(n); return T('?', [v[0], ...v[1]], n, [pn[0], ...parts(pn[1])]) },
  // 字符串字面量 → ["", 文本]；Dkey 是 o.k 的裸键（bare），语句级 o.k args 时改成名字
  strlit: (v, n) => leaf('', v, n),
  dkey: (v, n) => Object.assign(leaf('', v, n), { bare: true }),
  // 2x → (* 2 x)
  lmono: ([k, name], n) => { const pn = parts(n); return T('()', [ref('*', pn[0]), k, name], n, [pn[0], pn[0], pn[1]]) },
  // 语句级“自动插括号”：同一行里 Exp 之后并列的 Exp 是实参。a b → (a b)；(a) b → ((a) b)；c.d e f → c.(d e f)（头是 o.k 取键时，k 当作被调用的名字）；换行结束语句（类似 JS 的自动分号）
  lstmt: ([a, rest], n) => {
    if (!rest.length) return a
    const pn = parts(n), rn = parts(pn[1]), c = isT(a) && a[0] == '.' && a[2]
    if (isT(c) && c.bare) {
      const nm = leaf('$', c[1], c.node)
      n.free = [...(n.free || []), { name: c[1], node: c.node, x: nm }]
      const dot = T('.', [a[1], T('()', [nm, ...rest], n, [c.node, ...rn], false)], n, [a.ns[0], n], false)
      n.view = viewOf(dot); return dot
    }
    return T('()', [a, ...rest], n, [pn[0], ...rn])
  },
  // 同一行并列才算实参：换行、或之间隔着 ; 都结束语句
  lsame: (v, n, ss) => { let j = n.a; while (j > 0 && ' \t,'.includes(ss.src[j - 1])) j--; const c = ss.src[j - 1]; return c == '\n' || c == ';' ? FAIL : v },
  // ":" 语句... "..." → 语句数组（带每条语句的 CST 节点 ns），defn 把它展开成 lambda 体
  lblock: (v, n) => { const a = v === undefined ? [] : Array.isArray(v) && !isT(v) ? v : [v]; a.ns = parts(parts(n)[0]); return a },
  // (f a b)；当 f 是运算符名（+ * / % > < >= <= == !=）时实参里的 + - * / % 是中缀：(> 2x + 3y) → (> (+ (* 2 x) (* 3 y)))
  lcall: (v, n) => {
    const a = Array.isArray(v) && !isT(v) ? T('()', v, n, parts(n)) : T('()', v === undefined ? [] : [v], n, [n]), h = a[1]
    if (!(isT(h) && h[0] == '$' && OPHEAD.has(h[1]))) return a
    const isOp = (x, i) => i >= 3 && i < a.length - 1 && isT(x) && x[0] == '$' && Object.hasOwn(PREC, x[1])
    if (!a.some(isOp)) return a
    const bin = (o, l, r) => {
      const minus = o.t[1] == '-'
      const rv = minus ? T('()', [ref('neg', o.nd), r.v], n, [o.nd, r.nd], false) : r.v
      return { v: T('()', [minus ? ref('+', o.nd) : o.t, l.v, rv], n, [o.nd, l.nd, r.nd], false), nd: n }
    }
    const out = [h], ons = [a.ns[0]]
    for (let i = 2; i < a.length; i++) {
      const vals = [{ v: a[i], nd: a.ns[i - 1] }], os = []
      const red = () => { const r = vals.pop(), l = vals.pop(); vals.push(bin(os.pop(), l, r)) }
      while (i + 2 < a.length && isOp(a[i + 1], i + 1)) {
        const o = { t: a[i + 1], nd: a.ns[i] }; n.free &&= n.free.filter(r => r.node !== o.t.node)   // 中缀运算符不是名字引用
        while (os.length && PREC[os.at(-1).t[1]] >= PREC[o.t[1]]) red()
        os.push(o); vals.push({ v: a[i + 2], nd: a.ns[i + 1] }); i += 2
      }
      while (os.length) red()
      out.push(vals[0].v); ons.push(vals[0].nd)
    }
    return T('()', out, n, ons)
  },
}
Object.assign(P.funcs, funcs)

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 }
const OPHEAD = new Set(['+', '*', '/', '%', '>', '<', '>=', '<=', '==', '!='])
const SYM = '[^\\s()\\[\\]{}",;?.]'
const STR = '"(\\\\.|[^"\\\\])*"'
const RULES = `# Lisp —— 作用域由 Lexscope 工具包组合：:arg2nth 参数表、:fn 闭合 lambda、:let 定义、:set 赋值、:defn 两者合一、:ref 引用、:global 顶层
# (=> (a b) e)、[- f (=> (a b) e)]、def f(a b) e 产生完全相同的 AST（"=" 定义，不可被 -> 改变）；[-> x e] 是局部赋值（无则初始化）
# (条件)? A Or B 是 if；OK 是普通内建（流控返回）；表达式位置的 [] {} 是数组/KV，语句位置的 [] 是调用
# 同一行里语句级的 (a) b 是 ((a) b)，换行或 ; 结束语句；a.k 取对象的键，(> 2x + 3y) 的运算符之间是中缀
# 注释：# 到行尾，#@ … @# 可跨行；; 是语句分隔符（在表达式里与空白等价）
@skip /(?:[\\s,;]|#@[\\s\\S]*?@#|#[^\\n]*)+/
@color Num=B Coef=B Str=Y Qs=Y
@walk lisp
Lisp   (Stmt *) :global :tag("..")
Stmt   Exp (Same *) :lstmt
Same   Exp :lsame
Exp    ((Chain ("?" Recur "Or" Recur ?) :if) :setRecur)
Chain  Atom (Dot *) :chain
Dot    "." (List Brk Str Dkey <)
Atom   (Mono Num Str Lam Let Set Defn List Brk Obj Name <)
Lam    ((/\\((?=\\s*=>)/ "=>" Params (Recur *) ")" :par) (/\\[(?=\\s*=>)/ "=>" Params (Recur *) "]" :par) <) :fn
Let    ((/\\((?=\\s*-\\s+${SYM}+\\s)/ "-" Var Recur ")" :par) (/\\[(?=\\s*-\\s+${SYM}+\\s)/ "-" Var Recur "]" :par) <) :let
Set    ((/\\((?=\\s*->\\s+${SYM}+\\s)/ "->" Var Recur ")" :par) (/\\[(?=\\s*->\\s+${SYM}+\\s)/ "->" Var Recur "]" :par) <) :set
Defn   "def" Var Params (Block Recur <) :defn
Block  ":" (Stmt *) "..." :lblock
Params (("(" (Pname *) ")" :par) ("[" (Pname *) "]" :par) <) :arg2nth
List   ("(" (Recur *) ")" :par :lcall)
Brk    ("[" (Recur *) "]" :par :tag("[]"))
Obj    ("{" (Pair *) "}" :par :tag("{}"))
Pair   (Qs Key <) Recur
Key    /${SYM}+/
Dkey   /${SYM}+/ :dkey
Num    /-?\\d+(\\.\\d+)?/ :num
Mono   Coef Name :lmono
Coef   /-?\\d+(\\.\\d+)?(?=[^\\s()\\[\\]{}",;?.\\d])/ :num
Qs     /${STR}/ :str
Str    /${STR}/ :str :strlit
Var    /${SYM}+/
Pname  /${SYM}+/
Name   /(?!Or(?!${SYM}))${SYM}+/ :ref`

/* ======================= ② 求值 walker =======================
   独立于解析：只认标签式 AST。Walk 是 tag → 生成器的表，B 是内建函数表。
   事件：每个标签节点 in/out；调用返回 ret（带函数、实参、返回值）；判断 if（带条件值）。UI 的 F8 只停在 ret/if/标记处。 */
const NO = Object.freeze({ toString: () => 'NO' })
class Ret { constructor(v) { this.v = v } }          // OK 抛出的流控返回
class LispErr extends Error { constructor(m, x) { super(m); this.x = x } }
const truthy = v => v !== NO && v !== false && v != null
const fname = f => f?.t == 'fn' ? f.name || 'λ' : f?.bname || '?'
const show = (v, d = 0) => v === NO ? 'NO' : typeof v == 'string' ? (d ? JSON.stringify(v) : v)
  : Array.isArray(v) ? '[' + v.map(x => show(x, 1)).join(' ') + ']'
  : v && v.t == 'fn' ? `<fn ${fname(v)}/${v.params.length}>` : typeof v == 'function' ? `<builtin ${v.bname || ''}>`
  : v && typeof v == 'object' ? '{' + Object.entries(v).map(([k, x]) => k + ' ' + show(x, 1)).join(' ') + '}' : String(v)

class Env {
  constructor(p) { this.m = new Map; this.p = p }
  find(k) { for (let e = this; e; e = e.p) if (e.m.has(k)) return e }
}

// 内建：普通函数直接调用；gen 标记的是生成器（会回调 lambda，逐步执行能进到里面）
const gen = f => (f.gen = 1, f)
const eq = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)
const cmp = f => (...a) => a.length < 2 ? f(a[0], 0) : f(a[0], a[1])   // 单参比较与 0 比：(> 2x + 3y) 即 2x+3y > 0
const B = {
  '+': (...a) => a.reduce((x, y) => x + y), neg: a => -a,
  '*': (...a) => a.reduce((x, y) => x * y, 1), '/': (a, b) => a / b, '%': (a, b) => a % b,
  '>': cmp((a, b) => a > b), '<': cmp((a, b) => a < b), '>=': cmp((a, b) => a >= b), '<=': cmp((a, b) => a <= b),
  '==': eq, '!=': (a, b) => !eq(a, b), isnt: a => !truthy(a), both: (a, b) => truthy(a) ? b : a,
  '->': (o, k, v) => v === undefined ? { ...o, ...k } : { ...o, [k]: v },   // (-> any {…}) / any.[-> "k" v]：返回合并后的新对象（名字 + 对象字面量由 Walk['->'] 做部分赋值）
  at: (a, i) => { const r = a?.at?.(i); return r === undefined ? NO : r },
  get: (o, k) => o?.[k] ?? NO, len: a => a.length, keys: o => Object.keys(o), list: (...a) => a,
  str: (...a) => a.map(x => show(x)).join(''), concat: (...a) => [].concat(...a), push: (a, ...x) => [...a, ...x],
  range: (a, b) => { if (b == null) [a, b] = [0, a]; const r = []; for (let i = a; i < b; i++) r.push(i); return r },
  sum: a => a.reduce((x, y) => x + y, 0),
  OK: (...a) => { throw new Ret(a.length ? a.at(-1) : NO) },
  map: gen(function* (a, f) { const r = []; for (const x of a) r.push(yield* call(f, [x])); return r }),
  filter: gen(function* (a, f) { const r = []; for (const x of a) if (truthy(yield* call(f, [x]))) r.push(x); return r }),
  mapNotNO: gen(function* (a, f) { const r = []; for (const x of a) { const y = yield* call(f, [x]); if (y !== NO) r.push(y) } return r }),
  reduce: gen(function* (a, f, z) { for (const x of a) z = yield* call(f, [z, x]); return z }),
}
for (const k in B) B[k].bname = k
Object.setPrototypeOf(B, null)   // 名字如 constructor 不会命中 Object 原型

function* ev(x, env, stmt = false) {
  if (!isT(x)) return x                      // 数字等裸字面量
  const t = x[0]; let v
  yield { x, n: x.node, ph: 'in' }
  if (t === '$') v = lookup(x, env)          // 最常见的三种节点（名字、全局键、字符串字面）不经 Walk 表与生成器委托
  else if (t === '$$') v = glookup(x, env)
  else if (t === '') v = x[1]
  else { const f = Walk[t]; if (!f) throw new LispErr(tr`未知标签 ${t}`, x); v = yield* f(x, env, stmt) }
  yield { x, n: x.node, ph: 'out', v }
  return v
}
const lookup = (x, env) => {
  const k = x[1], e = env.find(k); if (e) return e.m.get(k)
  return glookup(x, env, 1)
}
// "$$" 全局键：解析期已确认不在任何作用域里，直接查内建；w@ 等运行期全局退回查环境
const glookup = (x, env, scoped) => {
  const k = x[1]
  if (k in B) return B[k]
  if (k == 'NO') return NO
  if (!scoped) { const e = env.find(k); if (e) return e.m.get(k) }
  throw new LispErr(tr`未定义 ${k}`, x)
}
const evAll = function* (xs, env) { const r = []; for (const y of xs) r.push(yield* ev(y, env)); return r }
const Walk = {
  // ["$", name]：名字解析；["", 文本]：字符串字面量
  *'$'(x, env) { return lookup(x, env) },
  *'$$'(x, env) { return glookup(x, env) },
  *''(x) { return x[1] },
  // ["()", f, ...args]：调用
  *'()'(x, env) { return yield* apply(x.slice(1), env, null, x) },
  // ["[]", ...]：语句位置是调用，表达式位置是数组
  *'[]'(x, env, stmt) { return stmt ? yield* apply(x.slice(1), env, null, x) : yield* evAll(x.slice(1), env) },
  *'..'(x, env) { return yield* evAll(x.slice(1), env) },
  // ["{}", [键, 值]...]
  *'{}'(x, env) {
    const o = {}
    for (const [k, v] of x.slice(1)) o[k] = yield* ev(v, env)
    return o
  },
  *'?'(x, env) {
    const c = yield* ev(x[1], env), t = truthy(c)
    yield { x, n: x.node, ph: 'if', c, t }
    return yield* ev(t ? x[2] : x[3], env)
  },
  *'=>'(x, env) { return { t: 'fn', params: x[1].slice(1), body: x.slice(2), env, node: x.node, name: '' } },
  // ["=", 名字, 值]（源码 [- 名字 值]，不可改变）与 ["->", 名字, 值]（局部赋值，无则初始化）：运行时都是在当前环境里设置，不可变性由 Lexscope 在解析期检查
  *'='(x, env) {
    const v = yield* ev(x[2], env)
    if (v?.t == 'fn' && !v.name) v.name = x[1]
    env.m.set(x[1], v); return v
  },
  // 右侧是对象字面量 → 部分赋值：只覆盖字面量里写出的键，其余键沿用该名字现有的值（没有则从空对象开始）
  *'->'(x, env) {
    const rhs = x[2]
    if (!(isT(rhs) && rhs[0] == '{}')) return yield* Walk['='](x, env)
    const o = yield* ev(rhs, env), cur = env.find(x[1])?.m.get(x[1]), v = { ...(cur && typeof cur == 'object' ? cur : null), ...o }
    env.m.set(x[1], v); return v
  },
  // [".", 基, 调用]：基插为调用的第一个实参
  *'.'(x, env, stmt) {
    const b = yield* ev(x[1], env, stmt), c = x[2]
    if (isT(c) && c[0] == '') return B.get(b, c[1])      // o.k / o."k"：取键
    if (!isT(c) || (c[0] != '()' && c[0] != '[]')) throw new LispErr(tr`. 之后应为 (..) 或 [..] 或键`, x)
    return yield* apply(c.slice(1), env, [b], c)
  },
}
function* apply(items, env, pre, x) {
  if (!items.length) return pre ? pre[0] : NO
  const f = yield* ev(items[0], env), args = pre ? [...pre] : []
  for (const y of items.slice(1)) args.push(yield* ev(y, env))
  return yield* call(f, args, x)
}
function* call(f, args, x) {
  let v
  if (f && f.t == 'fn') {
    const e = new Env(f.env); f.params.forEach((p, i) => e.m.set(p, i < args.length ? args[i] : NO))
    v = yield* body(f.body, e, f.node)
  } else if (typeof f == 'function') v = f.gen ? yield* f(...args) : f(...args)
  else throw new LispErr(tr`${show(f, 1)} 不可调用`, x)
  yield { x, n: x?.node || (f.t == 'fn' ? f.node : null), ph: 'ret', f, args, v }
  return v
}
// 函数体/程序：单语句直接取值；多语句必须用 OK 返回（last：像 Calc 那样取最后一句的值）
function* body(items, env, n, last) {
  try {
    if (items.length == 1) return yield* ev(items[0], env, true)
    let v = NO
    for (const y of items) v = yield* ev(y, env, true)
    if (last) return v
  } catch (e) { if (e instanceof Ret) return e.v; throw e }
  if (items.length) warn(tr`多语句缺少 OK 返回`, n)
  return NO
}

/* ---- 驱动 ---- */
let LOG = null
const warn = (m, n) => LOG && LOG.push({ warn: m, n })
const globals = log => { const e = new Env(null); e.m.set('w@', Object.assign((...a) => { log.push({ out: a.map(x => show(x)).join(' ') }); return a.at(-1) ?? NO }, { bname: 'w@' })); return e }
const isDef = s => isT(s) && (s[0] == '=' || s[0] == '->')
// 逐步执行：迭代器产出上述事件；结束时 done.value = {value} | {err, x}，均带 log。
// prog 是根 ["..", 语句...]；ast 不是根时（独立求值）先执行顶层定义再单独求值 ast
function* steps(ast, prog = ast, last = false) {
  const log = []; LOG = log
  try {
    const env = globals(log), stmts = prog.slice(1)
    if (ast === prog) return { value: yield* body(stmts, env, prog.node, last), log }
    for (const s of stmts) if (isDef(s) && s !== ast) try { yield* ev(s, env, true) } catch (e) { if (!(e instanceof LispErr)) throw e }
    return { value: yield* ev(ast, env, stmts.includes(ast)), log }
  }
  catch (e) { if (e instanceof Ret) return { value: e.v, log }; if (e instanceof LispErr || e instanceof RangeError || e instanceof TypeError) return { err: e.message, x: e.x, log }; throw e }
  finally { LOG = null }
}
const drive = (it, max = 300000) => { let r, n = 0; while (!(r = it.next()).done) if (++n > max) return { err: tr`超过 ${max} 步，已中止`, log: [] }; return { ...r.value, steps: n } }
const run = prog => drive(steps(prog))
const node = (ast, prog) => drive(steps(ast, prog))
const fns = new Set([...Object.keys(B), 'w@'])
P.walkers.lisp = { run, steps, node, show, fname, builtins: new Set([...fns, 'NO']) }
// Calc：同一个 walker，程序取最后一句的值
P.walkers.calc = { ...P.walkers.lisp, run: prog => drive(steps(prog, prog, true)), steps: (ast, prog) => steps(ast, prog, true) }

P.examples.splice(4, 0, {
  name: '四则运算（TDOP）', rules: CALC, input: `(1 + 2) * 3 - 8 / 4;
(-> f f 3 + f 4) (-> y y*y);
(-> x (-> n x*n+1)) 10 2`,
}, {
  name: '四则运算（作用域/错误）', rules: null, same: '四则运算（TDOP）', input: `-> y x+1 ; -> y1 x*2`,
}, {
  name: '四则运算（朴素 Chain）', rules: CHAIN, input: `1 - 2 - 3 + 4 * (5 - 2) / 6`,
}, {
  name: 'Lisp', rules: RULES, input: `# 语句位置的 [..] 是调用；[e1].[e2] 即 (e1).(e2 ..) 即 [e2 [e1] ..]
[- big (=> (xs n) xs.(mapNotNO (=> (x) (> x n)? x Or NO)))]
def fact(n) (<= n 1)? 1 Or (* n (fact (+ n -1)))
[- inc1 (=> (a) [len a].[+ 1])]
(- user {name "parviz" langs ["js" "lisp"]})
(- older user.[-> "age" 40])
(w@ "fact 5 =" (fact 5) "big:" [3 14 15 9 26].(big 10) user.name older.age (inc1 [1 2 3]))
def poly(x y):
  [-> t (> 2x + 3y - 7)]
  (OK (both t (isnt (== x y))))
...
(w@ (poly 2 3) (poly 0 1))
(OK [123].(mapNotNO (=>(x) (> x 10)? x Or NO )).[at 0] )`,
}, {
  name: 'Lisp（作用域/错误）', rules: null, same: 'Lisp', input: `[- k 10]
[- add (=> (a b) [- s (+ a b)] (OK s.[+ k]))]
def twice(f x) (f (f x))
[- c 1]
[-> c 2]
(w@ (twice (=> (y) (add y 1)) 5) undefinedName)
(OK {sum (add 1 2) xs [1 2 (3 ] ok "fine"})`,
})

const L = { NO, Ret, LispErr, B, Walk, Env, ev, steps, run, node, show, fname, truthy, RULES, CALC, CHAIN, funcs }
if (typeof module != 'undefined') module.exports = L
G.LISP = L
})(typeof globalThis != 'undefined' ? globalThis : window)
