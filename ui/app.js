/* app.js — 调试器页面：编辑器（共享 ui/editor.js）、Doc 树与三个 Tab、sloc 全屏标注与 $n 标记、
   步进可视化、逐步执行、规则区、颜色表。F12：$1 输入流  $2 最后悬停  $3 语法  $4 最近结果  $5.. 标记 */
'use strict'
const { feed, eat, grammar, walk, examples, errsOf, Node } = P
const clip = (s, n = 40) => s.length > n ? s.slice(0, n) + '…' : s
const A = i => String.fromCharCode(65 + i)

const src = new Editor($('#src'), 'src'), rules = new Editor($('#rules'), 'rules')


/* ---------- 状态 ---------- */
const S = {
  meta: grammar(P.META), g: null, ss: null, rss: null, doc: null, vdoc: null, gdoc: null, elById: new Map, last: '', timer: 0, rtimer: 0,
  onedit: null, res: null, stale: false, view: 'cst', tool: 'eval', folds: new Set, unfold: new Set, down: false, pendingParse: false, collapse: true,
  srcSeen: null, srcSpec: null, zoom: null, midAt: 0,
}
const status = t => $('#status').textContent = t
const { deepest, declAt, usesOf } = Xref   // xref.js：悬停箭头 / 跳定义 / 反查引用
const exactNode = (a, b) => { let r = null; if (S.ss?.tree) walk(S.ss.tree, n => { if (r) return false; if (n.a == a && n.b == b && n.k != 'top') { r = n; return false } if (n.b < a || n.a > b) return false }); return r }
Object.assign(window, { ss: null, $1: null, $2: null, $3: null, $4: undefined })   // F12 槽位，见文件头
const elFor = n => { if (S.view != 'cst') return null; const id = S.doc?.idOf.get(n); return id == null ? null : S.elById.get(id) ?? null }
const showRule = name => { const R = S.g?.rules.get(name); if (R) { rules.setSel(R.h.a, R.h.b); rules.scrollTo(R.h.a) } }

// 占位实现：只留最近一次调用，写进 #out .val，并显示该词条被编辑了几遍
const defaultOnedit = (o, n, info) => {
  const q = t => t == null ? 'null' : JSON.stringify(clip(t, 30))
  S.onedit = info.init ? `onedit 初始通知（${info.count} 个词条）` : `onedit(${q(o)}, ${q(n)})  第 ${info.count} 遍`
  const v = $('#out .val .oe'); if (v) v.textContent = `   // ${S.onedit}`
}
/* ---------- onedit 的 hashline：词条哈希 = 自身文本 + 左侧至行首的字符；解析完先通知一遍，之后只在有变更时调用 ----------
   对齐：哈希相同的公共前缀/后缀不动（行首上下文让对齐不跨行误配）；中间段按文本做 LCS，
   文本相同的只是被左边的编辑带着改了哈希，不算编辑；其余按位置配对成 改/增/删。 */
const hash4 = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return (x >>> 16).toString(16).padStart(4, '0') }
const Edits = {
  seq: null,   // 上一次的词条序列 [{h, t, n, cnt}]；换示例/改语法时清空
  sync(ss) {
    const s = ss.src, now = []
    walk(ss.tree, n => {
      if (n.kids.length || n.b <= n.a || n.k == 'err') return
      const t = s.slice(n.a, n.b)
      now.push({ h: hash4(s.slice(s.lastIndexOf('\n', n.a - 1) + 1, n.a) + t), t, n, cnt: 0 })
    })
    const old = this.seq; this.seq = now
    if (!old) { ss.onedit(null, s, { init: true, count: now.length }); return }
    const O = old.length, N = now.length; let p = 0, q = 0
    while (p < O && p < N && old[p].h == now[p].h) now[p].cnt = old[p++].cnt
    while (q < O - p && q < N - p && old[O - 1 - q].h == now[N - 1 - q].h) { now[N - 1 - q].cnt = old[O - 1 - q].cnt; q++ }
    for (const [o, x] of this.align(old.slice(p, O - q), now.slice(p, N - q))) {
      if (o && x && o.t == x.t) { x.cnt = o.cnt; continue }
      if (x) x.cnt = (o?.cnt ?? 0) + 1
      ss.onedit(o?.t ?? null, x?.t ?? null, { count: x ? x.cnt : o.cnt, node: x?.n, hash: x?.h })
    }
  },
  // 中间段：文本 LCS 匹配，两次匹配之间的未匹配段按位置配对；太大时直接按位置
  align(A, B) {
    const m = A.length, w = B.length, out = [], zip = (a, b) => { for (let k = 0; k < Math.max(a.length, b.length); k++) out.push([a[k] ?? null, b[k] ?? null]) }
    if (m * w > 4e5) { zip(A, B); return out }
    const L = new Int32Array((m + 1) * (w + 1)), at = (i, j) => i * (w + 1) + j
    for (let i = m - 1; i >= 0; i--) for (let j = w - 1; j >= 0; j--) L[at(i, j)] = A[i].t == B[j].t ? L[at(i + 1, j + 1)] + 1 : Math.max(L[at(i + 1, j)], L[at(i, j + 1)])
    let i = 0, j = 0, ra = [], rb = []
    while (i < m || j < w) {
      if (i < m && j < w && A[i].t == B[j].t) { zip(ra, rb); ra = []; rb = []; out.push([A[i++], B[j++]]) }
      else if (j < w && (i == m || L[at(i, j + 1)] >= L[at(i + 1, j)])) rb.push(B[j++])
      else ra.push(A[i++])
    }
    zip(ra, rb); return out
  },
}
/* ---------- 标记：ss.marks = [Node | 偏移 | [a,b] | {a,b,line}]，第 k 个即 $(5+k) ---------- */
const Marks = {
  prev: 0,
  norm(m) {
    if (m instanceof Node) return { a: m.a, b: m.b, n: m }
    if (typeof m == 'number') return { a: m, b: m + 1, n: S.ss?.tree && deepest(S.ss.tree, m) }
    if (Array.isArray(m)) { const b = m[1] ?? m[0] + 1; return { a: m[0], b, n: exactNode(m[0], b) } }
    if (m && typeof m == 'object') { const n = m.n instanceof Node ? m.n : exactNode(m.a, m.b); return n || m.a != null ? { a: m.a ?? n.a, b: m.b ?? n.b, n, line: !!m.line } : null }
    return null
  },
  list() { return (S.ss?.marks || []).map(m => this.norm(m)).filter(Boolean) },
  toggle(n, line) {
    const ms = S.ss.marks.slice(), i = ms.findIndex(m => (m instanceof Node ? m : m?.n) === n)
    if (i >= 0) ms.splice(i, 1); else ms.push(line ? { n, line: true } : n)
    S.ss.marks = ms
  },
  changed() {
    for (let k = 5; k < 5 + this.prev; k++) delete window['$' + k]
    const L = this.list(); L.forEach((m, k) => window['$' + (5 + k)] = m.n ?? [m.a, m.b]); this.prev = L.length
    for (const e of document.querySelectorAll('.nd.pin')) e.classList.remove('pin')
    for (const m of L) if (m.n) elFor(m.n)?.classList.add('pin')
    Sloc.draw()
  },
}
// 新的输入流：沿用上一次的标记（按区间重新定位）与用户自定义的 onedit
function wireFeed(ss, prev) {
  let marks = prev ? Marks.list().map(m => m.line ? { a: m.a, b: m.b, line: true } : [m.a, m.b]) : []
  Object.defineProperty(ss, 'marks', { get: () => marks, set: v => { marks = Array.isArray(v) ? v : []; Marks.changed() }, enumerable: true, configurable: true })
  ss.onedit = prev && prev.onedit !== defaultOnedit ? prev.onedit : defaultOnedit
}

function setFold(el, folded) {
  el.classList.toggle('fold', folded); const k = el.dataset.k; if (!k) return
  if (el.classList.contains('par')) folded ? S.unfold.delete(k) : S.unfold.add(k); else folded ? S.folds.add(k) : S.folds.delete(k)
}
const toggleFold = el => { setFold(el, !el.classList.contains('fold')); Sloc.draw() }
// 深度折叠展开：已折叠则连同所有子孙一起展开，否则连同所有子孙一起折叠（之后点 Tag 一层层展开）
const deepFold = el => { const f = !el.classList.contains('fold'); for (const x of [el, ...el.querySelectorAll('.box')]) setFold(x, f); Sloc.draw() }
function hookTree(host) {
  $.ev(host, {
    mouseover() {
      const { target } = $.event
      const r = target.closest('[data-rule]'); if (r) showRule(r.dataset.rule)
      const t = target.closest('.nd[data-id]'), it = t && nodeOf(t)
      if (it && it.a >= 0) Sloc.hover(it.n || { a: it.a, b: it.b, k: itemLabel(it) }, t)
    },
    mouseout() { if ($.event.target.closest('.nd[data-id]')) Sloc.hover(null) },
    mousedown() {
      const { detail, button } = $.event
      if (detail > 1 || button == 1) $.event.preventDefault()   // 双击不选中文字；中键不自动滚屏
      if (button == 1) S.midAt = performance.now()               // 记下中键：Chromium 会把 PRIMARY 选区粘进聚焦的输入区
    },
    mouseup() { if ($.event.button == 1) $.event.preventDefault() },
    // 中键：只看这棵子树（铺满树面板）；右键：回到整棵树
    auxclick() {
      const { button, target } = $.event
      if (button != 1) return
      const t = target.closest('.nd[data-id]'), nx = t && nodeOf(t)
      if (!nx?.n) return
      $.event.preventDefault(); zoomTo(nx.n)
    },
    contextmenu() { if (S.zoom) { $.event.preventDefault(); zoomTo(null) } },
    // 单击：只有折叠工具才折叠（括号、Tag 也一样），其他按当前工具；:par 尾巴总是可展开
    click() {
      const { detail, target } = $.event
      if (detail > 1) return
      const p = target.closest('[data-pos]'); if (p && !p.closest('.fold')) { goto(+p.dataset.pos, +p.dataset.pos + 1); return }
      const pr = target.closest('.par'); if (pr) { toggleFold(pr); return }
      const t = target.closest('.nd'); if (!t) return
      if (foldTool(t)) return
      const nx = nodeOf(t); if (nx) useTool(nx)
    },
    // 双击 = 标记：折叠工具先撤销第一下；标记工具第一下已标过
    dblclick() {
      const { target } = $.event
      const t = target.closest('.nd'); if (!t || target.closest('.par')) return
      foldTool(t); if (S.tool == 'mark' || S.tool == 'line') return
      const nx = nodeOf(t); if (nx && S.ss) { Marks.toggle(nx.n || (nx.a >= 0 ? [nx.a, nx.b] : null)); if (nx.a >= 0) goto(nx.a, nx.b, true) }
    },
    scroll() { Sloc.draw() },
  })
}
function renderTree() {
  const host = $('#tree'), st = host.scrollTop
  const d = viewDoc(), root = S.view == 'cst' && S.zoom ? S.doc?.idOf.get(S.zoom) ?? null : null
  if (!d) { m.render(host, m('div.tree')); S.elById = new Map; return }
  const box = Tree.render(host, d, { folds: S.folds, unfold: S.unfold, root })
  box._doc = d
  S.elById = new Map([...host.querySelectorAll('[data-id]')].map(e => [+e.dataset.id, e]))
  host.scrollTop = st
}
const viewDoc = () => S.view == 'g' ? S.gdoc : S.view == 'val' ? S.vdoc : S.doc
// 点击/悬停：Doc 节点 → 外部对象（CST 或值）；payload 只在这里读
const nodeOf = t => {
  const host = t.closest('.tree'), d = host?._doc, raw = t.dataset?.id
  if (!d || raw == null) return null
  const id = +raw, obj = d.payload[id] >= 0 ? d.objs[d.payload[id]] : null, cst = d.flavor == 'cst'
  return { d, id, n: cst ? obj : null, v: cst ? null : obj, a: d.a[id], b: d.b[id] }
}
const itemLabel = it => it.n ? (it.n.r || it.n.k || '') : (it.d.str[it.d.tag[it.id]] || '')
// 子树缩放：树面板只渲染这个 CST 节点的子树；右键（contextmenu）回到根
function zoomTo(n) {
  S.zoom = n
  renderTree(); Marks.changed()
  if (n) { $('#tree').scrollTop = 0; status(`只看 ${n.r || n.k}（右键回到根）`) }
  else status('')
}
const foldTool = t => {
  if (S.tool != 'fold' && S.tool != 'deep') return false
  const b = t.closest('.box'); if (b) (S.tool == 'deep' ? deepFold : toggleFold)(b); return true
}
/* ---------- 点击节点的工具（双击总是标记；1-6 切换） ---------- */
function useTool(it) {
  if (!S.ss || !it) return
  const span = it.a >= 0
  if (S.tool == 'mark' || S.tool == 'line') { Marks.toggle(it.n || (span ? [it.a, it.b] : null), S.tool == 'line'); if (span) goto(it.a, it.b, true) }
  else if (S.tool == 'clear') S.ss.marks = []
  else if (S.tool == 'eval') evalNode(it)
}
function evalNode(it) {
  const ast = it.n ? it.n.v : it.v, w = S.g.walk && P.walkers[S.g.walk]
  const where = it.a >= 0 ? S.ss.sloc(it.a) : '（合成节点）'
  if (w && P.isT(ast) && P.isT(S.ss.value)) setResult({ run: w.node(ast, S.ss.value), show: w.show, label: `独立求值 ${where}` })
  else setResult({ v: ast, label: `节点值 ${where}` })
}
const toolSel = $('#tool')
toolSel.onchange = () => { S.tool = toolSel.value; status('工具：' + toolSel.selectedOptions[0].text) }
$.ev(toolSel, {
  wheel() {
    $.event.preventDefault(); const n = toolSel.options.length
    toolSel.selectedIndex = (toolSel.selectedIndex + ($.event.deltaY > 0 ? 1 : -1) + n) % n; toolSel.onchange()
  },
}, { passive: false })

/* ---------- sloc：全屏打标、连线、goto ---------- */
const Sloc = {
  svg: $('#ov svg g'), mks: $('#mks'), hov: null, link: null, ref: null, rev: null,
  hover(n, el) {
    this.hov = n ? { n, el } : null
    HL.set('hov', n ? { hov: [src.range(n.a, Math.max(n.b, n.a + 1))] } : {})
    if (n && S.ss) { window.$2 = n; status(`$2 = ${n.r || n.k} ${S.ss.sloc(n)}${n.err ? '  ' + n.err : ''}`) }
    this.draw()
  },
  label(txt, r, cls, on) { return SL.label(this.mks, txt, r, cls, on) },
  path(a, b, cls, ref) { SL.path(this.svg, a, b, cls, ref) },
  inView(el, r) { const c = el.getBoundingClientRect(); return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right },
  draw() {
    this.mks.textContent = ''; this.svg.textContent = ''
    const ss = S.ss; if (!ss?.tree || ss.src !== src.value) return
    const tree = $('#tree')
    Marks.list().forEach((m, k) => {
      const id = '$' + (5 + k), r = src.rect(m.a, Math.max(m.b, m.a + 1)), el = m.n && elFor(m.n), tr = el?.offsetParent && el.getBoundingClientRect()
      const tv = tr && this.inView(tree, tr), sv = src.visible(r)
      const link = () => { if (tr) this.path(tr, r) }
      if (sv) this.label(id, r, '', { onmouseenter: link, onclick: () => goto(m.a, m.b), title: ss.sloc(m.a) })
      if (tv) this.label(id, tr, '', { onmouseenter: link, onclick: () => el.scrollIntoView({ block: 'center' }) })
      if (m.line && tv && sv) link()
    })
    ss.errs.forEach((e, k) => {
      const r = src.rect(e.a, Math.max(e.b, e.a + 1))
      if (src.visible(r)) this.label(`E${k + 1}`, r, 'e', { title: e.msg, onclick: () => goto(e.a, e.b) })
    })
    const hv = this.hov
    if (hv?.el?.offsetParent) { const r = src.rect(hv.n.a, Math.max(hv.n.b, hv.n.a + 1)); if (src.visible(r)) this.path(hv.el.getBoundingClientRect(), r) }
    if (hv?.from) this.path(hv.from, hv.to, hv.cls)
    const lk = this.link; if (lk?.el.isConnected && lk.el.offsetParent) this.path(lk.el.getBoundingClientRect(), src.rect(lk.a, lk.b), 'ar')
    const rf = this.ref
    if (rf?.d) { const e = rf.ed, a = e.rect(rf.d.a, rf.d.b), b = e.rect(rf.u.a, rf.u.b); if (e.visible(a) && e.visible(b)) this.path(a, b, 'ar', 1) }   // 箭头指向定义
    const rv = this.rev
    if (rv?.decl) { const e = rv.ed, dr = e.rect(rv.decl.a, rv.decl.b); for (const u of rv.uses) { const ur = e.rect(u.a, Math.max(u.b, u.a + 1)); if (e.visible(ur)) this.path(ur, dr, 'ar', 1) } }   // 箭头扎在每处引用上：同一行不画线段，只靠箭头标记
  },
}
function goto(a, b = a, keepFocus) {
  src.scrollTo(a); src.setSel(a, b); if (!keepFocus) src.el.focus()
  HL.set('hov', { hov: [src.range(a, Math.max(b, a + 1))] })
  requestAnimationFrame(() => Sloc.draw())
}

/* ---------- 输出：$4 = 最近结果 ---------- */
const fmt = (v, show) => {
  if (show) return show(v, 1)
  if (P.isT(v)) return `<AST ${JSON.stringify(v[0])} …>   // Ctrl+Enter 用 @walk ${S.g?.walk || '?'} 执行`
  try { return clip(JSON.stringify(v) ?? String(v), 3000) } catch { return String(v) }
}
function setResult(res) { S.res = res; window.$4 = res.run ? (res.run.err ? undefined : res.run.value) : res.v; renderOut() }
const conUI = Console.mount($('#out'), {
  open: s => goto(s.a, s.b),
  hover: (s, el) => { Sloc.hov = { from: SL.textEnd(el), to: src.rect(s.a, Math.max(s.b, s.a + 1)), cls: 'e' }; HL.set('hov', { hov: [src.range(s.a, Math.max(s.b, s.a + 1))] }); Sloc.draw() },
  leave: () => { if (Sloc.hov?.from) Sloc.hover(null) },
})
function renderOut() {
  const ss = S.ss, items = []
  if (Sloc.hov?.from) Sloc.hover(null)   // 输出重排，旧的错误连线作废
  items.push({ cls: 'cm', text: '// try ss.onedit=alert' })
  if (!S.g?.start) {   // 文法本身没编译出来：显示编译错误，别再显示上一份语法的解析结果
    ;(S.g?.errs || []).forEach((e, k) => items.push({ cls: 'eitem', text: `文法 ${k + 1} ${e.msg}` }))
    items.push({ cls: 'val', note: '语法未编译成功，未解析源码' })
    return conUI.set(items)
  }
  ss?.errs.forEach((e, k) => items.push({ cls: 'eitem', text: `E${k + 1} ${ss.sloc(e.a)}  ${e.msg}`, span: e }))
  const r = S.res, oe = S.onedit ? `   // ${S.onedit}` : ''
  if (r?.run) {
    for (const l of r.run.log) items.push(l.out != null
      ? { cls: 'log', text: l.out, span: l.a != null ? { a: l.a, b: l.b } : null, spans: l.spans }
      : { cls: 'warn', text: `⚠ ${l.warn}` })
    if (r.run.err) {
      const sp = r.run.a != null ? { a: r.run.a, b: r.run.b } : null
      items.push({ cls: 'eitem', text: `求值错误：${r.run.err}`, span: sp })
      items.push({ cls: 'val', note: oe })
    } else items.push({ cls: 'val', lead: '$4', text: ' = ' + fmt(r.run.value, r.show), note: `   // ${r.label}` + oe })
  } else if (r) items.push({ cls: 'val', lead: '$4', text: ' = ' + fmt(r.v), note: (r.label ? `   // ${r.label}` : '') + oe })
  else items.push({ cls: 'val', note: oe })
  conUI.set(items)
}

/* ---------- 解析 / 执行 ---------- */
$.ev($('#out'), { mouseleave() { if (Sloc.hov?.from) Sloc.hover(null) } })   // 指针离开输出区才收起错误连线

function parse() {
  clearTimeout(S.timer); S.timer = 0; Step.stop(); EvStep.stop()
  const focused = document.activeElement === src.el, sel = focused ? src.caret() : null
  src.fix(); S.last = src.value
  if (!S.g?.start) { status('语法未编译成功'); S.res = null; renderOut(); renderTree(); return }
  const prev = S.ss, ss = feed(src.value)
  wireFeed(ss, prev)
  const t0 = performance.now(); let v
  try { v = eat(S.g, ss) } catch (e) { status('解析异常：' + e.message); console.error(e); S.res = null; renderOut(); return }
  S.ss = ss; S.stale = false; window.ss = window.$1 = ss; window.$3 = S.g; S.zoom = null   // 新树：子树缩放失效
  Sloc.rev = Sloc.ref = null   // 节点换了，反查箭头作废
  S.doc = Doc.cst(ss, S.g); S.vdoc = Doc.val(ss); DBG.setDoc(S.doc)
  paint(src, ss.tree, S.g.colors); renderTree(); Marks.changed(); Edits.sync(ss)
  setResult({ v, label: ` ${(performance.now() - t0).toFixed(1)}ms · ${ss.errs.length} 个错误` }); syncHash()
  if (sel && document.activeElement !== src.el) { src.el.focus(); src.setSel(...sel) }   // 结构性编辑后恢复光标
  return v
}
function execute() {
  const v = parse(); if (!S.ss) return
  const w = S.g.walk && P.walkers[S.g.walk]
  if (w && P.isT(v)) setResult({ run: w.run(v), show: w.show, label: `执行 @walk ${S.g.walk}` })
}

/* ---------- 增量：不破坏词条语法的编辑直接顺延区间并触发 ss.onedit ---------- */
function tryShift(old, now) {
  const ss = S.ss, root = ss?.tree; if (!root || ss.src !== old) return false
  let p = 0; const m = Math.min(old.length, now.length); while (p < m && old[p] == now[p]) p++
  let s = 0; while (s < m - p && old[old.length - 1 - s] == now[now.length - 1 - s]) s++
  const a = p, b = old.length - s, d = now.length - old.length
  let T = null, prev = null, next = null
  walk(root, n => {
    if (n.kids.length || n.b <= n.a) return
    if (n.a <= a && b <= n.b && n.k == 'tok' && !T) T = n
    if (n.b <= a && (!prev || n.b >= prev.b)) prev = n
    if (n.a >= b && (!next || n.a < next.a)) next = n
  })
  const path = []
  if (T) { const f = n => { if (n === T) return true; for (const k of n.kids) if (k.a <= T.a && T.b <= k.b && f(k)) { path.push(n); return true } return false }; f(root) }
  let newT
  if (T) {
    if (T.free || T.defs || T.c == 'G' || T.c == 'P') return false       // 影响作用域，需重解析
    const y = T.rx; y.lastIndex = T.a; const mm = y.exec(now)
    if (!mm || !mm[0].length || mm[0].length != T.b - T.a + d) return false
    newT = mm[0]
  } else {
    const ga = prev ? prev.b : 0, gb = next ? next.a : old.length
    if (a < ga || b > gb || !ss.skip || ss.some) return false   // @skip some：空白是否被跳过取决于所在规则，交给重解析
    const ng = now.slice(ga, gb + d)
    if (!ng.length && gb > ga) return false
    if (ng.length) { ss.skip.lastIndex = 0; const mm = ss.skip.exec(ng); if (!mm || mm[0].length != ng.length) return false }
  }
  const inPath = new Set(T ? [T, ...path] : [])
  walk(root, n => { const sa = n.a >= b && !inPath.has(n); if (sa) n.a += d; if (n.b > a || inPath.has(n) || sa) n.b += d })
  root.b = now.length; ss.src = now; ss.errs = errsOf(root); S.stale = true
  if (T) { T.text = newT; const r = src.rmap.get(T); if (r) { r.setStart(src.t, T.a); r.setEnd(src.t, T.b) } }   // 先更新词条文本，再重建 Doc
  S.doc = Doc.cst(ss, S.g); S.vdoc = Doc.val(ss); DBG.setDoc(S.doc)
  Edits.sync(ss)
  HL.flush(); renderTree(); Marks.changed(); renderOut(); syncHash()
  status(`顺延 ${d > 0 ? '+' : ''}${d} @${ss.sloc(a)}`)
  return true
}
$.ev(src.el, {
  input() {
    if (Step.on) Step.stop()
    const ok = src.fix(), old = S.last, now = src.value; S.last = now
    if (!(ok && tryShift(old, now))) { clearTimeout(S.timer); S.timer = setTimeout(requestParse, 700) }   // 结构性编辑：停顿后重解析，旧高亮保留到新结果一次性替换
    Comp.update()
  },
})
// 鼠标按下期间（如正在点树节点）不重建树：推迟到这次点击处理完
const requestParse = () => { if (S.down) S.pendingParse = true; else parse() }
$.ev(src.el, { blur() { if (!Step.on && (S.timer || S.stale || S.ss?.src !== src.value)) requestParse() } })   // 失焦自动解析
$.ev(document, {
  pointerdown() { S.down = true },
  pointerup() { S.down = false; if (S.pendingParse) { S.pendingParse = false; setTimeout(parse, 0) } },
}, true)

/* ---------- 规则区：自己给自己写的语法（META）负责高亮 ---------- */
function paintRules() {
  rules.fix()
  const rss = feed(rules.value, 'feed$R'); eat(S.meta, rss); S.rss = rss
  if (Sloc.rev?.ed === rules) Sloc.rev = null
  paint(rules, rss.tree, S.meta.colors, S.g ? S.g.errs : [])
  const box = $('#rerr'); box.textContent = ''
  const errs = [...(S.g?.errs || []).map(e => ({ ...e, msg: '编译：' + e.msg })), ...rss.errs.map(e => ({ ...e, msg: '元语法：' + e.msg }))]
  for (const e of errs) { const d = h('div', null, `${rss.sloc(e.a)} ${e.msg}`); d.onclick = () => { rules.setSel(e.a, e.b); rules.el.focus() }; box.append(d) }
}
function compile() {
  clearTimeout(S.rtimer)
  rules.fix(); S.g = grammar(rules.value); window.$3 = S.g; S.gdoc = Doc.gram(S.g); Edits.seq = null
  paintRules()
  if (S.g.start) parse(); else { status(`语法错误 ${S.g.errs.length} 处`); S.res = null; renderOut(); renderTree() }
}
$.ev(rules.el, { input() { rules.fix(); clearTimeout(S.rtimer); S.rtimer = setTimeout(compile, 600) } })
const tabs = document.querySelectorAll('#tabs button')
for (const b of tabs) b.onclick = () => {
  S.view = b.dataset.tab
  for (const x of tabs) x.classList.toggle('on', x == b)
  renderTree(); Marks.changed()
}

/* ---------- 步进：聚焦任意位置按 →，像 parser 一样往右扫；← 回溯 ---------- */
const menu = $('#menu'), caretEl = $('#caret')
function popup(pos, fill, ch) {
  const r = src.rect(pos, pos)
  caretEl.hidden = false; Object.assign(caretEl.style, { left: r.left + 'px', top: r.top + 'px', height: (r.height || 16) + 'px' })
  menu.textContent = ''; fill(menu); menu.hidden = false; menu.classList.toggle('ch', !!ch)
  const mh = menu.offsetHeight, mw = menu.offsetWidth
  menu.style.left = Math.max(4, Math.min(r.left, innerWidth - mw - 8)) + 'px'
  menu.style.top = (r.bottom + 4 + mh > innerHeight ? Math.max(4, r.top - mh - 4) : r.bottom + 4) + 'px'
}
// 步进用的是独立的一次解析：按区间（优先同名规则）在主语法树里找对应元素；被折叠时退到最近的可见祖先
function astEl(a, b, r) {
  const d = S.doc; if (!d || S.view != 'cst') return null
  let best = -1, cover = -1, cs = Infinity
  for (let i = 0; i < d.a.length; i++) {
    if (d.b[i] < a || d.a[i] > b) continue
    if (d.a[i] == a && d.b[i] == b && (best < 0 || d.str[d.rule[i]] == r)) best = i
    const sp = d.b[i] - d.a[i]
    if (d.a[i] <= a && b <= d.b[i] && sp < cs) { cover = i; cs = sp }
  }
  let el = best >= 0 ? S.elById.get(best) : cover >= 0 ? S.elById.get(cover) : null
  while (el && !el.offsetParent) el = el.parentElement?.closest('.nd')
  return el
}
// 栈帧：内→外（旧 e.st 的 [...].reverse() 形状）
const stOf = (e, F) => { const r = []; for (let i = e.f; i >= 0; i = F[i].up) r.push(F[i]); return r }
const preview = (s, a, b = a + 24) => clip(s.slice(a, b).replace(/\s*\n\s*/g, '⏎'), 14)   // 原文前缀，不转义
const Step = {
  on: false, ev: [], vis: [], main: [], i: 0, all: false,
  start(all) {
    if (!S.g?.start) return false
    EvStep.stop(); src.fix(); if (S.ss?.src !== src.value) parse()   // 吃下时要连到主语法树
    const [c] = src.caret(), ss = feed(src.value); ss.trace = []; eat(S.g, ss)
    const ev = ss.trace; if (!ev.length) return false
    // 不显示失败的尝试（含其内部）与回溯事件：只走最终成功的路径
    const hide = new Uint8Array(ev.length), st = []
    ev.forEach((e, k) => { if (e.t == 'alt') hide[k] = 1; else if (e.t == 'in') st.push(k); else { const s = st.pop(); if (!e.ok && s != null) hide.fill(1, s, k + 1) } })
    const vis = []; for (let k = 0; k < ev.length; k++) if (!hide[k]) vis.push(k)
    if (!vis.length) return false
    Object.assign(this, { ss, ev, vis, on: true, all, F: ss.frames }); this.recalc()
    // 起点随按键：Shift（逐个事件）取光标后的第一个事件；否则取第一个折叠后保留的事件
    const i = all ? vis.findIndex(k => ev[k].a >= c) : vis.findIndex((k, j) => this.main[j] && ev[k].a >= c)
    this.i = i < 0 ? vis.length - 1 : i
    document.body.classList.add('stepping'); this.show(); return true
  },
  // 折叠纯递归：Tsv→Table→Row→Field 这样未吃任何东西的连续进入只停在最后一个“非叶”规则（叶规则 = 体只是一个词条，如 Bare）；
  // 连续的返回只停在第一个
  recalc() {
    const ev = this.ev, vis = this.vis, E = j => ev[vis[j]]
    const top = e => e && e.f >= 0 ? this.F[e.f] : null
    const ruleIn = j => E(j)?.t == 'in' && !top(E(j))?.tok, tokIn = j => E(j)?.t == 'in' && !!top(E(j))?.tok
    const leaf = j => ruleIn(j) && tokIn(j + 1)
    this.main = vis.map((k, j) => {
      if (!S.collapse) return true
      const e = E(j)
      // 下一个是同位置的规则进入：若它不是叶规则，或处于有序选择中（这一层含判定），本层折叠
      if (e.t == 'in') return ruleIn(j) && !leaf(j) && !(ruleIn(j + 1) && E(j + 1).a == e.a && (!leaf(j + 1) || E(j + 1).ch))
      const pv = E(j - 1)
      return !(pv && pv.t == 'out' && pv.b == e.b)
    })
    if (this.on && !this.all && !this.main[this.i]) { let i = this.i; while (i < vis.length - 1 && !this.main[i]) i++; this.i = i }
    let k = 0; this.mpre = this.main.map(m => m ? ++k : k); this.mainTot = k   // 折叠序号前缀和
  },
  // 步号：原始事件 i/n；发生折叠时再补折叠序号 f/F=百分比
  ord() {
    const n = this.vis.length, s = `${this.i + 1}/${n}`, F = this.mainTot
    return F > 0 && F < n ? `${s} Or ${this.mpre[this.i]}/${F}=${Math.round(this.mpre[this.i] / F * 100)}%` : s
  },
  cur() { return this.ev[this.vis[this.i]] },
  pos(e) { return e.t == 'out' && e.ok ? e.b : e.a },
  stop(place) {
    if (!this.on) return
    const p = this.pos(this.cur()); this.on = false; document.body.classList.remove('stepping')
    HL.set('step', {}); menu.hidden = caretEl.hidden = true; status(''); Sloc.link = null; Sloc.draw()
    if (place) { src.el.focus(); src.setSel(p) }
  },
  // →/←：按折叠后的步；Shift+→/←：逐个事件，含被折叠的递归进入与返回（#coll 关闭时两者相同）
  move(d, all) {
    const L = this.vis.length; let i = this.i + d
    if (!all) while (i > 0 && i < L - 1 && !this.main[i]) i += d
    this.all = all; this.i = Math.max(0, Math.min(L - 1, i)); this.show()
  },
  show() {
    const e = this.cur(), ss = this.ss, pos = this.pos(e)
    const top = stOf(e, this.F).find(f => !f.tok), hl = {}
    if (top && pos > top.a) hl[e.ch ? 'stepCh' : 'step'] = [src.range(top.a, pos)]
    if (e.t == 'out' && e.b > e.a) hl.eat = [src.range(e.a, e.b)]
    HL.set('step', hl); src.scrollTo(pos)
    const eaten = e.t == 'out' && e.ok && e.b > e.a, el = eaten && astEl(e.a, e.b, e.n?.r)   // 吃下：临时箭头连到对应 AST
    if (el) el.scrollIntoView({ block: 'nearest' })
    Sloc.link = el ? { el, a: e.a, b: e.b } : null
    // 进入：原文往右 10 个字符，不加省略号，用红色渐变淡出（.pv）；吃下：显示 top1 规则名（绿色，悬停在规则区指出）
    const rn = e.n?.k == 'rule' ? e.label : top?.label, rEl = rn ? h('span', 'G', rn) : null
    if (rEl) rEl.dataset.rule = rn
    const desc = e.t == 'in' ? ['→ ', h('span', 'pv', ss.src.slice(e.a, e.a + 10).replace(/\s*\n\s*/g, '⏎'))] : e.ok ? ['✓ ', rEl ?? clip(ss.src.slice(e.a, e.b))] : ['✗ ', rEl]
    status(`步进 ${ss.sloc(pos)}${e.ch ? '  选择中' : ''}`)
    popup(pos, m => {
      m.append(h('div', 'hd', h('b', null, ...desc), `  ${this.ord()}`))
      if (e.ch && e.al) {   // 处于有序选择中（蓝色）时列出这个选择包含的各项
        const al = h('div', 'alts', '(')
        e.al.xs.forEach((x, j) => { const s = h('span', j == e.al.j ? 'cur' : null, clip(x, 14)); s.dataset.rule = x; al.append(s) })
        al.append(' <)'); m.append(al)
      }
      // 栈层顺序是从内到外，故同前缀的层必然相邻：#coll 开启时同前缀只留最顶上一项
      const seen = new Set()
      stOf(e, this.F).forEach((f, k) => {
        const pv = preview(ss.src, f.a)
        if (S.collapse) { if (seen.has(pv)) return; seen.add(pv) }
        const d = h('div', 'fr' + (k == 0 ? ' top' : ''), h('span', null, pv), h('span', 'sl', ss.sloc(f.a)))
        if (!f.tok) d.dataset.rule = f.label; m.append(d)
      })
    }, e.ch)
    Sloc.draw()
  },
}
$('#coll').onchange = e => { S.collapse = e.target.checked; if (Step.on) { Step.recalc(); Step.show() } }

/* ---------- 逐步执行（@walk 的生成器 walker） ---------- */
// [= f (=> ..)]、定义处函数名、引用处函数名上的标记 = 函数断点（按名字，ret 时停）；其余标记 = 范围断点。
// 返回 { names, moved }：moved 是已转成函数断点的标记下标（这些标记不再当作范围断点）。
function fnBreaks(prog, marks) {
  const names = new Set, moved = new Set; if (!marks.length) return { names, moved }
  const at = (n, m) => n && n.a >= 0 && m.a == n.a && m.b == n.b
  const go = x => {
    if (!P.isT(x)) return
    if (x[0] == '=' && P.isT(x[2]) && x[2][0] == '=>') {
      // 标记可能落在包着引用词条的外层节点上（同区间的 seq/规则）：在其子树里找同区间且带 .def 的节点
      const nm = x.ns[0], d = m => { let r = null; if (m.n) walk(m.n, y => { if (r || y.b < m.a || y.a > m.b) return false; if (y.def && y.a == m.a && y.b == m.b) r = y.def }); return r }
      const k = marks.findIndex(m => at(x[2], m) || at(x.node, m) || at(nm, m) || (d(m) && nm && nm.a <= d(m).a && d(m).b <= nm.b))
      if (k >= 0) { moved.add(k); names.add(x[1]) }
    }
    for (const y of x.slice(1)) go(y)
  }
  go(prog); return { names, moved }
}
const EvStep = {
  it: null, n: 0, w: null,
  start() {
    const v = S.ss?.value, w = S.g?.walk && P.walkers[S.g.walk]
    if (!w || !P.isT(v)) { status('当前语法没有 @walk'); return false }
    Step.stop(); this.w = w; this.it = w.steps(v); this.n = 0
    DBG.setDoc(S.doc); DBG.mode = 'line'; DBG.lastKey = null
    return true
  },
  stop() { if (!this.it) return; this.it = null; DBG.mode = 'run'; HL.set('ev', {}); menu.hidden = caretEl.hidden = true; status('') },
  // 停：$n 标记（范围断点）、函数名标记（ret 时停）、#brk 的判断/返回、F11 的语句边界（line=true）
  next(line) {
    if (!this.it && !this.start()) return
    const marks = Marks.list(), B = this.brk(), { names, moved } = fnBreaks(S.ss.value, marks)
    DBG.names = names
    DBG.bps = new Set(marks.filter((m, i) => !moved.has(i)).map(m => m.a + ':' + m.b))
    DBG.mode = line ? 'line' : 'run'
    for (let g = 0; g < 1e6; g++) {
      const r = LISP.step(this.it); this.n++
      if (r.done) { const n = this.n; this.stop(); setResult({ run: r.value, show: this.w.show, label: `逐步执行完毕（${n} 步）` }); return }
      const e = r.value
      const why = DBG.hit(e) || (e.a != null && ((e.ph == 'if' && B.dec) || (e.ph == 'ret' && B.re?.test(this.w.fname(e.f)))) ? 'brk' : null)
      if (why) return this.show(e, why)
    }
  },
  // #brk：以 | 分隔；单独的 ? 表示判断，其余合成正则整体匹配函数名（默认 ?|.* 即所有判断与所有返回）
  brk() {
    const alts = $('#brk').value.split('|').map(s => s.trim()), rest = alts.filter(a => a && a != '?')
    let re = null; if (rest.length) try { re = new RegExp('^(?:' + rest.join('|') + ')$') } catch { status('F8 中断模式不是合法正则') }
    return { dec: alts.includes('?'), re }
  },
  show(e, why) {
    const a = e.a, b = e.b, sh = this.w.show, tag = why == 'line' ? '语句 ' : why == 'name' ? '函数 ' : why == 'bp' ? '标记 ' : ''
    const txt = e.ph == 'ret' ? `[${this.w.fname(e.f)}${e.args.map(a => ' ' + sh(a, 1)).join('')}] ⇒ ${sh(e.v, 1)}`
      : e.ph == 'if' ? `? ${sh(e.c, 1)} → ${e.t ? '真分支' : '假分支'}`
      : e.ph == 'in' ? `⇢ 进入` : `⇠ ${sh(e.v, 1)}`
    if (a != null) { HL.set('ev', { ev: [src.range(a, Math.max(b, a + 1))] }); src.scrollTo(a) }
    popup(a ?? b ?? 0, m => {
      m.append(h('div', 'hd', h('b', null, tag + txt), `  总步骤 #${this.n}`))
      m.append(h('div', 'fr', h('span', null, a != null ? clip(S.ss.src.slice(a, b).replace(/\s+/g, ' '), 40) : ''), h('span', 'sl', S.ss.sloc(a ?? 0))))
    })
    status(`逐步执行 第 ${this.n} 步`)
  },
}

/* ---------- 代码补齐：关键字集合在 ss.comp 登记的候选 ---------- */
const compEl = $('#comp')
const Comp = {
  items: [], i: 0, w: 0, c: 0,
  get on() { return !compEl.hidden },
  update() {
    this.hide()
    if (!S.g?.start || document.activeElement !== src.el) return
    const [c, c2] = src.caret(); if (c != c2) return
    const pre = /[\w-]*$/.exec(src.value.slice(0, c))[0]; if (!pre) return
    const w = c - pre.length, ss = feed(src.value); eat(S.g, ss)
    const set = ss.comp.get(w); if (!set) return
    const items = [...set].filter(x => x.startsWith(pre) && x != pre); if (!items.length) return
    Object.assign(this, { items, i: 0, w, c }); this.show()
  },
  show() {
    compEl.textContent = ''; compEl.append(h('div', 'hd', '补齐 · Tab 接受 · ↑↓'))
    this.items.forEach((x, k) => { const d = h('div', k == this.i ? 'cur' : null, x); d.onmousedown = e => { e.preventDefault(); this.i = k; this.accept() }; compEl.append(d) })
    const r = src.rect(this.c, this.c); compEl.style.left = r.left + 'px'; compEl.style.top = r.bottom + 2 + 'px'; compEl.hidden = false
  },
  hide() { compEl.hidden = true; this.items = [] },
  move(d) { this.i = (this.i + d + this.items.length) % this.items.length; this.show() },
  accept() { const x = this.items[this.i]; src.el.focus(); src.setSel(this.w, this.c); this.hide(); document.execCommand('insertText', false, x) },
}
$.ev(src.el, { blur() { Comp.hide() } })

/* ---------- 上下面板拖动调整 ---------- */
const split = $('#split')
const setSrcH = px => { src.el.style.height = Math.max(60, Math.min(innerHeight - 160, px)) + 'px'; Sloc.draw() }
if (+localStorage.getItem('parviz.srcH')) setSrcH(+localStorage.getItem('parviz.srcH'))
$.ev(split, {
  pointerdown() {
    $.event.preventDefault(); split.setPointerCapture($.event.pointerId); split.classList.add('drag')
    const y0 = $.event.clientY, h0 = src.el.offsetHeight
    const off = $.ev(split, { pointermove() { setSrcH(h0 + $.event.clientY - y0) } })
    $.ev(split, { pointerup() { off(); split.classList.remove('drag'); localStorage.setItem('parviz.srcH', src.el.offsetHeight) } }, { once: true })
  },
})

/* ---------- 键盘（触屏用 #mob 模拟同样的按键） ---------- */
function onKey(e) {
  if (Step.on) {
    if (e.key == 'ArrowRight' || e.key == 'ArrowLeft') { Step.move(e.key == 'ArrowRight' ? 1 : -1, e.shiftKey); e.preventDefault(); return }
    if (e.key == 'Home' || e.key == 'End') { Step.i = e.key == 'Home' ? 0 : Step.vis.length - 1; Step.show(); e.preventDefault(); return }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
    Step.stop(true); if (e.key == 'Escape') { e.preventDefault(); return }
  }
  if (Comp.on && e.target === src.el) {
    if (e.key == 'ArrowDown' || e.key == 'ArrowUp') { Comp.move(e.key == 'ArrowDown' ? 1 : -1); e.preventDefault(); return }
    if (e.key == 'Tab') { Comp.accept(); e.preventDefault(); return }
    if (e.key == 'Escape') { Comp.hide(); e.preventDefault(); return }
    Comp.hide()
  }
  if (/^[1-6]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && !e.target.isContentEditable && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    toolSel.selectedIndex = +e.key - 1; toolSel.onchange(); e.preventDefault(); return
  }
  if (e.key == 'F8') { EvStep.next(false); e.preventDefault(); return }        // 继续到断点/判断
  if (e.key == 'F11') { EvStep.next(true); e.preventDefault(); return }        // 下一条语句
  if (e.key == 'Escape') { EvStep.stop(); return }
  if (e.target === src.el) {
    if (e.key == 'Enter' && (e.ctrlKey || e.metaKey)) { execute(); e.preventDefault() }
    else if (e.key == 'ArrowRight' && !e.ctrlKey && !e.altKey && !e.metaKey) { if (Step.start(e.shiftKey)) e.preventDefault() }
  } else if (e.target === rules.el && e.key == 'Enter' && (e.ctrlKey || e.metaKey)) { compile(); e.preventDefault() }
}
$.ev(document, { keydown() { onKey($.event) } })
for (const b of document.querySelectorAll('#mob button')) {
  $.ev(b, { pointerdown() { $.event.preventDefault() } })   // 不抢输入区焦点
  b.onclick = () => onKey({ key: b.dataset.k, shiftKey: !!b.dataset.shift, ctrlKey: !!b.dataset.ctrl, target: src.el, preventDefault() {} })
}
$.ev(src.el, { mousedown() { if (Step.on) Step.stop() } })
$.ev(document, { paste() { if (performance.now() - S.midAt < 500) $.event.preventDefault() } }, true)   // 中键点树引起的粘贴：别写进输入区
$.ev(menu, { mouseover() { const r = $.event.target.closest('[data-rule]'); if (r) showRule(r.dataset.rule) } })

/* ---------- 作用域：悬停引用连线到定义，点引用翻页跳到定义，点声明用箭头反查引用 ---------- */
let hot = null   // 悬停联动树节点
$.ev(src.el, {
  mousemove() {
    if (!S.ss?.tree || S.ss.src !== src.value) return
    const i = src.offsetAt($.event.clientX, $.event.clientY), n = i < 0 ? null : deepest(S.ss.tree, i, n => S.doc?.idOf.has(n)), el = n && elFor(n)
    if (el === hot) return
    hot?.classList.remove('hot'); hot = el; el?.classList.add('hot')
  },
  mouseleave() { hot?.classList.remove('hot'); hot = null },
  scroll() { Sloc.draw() },
})
$.ev(rules.el, { scroll() { Sloc.draw() } })
Xref.wire({ ed: src, ssOf: () => S.ss, sloc: Sloc, status }); Xref.wire({ ed: rules, ssOf: () => S.rss, sloc: Sloc, status })
$.ev(window, { resize() { Sloc.draw() } })
hookTree($('#tree'))

/* ---------- 示例 + location.hash ----------
   #..名字                  内置示例
   #xx.js..名字             先取 xx.js（整个文件就是一句 (P) => { funcs?, examples:[{name, rules, input}] }），
                            示例并进选择菜单，再选中名字；省掉名字就选它第一个
   #…:~<url 编码的源码>     同一套规则，换成这段源码；要远程取文本就写 fetch:<URL>，否则原样当字面量
   分隔符用 :~ 而不是 :~: —— Chrome 会把 :~: 当成 text fragment 指令从 location.hash 里吃掉 */
const sel = $('#ex'), HASH_SEP = ':~'
examples.forEach((x, i) => sel.append(new Option(x.name, i)))
const rulesOf = x => x.rules ?? examples.find(y => y.name == x.same)?.rules
const dec = s => { try { return decodeURIComponent(s) } catch { return s } }
function readHash() {
  const raw = location.hash.slice(1), k = raw.indexOf(HASH_SEP)
  const head = dec(k < 0 ? raw : raw.slice(0, k)).replace(/^ex=/, '').trim(), j = head.lastIndexOf('..')
  return { mod: j < 0 ? '' : head.slice(0, j), who: j < 0 ? head : head.slice(j + 2), src: k < 0 ? null : dec(raw.slice(k + HASH_SEP.length)) }
}
function writeHash(who, spec) {
  const h = '#' + encodeURIComponent(who) + (spec == null ? '' : HASH_SEP + encodeURIComponent(spec))
  if (location.hash == h) return
  try { history.replaceState(null, '', h) } catch {}
}
const headOf = x => (x.mod ? x.mod + '..' : '..') + x.name   // 地址栏写法：模块..名字
// 源码没被改过就沿用载入时的写法（可能是个 URL），改过就写当前文本；等于示例默认值时不写源码段
function syncHash() {
  const x = examples[+sel.value]; if (!x) return
  const t = src.value === S.srcSeen ? S.srcSpec : src.value
  writeHash(headOf(x), t === x.input ? null : t)
}
function load(i, text, spec = text) {
  const x = examples[i]; sel.value = i
  const s = text ?? x.input
  Object.assign(S, { srcSeen: s, srcSpec: s === x.input ? null : spec, zoom: null })
  writeHash(headOf(x), S.srcSpec)
  S.ss = null; S.onedit = null; Edits.seq = null; S.folds.clear(); S.unfold.clear()
  rules.value = rulesOf(x)
  src.value = s; status(''); compile()
}
async function fetchText(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}
/* 动态示例模块：一个 URL 只取一次；文件里没有 P/require，只有一句 (P) => ({ funcs, examples }) */
const mods = new Map
function loadMod(url) {
  if (mods.has(url)) return mods.get(url)
  const p = (async () => {
    status(`加载示例模块 ${url}`)
    const make = new Function(`"use strict";return (${await fetchText(url)})`)()
    if (typeof make != 'function') throw new Error('要写成 (P) => ({ funcs?, examples })')
    const m = make(P)
    Object.assign(P.funcs, m.funcs || {})
    const ids = (m.examples || []).map(x => {
      let name = x.name || url.split(/[?#]/)[0].split('/').pop()
      while (examples.some(y => y.name == name)) name += '′'   // 名字要能唯一定位，hash 才能指回来
      return examples.push({ ...x, name, mod: url }) - 1
    })
    for (const i of ids) sel.append(new Option(examples[i].name, i))
    return { ids }
  })()
  mods.set(url, p); p.catch(() => mods.delete(url))   // 取失败不缓存，改了文件再点一次就能重试
  return p
}
const srcUrl = s => /^fetch:/i.test(s) ? s.slice(6) : null   // 源码段：只有 fetch:<URL> 才去取，其余一律当字面量
async function fromHash() {
  const { mod, who, src: text } = readHash()
  try {
    const r = mod ? await loadMod(mod) : null
    let i
    if (!who) i = r ? r.ids[0] ?? -1 : +sel.value || 0
    else if (!r && /^\d+$/.test(who)) i = +who
    else i = r ? r.ids.find(k => examples[k].name == who) ?? -1 : examples.findIndex(x => x.name == who)
    if (i < 0 || i >= examples.length) throw new Error(r ? `${mod} 里没有 ${who}` : `没有示例 ${who}`)
    const u = text == null ? null : srcUrl(text)
    load(i, u ? await fetchText(u) : text, text)
  } catch (e) { status(`示例加载失败：${e.message}`) }
}
sel.onchange = () => load(+sel.value)
$.ev(window, { hashchange: fromHash })
if (!window.CSS?.highlights) status('此浏览器不支持 CSS Custom Highlight API，高亮不可用')

/* ---------- 界面文案：原文即键（和 f`` 共用 i18n/<lang>.json）；只扫界面骨架，动态文本不碰 ---------- */
const I18N_ROOT = 'header, #side .hd, #mob, #split, title', I18N_ATTR = ['title', 'placeholder', 'aria-label']
const i18nTxt = new WeakMap, i18nAttr = new WeakMap   // 节点 → 原文：换回中文时按原文写回
const uiTr = s => {
  const k = s.trim(); if (!k) return s
  P.f.seen.add(k)                                      // 缺键也照收：P.f.seen 就是待补词典
  const v = P.f.dict[k]; return v == null ? s : s.replace(k, v)
}
function i18nApply() {
  for (const r of document.querySelectorAll(I18N_ROOT)) {
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT)
    for (let t; (t = w.nextNode());) {
      if (t.parentElement?.closest('#status, #ex option')) continue   // 状态栏 / 示例名是数据
      if (!i18nTxt.has(t)) i18nTxt.set(t, t.nodeValue)
      t.nodeValue = uiTr(i18nTxt.get(t))
    }
    for (const el of [r, ...r.querySelectorAll('*')]) for (const a of I18N_ATTR) {
      if (el.closest('#status')) continue
      const v = el.getAttribute(a); if (!v?.trim()) continue
      let m = i18nAttr.get(el); if (!m) i18nAttr.set(el, m = {})
      if (!(a in m)) m[a] = v
      el.setAttribute(a, uiTr(m[a]))
    }
  }
}
/* ---------- 报错语言：i18n/<lang>.json 翻译 f`` 的常量段与上面的界面文案 ---------- */
const langSel = $('#lang')
async function setLang(l) {
  try { P.f.dict = l == 'zh' ? {} : await (await fetch(`i18n/${l}.json`)).json() } catch (e) { status(`加载 i18n/${l}.json 失败：${e.message}`); return }
  langSel.value = l; localStorage.setItem('parviz.lang', l); document.documentElement.lang = l
  i18nApply(); compile()
}
langSel.onchange = () => setLang(langSel.value)

if(location.pathname=='/') location.hash||='#extra.js..URL:~https%3A%2F%2Fgithub.com%2Fsearch%3Fq%3D1%26a%3D2%0A'
i18nApply()
fromHash()
if ((localStorage.getItem('parviz.lang') || 'zh') != 'zh') setLang(localStorage.getItem('parviz.lang'))
