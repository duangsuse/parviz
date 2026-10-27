/* ui.js — 编辑器（单文本节点 + CSS.highlights）、语法树、sloc 全屏标注、步进可视化、逐步执行、规则区。 */
'use strict'
const { feed, eat, grammar, walk, examples, errsOf } = P
const $ = s => document.querySelector(s)
const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e }
const clip = (s, n = 40) => s.length > n ? s.slice(0, n) + '…' : s

/* ---------- 编辑器：contenteditable 中只保留一个 Text 节点，Range 随编辑自动顺延 ---------- */
class Editor {
  constructor(el, key) { this.el = el; this.key = key; el.contentEditable = 'plaintext-only'; el.spellcheck = false; this.t = document.createTextNode(''); el.append(this.t); this.rmap = new Map }
  get value() { return this.t.data }
  set value(s) { this.el.textContent = ''; this.t = document.createTextNode(s); this.el.append(this.t) }
  fix() {  // 若浏览器插入了 <br>/<div> 等，重建为单个文本节点；返回 false 表示 Range 已失效
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

/* ---------- 高亮：多个编辑器的 Range 汇总到全局 CSS.highlights ---------- */
const HL = {
  per: {}, names: ['B', 'Y', 'G', 'P', 'R', 'hov', 'step', 'stepY', 'eat', 'ev'],
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
const S = { meta: grammar(P.META), g: null, ss: null, rss: null, elOf: new Map, last: '', timer: 0, rtimer: 0, edits: [] }
const status = t => $('#status').textContent = t

/* ---------- 语法树：总是 [123 s[exp] "r"] 格式 ---------- */
function treeDOM(root, ss, colors, reg, elOf, max = 6000) {
  let count = 0
  const nd = (n, cls, ...kids) => { const e = h('span', 'nd ' + (cls || ''), ...kids); e.dataset.i = reg.push(n) - 1; elOf?.set(n, e); return e }
  const lc = p => ss.lc(p).join(':')
  const parTail = n => {
    const pv = h('span', 'pv')
    for (const p of [n.pair[0], n.pair[2]]) { const s = h('span', null, p < 0 ? ' "未闭合"' : ` "${lc(p)}"`); if (p >= 0) s.dataset.pos = p; pv.append(s) }
    return h('span', 'par fold', '[:par', pv)
  }
  const leaf = (n, inh) => {  // 规则链 Lit→Num→123 折叠为一个词条，悬停 title 显示规则链
    const names = []; let c = inh
    while (n.k == 'rule') { names.push(n.r); c = colorOf(n, colors) || c; n = n.kids[0] }
    if (n.kids.length && n.k != 'err') return null
    return { n, c: colorOf(n, colors) || c, names }
  }
  const node = (n, inh) => {
    if (++count > max) return h('span', 'more', '…')
    const c = colorOf(n, colors) || inh
    if (n.k == 'err') { const e = nd(n, 'R err', n.b > n.a ? clip(ss.src.slice(n.a, n.b)) : '∅'); e.title = n.err; return e }
    if (!n.kids.length) { const e = nd(n, (c || '') + (n.err ? ' err' : ''), n.text ?? ss.src.slice(n.a, n.b)); e.title = n.err || n.k; return e }
    const one = ks => ks.length == 1 && !ks[0].classList?.contains('par') ? ks[0] : null
    if (n.k == 'rule') {
      const lf = leaf(n, inh)
      if (lf) { const e = node(lf.n, lf.c); e.title = lf.names.join(' → ') + (lf.n.err ? '\n' + lf.n.err : ''); return e }
      const ks = flat(n.kids[0], c), e = one(ks)   // 只有一个子元素的规则不再套一层，规则名进 title
      if (e) { e.title = n.r + ' → ' + (e.title || ''); return e }
      return box(n, n.r, ks)
    }
    const ks = flat(n, c); return one(ks) || box(n, '', ks)
  }
  const flat = (n, inh) => {
    const c = colorOf(n, colors) || inh
    switch (n.k) {
      case 'seq': case 'opt': case 'top': return n.kids.flatMap(k => flat(k, c))
      case 'join': case 'many': return n.kids.filter(k => !k.sep || k.err).map(k => node(k, c))
      case 'par': return [...n.kids.flatMap(k => flat(k, c)), parTail(n)]
      case 'lit': return n.err ? [node(n, c)] : []
      default: return [node(n, inh)]
    }
  }
  const box = (n, name, kids) => {
    const e = nd(n, 'box', h('span', 'br nm', name + '['), h('span', 'kids', ...kids), h('span', 'br', ']'))
    if (e.textContent.length > 90) e.classList.add('blk')
    return e
  }
  return h('div', 'tree', ...flat(root, null))
}
function hookTree(host, getSS) {
  host.addEventListener('mouseover', e => { const t = e.target.closest('.nd'); if (t) Sloc.hover(host._reg[t.dataset.i], t) })
  host.addEventListener('mouseout', e => { if (e.target.closest('.nd')) Sloc.hover(null) })
  host.addEventListener('click', e => {
    const p = e.target.closest('[data-pos]'); if (p) { goto(+p.dataset.pos, +p.dataset.pos + 1); return }
    const pr = e.target.closest('.par'); if (pr) { pr.classList.toggle('fold'); return }
    const br = e.target.closest('.br'); if (br) { br.parentElement.classList.toggle('fold'); Sloc.draw(); return }
    const t = e.target.closest('.nd'); if (t) { const n = host._reg[t.dataset.i]; Sloc.pin(n); goto(n.a, n.b, true) }
  })
  host.addEventListener('scroll', () => Sloc.draw())
}
function renderTree() {
  const host = $('#tree'), ss = S.ss; host.textContent = ''; host._reg = []; S.elOf = new Map
  if (!ss?.tree) return
  host.append(treeDOM(ss.tree, ss, S.g.colors, host._reg, S.elOf))
  for (const p of Sloc.pins) S.elOf.get(p.n)?.classList.add('pin')
}

/* ---------- sloc：全屏打标、连线、goto ---------- */
const Sloc = {
  svg: $('#ov svg'), mks: $('#mks'), pins: [], seq: 0, hov: null,
  pin(n) { const i = this.pins.findIndex(p => p.n == n); if (i >= 0) { this.pins.splice(i, 1); S.elOf.get(n)?.classList.remove('pin') } else { this.pins.push({ n, id: ++this.seq }); S.elOf.get(n)?.classList.add('pin') } this.draw() },
  reset() { this.pins = []; this.seq = 0; this.hov = null; this.draw() },
  hover(n, el) {
    this.hov = n ? { n, el } : null
    HL.set('hov', n ? { hov: [src.range(n.a, Math.max(n.b, n.a + 1))] } : {})
    if (n && S.ss) status(`${S.ss.sloc(n)}  ${n.r || n.k}${n.err ? '  ' + n.err : ''}`)
    this.draw()
  },
  label(txt, r, cls, on) { const m = h('div', 'mk ' + (cls || ''), txt); m.style.left = r.left + 'px'; m.style.top = r.top + 'px'; Object.assign(m, on); this.mks.append(m); return m },
  path(a, b, cls) {  // 从 a 的上沿到 b 的下沿画曲线
    const x1 = a.left + Math.min(a.width, 30) / 2, y1 = a.top, x2 = b.left + Math.min(b.width, 30) / 2, y2 = b.bottom
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'), my = (y1 + y2) / 2
    p.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`); if (cls) p.setAttribute('class', cls); this.svg.append(p)
  },
  inView(el, r) { const c = el.getBoundingClientRect(); return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right },
  draw() {
    this.mks.textContent = ''; this.svg.textContent = ''
    const ss = S.ss; if (!ss?.tree || ss.src !== src.value) return
    const tree = $('#tree')
    for (const p of this.pins) {
      const r = src.rect(p.n.a, Math.max(p.n.b, p.n.a + 1)), el = S.elOf.get(p.n), tr = el?.getBoundingClientRect()
      const link = () => { this.svg.textContent = ''; if (tr && el.offsetParent) this.path(tr, r) }
      if (src.visible(r)) this.label(`[${p.id}]`, r, '', { onmouseenter: link, onclick: () => goto(p.n.a, p.n.b), title: ss.sloc(p.n) })
      if (tr && el.offsetParent && this.inView(tree, tr)) this.label(`[${p.id}]`, tr, '', { onmouseenter: link, onclick: () => el.scrollIntoView({ block: 'center' }) })
    }
    ss.errs.forEach((e, k) => {
      const r = src.rect(e.a, Math.max(e.b, e.a + 1))
      if (src.visible(r)) this.label(`E${k + 1}`, r, 'e', { title: e.msg, onclick: () => goto(e.a, e.b) })
    })
    const hv = this.hov
    if (hv?.el?.offsetParent) { const r = src.rect(hv.n.a, Math.max(hv.n.b, hv.n.a + 1)); if (src.visible(r)) this.path(hv.el.getBoundingClientRect(), r) }
    if (hv?.from) this.path(hv.from, hv.to, hv.cls)
  },
}
function goto(a, b = a, keepFocus) {
  src.scrollTo(a); src.setSel(a, b); if (!keepFocus) src.el.focus()
  HL.set('hov', { hov: [src.range(a, Math.max(b, a + 1))] })
  requestAnimationFrame(() => Sloc.draw())
}
// 找包含 i 的最深节点（可带条件）
const deepest = (root, i, ok = () => true) => { let best = null; walk(root, n => { if (n.a <= i && i < Math.max(n.b, n.a + 1)) { if (ok(n)) best = n; return } return false }); return best }

/* ---------- 解析与输出 ---------- */
function parse() {
  clearTimeout(S.timer); Step.stop(); EvStep.stop()
  src.fix(); S.last = src.value
  if (!S.g?.start) { status('语法未编译成功'); return }
  const ss = feed(src.value, 'In1')
  ss.onedit = (o, n) => { S.edits.push(`onedit(${JSON.stringify(o)}, ${JSON.stringify(n)})`); if (S.edits.length > 4) S.edits.shift() }
  const t0 = performance.now(); let v
  try { v = eat(S.g, ss) } catch (e) { status('解析异常：' + e.message); console.error(e); return }
  S.ss = ss; S.edits = []
  paint(src, ss.tree, S.g.colors); renderTree()
  Sloc.pins = []; Sloc.seq = 0; Sloc.hov = null
  output(v, `解析 ${(performance.now() - t0).toFixed(1)}ms · ${ss.errs.length} 个错误`)
  Sloc.draw()
}
function output(v, info, stale) {
  const out = $('#out'), ss = S.ss; out.textContent = ''
  ss.errs.forEach((e, k) => {
    const it = h('span', 'eitem', `E${k + 1} ${ss.sloc(e.a)}  ${e.msg}`)
    it.onclick = () => goto(e.a, e.b)
    it.onmouseenter = () => { const r = src.rect(e.a, Math.max(e.b, e.a + 1)); Sloc.hov = { from: it.getBoundingClientRect(), to: r, cls: 'e' }; HL.set('hov', { hov: [src.range(e.a, Math.max(e.b, e.a + 1))] }); Sloc.draw() }
    it.onmouseleave = () => Sloc.hover(null)
    out.append(it)
  })
  for (const e of S.edits) out.append(h('div', 'ed-log', e))
  if (stale) out.append(h('div', 'warn', '（仅顺延了 Range 与 CST 区间，值未重算：Ctrl+Enter 重新解析）'))
  else if (v && v.t == 'prog') showRun(LISP.run(v))
  else if (v !== undefined) { let s; try { s = JSON.stringify(v, null, 1) } catch { s = String(v) } out.append(h('div', 'val', '值 = ' + clip(s.replace(/\n\s*/g, ' '), 3000))) }
  status(info)
}
function showRun(r) {
  const out = $('#out')
  for (const l of r.log) out.append(h('div', l.out != null ? 'log' : 'warn', l.out ?? `⚠ ${l.warn}`))
  if (r.err) { const e = h('span', 'eitem', `求值错误：${r.err}`); if (r.x) e.onclick = () => goto(r.x.node.a, r.x.node.b); out.append(e) }
  else out.append(h('div', 'val', `= ${LISP.show(r.value, 1)}` + (r.steps ? `   （${r.steps} 步）` : '')))
}

/* ---------- 增量：不破坏词条语法的编辑直接顺延区间并触发 ss.onedit ---------- */
function tryShift(old, now) {
  const ss = S.ss, root = ss?.tree; if (!root || ss.src !== old) return false
  let p = 0; const m = Math.min(old.length, now.length); while (p < m && old[p] == now[p]) p++
  let s = 0; while (s < m - p && old[old.length - 1 - s] == now[now.length - 1 - s]) s++
  const a = p, b = old.length - s, d = now.length - old.length
  let T = null, path = [], prev = null, next = null; const stack = []
  walk(root, n => {
    if (!n.kids.length) {
      if (n.b > n.a && n.a <= a && b <= n.b && n.k == 'tok' && !T) { T = n; path = stack.slice() }
      if (n.b > n.a && n.b <= a && (!prev || n.b >= prev.b)) prev = n
      if (n.b > n.a && n.a >= b && (!next || n.a < next.a)) next = n
    }
  })
  // 用栈求 T 的祖先
  if (T) { const anc = []; const f = n => { if (n === T) return true; for (const k of n.kids) if (k.a <= T.a && T.b <= k.b && f(k)) { anc.push(n); return true } return false }; f(root); path = anc }
  let oldT, newT
  if (T) {
    if (T.free || T.defs || T.c == 'G' || T.c == 'P') return false       // 影响作用域，重解析
    const y = T.rx; y.lastIndex = T.a; const mm = y.exec(now)
    if (!mm || !mm[0].length || mm[0].length != T.b - T.a + d) return false
    oldT = old.slice(T.a, T.b); newT = mm[0]
  } else {
    const ga = prev ? prev.b : 0, gb = next ? next.a : old.length
    if (a < ga || b > gb || !ss.skip) return false
    const og = old.slice(ga, gb), ng = now.slice(ga, gb + d)
    if (!ng.length && og.length) return false
    if (ng.length) { ss.skip.lastIndex = 0; const mm = ss.skip.exec(ng); if (!mm || mm[0].length != ng.length) return false }
    oldT = og; newT = ng
  }
  const inPath = new Set(T ? [T, ...path] : [])
  walk(root, n => { const sa = n.a >= b && !inPath.has(n); if (sa) n.a += d; if (n.b > a || inPath.has(n) || sa) n.b += d })
  root.b = now.length; ss.src = now; ss.errs = errsOf(root)
  if (T) { T.text = newT; const r = src.rmap.get(T); if (r) { r.setStart(src.t, T.a); r.setEnd(src.t, T.b) } }
  ss.onedit(oldT, newT)
  HL.flush(); renderTree(); output(undefined, `顺延 ${d > 0 ? '+' : ''}${d} @${ss.sloc(a)}`, true); Sloc.draw()
  return true
}
src.el.addEventListener('input', () => {
  if (Step.on) return
  const ok = src.fix(), old = S.last, now = src.value; S.last = now
  if (ok && tryShift(old, now)) return
  clearTimeout(S.timer); S.timer = setTimeout(parse, 350)
})

/* ---------- 规则区：自己给自己写的语法（META）负责高亮 ---------- */
function paintRules() {
  rules.fix()
  const rss = feed(rules.value, 'Rules'); eat(S.meta, rss); S.rss = rss
  paint(rules, rss.tree, S.meta.colors, S.g ? S.g.errs : [])
  const box = $('#rerr'); box.textContent = ''
  const errs = [...(S.g?.errs || []).map(e => ({ ...e, msg: '编译：' + e.msg })), ...rss.errs.map(e => ({ ...e, msg: '元语法：' + e.msg }))]
  for (const e of errs) { const d = h('div', null, `${rss.sloc(e.a).replace('./feed.', '')} ${e.msg}`); d.onclick = () => { rules.setSel(e.a, e.b); rules.el.focus() }; box.append(d) }
}
function compile() {
  clearTimeout(S.rtimer)
  rules.fix(); S.g = grammar(rules.value)
  paintRules()
  if (S.g.start) parse(); else status(`语法错误 ${S.g.errs.length} 处`)
}
rules.el.addEventListener('input', () => { rules.fix(); clearTimeout(S.rtimer); S.rtimer = setTimeout(compile, 600) })

/* ---------- 步进可视化：→ 像 parser 一样往右扫，← 回溯并显示临时语法树 ---------- */
const menu = $('#menu'), caretEl = $('#caret')
function popup(pos, fill, yellow) {
  const r = src.rect(pos, pos)
  caretEl.hidden = false; Object.assign(caretEl.style, { left: r.left + 'px', top: r.top + 'px', height: (r.height || 16) + 'px' })
  menu.textContent = ''; fill(menu); menu.hidden = false; menu.classList.toggle('y', !!yellow)
  const mh = menu.offsetHeight, mw = menu.offsetWidth
  menu.style.left = Math.min(r.left, innerWidth - mw - 8) + 'px'
  menu.style.top = (r.bottom + 4 + mh > innerHeight ? Math.max(4, r.top - mh - 4) : r.bottom + 4) + 'px'
}
const Step = {
  on: false, ev: [], i: 0,
  start() {
    if (!S.g?.start) return
    EvStep.stop(); src.fix()
    const [c] = src.caret(), ss = feed(src.value, 'In1'); ss.trace = []; eat(S.g, ss)
    if (!ss.trace.length) return
    Object.assign(this, { ss, ev: ss.trace, on: true })
    const i = this.ev.findIndex(e => e.a >= c); this.i = i < 0 ? this.ev.length - 1 : i
    src.el.contentEditable = 'false'; document.body.classList.add('stepping'); this.show(false)
  },
  stop() {
    if (!this.on) return
    this.on = false; src.el.contentEditable = 'plaintext-only'; document.body.classList.remove('stepping')
    HL.set('step', {}); menu.hidden = caretEl.hidden = true; status('退出步进')
  },
  move(d, over) {
    const ev = this.ev; let i = this.i
    if (over && d > 0 && ev[i].t == 'in') { const D = ev[i].st.length; while (i < ev.length - 1 && !(ev[i].t == 'out' && ev[i].st.length == D - 1)) i++ }
    else if (over && d < 0 && ev[i].t == 'out') { const D = ev[i].st.length + 1; while (i > 0 && !(ev[i].t == 'in' && ev[i].st.length == D)) i-- }
    else i += d
    this.i = Math.max(0, Math.min(ev.length - 1, i)); this.show(d < 0)
  },
  show(back) {
    const e = this.ev[this.i], ss = this.ss, pos = e.t == 'out' && e.ok ? e.b : e.a
    const top = [...e.st].reverse().find(f => !f.tok), hl = {}
    if (top && pos > top.a) hl[e.ch ? 'stepY' : 'step'] = [src.range(top.a, pos)]
    if (e.t == 'out' && e.ok && e.b > e.a) hl.eat = [src.range(e.a, e.b)]
    HL.set('step', hl); src.scrollTo(pos)
    const desc = e.t == 'in' ? `→ 尝试 ${e.label}` : e.t == 'alt' ? `⎇ 回溯，改试 ${clip(e.label, 50)}`
      : e.ok ? `✓ ${e.label} 吃下 ${JSON.stringify(clip(ss.src.slice(e.a, e.b)))}` : `✗ ${e.label}`
    status(`步进 ${this.i + 1}/${this.ev.length}  ${ss.sloc(pos)}  ${e.ch ? '（选择中，可能回溯）' : ''}`)
    popup(pos, m => {
      m.append(h('div', 'hd', h('b', null, desc), `  ${this.i + 1}/${this.ev.length}`))
      if (back) {  // 回溯时菜单变成临时语法树
        let j = this.i; while (j >= 0 && !(this.ev[j].t == 'out' && this.ev[j].ok && this.ev[j].n?.k == 'rule')) j--
        if (j >= 0) { const n = this.ev[j].n; m.append(h('div', 'fr', h('span', null, '最近完成：' + n.r), h('span', 'sl', ss.sloc(n)))); const reg = []; const t = treeDOM(n, ss, S.g.colors, reg, null, 800); m.append(t); menu._reg = reg }
      } else {
        const fr = [...e.st].reverse()
        fr.forEach((f, k) => m.append(h('div', 'fr' + (k == 0 ? ' top' : '') + (f.tok ? ' tok' : ''), h('span', null, clip(f.label, 40)), h('span', 'sl', ss.sloc(f.a)))))
        if (!fr.length) m.append(h('div', 'fr', '（栈空）'))
      }
    }, e.ch)
  },
}
menu._reg = []; hookTree(menu)

/* ---------- 逐步执行（AST 生成器求值器） ---------- */
const EvStep = {
  it: null, n: 0,
  start() {
    const v = S.ss?.value; if (!v || v.t != 'prog') { status('逐步执行仅用于 Lisp'); return false }
    Step.stop(); this.it = LISP.steps(v); this.n = 0; return true
  },
  stop() { if (!this.it) return; this.it = null; HL.set('ev', {}); menu.hidden = caretEl.hidden = true },
  next() {
    if (!this.it && !this.start()) return
    const r = this.it.next(); this.n++
    if (r.done) { this.it = null; HL.set('ev', {}); menu.hidden = caretEl.hidden = true; output(undefined, `执行完毕（${this.n} 步）`); $('#out').lastChild?.remove(); showRun(r.value); return }
    const { x, ph, v } = r.value, n = x.node
    HL.set('ev', { ev: [src.range(n.a, n.b)] }); src.scrollTo(n.a)
    const txt = clip(S.ss.src.slice(n.a, n.b).replace(/\s+/g, ' '), 50)
    popup(ph == 'in' ? n.a : n.b, m => {
      m.append(h('div', 'hd', h('b', null, ph == 'in' ? `⇢ 求值 ${x.t}` : `⇠ 得到 ${LISP.show(v, 1)}`), `  第 ${this.n} 步 · F8 继续`))
      m.append(h('div', 'fr', h('span', null, txt), h('span', 'sl', S.ss.sloc(n))))
    })
    status(`逐步执行 第 ${this.n} 步`)
  },
}

/* ---------- 交互 ---------- */
hookTree($('#tree'))
document.addEventListener('keydown', e => {
  if (Step.on) {
    const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (k) { Step.move(k, e.shiftKey); e.preventDefault(); return }
    if (e.key == 'Home' || e.key == 'End') { Step.i = e.key == 'Home' ? 0 : Step.ev.length - 1; Step.show(false); e.preventDefault(); return }
    if (e.key == 'Escape') { Step.stop(); e.preventDefault() }
    return
  }
  if (e.key == 'F8') { EvStep.next(); e.preventDefault(); return }
  if (e.key == 'Escape') { EvStep.stop(); return }
  if (e.target === src.el) {
    if (e.key == 'Enter' && e.ctrlKey) { parse(); e.preventDefault() }
    else if (e.key == 'ArrowRight' && e.altKey) { Step.start(); e.preventDefault() }
  } else if (e.target === rules.el && e.key == 'Enter' && e.ctrlKey) { compile(); e.preventDefault() }
})
// Ctrl+点击跳到定义；普通悬停联动树节点
function jumpDef(ed, ss, e, after) {
  const i = ed.offsetAt(e.clientX, e.clientY); if (i < 0 || !ss?.tree) return
  const n = deepest(ss.tree, i, n => n.def); if (!n) { status('此处没有可跳转的定义'); return }
  e.preventDefault(); ed.setSel(n.def.a, n.def.b); ed.scrollTo(n.def.a); after?.(n)
}
src.el.addEventListener('click', e => {
  if (!(e.ctrlKey || e.metaKey) || Step.on) return
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
$('#bParse').onclick = parse
$('#bStep').onclick = () => Step.on ? Step.stop() : Step.start()
$('#bRun').onclick = () => { const v = S.ss?.value; if (v?.t == 'prog') { output(undefined, '执行'); $('#out').lastChild?.remove(); showRun(LISP.run(v)) } else parse() }
$('#bEval').onclick = () => EvStep.next()
$('#bCompile').onclick = compile

/* ---------- 示例 ---------- */
const sel = $('#ex')
examples.forEach((x, i) => sel.append(new Option(x.name, i)))
function load(i) {
  const x = examples[i]; sel.value = i
  rules.value = x.rules ?? examples.find(y => y.name == x.same).rules
  src.value = x.input; Sloc.reset(); compile()
}
sel.onchange = () => load(+sel.value)
if (!window.CSS?.highlights) status('此浏览器不支持 CSS Custom Highlight API，高亮不可用')
load(0)
