/* debug.js — 两页共用的调试控制器：断点集合、帧边界、语句边界。
   不碰 DOM：命中判断只吃 lisp.js 的事件（{ph,a,b,f,x,…}）与 Doc.stmts；怎么暂停、怎么显示由页面决定。
     p5    p.draw 每帧开头调 DBG.frame()，host.pause = e => DBG.at(e)（返回 Promise 就挂起）
     index EvStep 用自己的循环，每步调 DBG.hit(e)（返回非空即停）
   断点：范围（源码 a:b，页面把 $n 标记/双击词条变成它）+ 函数名（ret 事件上的 ev.f.name 或调用头名字）。
   模式：run（只断点）/ line（F10：语句或帧变了才停）/ step（index 的 F11：下一个事件）/ frame（p5 的 F11：到下一帧的第一条事件才停）。 */
(function (G) {
'use strict'
const head = x => !Array.isArray(x) ? null : x[0] == '$' || x[0] == '$$' ? x[1] : x[0] == '.' && Array.isArray(x[2]) ? x[2][1] : null
const keyOf = (i, f) => i + '@' + f
const DBG = {
  bps: new Set(), names: new Set(), conds: new Map(), onCond: null, mode: 'run', doc: null,   // conds：函数名 → 日志断点的条件（有条件就不暂停，条件成立时 onCond 负责打印）
  frameNo: 0, target: 0, lastKey: null, onPause: null, _q: [],
  setDoc(doc) { this.doc = doc && doc.stmts && doc.stmts.length ? doc.stmts : null; this.lastKey = null },
  // 只清运行期状态；断点跨运行保留
  reset() { this.mode = 'run'; this.lastKey = null; this.frameNo = 0; this.target = 0; this.doc = null; this.cancel() },
  range(a, b) { const k = a + ':' + b; if (this.bps.has(k)) { this.bps.delete(k); return false } this.bps.add(k); return true },
  hasRange(a, b) { return a != null && this.bps.has(a + ':' + b) },
  name(n, on) {
    if (n == null) return false
    const k = String(n); if (on === undefined) on = !this.names.has(k)
    on ? this.names.add(k) : (this.names.delete(k), this.conds.delete(k)); return on
  },
  hasName(n) { return n != null && this.names.has(String(n)) },
  // ret 事件命中的断点名：Lisp 函数名 / 内建名 / 调用头写的名字（JS 函数如 circle 的 f.name 常是空或 bound，要看调用头）
  nameOf(e) { for (const n of [e.f?.name, e.f?.bname, head(e.x?.[1])]) if (this.hasName(n)) return String(n); return null },
  // 事件所在的语句 + 帧(line 模式的“同一条语句”判据)
  keyAt(e) { return e && e.a != null ? keyOf(this.stmtOf(e.a), this.frameNo) : null },
  // 事件所在的语句（Doc.stmts 二分）；没有语句表时返回 -1
  stmtOf(a) {
    const S = this.doc; if (!S || a == null || a < 0) return -1
    let lo = 0, hi = S.length - 1
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a < S[m][0]) hi = m - 1; else if (a >= S[m][1]) lo = m + 1; else return m }
    return -1
  },
  // p5 的 tick 入口（p.draw 第一件事）：本帧的事件都带新的 frameNo
  frame() { this.frameNo++ },
  // 给 lisp.js 的 cx.watch：nodes = 是否要 in/out/if 节点事件（范围断点、F10/F11 单步）；rets = 是否要 ret 事件（再加函数名断点 / 日志断点）。都不要时运行时一个事件都不产出
  get watch() { const d = this; return d._w ||= { get nodes() { return d.bps.size > 0 || d.mode != 'run' }, get rets() { return d.names.size > 0 || d.conds.size > 0 || this.nodes } } },
  // 命中返回原因（'bp' | 'name' | 'line' | 'step' | 'frame'），否则 null；只在命中时更新 lastKey
  hit(e) {
    if (e.a != null && this.hasRange(e.a, e.b)) return 'bp'
    if (e.ph == 'ret') {
      const nm = this.nameOf(e)
      if (nm != null) {
        const c = this.conds.get(nm)
        if (c) { this.onCond?.(e, c, nm); return null }   // 日志断点：条件成立时打印，不暂停
        return 'name'
      }
    }
    if (this.mode == 'line') {
      if (e.a == null) return null
      const k = keyOf(this.stmtOf(e.a), this.frameNo)
      if (k === this.lastKey) return null
      const had = this.lastKey != null; this.lastKey = k
      return had ? 'line' : null            // 第一步先把当前语句记下，从下一条语句起停
    }
    if (this.mode == 'step') return e.a != null ? 'step' : null
    if (this.mode == 'frame' && this.frameNo >= this.target) { this.mode = 'run'; this.lastKey = null; return 'frame' }
    return null
  },
  // 从暂停处继续：一条语句 / 下一事件 / 下一帧 / 继续
  // send：兑现给暂停点的值；{ v } 会替换暂停在 ret 处那次调用的返回值（见 lisp.js call）
  stepLine(e, send) { this.mode = 'line'; this.lastKey = this.keyAt(e); return this._go(send) },
  stepEvent(send) { this.mode = 'step'; return this._go(send) },   // 下一个带源码位置的事件(进入 / 返回 / 判断)
  nextFrame(e, send) {
    if (this.frameNo == 0) return this.stepLine(e, send)           // 没有帧概念（index）→ 退化为逐语句
    this.mode = 'frame'; this.target = this.frameNo + 1; this.lastKey = null; return this._go(send)
  },
  resume(send) { this.mode = 'run'; this.lastKey = null; return this._go(send) },
  _go(send) { const r = this._q.shift(); return !!r && (r(send), true) },
  // 页面用：命中就挂起并交给 onPause，返回 Promise
  at(e) {
    const why = this.hit(e); if (!why) return
    return new Promise(res => { this._q.push(res); this.onPause?.(e, why) })
  },
  // 运行被取消（停止/重跑）：兑现所有挂起的暂停，免得旧运行卡住
  cancel() { const q = this._q; this._q = []; for (const r of q) r() },
}
G.DBG = DBG
if (typeof module != 'undefined') module.exports = DBG
})(typeof globalThis != 'undefined' ? globalThis : window)
