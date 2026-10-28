/* app.js — p5.html 的页面逻辑：用 Lisp 写 p5.js 草图（不依赖 ui.js 的调试器视图）。
   模型：toplevel 语句 = setup（在 p5 的 setup 里跑一遍，可以 await）；tick / do [=> ...] 注册每帧函数（draw）；
   on "mousePressed" [=> ...] 注册事件；全都可以在任何地方动态注册，返回的句柄交给 off 取消。
   名字回退（宿主）：Lisp 内建 > 作用域 > 本页的 tick/on/off/scope/remap/p > p5 实例 > p5 原型 > window。
   Lisp 的 map/get/push/set 等集合函数优先，被盖住的 p5 同名函数走 p.map / p.push / p.get …。 */
'use strict'
const { feed, eat, grammar, walk, isT } = P, L = LISP, tr = P.f
p5.disableFriendlyErrors = true   // FES 会给每个 p5 函数套一层检查，每帧上百次调用时很慢

const src = new Editor($('#src'), 'src'), out = $('#out')
Tweak.init(src, () => cur?.p ? [cur.p.width, cur.p.height] : null, { probe, note: t => con({ warn: t }) })   // 颜色 / 位置 / 数字小工具（tweak.js）
const status = t => $('#status').textContent = t
const g = grammar(L.RULES)

/* ---------- 控制台 / sloc：与调试器共用 console.js + sloc.js ---------- */
const ovg = $('#ov svg g'), mks = $('#mks')
const OUT = Console.mount(out, {
  open: s => goto(s.a, s.b),
  hover: (s, el) => { Sloc.hov = { el, a: s.a, b: s.b }; Sloc.draw() },
  leave: () => { Sloc.hov = null; Sloc.draw() },
  enter: el => { const v = scanRow(el.textContent); if (!v) return; if (v.cols.length) tint(el, v.cols[0]); if (v.dots.length) { Sloc.vis = { dots: v.dots }; Sloc.draw() } },   // 只在悬停时检测；有结果才替换，留在画布上直到清空
})
const Sloc = {
  hov: null, pick: null, ref: null, rev: null, vis: null,   // vis：控制台行里检测到的 { dots: [{x,y,w,h}] }，Esc / 清空 / 重跑才消失
  reset() { this.vis = null; this.clear() },
  clear() { mks.textContent = ''; ovg.textContent = '' },
  draw(srcSs = ss) {
    this.clear()
    if (!srcSs || srcSs.src !== src.value) return
    srcSs.errs.forEach((e, k) => {
      const r = src.rect(e.a, Math.max(e.b, e.a + 1))
      if (src.visible(r)) SL.label(mks, `E${k + 1}`, r, 'e', { title: e.msg, onclick: () => goto(e.a, e.b) })
    })
    const h = this.hov   // 控制台行 ↔ 源码：悬停时画一条线
    if (h?.el?.isConnected && h.el.offsetParent) { const r = src.rect(h.a, Math.max(h.b, h.a + 1)); if (src.visible(r)) SL.path(ovg, h.el.getBoundingClientRect(), r) }
    const k = this.pick   // 取源：画布上的点 → 源码（箭头扎进源码那边的跨度；矩形每次按当前滚动位置现算）
    if (k) { const to = src.rect(k.a, k.b); if (src.visible(to)) { SL.path(ovg, to, k.from, 'ar'); SL.label(mks, k.label, k.from, 'p', { title: '取源：点角标跳源码', onclick: () => goto(k.a, k.b) }) } }
    const rf = this.ref   // 悬停引用：从引用画到定义（箭头指向定义）
    if (rf?.d) { const a = src.rect(rf.d.a, rf.d.b), b = src.rect(rf.u.a, rf.u.b); if (src.visible(a) && src.visible(b)) SL.path(ovg, a, b, 'ar', 1) }
    const v = this.vis, cv = pvCanvas()   // 控制台行里的坐标：画在画布上（无面板）
    if (v && cv && cur?.p) {
      const q = cv.getBoundingClientRect(), k = q.width / cur.p.width, NS = 'http://www.w3.org/2000/svg'
      const el = (tag, at) => { const e = document.createElementNS(NS, tag); for (const n in at) e.setAttribute(n, at[n]); ovg.append(e) }
      for (const d of v.dots) {
        const cx = q.left + (d.x + d.w / 2) * k, cy = q.top + (d.y + d.h / 2) * k
        if (d.w > 8 || d.h > 8) el('rect', { x: q.left + d.x * k, y: q.top + d.y * k, width: d.w * k, height: d.h * k, fill: 'none', stroke: 'var(--Y)', 'stroke-width': 1.2, 'stroke-dasharray': '3 2' })
        el('circle', { cx, cy, r: 4, fill: 'var(--Y)', stroke: '#000', 'stroke-width': 1 })
      }
    }
    const rv = this.rev   // 点声明：每处引用一个箭头扎回去
    if (rv?.decl) { const dr = src.rect(rv.decl.a, rv.decl.b); for (const u of rv.uses) { const ur = src.rect(u.a, Math.max(u.b, u.a + 1)); if (src.visible(ur)) SL.path(ovg, ur, dr, 'ar', 1) } }
  },
}

/* ---------- 宿主名字：解析期（高亮/“未定义”判断）与运行期共用同一批名字 ---------- */
const EVENTS = new Set('mousePressed mouseReleased mouseClicked doubleClicked mouseMoved mouseDragged mouseWheel keyPressed keyReleased keyTyped windowResized touchStarted touchMoved touchEnded'.split(' '))
// p5 的变量不全在原型上（width / mouseX 等在实例上），解析期补一份名单；运行期取值总是查实例（每次引用读到最新值）
const PVARS = Object.fromEntries('width height mouseX mouseY pmouseX pmouseY winMouseX winMouseY movedX movedY mouseButton mouseIsPressed key keyCode keyIsPressed frameCount deltaTime windowWidth windowHeight displayWidth displayHeight focused pixels touches drawingContext'.split(' ').map(n => [n, 0]))
const DEFS = ['tick', 'do', 'on', 'off', 'scope', 'remap', 'html', 'p']
const staticHost = L.hostOf(Object.fromEntries(DEFS.map(n => [n, 0])), p5.prototype, PVARS, globalThis)
const base = g.builtins; g.builtins = { has: n => base.has(n) || staticHost.has(n) }

/* ---------- 一次运行 = 一个 p5 实例 + 一份宿主；停止/重跑后旧运行里挂起的执行都会作废 ---------- */
let cur = null, pausedEv = null, lastPool = null
// 断点：函数名（Lisp 函数的名字，或调用处写的名字，JS 函数如 circle / log 也行）；状态在 DBG.names 里

const headName = Pick.headName

function newRun(ss) {
  const run = { alive: true, p: null, ss, ticks: new Map, evs: new Map, n: 0, ready: false, pool: null, errs: 0, setupCalls: [], lastCalls: null, pk: null, draws: 0, tickFrames: 0, t0: performance.now() }
  const reg = (m, f, what, hz) => { if (f?.t != 'fn') throw new TypeError(tr`${what} 需要函数`); const id = ++run.n; m.set(id, { f, busy: false, period: hz > 0 ? 1000 / hz : 0, next: 0 }); return id }
  // 处理器在返回 Promise（里面 await 过）时占用自己：没跑完前跳过后续帧/事件，等价于一个协程
  const fire = (m, id, args) => {
    const h = m.get(id); if (!h || h.busy || !run.alive) return false
    if (h.period) {   // (tick 30 f)：Hz 上限；落后太多就重新对齐，不补发
      const t = performance.now(); if (t < h.next) return false
      h.next = !h.next || t - h.next > h.period * 2 ? t + h.period : h.next + h.period
    }
    const r = L.callback(h.f, args.map(L.fromJS), run.host, { m, id })
    if (r instanceof Promise) { h.busy = true; r.finally(() => { h.busy = false }) }
    return true
  }
  run.fire = fire
  const def = (name, f) => Object.assign(f, { bname: name })
  const defs = {
    tick: def('tick', (a, b) => typeof a == 'number' ? reg(run.ticks, b, 'tick', a) : reg(run.ticks, a, 'tick')),   // (tick f) / (tick 30 f)：后者最多每秒 30 次
    do: def('do', (a, b) => typeof a == 'number' ? reg(run.ticks, b, 'do', a) : reg(run.ticks, a, 'do')),
    on: def('on', (ev, f) => {
      if (!EVENTS.has(ev)) throw new TypeError(tr`未知事件 ${ev}`)
      let m = run.evs.get(ev)
      if (!m) { m = new Map; run.evs.set(ev, m); const mm = m; run.p[ev] = (...a) => { for (const id of [...mm.keys()]) fire(mm, id, a) } }
      return reg(m, f, 'on')
    }),
    off: def('off', id => { let hit = run.ticks.delete(id); for (const m of run.evs.values()) hit = m.delete(id) || hit; return hit }),
    scope: Object.assign(L.gen(function* (f) { run.p.push(); try { return yield* L.call(f, []) } finally { try { run.p.pop() } catch { } } }), { bname: 'scope' }),
    remap: def('remap', (...a) => run.p.map(...a)),
    html: def('html', s => { const fr = L.cx?.stack.at(-1); con({ html: String(s), ...(fr?.a != null ? { a: fr.a, b: fr.b } : {}) }); return s }),   // 往 Console 输出一行 HTML（echo`…` 这类 tag 函数用）
    get p() { return run.p },
  }
  run.host = Object.assign(L.hostOf(defs, () => run.p, p5.prototype, PVARS, globalThis), {
    run,          // cx.run：控制台行/后续 Tweak 部件按运行归属
    hooks: { ext: null },   // 取源的钩子：setup 期间 / 被请求的那一帧才装（见 pick.js），平时 call() 只多一次 null 判断
    last: true,   // 函数体取最后一句的值，不要求 OK
    log: { push: item => con(item) },
    alive: () => run.alive,
    error: (r, tag) => { con({ err: r.err, n: r.a != null ? { a: r.a, b: r.b } : null }); if (tag) tag.m.delete(tag.id) },   // 出错的处理器摘掉，免得每帧刷屏
    pause: e => DBG.at(e),
  })
  return run
}

/* ---------- 断点：双击函数名切换；暂停时在控制台显示 [f 实参] ⇒ 返回值，F9 / ⏯ 继续 ---------- */
const NAME = /^[A-Za-z_$@][^\s()\[\]{}",;?.#]*$/
const nameTokAt = i => {
  if (!ss) return null
  let hit = null
  walk(ss.tree, n => { if (hit) return false; if (n.b <= i || n.a > i) return false; if (!n.kids.length) hit = n })
  return hit && hit.k == 'tok' && NAME.test(ss.src.slice(hit.a, hit.b)) ? hit : null
}
function paintBp() {
  const rs = []
  if (ss?.tree && DBG.names.size) walk(ss.tree, n => { if (!n.kids.length && n.k == 'tok' && n.b > n.a) { const t = ss.src.slice(n.a, n.b); if (DBG.hasName(t) && NAME.test(t)) rs.push(src.range(n.a, n.b)) } })
  HL.set('bp', { bp: rs })
}
$.ev(src.el, {
  dblclick() {
    const { clientX, clientY } = $.event
    if (ss?.src !== src.value) parse()
    const i = src.offsetAt(clientX, clientY), n = i < 0 ? null : nameTokAt(i); if (!n) return
    const t = ss.src.slice(n.a, n.b), on = DBG.name(t)
    src.setSel(n.b); paintBp(); status(`断点 ${t} ${on ? '已设置' : '已取消'}（共 ${DBG.names.size} 个）`)
  },
})
/* ---------- 暂停：显示 [f 实参] ⇒ 返回值，下面一个输入框在这一帧里即时求值 ----------
   输入 (+ x 1)        → 求值并打印结果，继续停着
   输入 (OK 值)        → 用这个值替换这次调用的返回值并继续（暂停点兑现 { v }，见 lisp.js call）
   输入 ? (== x 1)     → 这个函数转成日志断点：以后条件成立时自动打印一行，不再暂停（单独一个 ? 表示每次都打印）
   名字查这一帧的环境；@args / @ret 是这次调用的实参数组和返回值。 */
const gc = grammar(L.RULES); gc.builtins = { has: () => true }   // 即时求值：名字运行期查帧环境，解析期不报“未定义”
function parseExpr(text) { const q = feed(text); eat(gc, q); return q.errs.length ? { err: q.errs[0].msg } : { ast: q.value } }
let pausedSend = null, evalInp = null, userLeft = false   // userLeft：最近一次按下发生在输入框之外（用户主动离开），否则失焦一律抢回
document.addEventListener('pointerdown', e => { userLeft = !!evalInp && e.target !== evalInp }, true)
const takeSend = () => { const v = pausedSend; pausedSend = null; return v || undefined }
const callName = e => DBG.nameOf(e) || headName(e.x?.[1]) || e.f?.name || L.fname(e.f)
// A B C… = 这次调用的第 1 2 3… 个实参；$A $B $C… = 同一个断点上一次命中时的同一位置实参（第一次是 NO）
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const evalAt = (e, ast, prev) => {
  const x = { '@args': e.args, '@ret': e.v }
  ;(e.args || []).slice(0, 26).forEach((v, i) => { x[LETTERS[i]] = v; x['$' + LETTERS[i]] = prev?.[i] ?? L.NO })
  return L.evalIn(ast, e.env, x)
}
DBG.onCond = (e, c, name) => {
  if (c.bad) return
  const r = evalAt(e, c.ast, c.prev); c.prev = e.args
  if (r.err !== undefined) { c.bad = true; con({ warn: `日志断点 ${name} ? ${c.text}：${r.err}（已停用）`, a: e.a, b: e.b }); return }
  if (L.truthy(r.value)) con({ out: `⏺ [${name}${(e.args || []).map(a => ' ' + L.show(a, 1)).join('')}] ⇒ ${L.show(e.v, 1)}`, a: e.a, b: e.b })
}
function pauseInput(row, e) {
  if (!row || e.ph != 'ret' || !e.env) return
  const inp = document.createElement('input')
  inp.placeholder = '即时求值 · (OK 值) 替换返回并继续 · ? 条件 → 日志断点'
  inp.style.cssText = 'display:block;width:100%;margin:2px 0 3px;background:#2f3440;color:var(--fg);border:1px solid var(--bd);border-radius:3px;font:11px/1.5 inherit;padding:1px 4px'
  inp.onclick = inp.onmousedown = ev => ev.stopPropagation()   // 输入框在可点击的控制台行里：别触发“跳转源码并聚焦编辑器”
  inp.onblur = () => { if (evalInp === inp && !userLeft && inp.isConnected && !$('#resume').hidden) setTimeout(() => { if (!userLeft && inp.isConnected) inp.focus({ preventScroll: true }) }, 0) }   // 选区 / 取源 / 刷新等程序化操作把焦点带走时抢回
  inp.onkeydown = ev => {
    if (ev.key == 'Escape') { ev.preventDefault(); userLeft = true; Sloc.vis = null; Sloc.draw(); src.el.focus(); return }
    if (!/^F\d+$/.test(ev.key)) ev.stopPropagation()   // 功能键（F8–F11）要漏给全局快捷键，其余按键留给输入框
    if (ev.key != 'Enter') return
    ev.preventDefault()
    const t = inp.value.trim(); if (!t) return
    const log = t[0] == '?', p = parseExpr(log ? (t.slice(1).trim() ? `(> ${t.slice(1).trim()})` : 'true') : t)
    if (p.err) { inp.style.borderColor = 'var(--R)'; status(p.err); return }
    inp.style.borderColor = 'var(--bd)'
    if (log) {
      const name = callName(e), text = t.slice(1).trim() || 'true'
      DBG.name(name, true); DBG.conds.set(name, { text, ast: p.ast }); paintBp()
      con({ out: `⏺ 日志断点 ${name} ? ${text}`, cls: 'info' }); resume(); return
    }
    const r = evalAt(e, p.ast)
    if (r.err !== undefined) { con({ err: r.err }); return }
    if (r.ret) { pausedSend = { v: r.value }; con({ out: `↩ 返回值替换为 ${L.show(r.value, 1)}`, cls: 'info' }); resume(); return }
    con({ out: `⇒ ${L.show(r.value, 1)}`, cls: 'info' }); inp.value = ''; inp.focus()
  }
  evalInp = inp; userLeft = false; row.append(inp); requestAnimationFrame(() => inp.focus())
}
function showPause(e, why) {
  const a = e.a, b = e.b, sh = L.show, name = e.ph == 'ret' ? callName(e) : e.f?.name || headName(e.x?.[1]) || L.fname(e.f)
  const tag = why == 'frame' ? 'F11 帧' : why == 'line' ? 'F10 语句' : why == 'name' ? '断点' : '断点'
  const what = e.ph == 'ret' ? `[${name}${(e.args || []).map(a => ' ' + sh(a, 1)).join('')}] ⇒ ${sh(e.v, 1)}`
    : e.ph == 'if' ? `? ${sh(e.c, 1)} → ${e.t ? '真分支' : '假分支'}`
    : e.ph == 'in' ? '⇢ 进入' : `⇠ ${sh(e.v, 1)}`
  pausedEv = e
  con({ pause: `⏸ ${what}   · ${tag}`, n: a != null ? { a, b } : null })
  pauseInput(out.lastElementChild, e)
  if (a != null) { HL.set('ev', { ev: [src.range(a, Math.max(b, a + 1))] }); src.scrollTo(a) }
  $('#resume').hidden = false; status('已暂停（F9 继续 · F10 下一行 · F8 取消此断点并继续 · F11 下一帧）')
}
DBG.onPause = (e, why) => showPause(e, why)
function resume() {
  if (!cur) return
  const more = DBG._q.length > 1
  HL.set('ev', {}); if (!more) { $('#resume').hidden = true; status('运行中') }
  DBG.resume(takeSend())
}
function go(fn) {
  const more = DBG._q.length > 1
  HL.set('ev', {}); if (!more) { $('#resume').hidden = true; status('运行中') }
  fn()
}
$('#resume').onclick = resume

/* ---------- 取源（pick）：悬停画布 → 箭头指向画这一笔的调用；右键 → 选中源码并打开那一行的第一个部件 ----------
   请求挂在 run.pk 上，由下一帧的 p.draw 兑现（pick.js 的 begin/end 夹住用户的 tick）：不额外重画，动画的状态不会多走一步；
   没在循环的草图（noLoop）才主动 redraw 一次。结果 = 像素读回的归属，读不到就用 (tweak …) 几何 / setup 期记下的 bbox 兜底。 */
let armed = false   // F8 按下后等一次右键取源：点中的调用名设为断点
const pvCanvas = () => document.querySelector('#pv canvas')
function pickAt(e, commit) {
  const run = cur, c = pvCanvas(); if (!run?.ready || !run.p || !c) return
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) * run.p.width / r.width, y = (e.clientY - r.top) * run.p.height / r.height
  const pk = run.pk ||= { commit: false }
  Object.assign(pk, { x, y, from: { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 } }); pk.commit ||= commit
  if (!run.p.isLooping()) run.p.redraw()
}
function finishPick(run, pk, res) {
  if (run !== cur) return
  const hit = res.by || Pick.byBox(res.calls, pk.x, pk.y) || Pick.byBox(run.setupCalls, pk.x, pk.y)
  if (!hit || hit.a == null) { Sloc.pick = null; Sloc.draw(); status(pk.commit ? '取源：这个位置没有找到绘制调用' : ''); return }
  const b = Math.max(hit.b, hit.a + 1)
  Sloc.pick = { from: pk.from, a: hit.a, b, label: hit.name || '?', sticky: pk.commit }
  if (pk.commit || $('#auto').checked) { src.setSel(hit.a, hit.b); src.scrollTo(hit.a) }   // 悬停只有开着自动刷新才直接定位源码；右键总是
  if (pk.commit) {
    requestAnimationFrame(() => { Tweak.openFirst(hit.a, { x: pk.from.left, y: pk.from.top }); Sloc.draw() })   // 部件直接出现在鼠标处
    if (armed && hit.name) { armed = false; DBG.name(hit.name, true); paintBp(); status(`已设断点 ${hit.name}（F8 取消并继续 · F9 继续 · F10 下一行）`) }
    else status(`取源：${hit.name}  ${run.ss.sloc(hit.a)}   · 想在别处设断点：F8 后右键`)
  }
  Sloc.draw()
}
$.ev($('#pv'), {
  mousemove() { if (!$.event.target.closest('canvas') || !$('#auto').checked) return; pickAt($.event, false) },   // 悬停取源只在自动刷新开着时生效
  contextmenu() { if (!$.event.target.closest('canvas')) return; $.event.preventDefault(); pickAt($.event, true) },
  mouseleave() { if (cur) cur.pk = null; if (Sloc.pick && !Sloc.pick.sticky) { Sloc.pick = null; Sloc.draw() } },
})

/* ---------- 速率：fps = p.draw 的实际次数，Hz = 有 tick 被触发的帧数 ---------- */
{
  const el = $('#rate'); let last = null
  setInterval(() => {
    const r = cur, t = performance.now()
    if (!r) { el.textContent = '— fps · — Hz'; last = null; return }
    if (last?.r === r) {
      const s = (t - last.t) / 1000
      el.textContent = `${((r.draws - last.d) / s).toFixed(0)} fps · ${r.ticks.size ? ((r.tickFrames - last.k) / s).toFixed(0) : '—'} Hz`
    }
    last = { r, t, d: r.draws, k: r.tickFrames }
  }, 500)
}
// 点速率：往源码里补上限控制——顶层 [frameRate 60]（fps 上限）和第一个 tick / do 前面的 Hz（(tick 60 f)），再在按钮下面弹出数字部件（滚轮微调）
$('#rate').onclick = () => {
  if (ss?.src !== src.value) parse()
  if (!ss.value || ss.errs.length) { status('先修好语法错误'); return }
  const top = ss.value.slice(1).filter(x => isT(x) && (x[0] == '()' || x[0] == '[]') && isT(x[1])), nm = x => x[1][0] == '$' || x[1][0] == '$$' ? x[1][1] : null
  const fr = top.find(x => nm(x) == 'frameRate'), tk = top.find(x => (nm(x) == 'tick' || nm(x) == 'do') && typeof x[2] != 'number')
  const edits = [], s = src.value
  if (!fr) { const cc = [...top].reverse().find(x => nm(x) == 'createCanvas'); edits.push(cc ? { at: (i => i < 0 ? s.length : i)(s.indexOf('\n', cc.b)), text: '\n[frameRate 60]' } : { at: 0, text: '[frameRate 60]\n' }) }
  if (tk) edits.push({ at: tk[1].b, text: ' 60' })
  if (edits.length && src.fix()) {
    for (const e of edits.sort((p, q) => q.at - p.at)) src.t.replaceData(e.at, 0, e.text)
    parse(); refresh(true)
  }
  const f2 = ss.value && ss.value.slice(1).find(x => isT(x) && (x[0] == '()' || x[0] == '[]') && isT(x[1]) && nm(x) == 'frameRate')
  const q = $('#rate').getBoundingClientRect()
  if (f2) { src.scrollTo(f2.a); requestAnimationFrame(() => { Tweak.openFirst(f2.a, { x: q.left, y: q.bottom }); Sloc.draw() }) }
  status(edits.length ? 'fps 上限：[frameRate N]；tick 上限：(tick N f)——悬停数字滚轮调整' : '已有 frameRate / tick 上限：悬停数字滚轮调整')
}
/* ---------- 控制台 #out ---------- */
const goto = (a, b) => { src.el.focus(); src.setSel(a, b); src.scrollTo(a); requestAnimationFrame(() => Sloc.draw()) }
// 颜色：直接把这一行的文字设成它（很暗的颜色配浅底，不然看不见）
function tint(el, [r, g, b, a]) {
  el.style.color = `rgba(${r},${g},${b},${a / 255})`
  el.style.background = 0.299 * r + 0.587 * g + 0.114 * b < 70 ? 'var(--fg)' : ''
}
// 控制台行 → 画布标记：颜色（#hex / rgb(…) / (color …)）和声明了 (tweak …) 几何的调用 [name 实参…]；没有可检测内容返回 null（保留上一次的标记）
const NUM = '-?\\d+(?:\\.\\d+)?'
const RE_COL = new RegExp(`#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\\b|rgba?\\(\\s*(${NUM})[ ,]+(${NUM})[ ,]+(${NUM})(?:[ ,/]+(${NUM}))?\\s*\\)|\\(color\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})(?:\\s+(${NUM}))?\\)`, 'gi')
const hexRgba = h => { h = h.slice(1); if (h.length < 6) h = [...h].map(c => c + c).join(''); return [0, 2, 4, 6].map(i => h.length > i ? parseInt(h.slice(i, i + 2), 16) : 255) }
// 没写 (tweak …) 声明时，悬停预览按 p5 的惯用参数顺序兜底（只用于悬停预览；写了声明就以声明为准）
const G = (kind, idx) => ({ kind, idx, ns: [] })
const FALLBACK = {
  circle: { groups: [G('vec2', [0, 1]), G('num', [2])] }, square: { groups: [G('vec2', [0, 1]), G('num', [2])] },
  ellipse: { groups: [G('vec2', [0, 1]), G('size', [2, 3])] }, rect: { groups: [G('vec2', [0, 1]), G('size', [2, 3])] },
  line: { groups: [G('vec2', [0, 1]), G('vec2', [2, 3])] }, point: { groups: [G('vec2', [0, 1])] }, translate: { groups: [G('vec2', [0, 1])] },
  fill: { groups: [G('color', [0, 1, 2, 3])] }, stroke: { groups: [G('color', [0, 1, 2, 3])] }, background: { groups: [G('color', [0, 1, 2, 3])] },
}
function scanRow(text) {
  if (text.length > 600) return null
  const cols = [], dots = []
  for (const m of text.matchAll(RE_COL)) {
    if (m[0][0] == '#') cols.push(hexRgba(m[0]))
    else { const n = m[1] != null ? m.slice(1, 5) : m.slice(5, 9); cols.push([+n[0], +n[1], +n[2], n[3] == null ? 255 : +n[3] * (m[1] != null && +n[3] <= 1 ? 255 : 1)]) }
  }
  for (const m of text.matchAll(/\[([^\s\[\]]+)([^\[\]]*)\]/g)) {
    const d = Tweak.decls.get(m[1]) || FALLBACK[m[1]]; if (!d) continue
    const args = m[2].trim().split(/\s+/).map(t => t !== '' && isFinite(+t) ? +t : t)
    const g = Tweak.geo(m[1], args, d); if (g) dots.push(g)
    for (const grp of d.groups) {   // (color i j k l)：[background 17 17 27] 这类声明过的颜色实参（含小数）
      if (grp.kind != 'color') continue
      const v = grp.idx.map(i => args[i]); if (v.length >= 3 && v.slice(0, 3).every(x => typeof x == 'number'))
        cols.push([v[0], v[1], v[2], typeof v[3] == 'number' ? v[3] : 255].map(x => Math.max(0, Math.min(255, Math.round(x)))))
    }
  }
  return cols.length || dots.length ? { cols, dots } : null
}
function con(it) {
  if (it.err != null && cur) cur.errs++   // 数字微调靠它判断“这个值让运行报错了”
  const at = it.n || (it.a != null ? { a: it.a, b: it.b } : it.span), sl = at && cur?.ss ? '  ' + cur.ss.sloc(at.a) : ''
  OUT.push(
    it.err != null ? { cls: 'eitem', text: `✖ ${it.err}${sl}`, span: at }
      : it.warn != null ? { cls: 'warn', text: `⚠ ${it.warn}` }
      : it.pause != null ? { cls: 'pause', text: it.pause, span: at }
      : it.html != null ? { cls: 'log', html: it.html, span: at }
      : { cls: it.cls || 'log', text: it.out, span: at, spans: it.spans })
}
const fmt = v => v instanceof Error ? v.message : L.show(L.fromJS(v))
// 只有调用点写着 console.<k>（console.log … / [console.log …] / console.[log …]）时才带跨度；
// p5 内部自己打的 log 没有这层调用点，不加跨度。异步回调里没有栈，也不加。
const siteOf = k => {
  const fr = L.cx?.stack.at(-1), c = fr?.x?.[1]
  return fr && isT(c) && c[0] == '.' && isT(c[1]) && (c[1][0] == '$' || c[1][0] == '$$') && c[1][1] == 'console' && isT(c[2]) && c[2][1] == k && fr.a != null
    ? { a: fr.a, b: fr.b } : null
}
for (const k of ['log', 'info', 'warn', 'error']) {   // console.* 同时进 #out
  const o = console[k].bind(console)
  console[k] = (...a) => { o(...a); con({ out: a.map(fmt).join(' '), cls: k == 'error' ? 'error' : k, ...siteOf(k) }) }
}
$.ev(window, {
  error() { con({ out: $.event.message, cls: 'error' }) },
  unhandledrejection() { con({ out: `Promise: ${fmt($.event.reason)}`, cls: 'error' }) },
})
$('#clr').onclick = () => { OUT.clear(); Sloc.reset() }

/* ---------- 解析 / 运行 / 停止 ---------- */
let ss = null, twSig = ''
Xref.wire({ ed: src, ssOf: () => ss, sloc: Sloc, status })
function parse() {
  ss = feed(src.value); eat(g, ss)
  ss.pool = null; if (!ss.errs.length) try { ss.pool = L.pool(ss.value, ss.src) } catch { }   // 常量池：实际执行的是它的副本（数字是格子）
  paint(src, ss.tree, g.colors); paintBp(); Tweak.scan(ss, ss.pool?.cells); Sloc.pick = null; Sloc.draw()
  const sig = Tweak.problems.map(p => p.a + ':' + p.msg).join('|')   // 声明写错时只提示一次（每次编辑后重解析）
  if (sig !== twSig) { twSig = sig; for (const p of Tweak.problems) con({ warn: `tweak ${p.msg}`, a: p.a, b: p.b }) }
  return ss
}
function stop() {
  const run = cur; if (!run) return
  cur = null; run.alive = false; run.pk = null; L.host = null
  DBG.cancel(); DBG.mode = 'run'; DBG.lastKey = null; pausedEv = null
  HL.set('ev', {}); $('#resume').hidden = true
  try { run.p?.remove() } catch { }
  Sloc.reset(); Sloc.pick = null; status('已停止')
}
function play() {
  stop(); parse(); OUT.clear(); Sloc.reset()
  if (ss.errs.length) {
    for (const e of ss.errs) OUT.push({ cls: 'eitem', text: `✖ ${ss.sloc(e.a)}  ${e.msg}`, span: e })
    Sloc.draw(); status(`${ss.errs.length} 个语法错误，未运行`); return
  }
  DBG.reset(); pausedEv = null; $('#resume').hidden = true   // 旧运行挂起的暂停先兑现
  const run = cur = newRun(ss); L.host = run.host; run.pool = ss.pool
  new p5(p => {
    run.p = p
    p.setup = () => {
      const fin = res => { Pick.record(run.host.hooks, null); if (res.err) con({ err: res.err, n: res.a != null ? { a: res.a, b: res.b } : null }); run.ready = true }
      Pick.record(run.host.hooks, run.setupCalls)   // setup 期间一直记几何调用（没有 tick 的草图只画这一次）
      const r = L.start(run.pool.code, run.host.log)
      r instanceof Promise ? r.then(fin) : fin(r)
    }
    // 帧起点：先于用户代码第一笔绘制。取源请求（run.pk）在这一帧兑现：begin 撒亮点，用户的 tick 跑完后 end 读回
    p.draw = () => {
      run.draws++
      if (run.ready && run.ticks.size) DBG.frame()
      const pk = run.pk, picking = pk && run.ready && Pick.begin(p, pk.x, pk.y, run.host.hooks)
      let fired = false
      if (run.ready) for (const id of [...run.ticks.keys()]) fired = run.fire(run.ticks, id, []) || fired
      if (fired) run.tickFrames++
      if (picking) { run.pk = null; finishPick(run, pk, Pick.end(run.host.hooks)) }
    }
  }, $('#pv'))
  status('运行中')
}
$('#play').onclick = play

/* ---------- 会话 / 目录树（Ctrl+E 打开，Ctrl+S 保存） ---------- */
const SESS = Session.create({
  ed: src, status,
  onOpen: () => { parse(); if (cur) play(); else if ($('#auto').checked) play() },   // 打开文件后重解析；在跑就重跑
})
const EXP = Explorer.mount({ session: SESS, status })
$('#files').onclick = () => EXP.toggle()

/* ---------- 编辑器 ----------
   数字字面量改了（打字 / Tweak / 滚轮）→ 改常量池的格子，不重解析不重跑不丢状态；格子在 setup 里只读一次（顶层字面量）或结构变了 → 才重跑。
   来自 Tweak 的编辑总是生效（不看“自动刷新”）；打字的编辑只有勾了“自动刷新”才重跑。 */
let pt = 0, playT = 0
const replay = ms => { clearTimeout(playT); playT = ms ? setTimeout(() => { playT = 0; play() }, ms) : 0 }
function refresh(eager) {
  const ms = eager ? 80 : $('#auto').checked ? 700 : 0
  if (!cur || !ss.pool) return replay(ms)             // 没在跑 / 有语法错误
  const done = cur.pool.apply(ss.pool)                // null：结构变了
  if (done) { cur.ss = ss; replay(done.some(c => !c.fn) ? ms : 0) } else replay(ms)
}
// 微调一个数字：先让运行证明新值没问题。返回 false = 运行报错（调用方退回旧值并划定区间）
async function probe(apply, revert) {
  const r0 = cur, e0 = r0?.errs || 0, t0 = r0?.ticks.size || 0
  apply()
  const t = performance.now()
  while ((playT || !cur?.ready) && performance.now() - t < 2000) await new Promise(r => requestAnimationFrame(r))
  const r = cur; if (!r) return true
  const d0 = r.draws; while (r.draws - d0 < 3 && cur === r && performance.now() - t < 2000) await new Promise(r => requestAnimationFrame(r))
  const ok = r === r0 ? r.errs == e0 && r.ticks.size >= t0 : r.errs == 0
  if (!ok) { revert(); if (cur === r && r.ticks.size < t0) replay(80) }   // 出错的处理器已被摘掉：退回原值后重跑才能恢复
  return ok
}
$.ev(src.el, {
  input() {
    clearTimeout(pt)
    if (Tweak.mine) { parse(); refresh(true) }
    else pt = setTimeout(() => { parse(); refresh(false) }, 150)
  },
  keydown() {
    const { key, ctrlKey, metaKey, shiftKey, altKey } = $.event
    if (key == 'Enter' && (ctrlKey || metaKey)) { shiftKey ? stop() : play(); $.event.preventDefault(); return }
    if (key == 'Enter' && !shiftKey && !altKey) {   // 保持缩进
      const [a] = src.caret(), s = src.value, ind = /^[ \t]*/.exec(s.slice(s.lastIndexOf('\n', a - 1) + 1, a))[0]
      src.fix(); src.splice('\n' + ind); $.event.preventDefault(); return
    }
    if (key == 'Tab') { src.fix(); src.splice('  '); $.event.preventDefault() }
  },
  scroll() { Sloc.draw() },
})
$.ev(window, {
  keydown() {
    const k = $.event.key
    // F8：没暂停 = 等下一次右键，在点中的图形上设断点（再按取消）；暂停中 = 取消当前断点并继续
    // F9 继续 · F10 下一条语句 · F11 下一帧入口
    if (k == 'F8') {
      $.event.preventDefault()
      if ($('#resume').hidden) { armed = !armed; status(armed ? 'F8：右键点画布上要断点的图形（再按 F8 取消）' : '已取消') }
      else {
        const e = pausedEv, nm = e.ph == 'ret' ? DBG.nameOf(e) : null
        if (nm) DBG.name(nm, false); else if (DBG.hasRange(e.a, e.b)) DBG.range(e.a, e.b)
        paintBp(); resume(); status(nm ? `已取消断点 ${nm}，继续运行` : '继续运行')
      }
    }
    else if (k == 'F9') { resume(); $.event.preventDefault() }
    else if (k == 'F10') { go(() => DBG.stepLine(pausedEv, takeSend())); $.event.preventDefault() }
    else if (k == 'F11') { go(() => DBG.nextFrame(pausedEv, takeSend())); $.event.preventDefault() }
    else if (k == 'Escape' && Sloc.vis) { Sloc.vis = null; Sloc.draw() }   // 清掉控制台悬停留在画布上的颜色 / 圆点
    else if ((k == 'e' || k == 'E') && ($.event.ctrlKey || $.event.metaKey)) { EXP.toggle(); $.event.preventDefault() }
    else if ((k == 's' || k == 'S') && ($.event.ctrlKey || $.event.metaKey)) { EXP.save(); $.event.preventDefault() }
  },
  resize() { Sloc.draw() },
})
$.ev(out, { scroll() { Sloc.draw() } })

// 编辑器 / 控制台分隔条
const split = $('#split'), con_ = $('#con')
$.ev(split, {
  pointerdown() {
    const { pointerId } = $.event
    $.event.preventDefault(); split.setPointerCapture(pointerId); split.classList.add('drag')
    const bottom = con_.parentElement.getBoundingClientRect().bottom
    const off = $.ev(split, { pointermove() { con_.style.flex = `0 0 ${Math.max(60, Math.min(bottom - $.event.clientY, innerHeight - 200))}px` } })
    $.ev(split, { pointerup() { off(); split.classList.remove('drag') } }, { once: true })
  },
})

/* ---------- 示例 ---------- */
const ex = $('#ex')
P5EX.forEach((e, i) => ex.append(h('option', null, `${i + 1}. ${e.name}`)))
function load(i) {
  ex.selectedIndex = i; src.value = P5EX[i].src; history.replaceState(null, '', '#' + (i + 1)); play()
}
ex.onchange = () => load(ex.selectedIndex)
load(Math.min(Math.max((parseInt(location.hash.slice(1)) || 1) - 1, 0), P5EX.length - 1))
