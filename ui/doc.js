/* doc.js — 显示层的最小扁平集合 Doc：三个生产者（CST / 值 AST / 编译结果），渲染器只认数组下标。
   Doc 不认识 Node 类型：所有节点平铺在数组里，payload/objs 是唯一逃生口（点击、求值、缩放）。
   换 CST 表示时只改 lowerCST；渲染器、Sloc、控制台都不用动。
   节点表（前序链，子节点用 first/next）：
     kind   K.ROOT|BOX|TOK|PAR|ERR|MORE
     flags  F.ANON|BLK|ERR
     color  str 下标：B/Y/G/P/R（空串表示不上色）
     a,b    源码区间；合成节点 -1
     key    str 下标：折叠/复用键（box: "a:b:tag"；par: "par:a:b"；编译结果: "g:…"）
     text   str 下标：词条文本（PAR 是左端位置文本）
     sub    str 下标：PAR 右端位置文本
     tag    str 下标：BOX 的标签
     title  str 下标：tooltip（错误、规则链）
     rule   str 下标：规则名（只有编译结果 + :par 用；渲染成 data-rule）
     pa,pb  :par 两个端点偏移（-1 = 未闭合）
     len    渲染后的文本长度（>90 加 .blk）
     first,next,parent  子节点链 / 父节点
     payload  objs 下标（-1 = 无）
   侧表：rules（规则区的已解析规则）、edges（xref：(def,ref) 对）、header（编译结果顶部行）、br（实例之间插 <br>） */
(function (G) {
'use strict'
const P = G.P || require('../parse.js')
const { isT, isName } = P

const K = { ROOT: 0, BOX: 1, TOK: 2, PAR: 3, ERR: 4, MORE: 5 }
const F = { ANON: 1, BLK: 2, ERR: 4 }
const LETTER = i => String.fromCharCode(65 + i)
const clip = (s, n) => s.length > n ? s.slice(0, n) + '…' : s
const spanOf = (v, nd) => { const n = (isT(v) && v.node) || nd; return n && n.a != null ? n : null }
const isPlain = v => { if (!v || typeof v != 'object') return false; const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null }

class Doc {
  constructor(src = '') {
    this.src = src; this.flavor = ''; this.str = ['']; this.si = new Map([['', 0]])
    this.kind = []; this.flags = []; this.color = []; this.a = []; this.b = []
    this.key = []; this.text = []; this.sub = []; this.tag = []; this.title = []; this.rule = []; this.len = []
    this.pa = []; this.pb = []; this.first = []; this.next = []; this.parent = []; this.payload = []
    this.objs = []; this.idOf = new Map; this.edges = []; this.header = null; this.br = false
  }
  s(v) { let i = this.si.get(v); if (i === undefined) { i = this.str.length; this.str.push(v); this.si.set(v, i) } return i }
  add(o) {
    const i = this.kind.length
    this.kind.push(o.kind ?? K.BOX); this.flags.push(o.flags || 0); this.color.push(o.color ? this.s(o.color) : 0)
    this.a.push(o.a ?? -1); this.b.push(o.b ?? -1)
    this.key.push(o.key == null ? 0 : this.s(o.key)); this.text.push(o.text == null ? 0 : this.s(o.text))
    this.sub.push(o.sub == null ? 0 : this.s(o.sub)); this.tag.push(o.tag == null ? 0 : this.s(String(o.tag)))
    this.title.push(o.title == null ? 0 : this.s(o.title)); this.rule.push(o.rule == null ? 0 : this.s(o.rule))
    this.len.push(o.len || 0); this.pa.push(o.pa ?? -1); this.pb.push(o.pb ?? -1)
    this.first.push(-1); this.next.push(-1); this.parent.push(-1)
    if (o.obj !== undefined && o.obj !== null) { this.objs.push(o.obj); this.payload.push(this.objs.length - 1) } else this.payload.push(-1)
    if (o.obj && typeof o.obj == 'object') this.idOf.set(o.obj, i)
    return i
  }
  kids(pid, ids) { let prev = -1; for (const c of ids) { this.parent[c] = pid; if (prev < 0) this.first[pid] = c; else this.next[prev] = c; prev = c } return ids }
  finish(ids) { const r = this.add({ kind: K.ROOT }); this.kids(r, ids); this.root = r; this.n = this.kind.length; return this }
}

/* ---------- CST → Doc（行为与旧的 treeDOM 一致：折叠叶链、单子规则、:par 尾巴、未知行隐藏） ---------- */
function lowerCST(ss, g, opt = {}) {
  const d = new Doc(ss.src); d.flavor = 'cst'
  const colors = g?.colors || {}, src = ss.src, max = opt.max || 6000
  let count = 0
  const col = n => n.c || (n.r && colors[n.r]) || (n.k == 'kw' && colors.kw) || ''
  const more = () => d.add({ kind: K.MORE, text: '…', len: 1 })
  const tok = (n, c, title) => {
    const t = n.text ?? src.slice(n.a, n.b)
    return d.add({ kind: K.TOK, color: c, text: t, flags: n.err ? F.ERR : 0, title: title || n.err || '', a: n.a, b: n.b, len: t.length, obj: n })
  }
  const box = (n, tag, ks, o = {}) => {
    const len = 2 + tag.length + ks.reduce((s, k) => s + d.len[k], 0)
    const id = d.add({
      kind: K.BOX, tag, a: n.a, b: n.b, color: o.tagc || '', key: n.a + ':' + n.b + ':' + tag,
      flags: (o.anon ? F.ANON : 0) | (len > 90 ? F.BLK : 0), len, obj: n,
    })
    return d.kids(id, ks), id
  }
  const par = n => {
    const t1 = n.pair[0] < 0 ? ' "未闭合"' : ` "${ss.lc(n.pair[0]).join(':')}"`
    const t2 = n.pair[2] < 0 ? ' "未闭合"' : ` "${ss.lc(n.pair[2]).join(':')}"`
    return d.add({ kind: K.PAR, key: 'par:' + n.a + ':' + n.b, a: n.a, b: n.b, pa: n.pair[0], pb: n.pair[2], text: t1, sub: t2, len: 6 + t1.length + t2.length, obj: n })
  }
  // Lit → Num → 123 这样的单链规则折叠成一个词条；规则名链进 title
  const leaf = (n, inh) => {
    const names = []; let c = inh
    while (n.k == 'rule') { names.push(n.r + (n.alt != null ? '.' + LETTER(n.alt) : '')); c = col(n) || c; n = n.kids[0] }
    if (n.kids.length && n.k != 'err') return null
    return { n, c: col(n) || c, names }
  }
  const node = (n, inh) => {
    if (++count > max) return more()
    const c = col(n) || inh
    if (n.k == 'err') {
      const t = n.b > n.a ? clip(src.slice(n.a, n.b), 40) : '😡😡😡'
      return d.add({ kind: K.ERR, text: t, title: n.err, a: n.a, b: n.b, len: t.length })
    }
    if (n.k == 'bin') return box(n, n.kids[1].text, [...flat(n.kids[0], c), ...flat(n.kids[2], c)])
    if (!n.kids.length) return tok(n, c)
    if (n.k == 'rule') {
      const lf = leaf(n, inh)
      if (lf) return tok(lf.n, lf.c, lf.names.join(' → ') + (lf.n.err ? '\n' + lf.n.err : ''))
      const tag = n.r + (n.alt != null ? '.' + LETTER(n.alt) : ''), ks = flat(n.kids[0], c)
      if (ks.length == 1 && d.kind[ks[0]] != K.PAR && !(d.flags[ks[0]] & F.ANON)) {   // 单子规则不套盒子（规则名进 title）
        const id = ks[0]; d.title[id] = d.s(tag + ' → ' + d.str[d.title[id]])
        return id
      }
      return box(n, tag, ks)
    }
    return box(n, '..', flat(n, c), { anon: true })
  }
  const flat = (n, inh, inPar) => {
    const c = col(n) || inh
    switch (n.k) {
      case 'seq': case 'opt': case 'top': return n.kids.flatMap(k => flat(k, c))
      case 'join': case 'many':
        return !n.kids.length && !inPar ? [] : [box(n, '..', n.kids.filter(k => !k.sep || k.err).map(k => node(k, c)), { anon: true })]
      case 'par': return [...n.kids.flatMap(k => flat(k, c, true)), par(n)]
      case 'lit': return n.err ? [tok(n, c)] : []
      default: return [node(n, c)]
    }
  }
  return d.finish(flat(ss.tree, ''))
}

/* ---------- 值 AST → Doc（脱糖视图；与 CST 无关，独立 Tab） ---------- */
const showVal = v =>
  v === null ? 'null' : v === undefined ? 'undefined'
  : typeof v == 'string' ? v : typeof v == 'number' || typeof v == 'boolean' ? String(v)
  : typeof v == 'function' ? `<fn ${v.bname || v.name || ''}>`
  : v && v.t == 'fn' ? `<fn ${v.name || 'λ'}>`
  : Array.isArray(v) ? '[]'
  : (() => { try { const s = String(v); return s == '[object Object]' ? '{…}' : s } catch { return '{…}' } })()

function lowerValue(ss, opt = {}) {
  const d = new Doc(ss.src || ''); d.flavor = 'val'
  const src = ss.src || '', max = opt.max || 6000
  let count = 0, seq = 0
  const more = () => d.add({ kind: K.MORE, text: '…', len: 1 })
  const keyOf = (n, tag) => n ? n.a + ':' + n.b + ':' + tag : 'v' + (++seq) + ':' + tag
  const leaf = (v, nd, txt) => {
    if (++count > max) return more()
    const n = spanOf(v, nd), a = n ? n.a : -1, b = n ? n.b : -1
    const t = txt != null ? txt : n ? src.slice(a, b) : showVal(v), obj = v && typeof v == 'object' ? v : null
    return d.add({ kind: K.TOK, text: t || '∅', a, b, len: t.length, obj })
  }
  const box = (v, tag, ks, n, anon) => {
    const len = 2 + tag.length + ks.reduce((s, k) => s + d.len[k], 0)
    const id = d.add({ kind: K.BOX, tag, a: n ? n.a : -1, b: n ? n.b : -1, key: keyOf(n, tag), flags: (anon ? F.ANON : 0) | (len > 90 ? F.BLK : 0), len, obj: v })
    return d.kids(id, ks), id
  }
  const arr = (v, nd) => {
    if (++count > max) return more()
    return box(v, '..', v.map(k => node(k, null)), spanOf(v, nd), true)
  }
  const obj = (v, nd) => {
    if (++count > max) return more()
    return box(v, '{}', Object.entries(v).map(([k, x]) => box(x, '..', [leaf(k, null, k), node(x, null)], null, false)), spanOf(v, nd), false)
  }
  const node = (v, nd) => {
    if (!isT(v)) return Array.isArray(v) ? arr(v, nd) : isPlain(v) ? obj(v, nd) : leaf(v, nd)
    if (++count > max) return more()
    const tag0 = v[0], ks = v.slice(1), ns = v.ns || []
    if (tag0 == '$' || tag0 == '$$') return leaf(ks[0], v.node, ks[0])       // 名字：文本就是名字
    if (tag0 == '') return leaf(ks[0], v.node, JSON.stringify(ks[0]))         // 字符串字面量：显示值
    let tag = tag0, kids = ks, kns = ns, anon = false
    if ((tag0 == '()' || tag0 == '[]') && isT(ks[0]) && isName(ks[0][0])) { tag = ks[0][1]; kids = ks.slice(1); kns = ns.slice(1) }
    else if (tag0 == '[]') { tag = '..'; anon = true }
    const names = tag0 == '..'   // 参数表 / 语句表：字符串项就是名字，别拿 ns 里的邻居 token 冒充
    return box(v, tag, kids.map((k, i) => names && typeof k == 'string' ? leaf(k, null, k) : node(k, kns[i])), spanOf(v, nd), anon)
  }
  const v = ss.value
  if (!isT(v)) return d.finish(v === undefined ? [] : [node(v, null)])
  return d.finish(v[0] == '..' ? v.slice(1).map((k, i) => node(k, v.ns?.[i])) : [node(v, null)])
}

/* ---------- 编译结果 → Doc（合成节点，没有源码区间；实例之间插 <br>） ---------- */
function lowerGrammar(g) {
  const d = new Doc(''); d.flavor = 'g'; d.br = true
  d.header = `起始 ${g.startName}  @skip ${g.some ? 'some ' : ''}${g.skip ? '/' + g.skip.source + '/' : 'none'}${g.walk ? '  @walk ' + g.walk : ''}  配对 ${g.pairs.map(p => p.join('')).join(' ') || '∅'}  颜色 ${Object.entries(g.colors).map(kv => kv.join('=')).join(' ') || '∅'}`
  const OPS = { seq: '..', alt: '<', join: '+', many: '*', opt: '?', mark: ':setRecur', par: ':par' }
  let n = 0
  const tk = (cls, t, rule) => d.add({ kind: K.TOK, color: cls || '', text: t, len: t.length, rule: rule || '' })
  const bx = (tag, ks, k) => {
    const id = d.add({ kind: K.BOX, tag, key: 'g:' + k, len: 2 + tag.length + ks.reduce((s, x) => s + d.len[x], 0) })
    return d.kids(id, ks), id
  }
  const pv = p => {
    if (!p) return tk('', '∅')
    if (p.kind == 'rule') return tk('G', p.label, p.label)
    if (p.kind == 'tok' || p.kind == 'lit') return tk('Y', p.label)
    if (p.kind == 'kw') return tk('B', p.label)
    if (p.kind == 'recur') return tk('P', 'Recur')
    if (p.kind == 'kwset') return bx(p.empty ? 'kwd -' : 'kwd', p.words.map(w => tk('B', w)), ++n)
    if (p.kind == 'prec') return bx('- 算符表', [pv(p.parts[0]), ...p.levels.flatMap((L, l) => [l ? tk('', ';') : null, ...L.map(pv)]).filter(Boolean)], ++n)
    return bx(p.kind == 'fn' ? p.fname : (OPS[p.kind] || p.kind), p.parts.filter(Boolean).map(pv), ++n)
  }
  const out = []
  for (const [key, I] of g.insts) {
    const name = key.replace(/\[.*$/, ''), label = key.replace(/^(\w+)\[(.*)\]$/, '$1($2)')
    const id = bx(label, [pv(I.body)], key)
    d.rule[id] = d.s(name)
    out.push(id)
  }
  for (const e of g.errs) out.push(d.add({ kind: K.ERR, text: e.msg, len: e.msg.length }))
  return d.finish(out)
}

G.Doc = { K, F, Doc, cst: lowerCST, val: lowerValue, gram: lowerGrammar }
if (typeof module != 'undefined') module.exports = G.Doc
})(typeof globalThis != 'undefined' ? globalThis : window)
