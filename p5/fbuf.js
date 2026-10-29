/* fbuf.js — 帧缓冲：最近 N 帧的画布副本 + 当时的内存快照 + 本帧的 p5 调用清单，供“时间轴”回看（只读，不重放）。
   一帧 = { no, cv（画布副本，按 CSS 尺寸）, calls:[{name,a,b,args}], state, t }。
   state 是整张图的只读快照：envs = [{ id, name, parent, vars }]，值里的 { $:'fn', name, env } 指向 envs，所以闭包捕获的环境也在里面。
   不能快照的（p5 实例、图片、DOM…）记成 { $:'js', name }；超出预算 / 成环记成 { $:'…' } / { $:'↻' }。
   只依赖 lisp.js（Env 链、fn 值的形状）；canvas 部分只在浏览器里用到。 */
(function (G) {
'use strict'
const L = G.LISP || require('../lisp.js'), NO = L.NO
const isPlain = v => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null }
const skip = (k, v) => k == '..' || k == 'xargs' || (typeof v == 'function' && (v.bname || v.lisp))   // 内建与 xargs 不是用户状态

// roots：[Env]（第一个当作顶层）；返回 { envs, roots:[id] }。budget：最多访问这么多个值节点
function snapshot(roots, budget = 6000) {
  const ids = new Map, envs = []
  const val = (v, up) => {
    if (v === NO || v === undefined) return { $: 'NO' }
    if (v === null || typeof v != 'object' && typeof v != 'function') return v
    if (--budget < 0) return { $: '…' }
    if (v.t == 'fn') return { $: 'fn', name: L.fname(v), params: v.params, env: envOf(v.env) }
    if (typeof v == 'function') return { $: 'js', name: v.name || 'function' }
    if (up.has(v)) return { $: '↻' }
    if (!Array.isArray(v) && !isPlain(v)) return { $: 'js', name: v.constructor?.name || 'object' }
    up.add(v)
    try { return Array.isArray(v) ? v.map(x => val(x, up)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x, up)])) }
    finally { up.delete(v) }
  }
  const envOf = e => {
    if (!e) return null
    if (ids.has(e)) return ids.get(e)
    const id = envs.length, o = { id, parent: null, vars: {} }
    ids.set(e, id); envs.push(o)
    for (const [k, v] of e.m) if (!skip(k, v)) o.vars[k] = val(v, new Set)
    o.parent = envOf(e.p)
    return id
  }
  return { roots: roots.map(envOf), envs }
}

// 快照 → 文本，每行一项，和控制台里 show 的写法一致（所以悬停能用同一套 (tweak …) 检测）：
//   E1 ⊂ E0            环境 1，父环境 0
//     x 131.45837      变量 值（数字最多 5 位小数；fn 显示为 <fn 名 E1>）
function fmt(snap) {
  const one = (v, d) => {
    if (v === null || typeof v != 'object') return typeof v == 'string' ? JSON.stringify(v) : typeof v == 'number' ? String(+v.toFixed(5)) : String(v)
    if (Array.isArray(v)) return d > 4 ? '[…]' : '[' + v.map(x => one(x, d + 1)).join(' ') + ']'
    if ('$' in v) return v.$ == 'fn' ? `<fn ${v.name}${v.env != null ? ' E' + v.env : ''}>` : v.$ == 'js' ? `<${v.name}>` : v.$
    return d > 4 ? '{…}' : '{' + Object.entries(v).map(([k, x]) => k + ' ' + one(x, d + 1)).join(' ') + '}'
  }
  return snap.envs.map(e => {
    const rows = Object.entries(e.vars).map(([k, v]) => '  ' + k + ' ' + one(v, 0))
    return `E${e.id}${e.parent != null ? ' ⊂ E' + e.parent : ''}${rows.length ? '\n' + rows.join('\n') : ''}`
  }).join('\n')
}
const create = size => ({ size, frames: [], gen: 0 })
// 帧起点：安装本帧的 p5 调用记录（hooks.ext）。返回 { calls }
function begin(fb, hooks) {
  const calls = []
  hooks.ext = ({ f, x, a, b, args }) => {   // 只记外部 JS（p5）调用：内建（+ * …）、tick/scope 这类带 bname 的、回调还原都不记
    if (calls.length >= 500 || typeof f != 'function' || f.bname || f.lisp || f.gen) return
    const n = (x && x[1] && (x[1][0] == '$' || x[1][0] == '$$') ? x[1][1] : x && x[1] && x[1][0] == '.' && x[1][2] ? x[1][2][1] : null) || f.name
    if (n) calls.push({ name: n, a, b, args: args.slice(0, 8).map(v => v === null || typeof v == 'object' || typeof v == 'function' ? '…' : v) })
  }
  return { calls }
}
// 帧末：把画布按 CSS 尺寸复制进环形缓冲（满了复用最老的一张），并拍内存快照
function end(fb, rec, hooks, p, roots, no) {
  hooks.ext = null
  const src = p.drawingContext?.canvas; if (!src) return
  const slot = fb.frames.length >= fb.size ? fb.frames.shift() : { cv: document.createElement('canvas') }
  if (slot.cv.width != p.width || slot.cv.height != p.height) { slot.cv.width = p.width; slot.cv.height = p.height }
  const g = slot.cv.getContext('2d'); g.clearRect(0, 0, p.width, p.height); g.drawImage(src, 0, 0, p.width, p.height)
  slot.no = no; slot.calls = rec.calls; slot.t = performance.now(); slot.state = snapshot(roots())
  fb.frames.push(slot); fb.gen++
}
// 每个注册的处理器的环境链（顶层环境 + 各闭包的局部环境）
const rootsOf = run => {
  const top = e => { while (e?.p) e = e.p; return e }
  const hs = [...run.ticks.values(), ...[...run.evs.values()].flatMap(m => [...m.values()])]
  const first = top(hs[0]?.f?.env)
  return first ? [first, ...hs.map(h => h.f.env)] : []
}

const Fbuf = { create, begin, end, snapshot, fmt, rootsOf }
G.Fbuf = Fbuf
if (typeof module != 'undefined') module.exports = Fbuf
})(typeof globalThis != 'undefined' ? globalThis : window)
