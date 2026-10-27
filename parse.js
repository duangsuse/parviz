/* parse.js — 递归下降组合子核心：feed/eat/sloc、组合子、错误恢复、作用域接口、元语言编译器。
   与 DOM 无关：浏览器下挂到 window.P，node 下 module.exports。 */
(function (G) {
'use strict'
const FAIL = Symbol('FAIL'), EOF = Symbol('EOF')

/* ---------- CST 节点 ----------
   k: tok|kw|lit|seq|alt|join|many|opt|par|rule|err|top
   a,b: 源码区间；v: 后处理后的值；r: 规则名；alt: 规则体有序选择所选分支；c: 颜色 B/Y/G/R/P；err: 报错信息
   作用域接口：free=[{name,node}] 未绑定引用，defs=[{name,node,kind}] 定义，自底向上汇总；
   node.def 指向绑定到的定义节点（Ctrl+点击跳转用）。
   多态显示：:func 可设 node.view = {tag, kids:[Node|view]}，树视图按它显示为 [tag ..]（如 Lisp 的 [= big [=> ..]]）。 */
class Node {
  constructor(k, a, b, kids = []) {
    this.k = k; this.a = a; this.b = b; this.kids = kids
    for (const c of kids) {
      if (c.free) (this.free ||= []).push(...c.free)
      if (c.defs) (this.defs ||= []).push(...c.defs)
    }
  }
}
const walk = (n, f, up = null) => { if (f(n, up) === false) return; for (const c of n.kids) walk(c, f, n) }

/* ---------- 输入流 ----------
   ss(n): n>0 偷看 n 个字符，n<0 吃掉 -n 个字符（与参考代码风格一致）。 */
const feed = (src, file = 'feed$A', i = 0) => {
  const ss = n => { const q = n < 0, r = ss.src.slice(ss.i, ss.i + (q ? -n : n)); if (q) ss.i -= n; return r }
  Object.assign(ss, {
    src, file, i, skip: undefined, st: null, far: -1, exp: new Set, stack: [], recur: [], closers: [],
    sync: null, spec: 0, mute: 0, trace: null, vmap: new WeakMap, pairs: [], builtins: new Set, alts: [], lastAlt: -1,
    marks: [],  // 标记：Node | 偏移 | [a,b]；UI 将第 k 个显示为 $(5+k)
    comp: new Map,  // 补齐：位置 → Set(候选词)，由关键字集合登记
    onedit(o, n) {},
  })
  ss.also = f => (f(ss), ss)
  ss.lc = p => { let l = 1, c = 0; for (let j = 0; j < p && j < ss.src.length; j++) ss.src[j] == '\n' ? (l++, c = 0) : c++; return [l, c] }
  ss.nodeOf = x => x instanceof Node ? x : x && typeof x == 'object' ? ss.vmap.get(x) : undefined
  ss.pos = x => typeof x == 'number' ? x : ss.nodeOf(x)?.a
  ss.sloc = x => { const p = ss.pos(x); if (p == null) return null; const [l, c] = ss.lc(p); return `./${ss.file}:${l}:${c}` }
  return ss
}
const sticky = rx => rx && new RegExp(rx.source, rx.flags.replace(/[gy]/g, '') + 'y')
const ws = ss => { const k = ss.skip; if (!k || ss.st) return; k.lastIndex = ss.i; const m = k.exec(ss.src); if (m) ss.i += m[0].length }
const wpos = ss => { const i = ss.i; ws(ss); const r = ss.i; ss.i = i; return r }

/* ---------- 跟踪（步进可视化用） ---------- */
const tr = (ss, t, label, a, b, n, ok) => {
  if (!ss.trace || ss.mute || ss.trace.length > 80000) return
  ss.trace.push({ t, label, a, b, n, ok, ch: ss.spec > 0, st: ss.stack.slice(), al: ss.alts.at(-1) })
}
const ruleTop = ss => { for (let j = ss.stack.length - 1; j >= 0; j--) if (!ss.stack[j].tok) return ss.stack[j].label }
const fail = (ss, a, label, k) => {
  if (ss.mute) return
  if (a > ss.far) { ss.far = a; ss.exp = new Set }
  if (a == ss.far) ss.exp.add(k == 'tok' ? ruleTop(ss) || label : label)
}
/* ---------- 报错文本与国际化 ----------
   f`…${x}…`：常量段拼成键 "…{0}…{1}"，查外部 JSON 词典（i18n/<lang>.json → P.f.dict）翻译后再填入插值，缺键用原文。
   P.f.seen 收集用到过的键，便于补全词典。 */
const f = (strs, ...xs) => {
  let key = strs[0]; for (let i = 1; i < strs.length; i++) key += `{${i - 1}}` + strs[i]
  f.seen.add(key)
  return (f.dict[key] ?? key).replace(/\{(\d+)\}/g, (_, i) => xs[i])
}
f.dict = {}; f.seen = new Set
const or = xs => xs.join(f` 或 `)
const quote = s => JSON.stringify(s.length > 24 ? s.slice(0, 24) + '…' : s)
const exps = (ss, a) => ss.far >= a ? [...ss.exp] : []   // 最远失败处的期望；只举前两项
const msgMissing = (ss, a) => { const e = exps(ss, a); return e.length ? f`缺少一项，比如 ${or(e.slice(0, 2))}` : f`缺少一项` }
const msgUnknown = (ss, a, b) => {
  const got = quote(ss.src.slice(a, b)), e = exps(ss, a)
  return e.length == 1 ? f`其中有 ${e[0]} ——不是 ${got}` : e.length ? f`什么是 ${got} ？这里支持 ${or(e.slice(0, 2))}` : f`什么是 ${got} ？`
}
const errNode = (ss, a, b, msg) => { const n = new Node('err', a, b); n.err = msg; n.v = FAIL; ss.far = -1; ss.exp = new Set; return n }

/* ---------- 词法组合子 ---------- */
const tok = (k, label, rx, match, val) => {
  const p = ss => {
    ws(ss); const a = ss.i
    if (!ss.mute) { ss.stack.push({ label, a, tok: 1 }); tr(ss, 'in', label, a, a) }
    const m = match(ss.src, a)
    if (m == null) { fail(ss, a, label, k); if (!ss.mute) { ss.stack.pop(); tr(ss, 'out', label, a, a, null, false) } return null }
    ss.i = a + m.length
    const n = new Node(k, a, ss.i); n.text = m; n.v = val(m); n.rx = rx
    if (!ss.mute) { ss.stack.pop(); tr(ss, 'out', label, a, ss.i, n, true) }
    return n
  }
  p.label = label; p.k = k; p.kind = k; p.src = rx; return p
}
const re = (rx, f) => {
  const y = sticky(rx)
  return tok('tok', '/' + rx.source + '/', y, (s, a) => { y.lastIndex = a; const m = y.exec(s); return m ? m[0] : null }, f || (m => m))
}
const W = /\w/
const lit = (s, k = 'lit', v = s) => tok(k, k == 'kw' ? s : JSON.stringify(s), s,
  (src, a) => src.startsWith(s, a) && !(W.test(s.at(-1)) && W.test(src[a + s.length] || '')) ? s : null, () => v)
const KW = { null: null, true: true, false: false }
const kw = w => lit(w, 'kw', w in KW ? KW[w] : w)
// 解析器元数据：kind/parts 供“编译结果”视图展示组合子结构
const meta = (p, kind, parts, x) => Object.assign(p, { kind, parts }, x)

/* ---------- 结构组合子 ---------- */
const mk = (k, ss, a0, kids, v) => {
  const n = new Node(k, kids.length ? kids[0].a : a0, kids.length ? kids.at(-1).b : a0, kids)
  n.v = v; if (v && typeof v == 'object') ss.vmap.set(v, n); return n
}
const vals = kids => { const r = []; for (const c of kids) if (c.k != 'lit' && c.k != 'err' && !c.sep) r.push(c.v); return r }
const seq = (...ps) => {
  if (ps.length == 1) return ps[0]
  const p = ss => {
    const a0 = ss.i, kids = []; ss.sync = null
    for (const q of ps) { const n = q(ss); if (!n) { ss.i = a0; return null } kids.push(n) }
    const v = vals(kids); return mk('seq', ss, a0, kids, v.length == 1 ? v[0] : v.length ? v : undefined)
  }
  p.label = '(' + ps.map(q => q.label).join(' ') + ')'; return meta(p, 'seq', ps)
}
const alt = (...ps) => {
  if (ps.length == 1) return ps[0]
  const p = ss => {
    const a0 = ss.i, sy = ss.sync, L = ps.length, xs = ps.map(q => q.label)
    for (let j = 0; j < L; j++) {
      if (j) tr(ss, 'alt', ps[j].label, wpos(ss), 0, null, true)
      ss.sync = sy; if (j < L - 1) ss.spec++
      ss.alts.push({ xs, j })
      const n = ps[j](ss); if (j < L - 1) ss.spec--
      ss.alts.pop()
      if (n) { ss.lastAlt = j; return n }
      ss.i = a0
    }
    return null
  }
  p.label = ps.map(q => q.label).join('|'); return meta(p, 'alt', ps, { alts: true })
}
const opt = p => {
  const q = ss => { const a0 = ss.i; ss.spec++; const n = p(ss); ss.spec--; if (n) return n; ss.i = a0; return mk('opt', ss, a0, [], undefined) }
  q.label = p.label + '?'; return meta(q, 'opt', [p])
}
// (pub priv pro override -) 关键字集合：按最长优先匹配其一；含 "-" 时可以什么都不吃。
// 每次尝试都在 ss.comp 登记该位置的补齐候选，供 UI 的代码补齐使用
const kwset = (words, empty) => {
  const ps = words.slice().sort((a, b) => b.length - a.length).map(w => kw(w))
  const p = ss => {
    const a0 = ss.i, a = wpos(ss)
    if (!ss.mute) { let s = ss.comp.get(a); if (!s) ss.comp.set(a, s = new Set); for (const w of words) s.add(w) }
    for (const q of ps) { const n = q(ss); if (n) return n }
    ss.i = a0; return empty ? mk('opt', ss, a0, [], undefined) : null
  }
  p.label = '(' + words.join(' ') + (empty ? ' -' : '') + ')'; return meta(p, 'kwset', ps, { words, empty })
}
// (X (- "+" "-"; "*" "/" -))：TDOP 风格的算符表，修饰前一项 X（操作数）。";" 分级，越往后结合越紧；全部左结合（不支持右结合）。
// 每次结合产生一个 bin 节点 kids=[左, 算符, 右]，值为 [算符, 左值, 右值]；缺右项时退回到算符之前，留给外层报错
const prec = (x, levels) => {
  const ops = levels.flatMap((L, l) => L.map(o => [o, l])).sort((p, q) => q[0].label.length - p[0].label.length)
  const climb = (ss, min) => {
    let l = x(ss); if (!l) return null
    for (;;) {
      const at = ss.i; let o = null, lv = -1
      for (const [q, k] of ops) if (k >= min && (o = q(ss))) { lv = k; break }
      if (!o) { ss.i = at; return l }
      const r = climb(ss, lv + 1); if (!r) { ss.i = at; return l }
      l = mk('bin', ss, l.a, [l, o, r], [o.text, l.v, r.v])
    }
  }
  const p = ss => climb(ss, 0)
  p.label = `(${x.label} (- ${levels.map(L => L.map(o => o.label).join(' ')).join('; ')} -))`
  return meta(p, 'prec', [x, ...ops.map(o => o[0])], { levels })
}
const peek = (ss, p) => { const i = ss.i; ss.mute++; const n = p(ss); ss.mute--; ss.i = i; return !!n }
const atEOF = ss => wpos(ss) >= ss.src.length
const atStop = (ss, sy) => atEOF(ss) || (sy != EOF && peek(ss, sy)) || ss.closers.some(c => peek(ss, c))
const STR = /"(?:\\.|[^"\\\n])*"/y
// 从当前位置向右扫描到 stops 之一（按配对深度 0 计），返回 {i, which}；which=-1 外层闭合符，-2 EOF
const skipTo = (ss, ...stops) => {
  const s = ss.src, P = ss.pairs, i0 = ss.i, st = ss.st; let i = i0, d = 0
  stops = stops.filter(x => x && x != EOF); ss.st = 1
  try {
    while (i < s.length) {
      if (d == 0) {
        ss.i = i
        for (let j = 0; j < stops.length; j++) if (peek(ss, stops[j])) return { i, which: j }
        for (const c of ss.closers) if (peek(ss, c)) return { i, which: -1 }
      }
      if (P.length && s[i] == '"') { STR.lastIndex = i; if (STR.exec(s)) { i = STR.lastIndex; continue } }
      const o = P.find(p => s.startsWith(p[0], i)); if (o) { d++; i += o[0].length; continue }
      const c = P.find(p => s.startsWith(p[1], i)); if (c) { if (d) d--; i += c[1].length; continue }  // 非活动闭合符：当垃圾跳过
      i++
    }
    return { i: s.length, which: -2 }
  } finally { ss.st = st; ss.i = i0 }
}
const recover = (ss, sep, sy) => {
  ws(ss); const a = ss.i, r = skipTo(ss, sep, sy)
  const e = errNode(ss, a, r.i, a == r.i ? msgMissing(ss, a) : msgUnknown(ss, a, r.i))
  ss.i = r.i; return { e, sep: r.which == 0 }
}
const chunkErr = ss => {
  ws(ss); const s = ss.src, P = ss.pairs, a = ss.i; let i = a + 1
  const o = P.find(p => s.startsWith(p[0], a))
  if (o) { let d = 0; i = a; while (i < s.length) { if (P.some(p => s.startsWith(p[0], i))) d++; else if (P.some(p => s.startsWith(p[1], i)) && --d == 0) { i++; break } i++ } }
  else while (i < s.length && !/\s/.test(s[i]) && !P.some(([x, y]) => s.startsWith(x, i) || s.startsWith(y, i))) i++
  ss.i = i; return errNode(ss, a, i, msgUnknown(ss, a, i))
}
// (p *)：0~N 次；若是 :par 内层/顶层，出错时跳过一块继续读
const many = p => {
  const q = ss => {
    const sy = ss.sync, a0 = ss.i, kids = []; ss.sync = null
    for (;;) {
      const at = ss.i, n = p(ss)
      if (n) { if (n.b == n.a && ss.i == at) break; kids.push(n); if (ss.i == at) break; continue }
      ss.i = at
      if (!sy || atStop(ss, sy)) break
      kids.push(chunkErr(ss))
    }
    return mk('many', ss, a0, kids, vals(kids))
  }
  q.label = '(' + p.label + ' *)'; return meta(q, 'many', [p])
}
// (p sep +)：0~N 个以 sep 连接；出错时落到最近的分隔符或外层闭合符
const join = (p, sep) => {
  const q = ss => {
    const sy = ss.sync, a0 = ss.i, kids = []; ss.sync = null
    const takeSep = () => { const s = sep(ss); s.sep = 1; kids.push(s) }
    for (;;) {
      const at = ss.i, n = p(ss)
      if (n) {
        kids.push(n)
        const b = ss.i, s = sep(ss)
        if (s) { s.sep = 1; kids.push(s); continue }
        ss.i = b
        if (!sy || atStop(ss, sy)) break
        const r = recover(ss, sep, sy); kids.push(r.e); if (r.sep) { takeSep(); continue } break
      }
      ss.i = at
      if (!sy) { if (kids.length) { kids.pop(); ss.i = kids.length ? kids.at(-1).b : a0 } break }
      if (!kids.length && atStop(ss, sy)) break
      const r = recover(ss, sep, sy); kids.push(r.e); if (r.sep) { takeSep(); continue } break
    }
    return mk('join', ss, a0, kids, vals(kids))
  }
  q.label = '(' + p.label + ' ' + sep.label + ' +)'; return meta(q, 'join', [p, sep])
}
// (open ... close :par)：配对；内层出错时扫描到本闭合符继续，找不到则报未闭合
const par = (open, inner, close) => {
  const p = ss => {
    const o = open(ss); if (!o) return null
    const kids = [o]; ss.closers.push(close); ss.sync = close
    const n = inner ? inner(ss) : null; ss.sync = null
    if (n) kids.push(n)
    let c = close(ss)
    if (!c) {
      ws(ss); const a = ss.i, r = skipTo(ss, close)
      if (r.which == 0) { kids.push(errNode(ss, a, r.i, msgUnknown(ss, a, r.i))); ss.i = r.i; c = close(ss) }
      else { kids.push(errNode(ss, a, a, f`需要闭合 ${close.label}`)); o.err = f`这有个 ${o.text} 需要闭合 ${close.label}` }
    }
    ss.closers.pop()
    if (c) kids.push(c)
    const N = mk('par', ss, o.a, kids, n ? n.v : undefined)
    N.pair = [o.a, o.b, c ? c.a : -1, c ? c.b : -1]; N.inner = n; return N
  }
  p.label = open.label + '…' + close.label; return meta(p, 'par', [open, inner, close])
}
// :func 后处理；返回 FAIL 则视为匹配失败
const fn = (p, f, name) => {
  const q = ss => {
    const a0 = ss.i, n = p(ss); if (!n) return null
    const v = f(n.v, n, ss)
    if (v === FAIL) { ss.i = a0; fail(ss, n.a, name, 'fn'); return null }
    n.v = v; if (v && typeof v == 'object') ss.vmap.set(v, n); return n
  }
  q.label = p.label; return meta(q, 'fn', [p], { fname: name, alts: p.alts })
}
// 具名规则：形成 CST 层级与调用栈帧；规则体是有序选择时记下选中的分支 N.alt（显示为 Val.A、Val.B…）
const rule = (name, get) => {
  const p = ss => {
    const a0 = ss.i, body = get()
    if (!ss.mute) { const a = wpos(ss); ss.stack.push({ label: name, a }); tr(ss, 'in', name, a, a) }
    const n = body(ss)
    if (!ss.mute) ss.stack.pop()
    if (!n) { ss.i = a0; tr(ss, 'out', name, a0, a0, null, false); return null }
    const N = new Node('rule', n.a, n.b, [n]); N.r = name; N.v = n.v
    if (body.alts) N.alt = ss.lastAlt
    if (N.v && typeof N.v == 'object') ss.vmap.set(N.v, N)
    tr(ss, 'out', name, N.a, N.b, N, true); return N
  }
  p.label = name; return meta(p, 'rule', [], { body: get })
}
// (… :setRecur) 指定递归起点；Recur 动态引用最近的 :setRecur（支持链式嵌套）
const mark = p => { const q = ss => { ss.recur.push(q); try { return p(ss) } finally { ss.recur.pop() } }; q.label = p.label; return meta(q, 'mark', [p], { alts: p.alts }) }
const recur = () => {
  const p = ss => { const q = ss.recur.at(-1); if (!q) throw new Error(f`Recur 不在 :setRecur 范围内`); return q(ss) }
  p.label = 'Recur'; return meta(p, 'recur', [])
}
const to = x => typeof x == 'function' ? x : x instanceof RegExp ? re(x) : typeof x == 'string' ? lit(x)
  : Array.isArray(x) ? (x[0] instanceof RegExp ? re(x[0], x[1]) : fn(to(x[0]), x[1], 'fn')) : null

/* ---------- eat：驱动解析，生成 ss.tree / ss.errs / ss.value ---------- */
const errsOf = root => { const r = []; walk(root, n => { if (n.err) r.push({ a: n.a, b: n.b, msg: n.err, node: n }) }); return r.sort((x, y) => x.a - y.a) }
const eat = (p, ss) => {
  let g = null
  if (p && p.start) { g = p; p = g.start } else p = to(p)
  if (ss.skip === undefined) ss.skip = g ? g.skip : /\s+/
  ss.skip = sticky(ss.skip); ss.pairs = g ? g.pairs : []; ss.g = g; if (g) ss.builtins = g.builtins
  Object.assign(ss, { far: -1, exp: new Set, stack: [], recur: [], closers: [], sync: EOF, spec: 0, alts: [] })
  let n = null, crash = null
  try { n = p(ss) } catch (e) { if (!(e instanceof RangeError) && !/Recur/.test(e.message)) throw e; crash = e }
  const kids = n ? [n] : [], L = ss.src.length
  ss.sync = null
  if (crash) kids.push(errNode(ss, ss.i, L, crash instanceof RangeError ? f`递归过深（左递归？）` : crash.message))
  else if (!n) { const a = Math.max(ss.far, 0), e = exps(ss, a); kids.push(errNode(ss, a, L, e.length ? f`无法解析，这里支持 ${or(e.slice(0, 2))}` : f`无法解析`)) }
  else { ws(ss); if (ss.i < L) { const a = ss.i; kids.push(errNode(ss, a, L, f`后面多出了 ${quote(ss.src.slice(a, L))}`)) } }
  const root = new Node('top', 0, L, kids); root.v = n ? n.v : undefined
  ss.tree = root; ss.errs = errsOf(root); ss.value = root.v
  return root.v
}

/* ---------- 标签式 AST：[tag, ...kids] ----------
   一切结构都是“多态调用”：[fact 5] 即 ["()", ["", "fact"], 5]；"=" "=>" ".." "?" 也只是 tag，由 walker 按 tag 分派。
   数组上隐藏 node（CST 节点）与 ns（每个 kid 对应的 CST 节点，原始值 kid 显示用）。 */
const isT = k => Array.isArray(k) && typeof k[0] == 'string' && !!k.node
const T = (tag, kids, n, ns = [], view = true) => {
  const a = [tag, ...kids]
  Object.defineProperty(a, 'node', { value: n }); Object.defineProperty(a, 'ns', { value: ns })
  if (view) n.view = viewOf(a)
  return a
}
// 产生某节点值的各组成部分对应的 CST 节点（与 vals() 一一对应）
const parts = n => {
  if (!n) return []
  switch (n.k) {
    case 'par': return parts(n.inner)
    case 'rule': return parts(n.kids[0])
    case 'seq': case 'many': case 'join': return n.kids.filter(k => k.k != 'lit' && k.k != 'err' && !k.sep)
    case 'opt': return n.kids.length ? parts(n.kids[0]) : []
    default: return [n]
  }
}
const leaves = n => { const r = []; if (n) walk(n, x => { if (!x.kids.length && x.k == 'tok') r.push(x) }); return r }
// 树视图：把标签式 AST 显示成调用 [f a b]；名字调用以名字作 tag，"." 链显示为脱糖后的调用
// 原始值 kid 的 CST 节点可能套着 Chain/Exp 等规则与空的 (Dot *)：下钻到唯一非空的子节点
const core = n => { for (;;) { const ks = n.kids.filter(k => k.k != 'lit' && (k.b > k.a || k.err)); if (ks.length != 1 || n.k == 'err') return n; n = ks[0] } }
const kidOf = (k, nd, a) => isT(k) ? (k.node === a.node || k[0] == '.' ? viewOf(k) : k.node) : nd && core(nd)
function viewOf(a) {
  const [tag, ...ks] = a, ns = a.ns, from = (b, i0 = 0) => ks.slice(i0).map((k, i) => kidOf(k, ns[i + i0], b)).filter(Boolean)
  if (tag == '()' || tag == '[]') {
    const c = ks[0]
    return isT(c) && c[0] == '' ? { tag: c[1], h: c.node, kids: from(a, 1), node: a.node, x: a } : { tag: tag == '[]' ? '..' : '()', kids: from(a), node: a.node, x: a }
  }
  if (tag == '.') {
    const [b, c] = ks, bk = kidOf(b, ns[0], a)
    if (isT(c) && (c[0] == '()' || c[0] == '[]') && isT(c[1]) && c[1][0] == '')
      return { tag: c[1][1], h: c[1].node, kids: [bk, ...c.slice(2).map((k, i) => kidOf(k, c.ns[i + 1], c)).filter(Boolean)], node: c.node, x: a }
    return { tag: '.', kids: [bk, kidOf(c, ns[1], a)].filter(Boolean), node: a.node, x: a }
  }
  return { tag, kids: from(a), node: a.node, x: a }
}

/* ---------- Lexscope 工具包：词法作用域在组合层完成 ----------
   引用产生 free=[{name,node}]，定义产生 defs=[{name,node,kind}]，二者随 CST 自底向上汇总；
   bind 在某个节点处用 defs 消解 free（node.def 指向定义，参数紫色、函数绿色）。
   语法里用 :ref :def :param :scope :arg2nth :fn :let :defn :global 组合出任何“定义/lambda”语法：
   (=> (a b) e)、[= f (=> (a b) e)]、def f(a b) e 得到完全相同的 AST 与作用域。 */
const bind = (n, defs) => {
  if (!n.free || !defs || !defs.length) return
  const m = new Map(defs.map(d => [d.name, d]))
  n.free = n.free.filter(r => {
    const d = m.get(r.name); if (!d) return true
    if (r.node !== d.node) { r.node.def = d.node; if (d.kind == 'param') r.node.c = 'P'; else if (d.kind == 'fn' || d.kind == 'rule') r.node.c = 'G' }
    return false
  })
}
const nameOf = (v, n, ss) => typeof v == 'string' ? v : ss.src.slice(n.a, n.b)
const lexscope = {
  // 名字引用 → ["", name]
  ref: (v, n, ss) => { const name = nameOf(v, n, ss); n.free = [{ name, node: n }]; return T('', [name], n, [n], false) },
  // 单个词条定义 / 参数（元语法的规则名、规则参数用）
  def: (v, n, ss) => { n.defs = [{ name: nameOf(v, n, ss), node: n, kind: 'rule' }]; n.c = 'G'; return v },
  param: (v, n, ss) => { n.defs = [{ name: nameOf(v, n, ss), node: n, kind: 'param' }]; n.c = 'P'; return v },
  // 只绑定参数，其他定义继续向外传
  scope: (v, n) => { const ps = (n.defs || []).filter(d => d.kind == 'param'); bind(n, ps); if (n.defs) n.defs = n.defs.filter(d => d.kind != 'param'); return v },
  // 参数表：其中的词条依次成为第 0、1、… 个参数 → ["..", 名字...]
  arg2nth: (v, n) => {
    const toks = leaves(n)
    n.defs = [...(n.defs || []), ...toks.map((t, i) => (t.c = 'P', { name: t.text, node: t, kind: 'param', nth: i }))]
    return T('..', toks.map(t => t.text), n, toks, !toks.includes(n))   // 单参时 n 就是那个词条：不挂 view，免得自己套自己
  },
  // [参数表, [体...] | 单个体] → ["=>", 参数表, ...体]；在此闭合作用域（参数与体内局部定义）
  fn: (v, n) => {
    const [ps, body = []] = v, pn = parts(n), many = Array.isArray(body) && !isT(body)
    bind(n, n.defs); n.defs = null
    return T('=>', [ps, ...(many ? body : [body])], n, [pn[0], ...(many ? parts(pn[1]) : [pn[1]])])
  },
  // [名字, 值] → ["=", 名字, 值]；名字定义到外层作用域，值是 lambda 时为函数
  let: (v, n) => {
    const [name, val] = v, pn = parts(n), tk = leaves(pn[0])[0], isFn = isT(val) && val[0] == '=>'
    if (tk) { if (isFn) tk.c = 'G'; (n.defs ||= []).push({ name, node: tk, kind: isFn ? 'fn' : 'var' }) }
    return T('=', [name, val], n, pn)
  },
  // [名字, 参数表, 体] → ["=", 名字, ["=>", 参数表, 体]]，与 let + fn 等价
  defn: (v, n) => {
    const [name, ps, body] = v, pn = parts(n), tk = leaves(pn[0])[0]
    bind(n, n.defs); n.defs = null
    const lam = T('=>', [ps, body], n, [pn[1], pn[2]], false)
    if (tk) { tk.c = 'G'; n.defs = [{ name, node: tk, kind: 'fn' }] }
    return T('=', [name, lam], n, [pn[0]])
  },
  // 顶层：绑定全部定义；剩余引用查内建（@walk 提供的函数名绿色），否则报未定义
  global: (v, n, ss) => {
    bind(n, n.defs)
    for (const r of n.free || []) {
      if (ss.builtins.has(r.name)) { if (ss.g?.fnNames?.has(r.name)) r.node.c = 'G'; continue }
      r.node.err = f`未定义 ${r.name}`
    }
    return v
  },
}
const funcs = {
  num: v => Number(v), int: v => parseInt(v),
  str: v => { try { return JSON.parse(v) } catch { return v.slice(1, -1) } },
  unq: v => v.slice(1, -1).replace(/""/g, '"'),
  text: (v, n, ss) => ss.src.slice(n.a, n.b),
  obj: v => Object.fromEntries(v || []),
  table: rows => {
    rows = rows.filter((r, i) => !(i == rows.length - 1 && r.length == 1 && r[0] === ''))
    if (!rows.length) return []
    const [h, ...rs] = rows; return rs.map(r => Object.fromEntries(h.map((k, j) => [k, r[j] ?? ''])))
  },
  // :tag("()")：带参数的函数是工厂；把值包成 [tag, ...值]
  tag: tag => (v, n) => Array.isArray(v) && !isT(v) ? T(tag, v, n, parts(n)) : T(tag, v === undefined ? [] : [v], n, [n]),
  ...lexscope,
}

/* ---------- 元语言编译器 ----------
   行首（无缩进）开始一条，第一条规则就是起始规则：  Name body...  | Name(P,..) body... | @skip /re/|none | @color Name=B .. | @walk name
   body 是隐式序列；( items ops ) 分组，ops: < 有序选择  + 连接(末项为分隔符)  * 重复  ? 可选  :setRecur 递归起点  :f 后处理  :par 配对
   A|B 内联选择；"lit" 字面量；小写词为关键字；(kw1 kw2 -) 关键字集合（- 表示可不消耗，登记补齐候选）；
   X (- "+" "-"; "*" "/" -) 算符表：修饰前一项 X，按 ; 分级（越往后越紧），左结合；
   Recur 引用最近的 :setRecur；/re/ 中 ${P} 插入参数。 */
const isUpper = s => /^[A-Z]/.test(s)
function mtok(s) {
  const T = []; let i = 0, bol = true
  const WORD = /([:@]?)([A-Za-z_]\w*)/y
  const push = (t, v, a, x) => { T.push({ t, v, a, b: i, bol, ...x }); bol = false }
  while (i < s.length) {
    const ch = s[i], a = i
    if (ch == '\n') { i++; bol = true; continue }
    if (ch == ' ' || ch == '\t' || ch == '\r') { i++; bol = false; continue }
    if (ch == '#') { while (i < s.length && s[i] != '\n') i++; continue }
    if (ch == '/') {
      let j = i + 1, cls = 0
      for (; j < s.length && s[j] != '\n'; j++) {
        if (s[j] == '\\') { j++; continue }
        if (s[j] == '[') cls = 1; else if (s[j] == ']') cls = 0; else if (s[j] == '/' && !cls) break
      }
      if (s[j] != '/') { i = j; push('bad', f`未闭合的正则`, a); continue }
      i = j + 1; push('re', s.slice(a + 1, j), a); continue
    }
    if (ch == '"') {
      let j = i + 1; for (; j < s.length && s[j] != '"' && s[j] != '\n'; j++) if (s[j] == '\\') j++
      i = Math.min(j + 1, s.length); let v
      try { v = JSON.parse(s.slice(a, i)) } catch { push('bad', f`字符串非法`, a); continue }
      push('lit', v, a); continue
    }
    if ('()|,=-;'.includes(ch)) { i++; push(ch, ch, a); continue }
    if ('<+*?'.includes(ch)) { i++; push('op', ch, a); continue }
    WORD.lastIndex = i; const m = WORD.exec(s)
    if (m) { i = WORD.lastIndex; push(m[1] == ':' ? 'fn' : m[1] == '@' ? 'dir' : 'word', m[2], a, { adj: s[i] == '(' }); continue }
    i++; push('bad', ch == '~' ? f`(A ~) 已改为 (A :setRecur)` : f`非法字符 ${JSON.stringify(ch)}`, a)
  }
  return T
}
class MErr extends Error { constructor(m, t) { super(m); this.t = t } }
function mparse(S) {
  let k = 0
  const need = t => { const x = S[k]; if (!x || x.t != t) throw new MErr(f`这里需要 ${t}`, x || S.at(-1)); k++; return x }
  const atom = () => {
    const x = S[k]; if (!x) throw new MErr(f`缺少一项`, S.at(-1))
    if (x.t == '(') { k++; if (S[k]?.t == '-') return optab(x); const g = items(')'); need(')'); return g }
    k++
    if (x.t == 're') return { t: 're', v: x.v, x }
    if (x.t == 'lit') return { t: 'lit', v: x.v, x }
    if (x.t == '-') return { t: 'empty', x }
    if (x.t == 'word') {
      if (x.v == 'Recur') return { t: 'recur', x }
      if (!isUpper(x.v)) return { t: 'kw', v: x.v, x }
      const args = []
      if (x.adj) { need('('); for (;;) { args.push(atom()); if (S[k]?.t == ',') { k++; continue } break } need(')') }
      return { t: 'ref', name: x.v, args, x }
    }
    throw new MErr(x.t == 'bad' ? x.v : f`意外的 ${x.v}`, x)
  }
  // (- "+" "-"; "*" "/" -)：已吃掉 "("；字面量或关键字按 ";" 分级
  const optab = x => {
    k++; const levels = [[]]
    for (;;) {
      const y = S[k]; if (!y) throw new MErr(f`算符表缺少结尾 -)`, x)
      k++
      if (y.t == '-') { need(')'); break }
      if (y.t == ';') levels.push([])
      else if (y.t == 'lit') levels.at(-1).push({ t: 'lit', v: y.v, x: y })
      else if (y.t == 'word' && !isUpper(y.v)) levels.at(-1).push({ t: 'kw', v: y.v, x: y })
      else throw new MErr(f`算符表里只能写字面量、关键字与 ;`, y)
    }
    if (levels.some(L => !L.length)) throw new MErr(f`算符表有空的一级`, x)
    return { t: 'optab', levels, x }
  }
  const items = stop => {
    const its = [], ops = []
    while (k < S.length && S[k].t != stop) {
      const x = S[k]
      if (x.t == 'op' || x.t == 'fn') {
        ops.push(x); k++
        if (x.t == 'fn' && x.adj) { x.args = []; need('('); while (S[k] && S[k].t != ')') { const y = S[k++]; if (y.t == 'lit') x.args.push(y.v); else if (y.t != ',') throw new MErr(f`:f(…) 参数须为字面量`, y) } need(')') }
        continue
      }
      let a = atom()
      if (S[k]?.t == '|') { const xs = [a]; while (S[k]?.t == '|') { k++; xs.push(atom()) } a = { t: 'alt', xs, x } }
      its.push(a)
    }
    return { t: 'grp', items: its, ops }
  }
  return { atom, items, need, get k() { return k }, set k(v) { k = v } }
}
const escRe = s => s.replace(/[\\^$.*+?()[\]{}|\/-]/g, '\\$&')
function build(m, env, g) {
  switch (m.t) {
    case 'lit': return lit(m.v)
    case 'kw': return kw(m.v)
    case 're': {
      const src = m.v.replace(/\$\{(\w+)\}/g, (_, k) => { const e = env[k]; if (!e || e.t != 'lit') throw new MErr(f`参数 ${k} 未提供字面量`, m.x); return escRe(e.v) })
      try { return re(new RegExp(src)) } catch (e) { throw new MErr(e.message, m.x) }
    }
    case 'recur': return recur()
    case 'alt': return alt(...m.xs.map(x => build(x, env, g)))
    case 'ref': return env[m.name] ? build(env[m.name], {}, g) : g.inst(m.name, m.args.map(x => x.t == 'ref' && env[x.name] ? env[x.name] : x), m.x)
    case 'optab': throw new MErr(f`算符表 (- …) 前面需要一个操作数`, m.x)
    case 'grp': {
      if (m.items.length && !m.ops.length && m.items.every(x => x.t == 'kw' || x.t == 'empty') && m.items.some(x => x.t == 'kw'))
        return kwset(m.items.filter(x => x.t == 'kw').map(x => x.v), m.items.some(x => x.t == 'empty'))
      if (m.items.some(x => x.t == 'empty')) throw new MErr(f`"-" 只能用在关键字集合 (kw1 kw2 -) 中`, m.items.find(x => x.t == 'empty').x)
      const its = []   // 算符表修饰紧挨在它前面的一项
      for (const x of m.items) {
        if (x.t != 'optab') { its.push(build(x, env, g)); continue }
        if (!its.length) throw new MErr(f`算符表 (- …) 前面需要一个操作数`, x.x)
        its.push(prec(its.pop(), x.levels.map(L => L.map(y => build(y, env, g)))))
      }
      if (!its.length) throw new MErr(f`空分组`, m.ops[0])
      const st = m.ops.filter(o => o.t == 'op').at(-1)?.v
      let p
      if (m.ops.some(o => o.t == 'fn' && o.v == 'par')) {
        if (its.length < 2) throw new MErr(f`:par 需要开、闭两项`, m.ops[0])
        p = par(its[0], its.length > 2 ? seq(...its.slice(1, -1)) : null, its.at(-1))
        const o = m.items[0], c = m.items.at(-1)
        if (o.t == 'lit' && c.t == 'lit' && !g.pairs.some(q => q[0] == o.v)) g.pairs.push([o.v, c.v])
      }
      else if (st == '<') p = alt(...its)
      else if (st == '+') { if (its.length < 2) throw new MErr(f`+ 需要元素与分隔符`, m.ops[0]); p = join(seq(...its.slice(0, -1)), its.at(-1)) }
      else if (st == '*') p = many(seq(...its))
      else if (st == '?') p = opt(seq(...its))
      else p = seq(...its)
      for (const o of m.ops) {
        if (o.t == 'fn' && o.v == 'setRecur') p = mark(p)
        else if (o.t == 'fn' && o.v != 'par') {
          let fx = g.funcs[o.v]; if (!fx) throw new MErr(f`未知函数 :${o.v}`, o)
          if (o.args) fx = fx(...o.args)
          p = fn(p, fx, ':' + o.v)
        }
      }
      return p
    }
  }
}
function grammar(text, opt = {}) {
  const g = { text, rules: new Map, insts: new Map, pairs: [], skip: /\s+/, colors: {}, errs: [], builtins: new Set, startName: null, funcs: { ...funcs, ...P.funcs, ...opt.funcs } }
  const E = (msg, t) => g.errs.push({ a: t ? t.a : 0, b: t ? Math.max(t.b, t.a + 1) : 1, msg })
  const T = mtok(text), stmts = []
  for (const t of T) if (t.bol || !stmts.length) stmts.push([t]); else stmts.at(-1).push(t)
  for (const S of stmts) {
    try {
      const h = S[0], M = mparse(S)
      if (h.t == 'dir') {
        const a = S.slice(1)
        if (h.v == 'skip') g.skip = a[0]?.t == 're' ? new RegExp(a[0].v) : a[0]?.v == 'none' ? null : (() => { throw new MErr(f`@skip /re/ 或 none`, h) })()
        else if (h.v == 'start') throw new MErr(f`没有 @start：第一条规则就是起始规则`, h)
        else if (h.v == 'color') for (let j = 0; j < a.length; j += 3) { if (a[j + 1]?.t != '=' || !a[j + 2]) throw new MErr(f`@color Name=B`, a[j]); g.colors[a[j].v] = a[j + 2].v }
        else if (h.v == 'builtin') a.forEach(x => g.builtins.add(x.v))
        else if (h.v == 'walk') {
          const w = P.walkers[a[0]?.v]; if (!w) throw new MErr(f`未注册的 walker ${a[0]?.v}`, a[0] || h)
          g.walk = a[0].v; for (const k of w.builtins || []) g.builtins.add(k); g.fnNames = w.fns
        }
        else throw new MErr(f`未知指令 @${h.v}`, h)
        continue
      }
      if (h.t != 'word') throw new MErr(h.t == 'bad' ? h.v : f`行首应为规则名`, h)
      if (!isUpper(h.v)) throw new MErr(f`规则名须大写开头（小写一定是关键字字面量）`, h)
      if (g.rules.has(h.v)) throw new MErr(f`重复定义 ${h.v}`, h)
      M.k = 1; const params = []
      if (h.adj) { M.need('('); for (;;) { const x = M.need('word'); params.push(x.v); if (S[M.k]?.t == ',') { M.k++; continue } break } M.need(')') }
      const body = M.items(null)
      if (M.k < S.length) throw new MErr(f`多余的 )`, S[M.k])
      g.rules.set(h.v, { params, body, h })
      g.startName ||= h.v
    } catch (e) { if (e instanceof MErr) E(e.message, e.t); else throw e }
  }
  g.inst = (name, args, at) => {
    const key = name + (args.length ? JSON.stringify(args.map(a => a.v ?? a.name)) : '')
    let I = g.insts.get(key); if (I) return I.p
    const R = g.rules.get(name); if (!R) throw new MErr(f`未定义规则 ${name}`, at)
    if (R.params.length != args.length) throw new MErr(f`${name} 需要 ${R.params.length} 个参数`, at)
    const env = {}; R.params.forEach((k, j) => env[k] = args[j])
    I = { p: rule(name, () => I.body) }; g.insts.set(key, I)
    try { I.body = build(R.body, env, g) } catch (e) { g.insts.delete(key); throw e }
    return I.p
  }
  for (const [name, R] of g.rules) if (!R.params.length) try { g.inst(name, [], R.h) } catch (e) { if (e instanceof MErr) E(e.message, e.t); else throw e }
  const sr = g.rules.get(g.startName)
  if (sr && !sr.params.length && g.insts.has(g.startName)) g.start = g.insts.get(g.startName).p
  else if (!g.errs.length) E(f`起始规则 ${g.startName || '?'} 不可用`)
  return g
}

/* ---------- 示例语法 ---------- */
const CSV_RULES = `Table(D) (Row(D) /\\r?\\n/ +) :table
Row(D)   (Field(D) D +)
Field(D) (Quoted Num(D) Bare(D) <)
Quoted   /"(?:[^"]|"")*"/ :unq
Num(D)   /-?\\d+(?:\\.\\d+)?(?=[\${D}\\r\\n]|$)/ :num
Bare(D)  /[^"\\r\\n\${D}]*/`
const CSV_HEAD = `@skip none
@color Num=B Quoted=Y
`
const examples = [
  { name: 'JSON', input: `{"name": "parviz", "tags": [1, 2.5e3, -0.5, true, null],
 "nested": {"a": [], "b": {"deep": [[1], [2, [3]]]}},
 "esc": "line\\n\\u4e2d"}`,
    rules: `# JSON —— (… <) 有序选择(PEG)，(… :setRecur) 递归起点，Recur 引用最近的 :setRecur
# (… +) 以末项为分隔符连接 0~N 个；(… :par) 配对提示与错误恢复；第一条规则是起始规则
@color Num=B Str=Y kw=B
Json  ((Val Lit null true false <) :setRecur)
Val   (("[" (Recur "," +) "]" :par) ("{" (Str ":" Recur "," +) "}" :par :obj) <)
Lit   Num|Str
Num   /-?(0|[1-9][0-9]*)(\\.\\d+)?([eE][+-]?\\d+)?/ :num
Str   /"(\\\\(?:[nrtbf"\\\\\\/]|u[0-9a-fA-F]{4})|[^"\\\\])*"/ :str` },
  { name: 'JSON（含错误）', input: `[1, , 2, {"a" 1, "b": 2}, 3 4, [5, 6}, 7,
 {"k": [true, nul]}, "ok"]`, rules: null, same: 'JSON' },
  { name: 'CSV', input: `name,age,quote
Ada,36,"Hello, ""world"""
Bob,-4.5,"多行
字段"
,,empty
`, rules: `# RFC4180：引号字段、"" 转义、首行表头；分隔符 D 参数化，CSV/TSV 用同一组规则常量拼出
${CSV_HEAD}Csv      Table(",")
${CSV_RULES}` },
  { name: 'TSV', input: 'id\tname\tnote\n1\tAda\t"tab\there"\n2\t"Bob ""B"""\t3.14\n', rules: `# 同一组规则常量，换个起始规则与分隔符
${CSV_HEAD}Tsv      Table("\\t")
${CSV_RULES}` },
  { name: 'Kwd 补齐', input: `pub override fun main;
priv fun helper;
pro overri fun draw;
`, rules: `# Kwd：关键字集合 (pub priv pro override -)，"-" 表示可以什么都不吃；
# 它在所在位置登记补齐候选：在 overri 后打字会弹出 override（Tab 接受，↑↓ 选择）
# (Kwd Kwd *) 等效于 (/pub|priv|pro|override/ *)
@color Name=G kw=P
Prog  (Decl *)
Decl  (Kwd Kwd *) "fun" Name ";"
Kwd   (pub priv pro override -)
Name  /[A-Za-z_]\\w*/` },
]
// 元语法：v1 只描述结构；v2 在同一结构上用 Lexscope 加作用域（规则名 :def、参数 :param、引用 :ref、:scope、:global）。
// 两版共用 META_HEAD 与 META_BODY，只有涉及名字的五六条规则不同。
const META_HEAD = `@skip /(?:[ \\t]+|#[^\\n]*)+/
@color Re=Y Lit=Y Kw=B Op=P Dir=P Head=G
`
const META_BODY = `Line    ((Dir Rule <) ?)
Dir     /@\\w+/ (Arg *)
Arg     (Re Lit Pair Word <)
Pair    /\\w+=\\w+/
Word    /\\w+/
Item    ((Group Re Lit "Recur" Kw Call Op <) :setRecur)
Group   ("(" (Recur *) ")" :par)
Call    Name (Args ?)
Args    (/(?<=\\w)\\(/ (Arg2 "," +) ")" :par)
Arg2    (Lit Name <)
Re      /\\/(?:\\\\.|\\[(?:\\\\.|[^\\]\\\\])*\\]|[^\\/\\\\\\n\\[])+\\//
Lit     /"(?:\\\\.|[^"\\\\\\n])*"/
Kw      /[a-z]\\w*/
Op      /[<+*?|;-]|:\\w+/`
const META_V1 = `# 元语法 v1：只有结构，没有作用域——引用了不存在的规则也看不出来
${META_HEAD}Grammar (Line /\\n/ +)
Rule    Head (Params ?) (Item *)
Head    /[A-Z]\\w*/
Params  (/(?<=\\w)\\(/ (Head "," +) ")" :par)
Name    /[A-Z]\\w*/
${META_BODY}`
const META = `# 元语法 v2：用元语言描述元语言自身（规则区高亮就是用它解析的），在 v1 的结构上复用 Lexscope：
# 规则名 :def 定义（绿），参数 :param（紫），Name :ref 引用；:scope 让参数只在本规则内可见，
# :global 用全部规则名消解引用，剩下的报“未定义”。Ctrl+点击引用跳到定义
${META_HEAD}Grammar (Line /\\n/ +) :global
Rule    Head (Params ?) (Item *) :scope
Head    /[A-Z]\\w*/ :def
Params  (/(?<=\\w)\\(/ (Pname "," +) ")" :par)
Pname   /[A-Z]\\w*/ :param
Name    /[A-Z]\\w*/ :ref
${META_BODY}`
examples.push({ name: 'Meta v1（纯结构）', input: META_V1, rules: META_V1 }, { name: 'Meta v2（自描述 + Lexscope）', input: META, rules: META })

const P = { FAIL, EOF, Node, walk, feed, eat, ws, re, lit, kw, seq, alt, opt, many, join, par, fn, rule, mark, recur, prec, to, bind, funcs, lexscope, T, isT, parts, viewOf, grammar, mtok, examples, META, META_V1, errsOf, f }
P.funcs = {}    // 供其他模块（lisp.js）注册额外 :func
P.walkers = {}  // @walk name：Ctrl+Enter 时对解析结果执行的遍历器 { run(value), steps(value), node(ast, value) }
if (typeof module != 'undefined') module.exports = P
G.P = P
})(typeof globalThis != 'undefined' ? globalThis : window)
