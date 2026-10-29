/* lisp.js — Lisp：①语法（元语言写成，作用域全用 parse.js 的 Lexscope 工具包）②按 tag 分派的求值 walker。
   AST 是标签式多态调用：(fact 5) 即 ["()", ["$", "fact"], 5]；"$" 名字 "" 字符串字面 "=" "->" "=>" ".." "?" "{}" "." 都只是 tag。 */
(function (G) {
'use strict'
const P = G.P || require('./parse.js')
const { T, leaf, leaves, isT, parts, bind, FAIL, hash4 } = P, tr = P.f   // tr`…`：报错文本走 parse.js 的国际化（这里 f 常作函数名，故换名）

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
Atom   (> Num ("(" Exp ")" :par) Lam Name <)
Lam    "->" Param Exp :fn
Param  /[A-Za-z_]\\w*/ :arg2nth
Num    /\\d+(\\.\\d+)?/ :num
Name   /[A-Za-z_]\\w*/ :ref`
const CHAIN = `# 朴素四则运算：左递归 Sum ← Sum "+" Prod 在 PEG 里会无限递归，于是写成链（chainl）：
# Sum ← Prod (("+"|"-") Prod)*，:chainl 从左往右折叠，解析完直接得到数值；没有作用域，也不需要 walker
@color Num=B Add=P Mul=P
Sum    Prod ((Add Prod) *) :chainl
Prod   Atom ((Mul Atom) *) :chainl
Atom   (> Num ("(" Sum ")" :par) <)
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
  return T('()', [ref('+', o), lv, T('()', [ref('neg', o), rv], n, [o, r])], n, [o, l, r])
}
const ARITH = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b }

// ---- 点号链 / 模板字符串的脱糖助手 ----
const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
const unesc = s => s.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r?\n)|([\s\S]))/g, (_, a, b, c, nl, ch) => a || b || c ? String.fromCodePoint(parseInt(a || b || c, 16)) : nl ? '' : ESC[ch] ?? ch)
// 模板字符串值 [首段文本, [[表达式, 后续段文本]…]] → 各段字符串字面量（各带自己的 token 节点）+ 表达式
const tplOf = (v, n) => {
  const [b, hs] = v, pn = parts(n), hn = parts(pn[1])
  const strs = [leaf('', unesc(b.slice(1)), pn[0])], sn = [pn[0]], xs = [], xn = []
  hs.forEach(([e, t], i) => { const [en, tn] = parts(hn[i]); xs.push(e); xn.push(en); strs.push(leaf('', unesc(t.slice(1)), tn)); sn.push(tn) })
  return { strs, sn, xs, xn }
}
// 基 acc 接一个点项 d：键 → ["." 基 键]；mcall → [(. 基 键) 实参…]；pipe → (f 基 实参…)；cb → As / 追加回调；tag → (tag [段…] 值…)
// at：挂在结果上的 CST 节点；an：基的 CST 节点；dnk：这一项的 CST 节点
// cs：结果节点里“基”所在的下标——基是 [..] 时，语句位置的链里它是调用、表达式位置的链里它是数组，求值时把 stmt 往下传到基
const cs = (x, i) => (x.cs = i, x)
const dot = (acc, d, at, an, dnk) => {
  if (isT(d)) return T('.', [acc, d], at, [an, d.node])
  switch (d.k) {
    case 'pipe': {
      const c = d.c
      if (!isT(c) || (c[0] != '()' && c[0] != '[]')) { dnk.err = tr`.. 之后应为调用 (f ..) 或 [f ..]`; return acc }
      return c.length == 1 ? acc : cs(T('()', [c[1], acc, ...c.slice(2)], at, [c.ns[0], an, ...c.ns.slice(1)]), 2)
    }
    case 'mcall': return cs(T('()', [T('.', [acc, d.key], d.key.node, [an, d.key.node]), ...d.args], at, [d.key.node, ...d.an]), 1)
    case 'cb':
      if (d.opt) return cs(T('()', [ref('As', d.n), acc, d.lam], at, [d.n, an, d.n]), 2)
      if (isT(acc) && (acc[0] == '()' || acc[0] == '[]')) return cs(T(acc[0], [...acc.slice(1), d.lam], at, [...acc.ns, d.n]), acc.cs)
      return cs(T('()', [acc, d.lam], at, [an, d.n]), 1)
    case 'tag': return cs(T('()', [acc, T('[]', d.strs, d.sn[0], d.sn), ...d.xs], at, [an, d.sn[0], ...d.xn]), 1)
  }
}

/* ======================= ① 语法 =======================
   Lisp 特有的语法糖：o.k 取键、o.[k a] 方法调用（等价于 [o.k a]，JS 的 OOP）、x..(f a) 管道（x 插为第一个实参）、(f)?.{ … } / (f).{ … } 回调块、`…${x}…` 模板字符串与 tag`…`、(x ..) [xargs {a_ 1}] 可选参数、(c)? A Or B、语句级 (a) b 即 ((a) b)、(> 2x + 3y) / [> a <= b] 内联中缀（只有头是 > 的括号里才有中缀）。其余（lambda、定义、def 写法）都在规则里用工具包组合。 */
const funcs = {
  infix: (v, n) => infix(n),
  // [函数, [实参...]] → ["()", ["()", 函数, 实参1], 实参2]…（单参 lambda 的柯里化调用）；树里显示为 [() [() f a] b]
  apply: (v, n) => {
    const [f, xs] = v; if (!xs.length) return f
    const pn = parts(n), an = parts(pn[1]); let acc = f, fn = pn[0]
    xs.forEach((x, k) => { acc = T('()', [acc, x], n, [fn, an[k]]); fn = null })   // 中间层也挂 n：值视图才展开成 [() [() f a] b]
    return acc
  },
  // [首项, [[算符, 项]...]] → 左折叠：((首项 o1 项1) o2 项2)…
  chainl: ([x, rest]) => rest.reduce((a, [o, b]) => ARITH[o](a, b), x),
  // [基, [点项...]] → 逐项脱糖（见 dot）；树里显示为脱糖后的调用
  chain: (v, n) => {
    const [b, cs] = v; if (!cs.length) return b
    const pn = parts(n), dn = parts(pn[1]); let acc = b, an = pn[0]
    cs.forEach((d, k) => { acc = dot(acc, d, k == cs.length - 1 ? n : isT(d) ? d.node : dn[k], an, dn[k]); an = null })
    return acc
  },
  // [条件, [A, B]?] → ["?", 条件, A, B]
  if: (v, n) => { if (v[1] === undefined) return v[0]; const pn = parts(n); return T('?', [v[0], ...v[1]], n, [pn[0], ...parts(pn[1])]) },
  // 字符串字面量 → ["", 文本]；Dkey 是 o.k 的裸键（bare），语句级 o.k args 时改成名字
  strlit: (v, n) => leaf('', v, n),
  lit: (v, n) => leaf('', v, n),   // #66ccff / ./a.wtf：字符串字面量（原样文本）
  // 2x → (* 2 x)
  lmono: ([k, name], n) => { const pn = parts(n); return T('()', [ref('*', pn[0]), k, name], n, [pn[0], pn[0], pn[1]]) },
  // 语句级“自动插括号”：同一行里 Exp 之后并列的 Exp 是实参。a b → (a b)；(a) b → ((a) b)；o.k e f → (o.k e f)（方法调用）；换行结束语句（类似 JS 的自动分号）
  lstmt: ([a, rest], n) => {
    if (!rest.length) return a
    const pn = parts(n), rn = parts(pn[1])
    return T('()', [a, ...rest], n, [pn[0], ...rn])
  },
  // 同一行并列才算实参：换行、或之间隔着 ; 都结束语句
  lsame: (v, n, ss) => { let j = n.a; while (j > 0 && ' \t,'.includes(ss.src[j - 1])) j--; const c = ss.src[j - 1]; return c == '\n' || c == ';' ? FAIL : v },
  // ":" 语句... "..." → 语句数组（带每条语句的 CST 节点 ns），defn 把它展开成 lambda 体
  lblock: (v, n) => { const a = v === undefined ? [] : Array.isArray(v) && !isT(v) ? v : [v]; a.ns = parts(parts(n)[0]); return a },
  // (f a b) 普通调用；头是 > 时是“内联中缀”（唯一有中缀的地方）：(> 2x + 3y) 是多项式的值，(> a <= b) 是比较。见 calc
  lcall: (v, n) => {
    const a = Array.isArray(v) && !isT(v) ? T('()', v, n, parts(n)) : T('()', v === undefined ? [] : [v], n, [n])
    return a[1]?.[0] == '$' && a[1][1] == '>' ? calc(a, n) : a
  },
  // [> a <= b] 同样是内联中缀（表达式位置也不会被当成数组）；其余 [..] 原样
  lbrk: (v, n) => v[1]?.[0] == '$' && v[1][1] == '>' ? calc(v, n) : v,
  // 点项：..(f a) 管道；.[k a] / .(k a) 方法调用（k 是键，不是名字）；?.{ … } / .{ … } 回调块（参数名固定为 u）；tag`…` 带标签的模板字符串
  dpipe: v => ({ k: 'pipe', c: v }),
  mcall: ([key, args], n) => ({ k: 'mcall', key, args, an: parts(parts(n)[1]) }),
  cb: (v, n) => {
    const o = n.kids[0]
    n.defs = [...(n.defs || []), { name: 'u', node: o, kind: 'param', nth: 0 }]; bind(n, n.defs); n.defs = null   // 隐式参数 u：在此闭合作用域
    return { k: 'cb', opt: o.text[0] == '?', lam: T('=>', [T('..', ['u'], o, [o]), ...v], n, [o, ...parts(n)]), n }
  },
  ttag: (v, n) => ({ k: 'tag', ...tplOf(v, n) }),
  // `…${x}…` → 无插值是字符串字面量，否则 (str 段 x 段 …)；str 把值转成文本再拼接
  tpl: (v, n) => {
    const { strs, sn, xs, xn } = tplOf(v, n)
    if (!xs.length) return leaf('', strs[0][1], n)
    const items = [ref('str', n)], ns = [n]
    strs.forEach((s, i) => { if (s[1] !== '') { items.push(s); ns.push(sn[i]) } if (i < xs.length) { items.push(xs[i]); ns.push(xn[i]) } })
    return T('()', items, n, ns)
  },
  // [xargs {a_ 1 b_ 2}] → ["xargs", {…}]：声明以 _ 结尾的可选参数（定义到外层 lambda 的作用域）；(xargs) 是普通调用，返回 .. 收到的实参
  xargs: (v, n) => {
    const ns = parts(parts(n)[0])
    v.slice(1).forEach(([k], i) => {
      const tk = leaves(ns[i])[0]
      if (k.at(-1) != '_') tk.err = tr`可选参数名必须以 _ 结尾`
      else {   // 定义挂到词条上（颜色 / 增量编辑据此重解析），同时保留在 n.defs 里供 :fn 聚合
        tk.c = 'P'; tk.defs = [{ name: k, node: tk, kind: 'param' }]
        ;(n.defs ||= []).push({ name: k, node: tk, kind: 'param' })
      }
    })
    return T('xargs', [v], n, parts(n))
  },
  // (tweak 名字 (vec2 0 1) (size 2)) → ["tweak", 名字, spec…]：只描述实参，不在运行期求值（Walk.tweak 返回 NO）
  tweak: (v, n) => { const [name, specs] = Array.isArray(v) ? v : []; return T('tweak', [name, ...(Array.isArray(specs) ? specs : [])], n) },
  // (vec2 0 1) → ["spec", "vec2", 0, 1]；ns 与 kids 对齐：类别词条 + 各数字词条（Tweak 用它定位源码）
  spec: (v, n) => { const [kind, nums] = Array.isArray(v) ? v : []; return T('spec', [kind, ...(nums || [])], n, leaves(n)) },
  // :top("tweak")：这类声明只允许出现在顶层；嵌套的标成解析期错误（Tweak.scan 只读顶层）
  top: tag => (v, n) => {
    const stmts = Array.isArray(v) ? v : []
    const chk = (x, root) => {
      if (Array.isArray(x) && !isT(x)) return x.forEach(y => chk(y, false))
      if (!isT(x)) return
      if (x[0] == tag && !root) { if (x.node) x.node.err = tr`(${tag} …) 只能在顶层`; return }
      for (let i = 1; i < x.length; i++) chk(x[i], false)
    }
    for (const s of stmts) chk(s, true)
    return v
  },
}
Object.assign(P.funcs, funcs)

/* (> 项 运算符 项 运算符 项 …)：头 > 是语法，不是比较函数。里面必须是“项 运算符 项 …”交替，优先级 比较 < + - < * / %，同级左结合；
   减法编译成加负数。结果直接是脱糖后的调用树：(> 2x + 3y <= 7) → (<= (+ (* 2 x) (* 3 y)) 7)；只有一项时就是那一项。 */
const PREC = { '<': 1, '<=': 1, '>': 1, '>=': 1, '==': 1, '!=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '%': 3 }
function calc(a, n) {
  const k = a.length - 2, isOp = x => isT(x) && x[0] == '$' && Object.hasOwn(PREC, x[1])
  let ok = k % 2 == 1; for (let i = 0; ok && i < k; i++) if (isOp(a[i + 2]) != (i % 2 == 1)) ok = false
  if (!ok) { n.err = tr`(> …) 里应是“项 运算符 项 …”交替，运算符是 + - * / % < <= > >= == !=`; return a }
  const ops = new Set(a.slice(2).filter(isOp).map(o => o.node)); ops.add(a[1].node)
  n.free &&= n.free.filter(r => !ops.has(r.node))                  // 头 > 和运算符是语法，不是名字引用
  const bin = (o, l, r) => {
    const minus = o.t[1] == '-'
    const rv = minus ? T('()', [ref('neg', o.nd), r.v], n, [o.nd, r.nd]) : r.v
    return { v: T('()', [minus ? ref('+', o.nd) : o.t, l.v, rv], n, [o.nd, l.nd, r.nd]), nd: n }
  }
  const vals = [{ v: a[2], nd: a.ns[1] }], os = []
  const red = () => { const r = vals.pop(), l = vals.pop(); vals.push(bin(os.pop(), l, r)) }
  for (let i = 3; i < a.length; i += 2) {
    const o = { t: a[i], nd: a.ns[i - 1] }
    while (os.length && PREC[os.at(-1).t[1]] >= PREC[o.t[1]]) red()
    os.push(o); vals.push({ v: a[i + 1], nd: a.ns[i] })
  }
  while (os.length) red()
  const r = vals[0].v
  return r
}
const SYM = '[^\\s()\\[\\]{}",;?.\\x60]'
const STR = '"(\\\\.|[^"\\\\])*"'
const END = '(?![^\\s()\\[\\]{}",;?\\x60])'                              // 字面量必须在分隔符处结束
const HEXB = `(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})${END}`, HEX = '#' + HEXB   // #rgb #rgba #rrggbb #rrggbbaa：不再当注释
const TCH = '(?:[^\\x60$\\\\]|\\\\[\\s\\S]|\\$(?!\\{))*'                 // 模板字符串的一段文本：到 ` 或 ${ 为止，\ 转义任意字符（含换行）
const RULES = `# Lisp —— 作用域由 Lexscope 工具包组合：:arg2nth 参数表、:fn 闭合 lambda、:let 定义、:set 赋值、:defn 两者合一、:ref 引用、:global 顶层
# (=> (a b) e)、[- f (=> (a b) e)]、def f(a b) e 产生完全相同的 AST（"=" 定义，不可被 -> 改变）；[-> x e] 是局部赋值（无则初始化）
# (条件)? A Or B 是 if；OK 是普通内建（流控返回）；表达式位置的 [] {} 是数组/KV，语句位置的 [] 是调用
# 同一行里语句级的 (a) b 是 ((a) b)，换行或 ; 结束语句；(> 2x + 3y <= 9) / [> a == b]? 是唯一有中缀的地方（头必须是 >）
# 点：o.k 取键；o.[k a] 即 [o.k a]（方法调用，JS 的 OOP）；x..(f a) 即 (f x a)（管道）；(f x)?.{ … } 即 (As (f x) (=> (u) …))；(f).{ … } 即 (f (=> (u) …))
# 模板字符串：\`a \${x} b\` 即 (str "a " x " b")，可多行；tag\`a \${x}\` 即 (tag ["a " ""] x)（tag 与 \` 之间不能有空白）
# 可选参数：(=> (x ..) [xargs {a_ 1 b_ 2}] …)：.. 收集多出来的实参，按序给 a_ b_（NO 或缺省取默认值）；(xargs) 返回收集到的实参数组
# 注释：# 到行尾（但 #66ccff 这样的十六进制颜色是字面量），#@ … @# 可跨行；; 是语句分隔符（在表达式里与空白等价）
# 字面量（都是字符串）：#66ccff 颜色、./a/b.wtf 与 ../x 路径
@skip /(?:[\\s,;]|#@[\\s\\S]*?@#|#(?!${HEXB})[^\\n]*)+/
@color Num=B Coef=B Str=Y Qs=Y Lit=Y Tbeg=Y Tbeg1=Y Tend=Y
@walk lisp
@stmt Stmt
Lisp   (Stmt *) :global :top("tweak") :tag("..")
Stmt   Exp (Same *) :lstmt
Same   Exp :lsame
Exp    ((Chain ("?" Recur "Or" Recur ?) :if) :setRecur)
Chain  Atom (Dot *) :chain
Dot    (> (".." (> List Brk <) :dpipe) ((> "?.{" ".{" <) (Stmt *) "}" :par :cb) ("." (> Mcall Str Dkey <)) Ttag <)
Mcall  (> ("(" Dkey (Recur *) ")" :par) ("[" Dkey (Recur *) "]" :par) <) :mcall
Atom   (> Mono Num Str Lit Lam Let Set Defn Xargs Tpl Tweak List Brk Obj Name <)
Lam    (> (/\\((?=\\s*=>)/ "=>" Params (Recur *) ")" :par) (/\\[(?=\\s*=>)/ "=>" Params (Recur *) "]" :par) <) :fn
Let    (> (/\\((?=\\s*-\\s+${SYM}+\\s)/ "-" Var Recur ")" :par) (/\\[(?=\\s*-\\s+${SYM}+\\s)/ "-" Var Recur "]" :par) <) :let
Set    (> (/\\((?=\\s*->\\s+${SYM}+\\s)/ "->" Var Recur ")" :par) (/\\[(?=\\s*->\\s+${SYM}+\\s)/ "->" Var Recur "]" :par) <) :set
Defn   "def" Var Params (> Block Recur <) :defn
Block  ":" (Stmt *) "..." :lblock
Params (> ("(" (Pname *) (Rest ?) ")" :par) ("[" (Pname *) (Rest ?) "]" :par) <) :arg2nth
Rest   /\\.\\./
Xargs  (> (/\\((?=\\s*xargs\\s*\\{)/ "xargs" Obj ")" :par) (/\\[(?=\\s*xargs\\s*\\{)/ "xargs" Obj "]" :par) <) :xargs
List   ("(" (Recur *) ")" :par :lcall)
Brk    ("[" (Recur *) "]" :par :tag("[]") :lbrk)
Obj    ("{" (Pair *) "}" :par :tag("{}"))
Pair   (> Qs Key <) Recur
Key    /${SYM}+/
Dkey   /(?![/])${SYM}+/ :lit
Num    /-?\\d+(\\.\\d+)?/ :num
Lit    /(?:${HEX}|[.]{1,2}[/][^\\s()\\[\\]{}",;?\\x60]+)/ :lit
Mono   Coef Name :lmono
Coef   /-?\\d+(\\.\\d+)?(?=[^\\s()\\[\\]{}",;?.\\x60\\d])/ :num
Qs     /${STR}/ :str
Str    /${STR}/ :str :strlit
Var    /${SYM}+/
Pname  /${SYM}+/
Tpl    (Tbeg (Hole *) "\`") :tpl
Ttag   (Tbeg1 (Hole *) "\`") :ttag
Tweak  (/\\((?=\\s*tweak\\b)/ "tweak" Tname (Spec *) ")" :par) :tweak
Spec   ("(" Tkind (Tidx *) ")" :par) :spec
Tname  (> Trec Tsym <)
Trec   ("{" (Tsym *) "}" :par :tag("rec"))
Tidx   (> Num Tsym <)
Tsym   /${SYM}+/ :lit
Tkind  /vec2|color|num|size|angle|enum/ :lit
Hole   "\${" Recur Tend
Tbeg   /\\x60${TCH}/
Tbeg1  /(?<=[^\\s,;])\\x60${TCH}/
Tend   /\\}${TCH}/
Name   /(?!Or(?!${SYM}))${SYM}+/ :ref`

/* ======================= ② 求值 walker =======================
   独立于解析：只认标签式 AST。Walk 是 tag → 生成器的表，B 是内建函数表。
   事件：每个标签节点 in/out；调用返回 ret（带函数、实参、返回值）；判断 if（带条件值）。
   事件只带源码跨度 a/b（值节点自带，见 parse.js 的 T/leaf），不带 CST 节点——显示层换 CST 也不用动这里。
   UI 的 F8 只停在 ret/if/标记处。 */
const NO = Object.freeze({ toString: () => 'NO' })
/* ---------- 常量池 ----------
   数字字面量在值 AST 里是裸 number（树视图 / Tweak 都认它）。要热编辑的程序先过 pool()：复制一份 AST，
   把每个有源码跨度的数字换成格子 Lit，ev 在非标签分支里解指针（一次 instanceof，不多发事件）。
   热编辑 = 改格子的值：不重解析、不重跑、不丢状态（闭包里 slice 出来的体也共享同一格子）。
   锚点 hashline = `行号#hash4(行首至词条末的文本)`，和 ui/app.js 的 onedit 词条哈希同一算法；
   pool.onedit(hashline, 新文本) 没有第三个参数（有第三个参数的 onedit 是编辑通知）。 */
class Lit { constructor(v, a, b, fn) { this.v = v; this.a = a; this.b = b; this.fn = fn } }   // fn：在 lambda 体里（会被再次调用）；顶层字面量只在 setup 里读一次
const NUMRE = /^-?\d+(\.\d+)?$/
// 同结构的两棵树：把 y 各节点的跨度抄给 x（Lit 格子由调用方单独对齐）
function respan(x, y, seen) {
  if (!Array.isArray(x) || !Array.isArray(y) || seen.has(x)) return
  seen.add(x)
  if (typeof y.a == 'number') { x.a = y.a; x.b = y.b }
  for (let i = 0; i < x.length && i < y.length; i++) respan(x[i], y[i], seen)
}
function pool(ast, src) {
  const cells = [], memo = new Map, seen = new Set
  const cell = (x, nd, fn) => {
    if (!nd || !(nd.a >= 0) || seen.has(nd.a)) return x
    const t = src.slice(nd.a, nd.b)
    if (!NUMRE.test(t) || Number(t) !== x) return x       // 节点与值对不上（语法糖拼出来的）：保持裸值，不可热编辑
    seen.add(nd.a); const c = new Lit(x, nd.a, nd.b, fn); cells.push(c); return c
  }
  const copy = (x, nd, fn) => {
    if (typeof x == 'number') return cell(x, nd, fn)
    if (!Array.isArray(x)) return x
    let c = memo.get(x); if (c) return c
    const t = isT(x), inner = fn || (t && x[0] == '=>'), ns = x.ns
    c = new x.constructor(x.length); memo.set(x, c)
    for (let i = 0; i < x.length; i++) {
      const k = x[i], n = t && i >= 1 && ns ? ns[i - 1] : null
      // {} 的键值对是普通数组 [键, 值]；值的节点在这一对的 CST 里
      c[i] = t && x[0] == '{}' && i >= 1 && Array.isArray(k) && !isT(k) ? (p => [k[0], copy(k[1], p[1], inner)])(parts(n)) : copy(k, n, inner)
    }
    for (const k of Object.keys(x)) if (!/^\d+$/.test(k)) c[k] = x[k]   // node / ns / a / b / cs …
    return c
  }
  const code = copy(ast, null, false)
  cells.sort((p, q) => p.a - q.a)
  const P_ = {
    code, cells, src,
    // 结构签名：数字都当 #，其余照抄；去掉跨度，所以空白 / 注释的变化不改变签名
    sig() {
      const w = x => x instanceof Lit ? '#' : Array.isArray(x) ? '[' + x.map(w).join(',') + ']' : typeof x == 'string' ? JSON.stringify(x) : String(x)
      return w(code)
    },
    // 所有格子的锚点（与 cells 同序）
    anchors() {
      const s = this.src, ls = [0]; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) == 10) ls.push(i + 1)
      return this.cells.map(c => {
        let lo = 0, hi = ls.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ls[m] <= c.a) lo = m; else hi = m - 1 }
        return `${lo + 1}#${hash4(s.slice(ls[lo], c.b))}`
      })
    },
    // 热编辑：按锚点找格子，改值并同步影子源码；返回被改的格子，找不到 / 文本不是数字返回 null
    onedit(h, val) {
      const t = String(val); if (!NUMRE.test(t)) return null
      const i = this.anchors().indexOf(h); return i < 0 ? null : this.put(this.cells[i], t)
    },
    // 改一个格子的文本（t 已确认是数字）：同步影子源码，并把它右边所有格子顺延
    put(c, t) {
      const ob = c.b, d = t.length - (c.b - c.a)
      c.v = Number(t); c.b = c.a + t.length
      this.src = this.src.slice(0, c.a) + t + this.src.slice(ob)
      for (const k of this.cells) if (k !== c && k.a >= ob) { k.a += d; k.b += d }
      return c
    },
    // 与新解析出的池比较：结构相同（签名一致、格子数一致）→ 返回需要改的 [{cell, text}]，否则 null
    diff(next) {
      if (next.cells.length != this.cells.length || next.sig() !== this.sig()) return null
      const r = []
      this.cells.forEach((c, i) => { const n = next.cells[i]; if (n.v !== c.v) r.push({ cell: c, text: next.src.slice(n.a, n.b) }) })
      return r
    },
    // 一次编辑（仅数字字面量变化）后：逐格 put（从右往左，不用逐格重算锚点），再把影子源码与跨度对齐到新文本
    apply(next) {
      const ch = this.diff(next); if (!ch) return null
      const done = []
      for (const e of ch.sort((p, q) => q.cell.a - p.cell.a)) if (NUMRE.test(e.text)) done.push(this.put(e.cell, e.text))
      this.src = next.src; this.cells.forEach((c, i) => { c.a = next.cells[i].a; c.b = next.cells[i].b })
      respan(code, next.code, new Set)   // 结构相同的两棵树：其余节点的 a/b 也跟着新文本走（控制台 / 暂停 / 取源的跨度不会错位）
      return done
    },
  }
  return P_
}
class Ret { constructor(v) { this.v = v } }          // OK 抛出的流控返回
class LispErr extends Error { constructor(m, x) { super(m); this.x = x } }
const truthy = v => v !== NO && v !== false && v != null
const fname = f => f?.t == 'fn' ? f.name || 'λ' : f?.bname || f?.name || '?'
const isPlain = v => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null }
const show = (v, d = 0) => v === NO ? 'NO' : typeof v == 'string' ? (d ? JSON.stringify(v) : v)
  : Array.isArray(v) ? (d > 6 ? '[…]' : '[' + v.map(x => show(x, d + 1)).join(' ') + ']')
  : v && v.t == 'fn' ? `<fn ${fname(v)}/${v.params.length}>` : typeof v == 'function' ? (v.lisp ? show(v.lisp) : `<builtin ${fname(v)}>`)
  : v && typeof v == 'object' ? (!isPlain(v) ? `<${v.constructor?.name || 'object'}>` : d > 6 ? '{…}' : '{' + Object.entries(v).map(([k, x]) => k + ' ' + show(x, d + 1)).join(' ') + '}') : String(v)

class Env {
  constructor(p) { this.m = new Map; this.p = p }
  find(k) { for (let e = this; e; e = e.p) if (e.m.has(k)) return e }
}

// 内建：普通函数直接调用；gen 标记的是生成器（会回调 lambda，逐步执行能进到里面）
const gen = f => (f.gen = 1, f)
// ctxGen：生成器还要调用点上下文（w@ 打印定位），签名多一个 {cx,a,b,node,args}——只有显式要上下文的内建才改签名
const ctxGen = f => (f.gen = 1, f.ctx = 1, f)
const eq = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)
const B = {
  '+': (...a) => a.reduce((x, y) => x + y), neg: a => -a,
  '*': (...a) => a.reduce((x, y) => x * y, 1), '/': (a, b) => a / b, '%': (a, b) => a % b,
  '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b,   // (> a > b) 等中缀脱糖成这些二元调用
  '==': eq, '!=': (a, b) => !eq(a, b), isnt: a => !truthy(a), both: (a, b) => truthy(a) ? b : a,
  '->': (o, k, v) => { const p = v === undefined ? k : { [k]: v }; return Object.assign(o, isPlain(o) ? p : Object.fromEntries(Object.entries(p).map(([a, b]) => [a, toJS(b)]))) },   // o..[-> {…}] / o..[-> "k" v]：原地合并并返回 o（JS 对象上的 Lisp 函数转成回调）；名字 + 对象字面量由 Walk['->'] 做局部部分赋值
  at: (a, i) => { const r = a?.at?.(i); return r === undefined ? NO : r },
  get: (o, k) => { const v = o?.[k]; return v === undefined ? NO : bindTo(v, o) }, len: a => a.length, keys: o => Object.keys(o), list: (...a) => a,
  str: (...a) => a.map(x => show(x)).join(''), concat: (...a) => [].concat(...a), push: (a, ...x) => [...a, ...x],
  range: (a, b) => { if (b == null) [a, b] = [0, a]; const r = []; for (let i = a; i < b; i++) r.push(i); return r },
  sum: a => a.reduce((x, y) => x + y, 0),
  OK: (...a) => { throw new Ret(a.length ? a.at(-1) : NO) },
  map: gen(function* (a, f) { const r = []; for (const x of a) r.push(yield* call(f, [x])); return r }),
  filter: gen(function* (a, f) { const r = []; for (const x of a) if (truthy(yield* call(f, [x]))) r.push(x); return r }),
  mapNotNO: gen(function* (a, f) { const r = []; for (const x of a) { const y = yield* call(f, [x]); if (y !== NO) r.push(y) } return r }),
  // (As 值 f)，即 值?.{ … }：数组逐项 f 并丢掉 NO（mapNotNO），假值（NO/false/null）原样返回，否则 (f 值)
  As: gen(function* (v, f) { return Array.isArray(v) ? yield* B.mapNotNO(v, f) : truthy(v) ? yield* call(f, [v]) : v }),
  reduce: gen(function* (a, f, z) { for (const x of a) z = yield* call(f, [z, x]); return z }),
  each: gen(function* (a, f) { let i = 0; for (const x of a) yield* call(f, [x, i++]); return a }),
  new: (C, ...a) => fromJS(new C(...a.map(toJS))),
  wait: ms => new Promise(r => setTimeout(r, ms)),                         // Promise：调用处自动 await
  true: true, false: false, null: null,
}
for (const k in B) if (typeof B[k] == 'function') B[k].bname = k
Object.setPrototypeOf(B, null)   // 名字如 constructor 不会命中 Object 原型

function* ev(x, env, stmt = false) {
  if (!isT(x)) return x instanceof Lit ? x.v : x   // 数字等裸字面量；常量池的格子解指针（见 pool）
  const t = x[0]; let v
  const w = CX.watch, nodes = !w || w.nodes                 // 宿主给了 watch（p5 的 DBG）且没人要节点事件时，in/out/if 都不产出（只剩 ret）
  if (nodes) yield { x, a: x.a, b: x.b, ph: 'in' }
  if (t === '$') v = lookup(x, env)          // 最常见的三种节点（名字、全局键、字符串字面）不经 Walk 表与生成器委托
  else if (t === '$$') v = glookup(x, env)
  else if (t === '') v = x[1]
  else { const f = Walk[t]; if (!f) throw new LispErr(tr`未知标签 ${t}`, x); v = yield* f(x, env, stmt) }
  if (nodes) yield { x, a: x.a, b: x.b, ph: 'out', v }
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
  const h = L.host; if (h?.has(k)) return fromJS(h.get(k))      // 宿主（JS 全局 / p5 实例…）
  throw new LispErr(tr`未定义 ${k}`, x)
}
const evAll = function* (xs, env) { const r = []; for (const y of xs) r.push(yield* ev(y, env)); return r }
const Walk = {
  // ["$", name]：名字解析；["", 文本]：字符串字面量
  *'$'(x, env) { return lookup(x, env) },
  *'$$'(x, env) { return glookup(x, env) },
  *''(x) { return x[1] },
  // ["()", f, ...args]：调用
  *'()'(x, env, stmt) { return yield* apply(x.slice(1), env, x, stmt) },
  // ["[]", ...]：语句位置是调用，表达式位置是数组
  *'[]'(x, env, stmt) { return stmt ? yield* apply(x.slice(1), env, x, stmt) : yield* evAll(x.slice(1), env) },
  *'..'(x, env) { return yield* evAll(x.slice(1), env) },
  // ["{}", [键, 值]...]
  *'{}'(x, env) {
    const o = {}
    for (const [k, v] of x.slice(1)) o[k] = yield* ev(v, env)
    return o
  },
  *'?'(x, env) {
    const c = yield* ev(x[1], env), t = truthy(c)
    if (!CX.watch || CX.watch.nodes) yield { x, a: x.a, b: x.b, ph: 'if', c, t }
    return yield* ev(t ? x[2] : x[3], env)
  },
  *'=>'(x, env) { return { t: 'fn', params: x[1].slice(1), body: x.slice(2), env, a: x.a, b: x.b, name: '' } },
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
  // ["xargs", {键 默认值…}]（源码 [xargs {a_ 1 b_ 2}]）：参数表以 .. 结尾时，多出来的实参按书写顺序依次成为 a_ b_；缺省或 NO 取默认值（默认值只在需要时求值）
  *xargs(x, env) {
    const e = env.find('..'); if (!e) throw new LispErr(tr`[xargs ..] 需要参数表以 .. 结尾`, x)
    const rest = e.m.get('..'); let i = 0
    for (const [k, d] of x[1].slice(1)) { const g = rest[i++]; env.m.set(k, g !== undefined && g !== NO ? g : yield* ev(d, env)) }
    return NO
  },
  // (tweak …)：顶层声明，运行期不求值实参（Tweak.scan 从值 AST 读声明）
  *tweak() { return NO },
  // [".", 基, 键]：o.k / o."k" 取键；JS 对象上的方法取出来时绑定 this（所以 o.[k a] 就是 JS 的 o.k(a)）
  *'.'(x, env, stmt) { return B.get(yield* ev(x[1], env, stmt), x[2][1]) },
}
function* apply(items, env, x, stmt) {
  if (!items.length) return NO
  const k = stmt && x.cs ? x.cs - 1 : -1             // 点号链的“基”在 items 里的下标：它继承语句位置（[len a]..[+ 1] 里的 [len a] 是调用）
  const f = yield* ev(items[0], env, k == 0), args = []
  for (let j = 1; j < items.length; j++) args.push(yield* ev(items[j], env, j == k))
  return yield* call(f, args, x)
}
// Lisp 值 ⇄ JS 值：NO↔undefined；Lisp 函数交给 JS 时包成回调（同一函数同一包装，可 removeEventListener）
// JS 方法取出来再调用要保住 this：绑到所属对象；Lisp 内建/回调包装原样，大写开头的构造函数不绑（静态成员如 Promise.resolve 会丢）
const bindTo = (v, o) => typeof v == 'function' && !v.bname && !v.lisp && !/^[A-Z]/.test(v.name) ? v.bind(o) : v
const toJS = v => v === NO ? undefined : v && v.t == 'fn' ? (v.js ||= ((h) => Object.defineProperties((...a) => callback(v, a.map(fromJS), h), { lisp: { value: v }, toString: { value: () => show(v) } }))(L.host)) : v
const fromJS = v => v === undefined ? NO : v
const thenable = v => v && typeof v.then == 'function'
// 当前调用栈里最近的 Lisp 函数帧环境；没有就是顶层环境
const envOf = cx => { for (let i = cx.stack.length - 1; i >= 0; i--) if (cx.stack[i].env) return cx.stack[i].env; return cx.env }
// 在 env 里即时求值一段已解析的程序（根 [".." 语句…]）；extra 是临时绑定（如 @args / @ret）。
// 返回 { value } | { value, ret: true }（用了 OK）| { err, a, b }；不触发 pause，所以断点暂停时可以放心调用
function evalIn(ast, env, extra) {
  const e = new Env(env); if (extra) for (const k in extra) e.m.set(k, extra[k])
  const it = (function* () {
    try { let v = NO; for (const s of ast.slice(1)) v = yield* ev(s, e, true); return { value: v } }
    catch (x) { if (x instanceof Ret) return { value: x.v, ret: true }; return fail(x) }
  })()
  it.cx = newCx(L.host, [])
  return drive(it)
}
// ret 事件：env（暂停时即时求值用的帧环境）是原型上的 getter，不是自有属性，事件被整体展示 / 序列化时不会带上；用到才求，常规调用不付 envOf 的栈扫描
class RetEv {
  #fr; #cx
  constructor(fr, cx, x, f, args, v) {
    this.x = x; this.a = x ? x.a : f.t == 'fn' ? f.a : undefined; this.b = x ? x.b : f.t == 'fn' ? f.b : undefined
    this.ph = 'ret'; this.f = f; this.args = args; this.v = v; this.#fr = fr; this.#cx = cx
  }
  get env() { return this.#fr.env || envOf(this.#cx) }
}
function* call(f, args, x) {
  const cx = CX || (CX = newCx(L.host, L.host?.log))
  const fr = { f, x, a: x?.a, b: x?.b }
  if (++cx.n > MAXCALLS) { cx.n = 0; throw new LispErr(tr`超过 ${MAXCALLS} 次调用，已中止`, x) }   // 失控保护不依赖事件：ret 被 watch 门掉后仍然有效（每次驱动器恢复时清零）
  cx.stack.push(fr)
  let v
  try {
    if (f && f.t == 'fn') {
      const e = new Env(f.env), ps = f.params, rest = ps.at(-1) == '..', n = rest ? ps.length - 1 : ps.length
      for (let i = 0; i < n; i++) e.m.set(ps[i], i < args.length ? args[i] : NO)
      fr.env = e   // 断点暂停时在这一帧里求值
      if (rest) { const r = args.slice(n); e.m.set('..', r); e.m.set('xargs', Object.assign(() => r, { bname: 'xargs' })) }   // .. 参数收集多出来的实参；(xargs) 返回它们
      v = yield* body(f.body, e, f, L.host?.last)
    } else if (typeof f == 'function') {
      if (f.lisp) return yield* call(f.lisp, args, x)                      // 交给过 JS 的回调又回到 Lisp：还原
      if (f.gen) v = yield* (f.ctx ? f({ cx, a: fr.a, b: fr.b, node: x, args: isT(x) ? x.slice(2) : [] }, ...args) : f(...args))
      else if (f.bname) { try { v = f(...args) } catch (e) { if ((e instanceof TypeError || e instanceof RangeError) && !e.x) e.x = x; throw e } }   // 内建的参数错误也指到调用处
      else {                                                               // 外部 JS 函数：参数转 JS、异常归到调用节点
        try { v = f(...args.map(toJS)) } catch (e) { if (e instanceof Ret || e instanceof LispErr) throw e; throw new LispErr(e?.message ?? String(e), x) }
        v = fromJS(v)
      }
      if (thenable(v)) {                                                   // 自动 await：驱动器回送 {v} / {err}；同步驱动器不回送，原样返回 Promise
        const s = yield { x, a: x?.a, b: x?.b, ph: 'await', p: v }
        if (s) { if (s.err !== undefined) throw new LispErr(s.err?.message ?? String(s.err), x); v = fromJS(s.v) }
      }
    }
    else throw new LispErr(tr`${show(f, 1)} 不可调用`, x)
    if (cx.hooks && cx.hooks.ext) cx.hooks.ext({ cx, f, x, a: fr.a, b: fr.b, args, v })   // pick 模式：默认 null，运行时只剩一次属性读
    if (!cx.watch || cx.watch.rets) {                                     // 宿主声明没人要 ret 事件时整个 yield 省掉
      const s = yield new RetEv(fr, cx, x, f, args, v)                    // 暂停的 Promise 可以兑现成 { v }：替换这次调用的返回值
      if (s && typeof s == 'object' && 'v' in s) v = s.v
    }
    return v
  } catch (e) { if (e instanceof RangeError && !e.x) e.x = x; throw e }   // JS 栈溢出：指到最深的那次调用（外层 call 接力补上）
  finally { cx.stack.pop() }
}
// 函数体/程序：单语句直接取值；多语句必须用 OK 返回（last：像 Calc 那样取最后一句的值）
function* body(items, env, at, last) {
  try {
    if (items.length == 1) return yield* ev(items[0], env, true)
    let v = NO
    for (const y of items) v = yield* ev(y, env, true)
    if (last) return v
  } catch (e) { if (e instanceof Ret) return e.v; throw e }
  if (items.length) warn(tr`多语句缺少 OK 返回`, at)
  return NO
}

/* ---- 驱动 ----
   一次执行 = 一个 cx：{ run, log, stack, hooks }。CX 是“当前同步段”的 cx，只在 it.next() 周围设置/恢复，
   所以嵌套入口（JS 回调再进 Lisp）各用各的栈，外层挂起时的栈不受影响；异步挂起后 JS 栈没了，栈还在。 */
const MAXCALLS = 1e6
const newCx = (h, log) => ({ run: h?.run ?? null, log: log ?? h?.log ?? [], stack: [], hooks: h?.hooks ?? null, watch: h?.watch ?? null, n: 0 })
let CX = null
const atOf = () => CX && CX.stack.length ? CX.stack[CX.stack.length - 1] : null
const sync = (it, f) => { const p = CX; CX = it.cx; try { return f() } finally { CX = p } }
const step = (it, send) => sync(it, () => it.next(send))
const warn = (m, n) => (CX?.log || L.host?.log)?.push({ warn: m, n })
// w@：打印一行并带上调用点；args 是实参的 AST 节点（各带 a/b），spans 供 P2 的逐参部件
const wAt = ctxGen(function* (c, ...a) {
  c.cx.log.push({ out: a.map(x => show(x)).join(' '), a: c.a, b: c.b, spans: c.args.map(v => (isT(v) || v instanceof Lit) && v.a >= 0 ? [v.a, v.b] : null), run: c.cx.run })
  return a.at(-1) ?? NO
})
const globals = cx => { const e = new Env(null); e.cx = cx; e.m.set('w@', Object.assign(wAt, { bname: 'w@' })); return e }
const isDef = s => isT(s) && (s[0] == '=' || s[0] == '->')
// 逐步执行：迭代器产出上述事件；结束时 done.value = {value} | {err, a, b}（a/b 是出错处的源码跨度），均带 log。
// prog 是根 ["..", 语句...]；ast 不是根时（独立求值）先执行顶层定义再单独求值 ast。cx 挂在迭代器 it.cx 上。
function steps(ast, prog = ast, last = false, log = [], cx = newCx(L.host, log)) {
  const it = st(ast, prog, last, cx)
  it.cx = cx
  return it
}
function* st(ast, prog, last, cx) {
  try {
    const env = globals(cx), stmts = prog.slice(1); cx.env = env
    if (ast === prog) return { value: yield* body(stmts, env, prog, last), log: cx.log }
    for (const s of stmts) if (isDef(s) && s !== ast) try { yield* ev(s, env, true) } catch (e) { if (!(e instanceof LispErr)) throw e }
    return { value: yield* ev(ast, env, stmts.includes(ast)), log: cx.log }
  }
  catch (e) { return { ...fail(e), log: cx.log } }
}
const drive = (it, max = 300000) => {
  let r, n = 0
  if (!it.cx) it.cx = newCx(L.host)
  for (;;) {
    r = step(it)
    if (r.done) break
    if (++n > max) { try { sync(it, () => it.return()) } catch { } return { err: tr`超过 ${max} 步，已中止`, log: it.cx.log } }
  }
  return { ...r.value, steps: n }
}
const run = prog => drive(steps(prog))
const node = (ast, prog) => drive(steps(ast, prog))
const fail = e => {
  if (e instanceof Ret) return { value: e.v }
  if (e instanceof RangeError && /call stack/i.test(e.message)) return { err: tr`递归过深（调用栈溢出）`, a: e.x?.a, b: e.x?.b }
  if (e instanceof LispErr || e instanceof RangeError || e instanceof TypeError) return { err: e.message, a: e.x?.a, b: e.x?.b }
  throw e
}

/* ---- 脱离调试器独立运行（p5.html 等宿主）----
   L.host = { has(名), get(名), last?, log?, error?(res), pause?(事件)→Promise, alive?()→bool }：
     has/get 名字回退（JS 全局、p5 实例…，见 hostOf）；last 为真时函数体取最后一句的值，不要求 OK；
     pause 在每个事件上被问一次，返回 Promise 就挂起到它兑现（断点）；alive 返回 false 即放弃执行（停止）。 */
// 驱动生成器：同步一直跑；遇到 await 事件或 pause 返回的 Promise 才转异步。返回结果对象或 Promise<结果对象>
const exec = (it, h = L.host, max = 3e6) => {
  if (!it.cx) it.cx = newCx(h, h?.log)                 // callback/runFn 这类入口：新栈，共享 run/log
  const close = () => { try { sync(it, () => it.return()) } catch { } }
  const go = send => {
    for (let n = 0; ; n++) {
      if (h?.alive && !h.alive()) { close(); return { cancelled: true } }
      it.cx.n = 0
      const r = step(it, send); send = undefined
      if (r.done) return r.value
      const e = r.value, w = e.ph == 'await' ? e.p.then(v => ({ v }), err => ({ err })) : h?.pause?.(e)
      if (w) return w.then(go)
      if (n > max) { close(); return { err: tr`超过 ${max} 步，已中止` } }
    }
  }
  return go()
}
function* runFn(f, args) { try { return { value: yield* call(f, args) } } catch (e) { return fail(e) } }
// 以 Lisp 函数为入口运行：返回值（或 Promise<值>，函数里 await 过时）；出错交给 h.error(res, tag)，值为 undefined。
// h 默认当前宿主；交给 JS 的回调固定用创建时的宿主（停止/重跑后旧回调随旧宿主作废）
// 交给 JS 的回调：新栈、沿用函数定义时那次执行的 log（所以异步打印仍落在同一个控制台里）
const rootLog = f => { for (let e = f?.env; e; e = e.p) if (e.cx) return e.cx.log }
const callback = (f, args = [], h = L.host, tag) => {
  const fin = r => r.err !== undefined ? (h?.error?.(r, tag), undefined) : r.cancelled ? undefined : toJS(r.value)
  const it = runFn(f, args); it.cx = newCx(h, rootLog(f))
  const r = exec(it, h)
  return r instanceof Promise ? r.then(fin) : fin(r)
}
// 以顶层程序为入口运行（语句 = setup）：返回结果对象或 Promise<结果对象>；log 是任何有 push 的接收器（实时输出）
const start = (prog, log = []) => exec(steps(prog, prog, true, log), L.host)
// 宿主 = 若干层名字表（先到先得，层可以是返回对象的函数）：has/get；JS 函数绑定到所属对象，Lisp 内建（带 bname）原样
const hostOf = (...layers) => {
  const own = n => { for (const l of layers) { const o = typeof l == 'function' ? l() : l; if (o != null && n in Object(o)) return Object(o) } }
  return { has: n => !!own(n), get: n => { const o = own(n); return bindTo(o[n], o) } }
}
const fns = new Set([...Object.keys(B), 'w@', 'xargs'])
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
  name: 'Lisp', rules: RULES, input: `# 语句位置的 [..] 是调用；x..(f a) 是管道：(f x a)；o.k 取键，o.[k a] 即 [o.k a]（对象的方法调用，不是管道）
[- big (=> (xs n) xs..(mapNotNO (=> (x) (> x > n)? x Or NO)))]
def fact(n) (> n <= 1)? 1 Or (> n * (fact (> n - 1)))
[- inc1 (=> (a) [len a]..[+ 1])]
(- user {name "parviz" langs ["js" "lisp"]})
(- older user..[-> "age" 40])
# 可选参数：参数表末尾的 .. 收集多出来的实参，[xargs {…}] 按序命名它们（名字以 _ 结尾），(xargs) 是收集到的数组；模板字符串可多行
def greet(who ..):
  [xargs {title_ "Dr." n_ 1}]
  (OK \`\${title_} \${who} ×\${n_}，另有 \${(len (xargs))} 个\`)
...
(w@ "fact 5 =" (fact 5) "big:" [3 14 15 9 26]..(big 10) user.name older.age (inc1 [1 2 3]))
(w@ (greet "ann") (greet "bo" "Prof." 2))
# ?.{ } 即 (As 值 (=> (u) …))：数组逐项处理并丢掉 NO，假值原样，否则 (f 值)；(f).{ } 把回调追加成最后一个实参
(w@ [1 2 3]?.{ (> u * 2) } user.nope?.{ (> u + 1) } older.age?.{ (> u + 1) } (map [1 2 3]).{ (> u * u) })
def poly(x y):
  [-> t (> 2x + 3y > 7)]
  (OK (both t (> x != y)))
...
(w@ (poly 2 3) (poly 0 1))
(OK [123]..(mapNotNO (=>(x) (> x > 10)? x Or NO ))..[at 0] )`,
}, {
  name: 'Lisp（作用域/错误）', rules: null, same: 'Lisp', input: `[- k 10]
[- add (=> (a b) [- s (+ a b)] (OK s..[+ k]))]
def twice(f x) (f (f x))
def opt(a ..): [xargs {b 1}] (OK a) ...   # 可选参数名必须以 _ 结尾
[- c 1]
[-> c 2]
(w@ (twice (=> (y) (add y 1)) 5) undefinedName)
(OK {sum (add 1 2) xs [1 2 (3 ] ok "fine"})`,
})

const L = { NO, Ret, LispErr, B, Walk, Env, ev, call, gen, ctxGen, steps, step, newCx, atOf, run, node, show, fname, truthy, toJS, fromJS, exec, callback, start, hostOf, pool, Lit, evalIn, envOf, host: null, RULES, CALC, CHAIN, funcs,
  get cx() { return CX },   // 当前同步段（p5 的 console 拦截器用它取调用点）
}
if (typeof module != 'undefined') module.exports = L
G.LISP = L
})(typeof globalThis != 'undefined' ? globalThis : window)
