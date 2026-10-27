/* ui.js — 编辑器（单文本节点 + CSS.highlights）、语法树/编译结果视图、sloc 全屏标注与 $n 标记、
   步进可视化、逐步执行、规则区、颜色表。F12：$1 输入流  $2 最后悬停  $3 语法  $4 最近结果  $5.. 标记 */
'use strict'
const { feed, eat, grammar, walk, examples, errsOf, Node } = P
const $ = s => document.querySelector(s)
const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e }
const clip = (s, n = 40) => s.length > n ? s.slice(0, n) + '…' : s
const A = i => String.fromCharCode(65 + i)

/* ---------- 编辑器：contenteditable 中只保留一个 Text 节点，Range 随编辑自动顺延 ---------- */
class Editor {
  constructor(el, key) { this.el = el; this.key = key; el.contentEditable = 'plaintext-only'; el.spellcheck = false; this.t = document.createTextNode(''); el.append(this.t); this.rmap = new Map }
  get value() { return this.t.data }
  set value(s) { this.el.textContent = ''; this.t = document.createTextNode(s); this.el.append(this.t) }
  fix() {  // 浏览器插入了 <br>/<div> 时重建为单个文本节点并恢复光标；返回 false 表示旧 Range 已失效
    const el = this.el
    if (el.childNodes.length == 1 && el.firstChild === this.t) return true
    const [a, b] = this.caret(); let s = ''
    for (const c of el.childNodes) s += c.nodeType == 3 ? c.data : c.nodeName == 'BR' ? '\n' : c.textContent + (c.nodeName == 'DIV' ? '\n' : '')
    this.value = s; if (document.activeElement === el) this.setSel(a, b); return false
  }
  caret() {
    const s = getSelection(); if (!s.rangeCount) return [0, 0]
    const r = s.getRangeAt(0); if (!this.el.contains(r.startContainer)) return [0, 0]
    if (r.startContainer === this.t && r.endContainer === this.t) return [r.startOffset, r.endOffset]
    const off = (n, o) => { const q = document.createRange(); q.setStart(this.el, 0); q.setEnd(n, o); return q.toString().length }
    return [off(r.startContainer, r.startOffset), off(r.endContainer, r.endOffset)]
  }
  range(a, b = a) { const L = this.t.length, r = new Range(); r.setStart(this.t, Math.max(0, Math.min(a, L))); r.setEnd(this.t, Math.max(0, Math.min(b, L))); return r }
  setSel(a, b = a) { const s = getSelection(); s.removeAllRanges(); s.addRange(this.range(a, b)) }
  offsetAt(x, y) {
    const p = document.caretPositionFromPoint?.(x, y); if (p) return p.offsetNode === this.t ? p.offset : -1
    const r = document.caretRangeFromPoint?.(x, y); return r && r.startContainer === this.t ? r.startOffset : -1
  }
  rect(a, b) {  // 屏幕坐标（sloc 以全屏为单位）
    const r = this.range(a, b), rs = r.getClientRects()
    if (rs.length) return rs[0]
    const q = r.getBoundingClientRect(); if (q.width || q.height || a == 0) return q
    return this.range(a - 1, a).getBoundingClientRect()
  }
  visible(r) { const c = this.el.getBoundingClientRect(); return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right }
  scrollTo(a) { const r = this.rect(a, a + 1), c = this.el.getBoundingClientRect(); if (r.top < c.top + 4 || r.bottom > c.bottom - 4) this.el.scrollTop += r.top - c.top - c.height / 3 }
}
const src = new Editor($('#src'), 'src'), rules = new Editor($('#rules'), 'rules')

/* ---------- 颜色表 BYGRP：点图例换色，存 localStorage；树视图与 ::highlight 共用 ---------- */
const Colors = {
  def: { B: '#61afef', Y: '#e5c07b', G: '#98c379', R: '#e06c75', P: '#c678dd' }, cur: null,
  load() { try { this.cur = { ...this.def, ...JSON.parse(localStorage.getItem('parviz.colors') || '{}') } } catch { this.cur = { ...this.def } } this.apply() },
  apply() {
    let css = ''
    for (const [k, v] of Object.entries(this.cur)) {
      document.documentElement.style.setProperty('--' + k, v)
      css += k == 'R' ? `::highlight(R){text-decoration:underline wavy ${v};text-decoration-skip-ink:none}` : `::highlight(${k}){color:${v}}`
    }
    const B = this.cur.B   // 步进选区与判定（有序选择中）都用颜色 B
    css += `::highlight(step){background-color:${B}38}::highlight(stepCh){background-color:${B}70;text-decoration:underline ${B}}`
    $('#hlc').textContent = css
  },
  pick(k) {
    const p = $('#picker'); p.value = this.cur[k]
    p.oninput = () => { this.cur[k] = p.value; this.apply() }
    p.onchange = () => localStorage.setItem('parviz.colors', JSON.stringify(this.cur))
    p.showPicker ? p.showPicker() : p.click()
  },
}
Colors.load()
for (const s of document.querySelectorAll('.lg [data-c]')) s.onclick = () => Colors.pick(s.dataset.c)

/* ---------- 高亮：多个编辑器的 Range 汇总后一次性替换（不闪烁） ---------- */
const HL = {
  per: {}, names: ['B', 'Y', 'G', 'P', 'R', 'hov', 'step', 'stepCh', 'eat', 'ev'],
  set(key, m) { this.per[key] = m; this.flush() },
  flush() {
    if (!window.CSS?.highlights) return
    const all = {}
    for (const m of Object.values(this.per)) for (const k in m) (all[k] ||= []).push(...m[k])
    for (const k of this.names) all[k]?.length ? CSS.highlights.set(k, new Highlight(...all[k])) : CSS.highlights.delete(k)
  },
}
const colorOf = (n, colors) => n.c || (n.r && colors[n.r]) || (n.k == 'kw' && colors.kw) || null
function paint(ed, root, colors, extra = []) {
  const m = { B: [], Y: [], G: [], P: [], R: [] }; ed.rmap = new Map
  const L = ed.value.length, er = (a, b) => b > a ? ed.range(a, b) : a >= L ? ed.range(Math.max(0, L - 1), L) : ed.range(a, a + 1)
  const go = (n, inh) => {
    const c = colorOf(n, colors) || inh
    if (n.err) m.R.push(er(n.a, n.b))
    if (!n.kids.length) { if (c && n.b > n.a && m[c] && c != 'R') { const r = ed.range(n.a, n.b); m[c].push(r); ed.rmap.set(n, r) } }
    else for (const k of n.kids) go(k, c)
  }
  if (root) go(root, null)
  for (const e of extra) m.R.push(er(e.a, e.b))
  HL.set(ed.key, m)
}

/* ---------- 状态 ---------- */
const S = {
  meta: grammar(P.META), g: null, ss: null, rss: null, elOf: new Map, last: '', timer: 0, rtimer: 0,
  onedit: null, res: null, stale: false, view: 'cst', tool: 'eval', folds: new Set, unfold: new Set, down: false, pendingParse: false, collapse: true,
}
const status = t => $('#status').textContent = t
const deepest = (root, i, ok = () => true) => { let best = null; walk(root, n => { if (n.a <= i && i < Math.max(n.b, n.a + 1)) { if (ok(n)) best = n; return } return false }); return best }
const exactNode = (a, b) => { let r = null; if (S.ss?.tree) walk(S.ss.tree, n => { if (r) return false; if (n.a == a && n.b == b && n.k != 'top') { r = n; return false } if (n.b < a || n.a > b) return false }); return r }
Object.assign(window, { ss: null, $1: null, $2: null, $3: null, $4: undefined })   // F12 槽位，见文件头
const elFor = n => { for (let x = n; x; x = x.kids.length == 1 ? x.kids[0] : null) { const e = S.elOf.get(x); if (e) return e } }
const showRule = name => { const R = S.g?.rules.get(name); if (R) { rules.setSel(R.h.a, R.h.b); rules.scrollTo(R.h.a) } }

// 占位实现：只留最近一次调用，写进 #out .val，并显示该词条被编辑了几遍
const defaultOnedit = (o, n, info) => {
  const q = (t, l) => t == null ? 'null' : JSON.stringify(clip((l ?? '') + t, 30))
  S.onedit = info.init ? `onedit 初始通知（${info.count} 个词条）` : `onedit(${q(o, info.left?.[0])}, ${q(n, info.left?.[1])})  第 ${info.count} 遍`
  const v = $('#out .val .oe'); if (v) v.textContent = `   // ${S.onedit}`
}
/* ---------- onedit 的 hashline：词条哈希取自身文本及左侧一个字符；解析完先通知一遍，之后只对哈希变了的词条调用 ---------- */
const hash4 = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return (x >>> 16).toString(16).padStart(4, '0') }
const Edits = {
  seq: null,   // 上一次的词条序列 [{h, t, l, n, cnt, glued}]；换示例/改语法时清空
  sync(ss) {
    const s = ss.src, now = []; let pb = -1
    walk(ss.tree, n => {
      if (n.kids.length || n.b <= n.a || n.k == 'err') return
      const t = s.slice(n.a, n.b), l = s[n.a - 1] ?? ''
      now.push({ h: hash4(l + t), t, l, n, cnt: 0, glued: pb == n.a }); pb = n.b
    })
    const old = this.seq; this.seq = now
    if (!old) { ss.onedit(null, s, { init: true, count: now.length }); return }
    // 与上一次按哈希对齐：公共前缀/后缀不动，中间段按位置配对
    const O = old.length, N = now.length; let p = 0, q = 0
    while (p < O && p < N && old[p].h == now[p].h) now[p].cnt = old[p++].cnt
    while (q < O - p && q < N - p && old[O - 1 - q].h == now[N - 1 - q].h) { now[N - 1 - q].cnt = old[O - 1 - q].cnt; q++ }
    for (let k = 0; k < Math.max(O, N) - p - q; k++) {
      const o = p + k < O - q ? old[p + k] : null, x = p + k < N - q ? now[p + k] : null
      const same = o && x && o.t == x.t
      if (same && x.glued) { x.cnt = o.cnt; continue }   // 只因紧贴的左邻词条改了：不算编辑
      if (x) x.cnt = (o?.cnt ?? 0) + 1
      ss.onedit(o?.t ?? null, x?.t ?? null, { count: x ? x.cnt : o.cnt, node: x?.n, hash: x?.h, left: same ? [o.l, x.l] : undefined })
    }
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
    return box(p.kind == 'fn' ? p.fname : OPS[p.kind], p.parts.filter(Boolean).map(pv), ++id)
  }
  const hd = h('div', 'gh', `起始 ${g.startName}  @skip ${g.skip ? '/' + g.skip.source + '/' : 'none'}${g.walk ? '  @walk ' + g.walk : ''}  配对 ${g.pairs.map(p => p.join('')).join(' ') || '∅'}  颜色 ${Object.entries(g.colors).map(kv => kv.join('=')).join(' ') || '∅'}`)
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
  host.addEventListener('mousedown', e => { if (e.detail > 1) e.preventDefault() })   // 双击不选中文字
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
    const t = treeDOM(ss.tree, ss, o); t._reg = o.reg; t._regX = o.regX; host.append(t)
  }
  host.scrollTop = st
}

const nodeOf = t => { const tr = t.closest('.tree'); return t.dataset.i == null || !tr?._reg ? null : [tr._reg[t.dataset.i], t.dataset.x != null ? tr._regX[t.dataset.x] : null] }
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
  svg: $('#ov svg g'), mks: $('#mks'), hov: null, link: null,
  hover(n, el) {
    this.hov = n ? { n, el } : null
    HL.set('hov', n ? { hov: [src.range(n.a, Math.max(n.b, n.a + 1))] } : {})
    if (n && S.ss) { window.$2 = n; status(`$2 = ${n.r || n.k} ${S.ss.sloc(n)}${n.err ? '  ' + n.err : ''}`) }
    this.draw()
  },
  label(txt, r, cls, on) { const m = h('div', 'mk ' + (cls || ''), txt); m.style.left = r.left + 'px'; m.style.top = r.top + 'px'; Object.assign(m, on); this.mks.append(m); return m },
  path(a, b, cls) {  // 从 a 的上沿到 b 的下沿画曲线
    const x1 = a.left + Math.min(a.width, 30) / 2, y1 = a.top, x2 = b.left + Math.min(b.width, 30) / 2, y2 = b.bottom
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'), my = (y1 + y2) / 2
    p.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`); if (cls) p.setAttribute('class', cls)
    if (cls == 'ar') p.setAttribute('marker-start', 'url(#ah)')   // 箭头指向 a（树里的 AST）
    this.svg.append(p)
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
function renderOut() {
  const out = $('#out'), ss = S.ss; out.textContent = ''
  out.append(h('div', 'cm', '// try ss.onedit=alert'))
  ss?.errs.forEach((e, k) => {
    const it = h('span', 'eitem', `E${k + 1} ${ss.sloc(e.a)}  ${e.msg}`)
    it.onclick = () => goto(e.a, e.b)
    it.onmouseenter = () => { Sloc.hov = { from: it.getBoundingClientRect(), to: src.rect(e.a, Math.max(e.b, e.a + 1)), cls: 'e' }; HL.set('hov', { hov: [src.range(e.a, Math.max(e.b, e.a + 1))] }); Sloc.draw() }
    it.onmouseleave = () => Sloc.hover(null)
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
function parse() {
  clearTimeout(S.timer); S.timer = 0; Step.stop(); EvStep.stop()
  const focused = document.activeElement === src.el, sel = focused ? src.caret() : null
  src.fix(); S.last = src.value
  if (!S.g?.start) { status('语法未编译成功'); renderTree(); return }
  const prev = S.ss, ss = feed(src.value)
  wireFeed(ss, prev)
  const t0 = performance.now(); let v
  try { v = eat(S.g, ss) } catch (e) { status('解析异常：' + e.message); console.error(e); return }
  S.ss = ss; S.stale = false; window.ss = window.$1 = ss; window.$3 = S.g
  paint(src, ss.tree, S.g.colors); renderTree(); Marks.changed(); Edits.sync(ss)
  setResult({ v, label: `解析 ${(performance.now() - t0).toFixed(1)}ms · ${ss.errs.length} 个错误` })
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
    if (a < ga || b > gb || !ss.skip) return false
    const ng = now.slice(ga, gb + d)
    if (!ng.length && gb > ga) return false
    if (ng.length) { ss.skip.lastIndex = 0; const mm = ss.skip.exec(ng); if (!mm || mm[0].length != ng.length) return false }
  }
  const inPath = new Set(T ? [T, ...path] : [])
  walk(root, n => { const sa = n.a >= b && !inPath.has(n); if (sa) n.a += d; if (n.b > a || inPath.has(n) || sa) n.b += d })
  root.b = now.length; ss.src = now; ss.errs = errsOf(root); S.stale = true
  if (T) { T.text = newT; const r = src.rmap.get(T); if (r) { r.setStart(src.t, T.a); r.setEnd(src.t, T.b) } }
  Edits.sync(ss)
  HL.flush(); renderTree(); Marks.changed(); renderOut()
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
  on: false, ev: [], vis: [], main: [], i: 0,
  start() {
    if (!S.g?.start) return false
    EvStep.stop(); src.fix(); if (S.ss?.src !== src.value) parse()   // 吃下时要连到主语法树
    const [c] = src.caret(), ss = feed(src.value); ss.trace = []; eat(S.g, ss)
    const ev = ss.trace; if (!ev.length) return false
    // 不显示失败的尝试（含其内部）与回溯事件：只走最终成功的路径
    const hide = new Uint8Array(ev.length), st = []
    ev.forEach((e, k) => { if (e.t == 'alt') hide[k] = 1; else if (e.t == 'in') st.push(k); else { const s = st.pop(); if (!e.ok && s != null) hide.fill(1, s, k + 1) } })
    const vis = []; for (let k = 0; k < ev.length; k++) if (!hide[k]) vis.push(k)
    if (!vis.length) return false
    Object.assign(this, { ss, ev, vis, on: true }); this.recalc()
    const i = vis.findIndex((k, j) => this.main[j] && ev[k].a >= c); this.i = i < 0 ? vis.length - 1 : i
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
      if (e.t == 'in') return ruleIn(j) && !leaf(j) && !(ruleIn(j + 1) && !leaf(j + 1) && E(j + 1).a == e.a)
      const pv = E(j - 1)
      return !(pv && pv.t == 'out' && pv.b == e.b)
    })
    if (this.on && !this.main[this.i]) { let i = this.i; while (i < vis.length - 1 && !this.main[i]) i++; this.i = i }
  },
  cur() { return this.ev[this.vis[this.i]] },
  pos(e) { return e.t == 'out' && e.ok ? e.b : e.a },
  stop(place) {
    if (!this.on) return
    const p = this.pos(this.cur()); this.on = false; document.body.classList.remove('stepping')
    HL.set('step', {}); menu.hidden = caretEl.hidden = true; status(''); Sloc.link = null; Sloc.draw()
    if (place) { src.el.focus(); src.setSel(p) }
  },
  // →/←：按折叠后的步；Shift+→/←：逐个事件，含被折叠的递归进入与返回
  move(d, all) {
    const L = this.vis.length; let i = this.i + d
    if (!all) while (i > 0 && i < L - 1 && !this.main[i]) i += d
    this.i = Math.max(0, Math.min(L - 1, i)); this.show()
  },
  show() {
    const e = this.cur(), ss = this.ss, pos = this.pos(e), n = this.vis.length
    const top = [...e.st].reverse().find(f => !f.tok), hl = {}
    if (top && pos > top.a) hl[e.ch ? 'stepCh' : 'step'] = [src.range(top.a, pos)]
    if (e.t == 'out' && e.b > e.a) hl.eat = [src.range(e.a, e.b)]
    HL.set('step', hl); src.scrollTo(pos)
    const eaten = e.t == 'out' && e.ok && e.b > e.a, el = eaten && astEl(e.a, e.b, e.n?.r)   // 吃下：临时箭头连到对应 AST
    if (el) el.scrollIntoView({ block: 'nearest' })
    Sloc.link = el ? { el, a: e.a, b: e.b } : null
    const desc = e.t == 'in' ? `→ ${preview(ss.src, e.a)}` : `✓ 吃下 ${clip(ss.src.slice(e.a, e.b).replace(/\s*\n\s*/g, '⏎'))}`
    status(`步进 ${this.i + 1}/${n}  ${ss.sloc(pos)}${e.ch ? '  选择中' : ''}`)
    popup(pos, m => {
      m.append(h('div', 'hd', h('b', null, desc), `  ${this.i + 1}/${n}`))
      if (e.ch && e.al) {   // 处于有序选择中（蓝色）时列出这个选择包含的各项
        const al = h('div', 'alts', '(')
        e.al.xs.forEach((x, j) => { const s = h('span', j == e.al.j ? 'cur' : null, clip(x, 14)); s.dataset.rule = x; al.append(s) })
        al.append(' <)'); m.append(al)
      }
      ;[...e.st].reverse().forEach((f, k) => { const d = h('div', 'fr' + (k == 0 ? ' top' : ''), h('span', null, preview(ss.src, f.a)), h('span', 'sl', ss.sloc(f.a))); if (!f.tok) d.dataset.rule = f.label; m.append(d) })
    }, e.ch)
    Sloc.draw()
  },
}
$('#coll').onchange = e => { S.collapse = e.target.checked; if (Step.on) { Step.recalc(); Step.show() } }

/* ---------- 逐步执行（@walk 的生成器 walker） ---------- */
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
    for (let g = 0; g < 1e6; g++) {
      const r = this.it.next(); this.n++
      if (r.done) { const n = this.n; this.stop(); setResult({ run: r.value, show: this.w.show, label: `逐步执行完毕（${n} 步）` }); return }
      const e = r.value, k = mk(e.n)
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
      m.append(h('div', 'hd', h('b', null, tag + txt), `  第 ${this.n} 步 · F8 继续`))
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
    else if (e.key == 'ArrowRight' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { if (Step.start()) e.preventDefault() }
  } else if (e.target === rules.el && e.key == 'Enter' && (e.ctrlKey || e.metaKey)) { compile(); e.preventDefault() }
}
document.addEventListener('keydown', onKey)
for (const b of document.querySelectorAll('#mob button')) {
  b.addEventListener('pointerdown', e => e.preventDefault())   // 不抢输入区焦点
  b.onclick = () => onKey({ key: b.dataset.k, shiftKey: !!b.dataset.shift, ctrlKey: !!b.dataset.ctrl, target: src.el, preventDefault() {} })
}
src.el.addEventListener('mousedown', () => { if (Step.on) Step.stop() })
menu.addEventListener('mouseover', e => { const r = e.target.closest('[data-rule]'); if (r) showRule(r.dataset.rule) })

// Ctrl+点击跳到定义；普通悬停联动树节点
function jumpDef(ed, ss, e, after) {
  const i = ed.offsetAt(e.clientX, e.clientY); if (i < 0 || !ss?.tree) return
  const n = deepest(ss.tree, i, n => n.def); if (!n) { status('此处没有可跳转的定义'); return }
  e.preventDefault(); ed.setSel(n.def.a, n.def.b); ed.scrollTo(n.def.a); after?.(n)
}
src.el.addEventListener('click', e => {
  if (!(e.ctrlKey || e.metaKey)) return
  jumpDef(src, S.ss, e, n => { Sloc.hov = { from: src.rect(n.def.a, n.def.b), to: src.rect(n.a, n.b) }; status(`定义于 ${S.ss.sloc(n.def)}`); Sloc.draw(); setTimeout(() => { Sloc.hov = null; Sloc.draw() }, 1500) })
})
rules.el.addEventListener('click', e => { if (e.ctrlKey || e.metaKey) jumpDef(rules, S.rss, e) })
let hot = null
src.el.addEventListener('mousemove', e => {
  if (!S.ss?.tree || S.ss.src !== src.value) return
  const i = src.offsetAt(e.clientX, e.clientY), n = i < 0 ? null : deepest(S.ss.tree, i, n => S.elOf.has(n)), el = n && S.elOf.get(n)
  if (el === hot) return
  hot?.classList.remove('hot'); hot = el; el?.classList.add('hot')
})
src.el.addEventListener('mouseleave', () => { hot?.classList.remove('hot'); hot = null })
src.el.addEventListener('scroll', () => Sloc.draw())
addEventListener('resize', () => Sloc.draw())
hookTree($('#tree'))

/* ---------- 示例 ---------- */
const sel = $('#ex')
examples.forEach((x, i) => sel.append(new Option(x.name, i)))
function load(i) {
  const x = examples[i]; sel.value = i
  S.ss = null; S.onedit = null; Edits.seq = null; S.folds.clear(); S.unfold.clear()
  rules.value = x.rules ?? examples.find(y => y.name == x.same).rules
  src.value = x.input; compile()
}
sel.onchange = () => load(+sel.value)
if (!window.CSS?.highlights) status('此浏览器不支持 CSS Custom Highlight API，高亮不可用')
load(0)
