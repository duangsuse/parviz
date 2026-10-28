/* ui.js — 编辑器（单文本节点 + CSS.highlights）、语法树/编译结果视图、sloc 全屏标注与 $n 标记、
   步进可视化、逐步执行、规则区、颜色表。F12：$1 输入流  $2 最后悬停  $3 语法  $4 最近结果  $5.. 标记 */
'use strict'
const { feed, eat, grammar, walk, examples, errsOf, Node } = P
const clip = (s, n = 40) => s.length > n ? s.slice(0, n) + '…' : s
const A = i => String.fromCharCode(65 + i)

const src = new Editor($('#src'), 'src'), rules = new Editor($('#rules'), 'rules')


/* ---------- 状态 ---------- */
const S = {
  meta: grammar(P.META), g: null, ss: null, rss: null, elOf: new Map, last: '', timer: 0, rtimer: 0,
  onedit: null, res: null, stale: false, view: 'cst', tool: 'eval', folds: new Set, unfold: new Set, down: false, pendingParse: false, collapse: true,
  srcSeen: null, srcSpec: null, zoom: null, midAt: 0,
}
const status = t => $('#status').textContent = t
const deepest = (root, i, ok = () => true) => { let best = null; walk(root, n => { if (n.a <= i && i < Math.max(n.b, n.a + 1)) { if (ok(n)) best = n; return } return false }); return best }
const exactNode = (a, b) => { let r = null; if (S.ss?.tree) walk(S.ss.tree, n => { if (r) return false; if (n.a == a && n.b == b && n.k != 'top') { r = n; return false } if (n.b < a || n.a > b) return false }); return r }
Object.assign(window, { ss: null, $1: null, $2: null, $3: null, $4: undefined })   // F12 槽位，见文件头
const elFor = n => { for (let x = n; x; x = x.kids.length == 1 ? x.kids[0] : null) { const e = S.elOf.get(x); if (e) return e } }
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

/* ---------- 语法树：[Tag ..] 照常，[-Tag] 已折叠，[.. ] 匿名列表；规则体为有序选择时 Tag 带分支 Val.A ---------- */
function treeDOM(root, ss, o) {
  let count = 0
  const nd = (n, cls, kids, x) => { const e = h('span', 'nd ' + (cls || ''), ...kids); e.dataset.i = o.reg.push(n) - 1; if (x) e.dataset.x = o.regX.push(x) - 1; o.elOf?.set(n, e); return e }
  const tok = (n, c, title) => { const e = nd(n, (c || '') + (n.err ? ' err' : ''), [n.text ?? ss.src.slice(n.a, n.b)]); e.title = title || n.err || ''; return e }
  const box = (n, tag, kids, { x, tagc, anon, view } = {}) => {
    const k = n.a + ':' + n.b + ':' + tag
    const e = nd(n, 'box' + (view ? ' vw' : ''), [h('span', 'br', '['), h('span', 'tag' + (tag == '..' ? ' anon' : '') + (tagc ? ' ' + tagc : ''), tag), h('span', 'kids', ...kids), h('span', 'br', ']')], x)
    e.dataset.k = k; if (anon) e.dataset.anon = 1
    if (o.folds?.has(k)) e.classList.add('fold')
    if (e.textContent.length > 90) e.classList.add('blk')
    return e
  }
  const parTail = n => {
    const k = 'par:' + n.a + ':' + n.b, pv = h('span', 'pv')
    for (const p of [n.pair[0], n.pair[2]]) { const s = h('span', null, p < 0 ? ' "未闭合"' : ` "${ss.lc(p).join(':')}"`); if (p >= 0) s.dataset.pos = p; pv.append(s) }
    const e = h('span', 'par' + (o.unfold?.has(k) ? '' : ' fold'), h('span', 'br', '['), h('span', 'tag', ':par'), pv, h('span', 'br', ']'))
    e.dataset.k = k; return e
  }
  const leaf = (n, inh) => {  // 规则链 Lit→Num→123 折叠为一个词条
    const names = []; let c = inh
    while (n.k == 'rule') { names.push(n.r + (n.alt != null ? '.' + A(n.alt) : '')); c = colorOf(n, o.colors) || c; n = n.kids[0] }
    if (n.kids.length && n.k != 'err') return null
    return { n, c: colorOf(n, o.colors) || c, names }
  }
  // 只有一个子元素的规则不再套一层（规则名进 title），除非那个子元素是匿名列表
  const one = ks => ks.length == 1 && !ks[0].classList.contains('par') && !(ks[0].dataset.anon && !ks[0].classList.contains('vw')) ? ks[0] : null
  const viewEl = (v, n) => v instanceof Node ? node(v, null)
    : box(v.node || n, v.tag, v.kids.map(k => k instanceof Node ? node(k, null) : viewEl(k, n)), { x: v.x, tagc: v.h && colorOf(v.h, o.colors), anon: v.tag == '..', view: true })
  const node = (n, inh) => {
    if (++count > o.max) return h('span', 'more', '…')
    if (n.view) return viewEl(n.view, n)
    const c = colorOf(n, o.colors) || inh
    if (n.k == 'err') { const e = nd(n, 'R err', [n.b > n.a ? clip(ss.src.slice(n.a, n.b)) : '😡😡😡']); e.title = n.err; return e }
    if (n.k == 'bin') return box(n, n.kids[1].text, [n.kids[0], n.kids[2]].flatMap(k => flat(k, c)))   // 算符表：[+ 左 右]
    if (!n.kids.length) return tok(n, c)
    if (n.k == 'rule') {
      const lf = leaf(n, inh)
      if (lf) return tok(lf.n, lf.c, lf.names.join(' → ') + (lf.n.err ? '\n' + lf.n.err : ''))
      const tag = n.r + (n.alt != null ? '.' + A(n.alt) : ''), ks = flat(n.kids[0], c), e = one(ks)
      if (e) { e.title = tag + ' → ' + e.title; return e }
      return box(n, tag, ks)
    }
    return box(n, '..', flat(n, c), { anon: true })
  }
  const flat = (n, inh, inPar) => {   // inPar：作为 :par 的内层时，空列表 [..] 也显示（表示“空”）
    if (n.view) return [viewEl(n.view, n)]
    const c = colorOf(n, o.colors) || inh
    switch (n.k) {
      case 'seq': case 'opt': case 'top': return n.kids.flatMap(k => flat(k, c))
      case 'join': case 'many': return !n.kids.length && !inPar ? [] : [box(n, '..', n.kids.filter(k => !k.sep || k.err).map(k => node(k, c)), { anon: true })]
      case 'par': return [...n.kids.flatMap(k => flat(k, c, true)), parTail(n)]
      case 'lit': return n.err ? [tok(n, c)] : []
      default: return [node(n, inh)]
    }
  }
  return h('div', 'tree', ...flat(root, null))
}
// 编译结果：每条规则实例显示为 [Name 组合子结构]；组合子同样写成调用形式
function gDOM(g, o) {
  const tk = (cls, t) => h('span', 'nd ' + cls, t)
  const box = (tag, kids, k) => {
    const e = h('span', 'nd box', h('span', 'br', '['), h('span', 'tag' + (tag == '..' ? ' anon' : ''), tag), h('span', 'kids', ...kids), h('span', 'br', ']'))
    e.dataset.k = 'g:' + k; if (o.folds.has(e.dataset.k)) e.classList.add('fold')
    if (e.textContent.length > 90) e.classList.add('blk')
    return e
  }
  let id = 0
  const OPS = { seq: '..', alt: '<', join: '+', many: '*', opt: '?', mark: ':setRecur', par: ':par' }
  const pv = p => {
    if (!p) return tk('', '∅')
    if (p.kind == 'rule') { const e = tk('G', p.label); e.dataset.rule = p.label; return e }
    if (p.kind == 'tok' || p.kind == 'lit') return tk('Y', p.label)
    if (p.kind == 'kw') return tk('B', p.label)
    if (p.kind == 'recur') return tk('P', 'Recur')
    if (p.kind == 'kwset') return box(p.empty ? 'kwd -' : 'kwd', p.words.map(w => tk('B', w)), ++id)
    if (p.kind == 'prec') return box('- 算符表', [pv(p.parts[0]), ...p.levels.flatMap((L, l) => [l ? tk('', ';') : null, ...L.map(pv)]).filter(Boolean)], ++id)   // 操作数 + 各级（; 分隔，越往后越紧）
    return box(p.kind == 'fn' ? p.fname : OPS[p.kind], p.parts.filter(Boolean).map(pv), ++id)
  }
  const hd = h('div', 'gh', `起始 ${g.startName}  @skip ${g.some ? 'some ' : ''}${g.skip ? '/' + g.skip.source + '/' : 'none'}${g.walk ? '  @walk ' + g.walk : ''}  配对 ${g.pairs.map(p => p.join('')).join(' ') || '∅'}  颜色 ${Object.entries(g.colors).map(kv => kv.join('=')).join(' ') || '∅'}`)
  const out = h('div', 'tree', hd)
  for (const [key, I] of g.insts) {
    const name = key.replace(/\[.*$/, ''), label = key.replace(/^(\w+)\[(.*)\]$/, '$1($2)')
    const e = box(label, [pv(I.body)], key); e.querySelector('.tag').dataset.rule = name
    out.append(e, h('br'))
  }
  for (const e of g.errs) out.append(h('div', 'R', `${e.msg}`))
  return out
}
function setFold(el, folded) {
  el.classList.toggle('fold', folded); const k = el.dataset.k; if (!k) return
  if (el.classList.contains('par')) folded ? S.unfold.delete(k) : S.unfold.add(k); else folded ? S.folds.add(k) : S.folds.delete(k)
}
const toggleFold = el => { setFold(el, !el.classList.contains('fold')); Sloc.draw() }
// 深度折叠展开：已折叠则连同所有子孙一起展开，否则连同所有子孙一起折叠（之后点 Tag 一层层展开）
const deepFold = el => { const f = !el.classList.contains('fold'); for (const x of [el, ...el.querySelectorAll('.box')]) setFold(x, f); Sloc.draw() }
function hookTree(host) {
  host.addEventListener('mouseover', e => {
    const r = e.target.closest('[data-rule]'); if (r) showRule(r.dataset.rule)
    const t = e.target.closest('.nd[data-i]'); if (t) Sloc.hover(t.closest('.tree')._reg[t.dataset.i], t)
  })
  host.addEventListener('mouseout', e => { if (e.target.closest('.nd[data-i]')) Sloc.hover(null) })
  host.addEventListener('mousedown', e => {
    if (e.detail > 1 || e.button == 1) e.preventDefault()   // 双击不选中文字；中键不自动滚屏
    if (e.button == 1) S.midAt = performance.now()          // 记下中键：Chromium 会把 PRIMARY 选区粘进聚焦的输入区
  })
  host.addEventListener('mouseup', e => { if (e.button == 1) e.preventDefault() })
  // 中键：只看这棵子树（铺满树面板）；右键：回到整棵树
  host.addEventListener('auxclick', e => {
    if (e.button != 1) return
    const t = e.target.closest('.nd[data-i]'), nx = t && nodeOf(t)
    if (!nx) return
    e.preventDefault(); zoomTo(nx[0])
  })
  host.addEventListener('contextmenu', e => { if (S.zoom) { e.preventDefault(); zoomTo(null) } })
  // 单击：只有折叠工具才折叠（括号、Tag 也一样），其他按当前工具；:par 尾巴总是可展开
  host.addEventListener('click', e => {
    if (e.detail > 1) return
    const p = e.target.closest('[data-pos]'); if (p && !p.closest('.fold')) { goto(+p.dataset.pos, +p.dataset.pos + 1); return }
    const pr = e.target.closest('.par'); if (pr) { toggleFold(pr); return }
    const t = e.target.closest('.nd'); if (!t) return
    if (foldTool(t)) return
    const nx = nodeOf(t); if (nx) useTool(...nx)
  })
  // 双击 = 标记：折叠工具先撤销第一下；标记工具第一下已标过
  host.addEventListener('dblclick', e => {
    const t = e.target.closest('.nd'); if (!t || e.target.closest('.par')) return
    foldTool(t); if (S.tool == 'mark' || S.tool == 'line') return
    const nx = nodeOf(t); if (nx && S.ss) { Marks.toggle(nx[0]); goto(nx[0].a, nx[0].b, true) }
  })
  host.addEventListener('scroll', () => Sloc.draw())
}
function renderTree() {
  const host = $('#tree'), st = host.scrollTop, ss = S.ss
  host.textContent = ''; S.elOf = new Map
  $('#bView').classList.toggle('on', S.view == 'g')
  if (S.view == 'g') { if (S.g) host.append(gDOM(S.g, S)) }
  else if (ss?.tree) {
    const o = { reg: [], regX: [], elOf: S.elOf, folds: S.folds, unfold: S.unfold, colors: S.g.colors, max: 6000 }
    const t = treeDOM(S.zoom || ss.tree, ss, o); t._reg = o.reg; t._regX = o.regX; host.append(t)
  }
  host.scrollTop = st
}

const nodeOf = t => { const tr = t.closest('.tree'); return t.dataset.i == null || !tr?._reg ? null : [tr._reg[t.dataset.i], t.dataset.x != null ? tr._regX[t.dataset.x] : null] }
// 子树缩放：树面板只渲染这个节点；右键（contextmenu）回到根
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
function useTool(n, x) {
  if (!S.ss) return
  if (S.tool == 'mark' || S.tool == 'line') { Marks.toggle(n, S.tool == 'line'); goto(n.a, n.b, true) }
  else if (S.tool == 'clear') S.ss.marks = []
  else if (S.tool == 'eval') evalNode(n, x)
}
function evalNode(n, x) {
  const ast = x || n.v, w = S.g.walk && P.walkers[S.g.walk]
  if (w && P.isT(ast) && P.isT(S.ss.value)) setResult({ run: w.node(ast, S.ss.value), show: w.show, label: `独立求值 ${S.ss.sloc(n)}` })
  else setResult({ v: n.v, label: `节点值 ${S.ss.sloc(n)}` })
}
const toolSel = $('#tool')
toolSel.onchange = () => { S.tool = toolSel.value; status('工具：' + toolSel.selectedOptions[0].text) }
toolSel.addEventListener('wheel', e => {
  e.preventDefault(); const n = toolSel.options.length
  toolSel.selectedIndex = (toolSel.selectedIndex + (e.deltaY > 0 ? 1 : -1) + n) % n; toolSel.onchange()
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
  label(txt, r, cls, on) { const m = h('div', 'mk ' + (cls || ''), txt); m.style.left = r.left + 'px'; m.style.top = r.top + 'px'; Object.assign(m, on); this.mks.append(m); return m },
  path(a, b, cls, ref) {  // a、b 连线：两端各落在朝向对方的边上；cls 'ar' 时箭头扎进 a 那条边；ref：同编辑区内的引用箭头
    const mid = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    const edge = (r, dx, dy) => {   // r 上朝 (dx,dy) 的边：点 + 外法线（竖直方向略占优）
      if (Math.abs(dy) > Math.abs(dx) * .5) return { p: { x: r.left + Math.min(r.width, 30) / 2, y: dy > 0 ? r.bottom : r.top }, n: { x: 0, y: dy > 0 ? 1 : -1 } }
      return { p: { x: dx > 0 ? r.right : r.left, y: r.top + r.height / 2 }, n: { x: dx > 0 ? 1 : -1, y: 0 } }
    }
    const ac = mid(a), bc = mid(b)
    const A = edge(a, bc.x - ac.x, bc.y - ac.y), B = edge(b, ac.x - bc.x, ac.y - bc.y)   // A = 箭头那端
    // 跨面板：按距离外推 12–60px；同一编辑区内的引用（ref）：控制点只取纵向间距的一半，不跨出两行之外
    const d = ref ? Math.abs(ac.y - bc.y) / 2 : Math.min(140, Math.max(12, Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y) / 2.5))
    const c1 = { x: B.p.x + B.n.x * d, y: B.p.y + B.n.y * d }, c2 = { x: A.p.x + A.n.x * d, y: A.p.y + A.n.y * d }
    const ar = cls == 'ar', L = 12, W = 11
    const tip = A.p, base = { x: tip.x + A.n.x * L, y: tip.y + A.n.y * L }   // 三角底在 a 外面，尖端扎进边里
    const q = { x: -A.n.y * W / 2, y: A.n.x * W / 2 }
    const flat = ar && Math.abs(ac.y - bc.y) < Math.max(a.height || 16, b.height || 16) * .5   // 同一行：横线会压着代码，只留箭头
    if (!flat) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', `M${B.p.x},${B.p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${(ar ? base : tip).x},${(ar ? base : tip).y}`)
      if (cls) p.setAttribute('class', cls)
      this.svg.append(p)
    }
    if (ar) {
      const hd = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hd.setAttribute('d', `M${tip.x},${tip.y} L${base.x + q.x},${base.y + q.y} L${base.x - q.x},${base.y - q.y}Z`)
      hd.setAttribute('class', 'ah')
      this.svg.append(hd)
    }
  },
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
const textEnd = el => {   // 错误行文字右端的零宽矩形：连线从右侧引出
  const rg = document.createRange(); rg.selectNodeContents(el)
  const rs = rg.getClientRects(), q = rs[rs.length - 1]
  return q ? { left: q.right, right: q.right, top: q.top, bottom: q.bottom, width: 0, height: q.height } : el.getBoundingClientRect()
}
function renderOut() {
  const out = $('#out'), ss = S.ss; out.textContent = ''
  if (Sloc.hov?.from) Sloc.hover(null)   // 输出重排，旧的错误连线作废
  out.append(h('div', 'cm', '// try ss.onedit=alert'))
  ss?.errs.forEach((e, k) => {
    const it = h('span', 'eitem', `E${k + 1} ${ss.sloc(e.a)}  ${e.msg}`)
    it.onclick = () => goto(e.a, e.b)
    it.onmouseenter = () => { Sloc.hov = { from: textEnd(it), to: src.rect(e.a, Math.max(e.b, e.a + 1)), cls: 'e' }; HL.set('hov', { hov: [src.range(e.a, Math.max(e.b, e.a + 1))] }); Sloc.draw() }
    out.append(it)
  })
  const r = S.res, oe = h('span', 'oe cm', S.onedit ? `   // ${S.onedit}` : '')
  if (r?.run) {
    for (const l of r.run.log) out.append(h('div', l.out != null ? 'log' : 'warn', l.out ?? `⚠ ${l.warn}`))
    if (r.run.err) { const e = h('span', 'eitem', `求值错误：${r.run.err}`), xn = r.run.x?.node; if (xn) e.onclick = () => goto(xn.a, xn.b); out.append(e, h('div', 'val', oe)) }
    else out.append(h('div', 'val', h('b', null, '$4'), ' = ' + fmt(r.run.value, r.show), h('span', 'cm', `   // ${r.label}`), oe))
  } else if (r) out.append(h('div', 'val', h('b', null, '$4'), ' = ' + fmt(r.v), r.label ? h('span', 'cm', `   // ${r.label}`) : null, oe))
  else out.append(h('div', 'val', oe))
}

/* ---------- 解析 / 执行 ---------- */
$('#out').addEventListener('mouseleave', () => { if (Sloc.hov?.from) Sloc.hover(null) })   // 指针离开输出区才收起错误连线

function parse() {
  clearTimeout(S.timer); S.timer = 0; Step.stop(); EvStep.stop()
  const focused = document.activeElement === src.el, sel = focused ? src.caret() : null
  src.fix(); S.last = src.value
  if (!S.g?.start) { status('语法未编译成功'); renderTree(); return }
  const prev = S.ss, ss = feed(src.value)
  wireFeed(ss, prev)
  const t0 = performance.now(); let v
  try { v = eat(S.g, ss) } catch (e) { status('解析异常：' + e.message); console.error(e); return }
  S.ss = ss; S.stale = false; window.ss = window.$1 = ss; window.$3 = S.g; S.zoom = null   // 新树：子树缩放失效
  Sloc.rev = Sloc.ref = null   // 节点换了，反查箭头作废
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
  if (T) { T.text = newT; const r = src.rmap.get(T); if (r) { r.setStart(src.t, T.a); r.setEnd(src.t, T.b) } }
  Edits.sync(ss)
  HL.flush(); renderTree(); Marks.changed(); renderOut(); syncHash()
  status(`顺延 ${d > 0 ? '+' : ''}${d} @${ss.sloc(a)}`)
  return true
}
src.el.addEventListener('input', () => {
  if (Step.on) Step.stop()
  const ok = src.fix(), old = S.last, now = src.value; S.last = now
  if (!(ok && tryShift(old, now))) { clearTimeout(S.timer); S.timer = setTimeout(requestParse, 700) }   // 结构性编辑：停顿后重解析，旧高亮保留到新结果一次性替换
  Comp.update()
})
// 鼠标按下期间（如正在点树节点）不重建树：推迟到这次点击处理完
const requestParse = () => { if (S.down) S.pendingParse = true; else parse() }
src.el.addEventListener('blur', () => { if (!Step.on && (S.timer || S.stale || S.ss?.src !== src.value)) requestParse() })   // 失焦自动解析
document.addEventListener('pointerdown', () => { S.down = true }, true)
document.addEventListener('pointerup', () => { S.down = false; if (S.pendingParse) { S.pendingParse = false; setTimeout(parse, 0) } }, true)

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
  rules.fix(); S.g = grammar(rules.value); window.$3 = S.g; Edits.seq = null
  paintRules()
  if (S.g.start) parse(); else { status(`语法错误 ${S.g.errs.length} 处`); renderTree() }
}
rules.el.addEventListener('input', () => { rules.fix(); clearTimeout(S.rtimer); S.rtimer = setTimeout(compile, 600) })
$('#bView').onclick = () => { S.view = S.view == 'g' ? 'cst' : 'g'; renderTree(); Marks.changed() }

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
  let best = null, br = null, cover = null
  if (S.ss?.tree) walk(S.ss.tree, n => {
    if (n.b < a || n.a > b) return false
    const e = S.elOf.get(n); if (!e) return
    if (n.a == a && n.b == b && (!best || (n.r == r && br != r))) { best = e; br = n.r }
    if (n.a <= a && b <= n.b) cover = e
  })
  let el = best || cover
  while (el && !el.offsetParent) el = el.parentElement?.closest('.nd')
  return el
}
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
    Object.assign(this, { ss, ev, vis, on: true, all }); this.recalc()
    // 起点随按键：Shift（逐个事件）取光标后的第一个事件；否则取第一个折叠后保留的事件
    const i = all ? vis.findIndex(k => ev[k].a >= c) : vis.findIndex((k, j) => this.main[j] && ev[k].a >= c)
    this.i = i < 0 ? vis.length - 1 : i
    document.body.classList.add('stepping'); this.show(); return true
  },
  // 折叠纯递归：Tsv→Table→Row→Field 这样未吃任何东西的连续进入只停在最后一个“非叶”规则（叶规则 = 体只是一个词条，如 Bare）；
  // 连续的返回只停在第一个
  recalc() {
    const ev = this.ev, vis = this.vis, E = j => ev[vis[j]]
    const ruleIn = j => E(j)?.t == 'in' && !E(j).st.at(-1)?.tok, tokIn = j => E(j)?.t == 'in' && !!E(j).st.at(-1)?.tok
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
    const top = [...e.st].reverse().find(f => !f.tok), hl = {}
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
      ;[...e.st].reverse().forEach((f, k) => {
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
// [= f (=> ..)]、定义处函数名、引用处函数名上的标记 = 函数断点：像表达式断点的返回一样，在该函数每次返回时一次性显示 [f 实参..] ⇒ 返回值
// 返回 { bp: lambda 节点→标记序号, moved: 改作函数断点的标记序号 }
function fnBreaks(prog, marks) {
  const bp = new Map, moved = new Set; if (!marks.length) return { bp, moved }
  const at = (n, m) => n && m.a == n.a && m.b == n.b
  const go = x => {
    if (!P.isT(x)) return
    if (x[0] == '=' && P.isT(x[2]) && x[2][0] == '=>') {
      // 标记可能落在包着引用词条的外层节点上（同区间的 seq/规则）：在其子树里找同区间且带 .def 的节点
      const nm = x.ns[0], d = m => { let r = null; if (m.n) walk(m.n, y => { if (r || y.b < m.a || y.a > m.b) return false; if (y.def && y.a == m.a && y.b == m.b) r = y.def }); return r }
      const k = marks.findIndex(m => at(x.node, m) || at(nm, m) || (d(m) && nm && nm.a <= d(m).a && d(m).b <= nm.b))
      if (k >= 0) { moved.add(k); bp.set(x[2].node, k) }
    }
    for (const y of x.slice(1)) go(y)
  }
  go(prog); return { bp, moved }
}
const EvStep = {
  it: null, n: 0, w: null,
  start() {
    const v = S.ss?.value, w = S.g?.walk && P.walkers[S.g.walk]
    if (!w || !P.isT(v)) { status('当前语法没有 @walk'); return false }
    Step.stop(); this.w = w; this.it = w.steps(v); this.n = 0; return true
  },
  stop() { if (!this.it) return; this.it = null; HL.set('ev', {}); menu.hidden = caretEl.hidden = true; status('') },
  // 只在：标记了 $n 的节点、调用返回（连实参带返回值）、判断 处中断；名字解析与函数进入不停
  next() {
    if (!this.it && !this.start()) return
    const marks = Marks.list(), mk = n => n ? marks.findIndex(m => m.n === n || (m.a == n.a && m.b == n.b)) : -1, B = this.brk()
    const { bp, moved } = fnBreaks(S.ss.value, marks)
    for (let g = 0; g < 1e6; g++) {
      const r = this.it.next(); this.n++
      if (r.done) { const n = this.n; this.stop(); setResult({ run: r.value, show: this.w.show, label: `逐步执行完毕（${n} 步）` }); return }
      const e = r.value; let k = mk(e.n)
      if (moved.has(k)) k = -1                                                            // 定义/函数名本身不停
      if (k < 0 && e.ph == 'ret' && e.f?.t == 'fn' && bp.has(e.f.node)) k = bp.get(e.f.node)   // 改停在该函数返回时
      if (k >= 0 || (e.n && ((e.ph == 'if' && B.dec) || (e.ph == 'ret' && B.re?.test(this.w.fname(e.f)))))) return this.show(e, k)
    }
  },
  // #brk：以 | 分隔；单独的 ? 表示判断，其余合成正则整体匹配函数名（默认 ?|.* 即所有判断与所有返回）
  brk() {
    const alts = $('#brk').value.split('|').map(s => s.trim()), rest = alts.filter(a => a && a != '?')
    let re = null; if (rest.length) try { re = new RegExp('^(?:' + rest.join('|') + ')$') } catch { status('F8 中断模式不是合法正则') }
    return { dec: alts.includes('?'), re }
  },
  show(e, k) {
    const n = e.n, sh = this.w.show, tag = k >= 0 ? `$${5 + k} ` : ''
    const txt = e.ph == 'ret' ? `[${this.w.fname(e.f)}${e.args.map(a => ' ' + sh(a, 1)).join('')}] ⇒ ${sh(e.v, 1)}`
      : e.ph == 'if' ? `? ${sh(e.c, 1)} → ${e.t ? '真分支' : '假分支'}`
      : e.ph == 'in' ? `⇢ 进入` : `⇠ ${sh(e.v, 1)}`
    HL.set('ev', { ev: [src.range(n.a, n.b)] }); src.scrollTo(n.a)
    popup(e.ph == 'in' ? n.a : n.b, m => {
      m.append(h('div', 'hd', h('b', null, tag + txt), `  总步骤 #${this.n}`))
      m.append(h('div', 'fr', h('span', null, clip(S.ss.src.slice(n.a, n.b).replace(/\s+/g, ' '), 40)), h('span', 'sl', S.ss.sloc(n))))
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
src.el.addEventListener('blur', () => Comp.hide())

/* ---------- 上下面板拖动调整 ---------- */
const split = $('#split')
const setSrcH = px => { src.el.style.height = Math.max(60, Math.min(innerHeight - 160, px)) + 'px'; Sloc.draw() }
if (+localStorage.getItem('parviz.srcH')) setSrcH(+localStorage.getItem('parviz.srcH'))
split.addEventListener('pointerdown', e => {
  e.preventDefault(); split.setPointerCapture(e.pointerId); split.classList.add('drag')
  const y0 = e.clientY, h0 = src.el.offsetHeight, mv = ev => setSrcH(h0 + ev.clientY - y0)
  split.addEventListener('pointermove', mv)
  split.addEventListener('pointerup', () => { split.removeEventListener('pointermove', mv); split.classList.remove('drag'); localStorage.setItem('parviz.srcH', src.el.offsetHeight) }, { once: true })
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
  if (e.key == 'F8') { EvStep.next(); e.preventDefault(); return }
  if (e.key == 'Escape') { EvStep.stop(); return }
  if (e.target === src.el) {
    if (e.key == 'Enter' && (e.ctrlKey || e.metaKey)) { execute(); e.preventDefault() }
    else if (e.key == 'ArrowRight' && !e.ctrlKey && !e.altKey && !e.metaKey) { if (Step.start(e.shiftKey)) e.preventDefault() }
  } else if (e.target === rules.el && e.key == 'Enter' && (e.ctrlKey || e.metaKey)) { compile(); e.preventDefault() }
}
document.addEventListener('keydown', onKey)
for (const b of document.querySelectorAll('#mob button')) {
  b.addEventListener('pointerdown', e => e.preventDefault())   // 不抢输入区焦点
  b.onclick = () => onKey({ key: b.dataset.k, shiftKey: !!b.dataset.shift, ctrlKey: !!b.dataset.ctrl, target: src.el, preventDefault() {} })
}
src.el.addEventListener('mousedown', () => { if (Step.on) Step.stop() })
document.addEventListener('paste', e => { if (performance.now() - S.midAt < 500) e.preventDefault() }, true)   // 中键点树引起的粘贴：别写进输入区
menu.addEventListener('mouseover', e => { const r = e.target.closest('[data-rule]'); if (r) showRule(r.dataset.rule) })

/* ---------- 作用域：悬停引用连线到定义，点引用翻页跳到定义，点声明用箭头反查引用 ---------- */
const declAt = (ss, i) => { let d = null; walk(ss.tree, n => { for (const x of n.defs || []) if (x.node && i >= x.node.a && i < x.node.b) d = x }); return d }
const usesOf = (ss, tok) => { const u = []; walk(ss.tree, n => { if (n.def === tok && n !== tok) u.push(n) }); return u }
function wireScope(ed, ssOf) {
  let refHot = null, saved = ''
  const at = e => { const ss = ssOf(); if (!ss?.tree || ss.src !== ed.value) return null; const i = ed.offsetAt(e.clientX, e.clientY); return i < 0 ? null : { ss, i } }
  ed.el.addEventListener('mousemove', e => {
    const a = at(e), u = a && deepest(a.ss.tree, a.i, n => n.def), d = u?.def || null
    if (d === refHot) return
    refHot = d; Sloc.ref = d ? { ed, d, u } : null
    if (d) { if (!saved) saved = $('#status').textContent; status(`定义于 ${a.ss.sloc(d)} · 点击跳到`) }
    else { status(saved); saved = '' }
    Sloc.draw()
  })
  ed.el.addEventListener('mouseleave', () => { if (!refHot) return; refHot = null; Sloc.ref = null; status(saved); saved = ''; Sloc.draw() })
  ed.el.addEventListener('click', e => {   // 点引用：翻页跳到定义；点声明：箭头反查全部引用
    const a = at(e); if (!a) return
    const { ss, i } = a, u = deepest(ss.tree, i, n => n.def)
    if (u) { ed.setSel(u.def.a, u.def.b); ed.scrollTo(u.def.a); status(`定义于 ${ss.sloc(u.def)}，共 ${usesOf(ss, u.def).length} 处引用`); Sloc.draw(); return }
    const d = declAt(ss, i); if (!d) { if (Sloc.rev) { Sloc.rev = null; Sloc.draw() } return }
    const on = Sloc.rev?.decl === d.node
    Sloc.rev = on ? null : { ed, decl: d.node, uses: usesOf(ss, d.node) }
    status(on ? '' : `${d.name}：${Sloc.rev.uses.length} 处引用`)
    Sloc.draw()
  })
}
let hot = null   // 悬停联动树节点
src.el.addEventListener('mousemove', e => {
  if (!S.ss?.tree || S.ss.src !== src.value) return
  const i = src.offsetAt(e.clientX, e.clientY), n = i < 0 ? null : deepest(S.ss.tree, i, n => S.elOf.has(n)), el = n && S.elOf.get(n)
  if (el === hot) return
  hot?.classList.remove('hot'); hot = el; el?.classList.add('hot')
})
src.el.addEventListener('mouseleave', () => { hot?.classList.remove('hot'); hot = null })
src.el.addEventListener('scroll', () => Sloc.draw())
rules.el.addEventListener('scroll', () => Sloc.draw())
wireScope(src, () => S.ss); wireScope(rules, () => S.rss)
addEventListener('resize', () => Sloc.draw())
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
addEventListener('hashchange', fromHash)
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
