/* editor.js — 共享：编辑器（单文本节点，Range 随编辑顺延）、颜色表 BYGRP、CSS.highlights 汇总与按 CST 上色。index.html 与 p5.html 共用。 */
'use strict'
const $ = s => document.querySelector(s)
const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e }

/* ---------- 编辑器：contenteditable 中只保留一个 Text 节点，Range 随编辑自动顺延 ---------- */
class Editor {
  constructor(el, key) {
    this.el = el; this.key = key; el.contentEditable = 'plaintext-only'; el.spellcheck = false; this.t = document.createTextNode(''); el.append(this.t); this.rmap = new Map
    // 换行/粘贴/拖放：浏览器可能插入 <br>/<div> 或拆分文本节点，迫使 fix() 重建（旧 Range 全部失效 → 高亮闪烁、光标归零）。
    // 改为直接在唯一的 Text 节点上 replaceData：live Range 按 DOM 规则自动顺延，旧高亮原地保留到重解析
    el.addEventListener('beforeinput', e => {
      const t = e.inputType
      const s = t == 'insertParagraph' || t == 'insertLineBreak' ? '\n' : t == 'insertFromPaste' || t == 'insertFromDrop' ? e.dataTransfer?.getData('text/plain') ?? e.data : null
      if (s == null || !this.fix()) return
      e.preventDefault(); this.splice(s.replace(/\r\n?/g, '\n'))
    })
  }
  splice(s) {
    const [a, b] = this.caret(); this.t.replaceData(a, b - a, s)
    this.setSel(a + s.length); this.el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: s }))
  }
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
  per: {}, names: ['B', 'Y', 'G', 'P', 'R', 'hov', 'step', 'stepCh', 'eat', 'ev', 'bp'],
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
