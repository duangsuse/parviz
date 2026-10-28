/* app.js — p5.html 的页面逻辑：用 Lisp 写 p5.js 草图（不依赖 ui.js 的调试器视图）。
   模型：toplevel 语句 = setup（在 p5 的 setup 里跑一遍，可以 await）；tick / do [=> ...] 注册每帧函数（draw）；
   on "mousePressed" [=> ...] 注册事件；全都可以在任何地方动态注册，返回的句柄交给 off 取消。
   名字回退（宿主）：Lisp 内建 > 作用域 > 本页的 tick/on/off/scope/remap/p > p5 实例 > p5 原型 > window。
   Lisp 的 map/get/push/set 等集合函数优先，被盖住的 p5 同名函数走 p.map / p.push / p.get …。 */
'use strict'
const { feed, eat, grammar, walk, isT } = P, L = LISP, tr = P.f
p5.disableFriendlyErrors = true   // FES 会给每个 p5 函数套一层检查，每帧上百次调用时很慢

const src = new Editor($('#src'), 'src'), out = $('#out')
Tweak.init(src, () => cur?.p ? [cur.p.width, cur.p.height] : null)   // 颜色 / 位置小工具（p5tweak.js）
const status = t => $('#status').textContent = t
const g = grammar(L.RULES)

/* ---------- 控制台 / sloc：与调试器共用 console.js + sloc.js ---------- */
const ovg = $('#ov svg g'), mks = $('#mks')
const OUT = Console.mount(out, {
  open: s => goto(s.a, s.b),
  hover: (s, el) => { Sloc.hov = { el, a: s.a, b: s.b }; Sloc.draw() },
  leave: () => { Sloc.hov = null; Sloc.draw() },
})
const Sloc = {
  hov: null, pick: null, ref: null, rev: null,
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
    const k = this.pick   // 取源：画布上的点 → 源码（箭头扎进源码那边的跨度）
    if (k?.to) { SL.path(ovg, k.to, k.from, 'ar'); SL.label(mks, k.label, k.from, 'p', { title: '取源：点角标跳源码', onclick: () => goto(k.to.a, k.to.b) }) }
    const rf = this.ref   // 悬停引用：从引用画到定义（箭头指向定义）
    if (rf?.d) { const a = src.rect(rf.d.a, rf.d.b), b = src.rect(rf.u.a, rf.u.b); if (src.visible(a) && src.visible(b)) SL.path(ovg, a, b, 'ar', 1) }
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
let cur = null, pausedEv = null, pickOn = false
// 断点：函数名（Lisp 函数的名字，或调用处写的名字，JS 函数如 circle / log 也行）；状态在 DBG.names 里

const headName = x => !isT(x) ? null : x[0] == '$' || x[0] == '$$' ? x[1] : x[0] == '.' && isT(x[2]) && x[2][0] == '' ? x[2][1] : null

function newRun(ss) {
  const run = { alive: true, p: null, ss, ticks: new Map, evs: new Map, n: 0, ready: false }
  const reg = (m, f, what) => { if (f?.t != 'fn') throw new TypeError(tr`${what} 需要函数`); const id = ++run.n; m.set(id, { f, busy: false }); return id }
  // 处理器在返回 Promise（里面 await 过）时占用自己：没跑完前跳过后续帧/事件，等价于一个协程
  const fire = (m, id, args) => {
    const h = m.get(id); if (!h || h.busy || !run.alive) return
    const r = L.callback(h.f, args.map(L.fromJS), run.host, { m, id })
    if (r instanceof Promise) { h.busy = true; r.finally(() => { h.busy = false }) }
  }
  run.fire = fire
  const def = (name, f) => Object.assign(f, { bname: name })
  const defs = {
    tick: def('tick', f => reg(run.ticks, f, 'tick')),
    do: def('do', f => reg(run.ticks, f, 'do')),
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
    hooks: { ext: pickOn ? pickCall : null },   // 取源：只有开着才装钩子（关时 call() 只多一次 null 判断）
    last: true,   // 函数体取最后一句的值，不要求 OK
    log: { push: item => con(item) },
    alive: () => run.alive,
    error: (r, tag) => { con({ err: r.err, n: r.a != null ? { a: r.a, b: r.b } : null }); if (tag) tag.m.delete(tag.id) },   // 出错的处理器摘掉，免得每帧刷屏
    pause: e => DBG.at(e),
  })
  return run
}

/* ---------- 断点：双击函数名切换；暂停时在控制台显示 [f 实参] ⇒ 返回值，F8 / ⏯ 继续 ---------- */
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
// 暂停在返回处：把返回值放进一个输入框，回车按 JSON 原地改（对象换键、数组换元素）
function editRuntime(row, v) {
  if (!row || !v || typeof v != 'object') return
  const inp = document.createElement('input')
  inp.value = JSON.stringify(v)
  inp.title = '改返回值：回车应用（对象/数组原地改，下一步读取时生效）'
  inp.style.cssText = 'display:block;width:100%;margin:2px 0 3px;background:#2f3440;color:var(--fg);border:1px solid var(--bd);border-radius:3px;font:11px/1.5 inherit;padding:1px 4px'
  inp.onkeydown = ev => {
    if (ev.key != 'Enter') return
    ev.preventDefault()
    let t; try { t = JSON.parse(inp.value) } catch { inp.style.borderColor = 'var(--R)'; return }
    if (Array.isArray(v) && Array.isArray(t)) v.splice(0, v.length, ...t)
    else if (!Array.isArray(v) && t && typeof t == 'object' && !Array.isArray(t)) { for (const k of Object.keys(v)) delete v[k]; Object.assign(v, t) }
    else { inp.style.borderColor = 'var(--R)'; return }
    inp.style.borderColor = 'var(--G)'; status('已改返回值（下一步读取时生效）')
  }
  row.append(inp)
}
function showPause(e, why) {
  const a = e.a, b = e.b, sh = L.show, name = e.f?.name || headName(e.x?.[1]) || L.fname(e.f)
  const tag = why == 'frame' ? 'F8 帧' : why == 'line' ? 'F11 语句' : why == 'name' ? '断点' : '断点'
  const what = e.ph == 'ret' ? `[${name}${(e.args || []).map(a => ' ' + sh(a, 1)).join('')}] ⇒ ${sh(e.v, 1)}`
    : e.ph == 'if' ? `? ${sh(e.c, 1)} → ${e.t ? '真分支' : '假分支'}`
    : e.ph == 'in' ? '⇢ 进入' : `⇠ ${sh(e.v, 1)}`
  pausedEv = e
  con({ pause: `⏸ ${what}   · ${tag}`, n: a != null ? { a, b } : null })
  if (e.ph == 'ret') editRuntime(out.lastElementChild, e.v)   // 暂停在返回处：对象/数组可以原地改，下一步生效
  if (a != null) { HL.set('ev', { ev: [src.range(a, Math.max(b, a + 1))] }); src.scrollTo(a) }
  $('#resume').hidden = false; status('已暂停（F5 继续 · F8 下一帧 · F11 下一条语句）')
}
DBG.onPause = (e, why) => showPause(e, why)
function resume() {
  if (!cur) return
  const more = DBG._q.length > 1
  HL.set('ev', {}); if (!more) { $('#resume').hidden = true; status('运行中') }
  DBG.resume()
}
function go(fn) {
  const more = DBG._q.length > 1
  HL.set('ev', {}); if (!more) { $('#resume').hidden = true; status('运行中') }
  fn()
}
$('#resume').onclick = resume

/* ---------- 取源（pick）：点画布 → 这一笔是哪个调用 → 选中源码并连线 ----------
   主路径是 IDEA.md 的“亮点”：点下时重画一帧，在帧起点（p.draw 里、用户第一笔绘制之前）把点击像素涂成随机色；
   之后每个会写画布的 ctx 方法返回时读回那个像素——颜色变了就说明“刚才这个调用盖住了它”，记下栈顶的 Lisp 调用并重新撒点，
   于是最后一个盖住它的调用就是屏幕上看到的那一笔。声明了 (tweak …) 几何的调用另有一份 bbox 列表兜底（没写声明也能命中）。 */
function pickCall({ f, x, a, b, args }) {
  if (!pickOn || DBG.calls.length > 2000) return
  const name = headName(x?.[1]) || f?.bname || f?.name
  const g = name && Tweak.geo(name, args)   // 只有声明了几何的调用才记录：逐帧数组保持很小
  if (g) DBG.calls.push({ name, a, b, g })
}
const pickPx = { x: 0, y: 0, on: false, mark: null, ctx: null, saved: null, by: null, planting: false }
const DIRTY = ['fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'putImageData', 'fillText', 'strokeText']
function pickAttach() {
  const g = cur && cur.p && cur.p.drawingContext
  if (!g || pickPx.ctx === g) return
  pickDetach()
  pickPx.ctx = g; pickPx.saved = {}
  for (const k of DIRTY) {
    const o = g[k]; if (typeof o != 'function') continue
    pickPx.saved[k] = o
    g[k] = function (...a) { const r = o.apply(this, a); pickAfter(); return r }
  }
}
function pickDetach() {
  const g = pickPx.ctx; if (!g) return
  for (const k in pickPx.saved) g[k] = pickPx.saved[k]
  pickPx.ctx = null; pickPx.saved = null
}
// 亮点落在整数设备像素上：上下文被 pixelDensity 缩放过，先在设备坐标里算 X/Y，撒点时临时把变换置成单位阵
function pickDev() {
  const g = pickPx.ctx, d = cur && cur.p && cur.p.pixelDensity ? cur.p.pixelDensity() : 1
  return { d, X: Math.max(0, Math.min(g.canvas.width - 1, Math.floor(pickPx.x * d))), Y: Math.max(0, Math.min(g.canvas.height - 1, Math.floor(pickPx.y * d))) }
}
function pickPlant() {
  const g = pickPx.ctx; if (!g || pickPx.planting) return
  const c = [1 + ((Math.random() * 254) | 0), 1 + ((Math.random() * 254) | 0), 1 + ((Math.random() * 254) | 0)]
  pickPx.mark = c
  const { X, Y } = pickDev()
  pickPx.planting = true   // 撒点自己的 fillRect 不能再触发 pickAfter（否则递归）
  try {
    g.save()
    if (g.setTransform) g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`
    g.fillRect(X, Y, 1, 1)   // 一个设备像素
  } finally { g.restore(); pickPx.planting = false }
}
function pickAfter() {
  const g = pickPx.ctx, m = pickPx.mark; if (!g || !m || pickPx.planting) return
  const { X, Y } = pickDev()
  let q; try { q = g.getImageData(X, Y, 1, 1).data } catch { return }     // 只在 pick 模式读像素
  if (q[0] === m[0] && q[1] === m[1] && q[2] === m[2] && q[3] === 255) return
  const cx = LISP.cx, fr = cx && cx.stack.length ? cx.stack[cx.stack.length - 1] : null
  if (fr) pickPx.by = { name: headName(fr.x?.[1]) || fr.f?.bname || fr.f?.name, a: fr.a, b: fr.b }
  pickPlant()   // 重新撒点：后面的调用再盖住它时还能认出来
}
function setPick(on) {
  pickOn = on
  $('#pick').classList.toggle('on', on)
  if (cur) cur.host.hooks.ext = on ? pickCall : null
  if (!on) pickDetach()
  const cv = document.querySelector('#pv canvas'); if (cv) cv.style.cursor = on ? 'crosshair' : ''
  if (!on) { Sloc.pick = null; Sloc.draw(); status('') }
  else status('取源：点画布上的图形，跳到画它的源码')
}
$('#pick').onclick = () => setPick(!pickOn)
$.ev($('#pv'), {
  click(e) {
    if (!pickOn || !cur?.p) return
    const c = document.querySelector('#pv canvas'); if (!c) return
    e.preventDefault(); e.stopPropagation()
    const r = c.getBoundingClientRect()
    const x = (e.clientX - r.left) * cur.p.width / r.width, y = (e.clientY - r.top) * cur.p.height / r.height
    pickPx.x = x; pickPx.y = y; pickPx.by = null; pickPx.on = true
    pickAttach()
    try { cur.p.redraw() } finally { pickPx.on = false; pickDetach() }   // 重画一帧：帧起点撒点，之后逐调用读回
    const hit = pickPx.by || (DBG.calls.length ? [...DBG.calls].reverse().find(k => Tweak.inside(k.g, x, y)) : null)
    if (!hit) { Sloc.pick = null; Sloc.draw(); status('取源：这个位置没有找到绘制调用'); return }
    const b = Math.max(hit.b, hit.a + 1)
    Sloc.pick = { from: { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 }, to: src.rect(hit.a, b), label: hit.name }
    src.setSel(hit.a, hit.b); src.scrollTo(hit.a); Sloc.draw()
    status(`取源：${hit.name}  ${cur.ss ? cur.ss.sloc(hit.a) : ''}`)
  },
}, true)

/* ---------- 控制台 #out ---------- */
const goto = (a, b) => { src.el.focus(); src.setSel(a, b); src.scrollTo(a); requestAnimationFrame(() => Sloc.draw()) }
function con(it) {
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
$('#clr').onclick = () => { OUT.clear(); Sloc.clear() }

/* ---------- 解析 / 运行 / 停止 ---------- */
let ss = null, twSig = ''
Xref.wire({ ed: src, ssOf: () => ss, sloc: Sloc, status })
function parse() {
  ss = feed(src.value); eat(g, ss)
  paint(src, ss.tree, g.colors); paintBp(); Tweak.scan(ss); Sloc.pick = null; Sloc.draw()
  const sig = Tweak.problems.map(p => p.a + ':' + p.msg).join('|')   // 声明写错时只提示一次（每次编辑后重解析）
  if (sig !== twSig) { twSig = sig; for (const p of Tweak.problems) con({ warn: `tweak ${p.msg}`, a: p.a, b: p.b }) }
  return ss
}
function stop() {
  const run = cur; if (!run) return
  cur = null; run.alive = false; L.host = null
  DBG.cancel(); DBG.mode = 'run'; DBG.lastKey = null; pausedEv = null; pickPx.on = false; pickDetach()
  HL.set('ev', {}); $('#resume').hidden = true
  try { run.p?.remove() } catch { }
  Sloc.clear(); Sloc.pick = null; status('已停止')
}
function play() {
  stop(); parse(); OUT.clear(); Sloc.clear()
  if (ss.errs.length) {
    for (const e of ss.errs) OUT.push({ cls: 'eitem', text: `✖ ${ss.sloc(e.a)}  ${e.msg}`, span: e })
    Sloc.draw(); status(`${ss.errs.length} 个语法错误，未运行`); return
  }
  DBG.reset(); pausedEv = null; $('#resume').hidden = true   // 旧运行挂起的暂停先兑现
  const run = cur = newRun(ss); L.host = run.host
  new p5(p => {
    run.p = p
    p.setup = () => {
      const fin = res => { if (res.err) con({ err: res.err, n: res.a != null ? { a: res.a, b: res.b } : null }); run.ready = true }
      const r = L.start(ss.value, run.host.log)
      r instanceof Promise ? r.then(fin) : fin(r)
    }
    // 帧起点：先于用户代码第一笔绘制。没有 tick 的草图只画一次（setup），不能每帧清掉取源记录
    p.draw = () => {
      if (run.ready && run.ticks.size) DBG.frame()
      if (pickPx.on) pickPlant()                                  // 亮点在用户第一笔绘制之前撒下去（不在 clearRect 上）
      if (run.ready) for (const id of [...run.ticks.keys()]) run.fire(run.ticks, id, [])
    }
  }, $('#pv'))
  status('运行中')
}
$('#play').onclick = play
$('#stop').onclick = stop

/* ---------- 会话 / 目录树（Ctrl+E 打开，Ctrl+S 保存） ---------- */
const SESS = Session.create({
  ed: src, status,
  onOpen: () => { parse(); if (cur) play(); else if ($('#auto').checked) play() },   // 打开文件后重解析；在跑就重跑
})
const EXP = Explorer.mount({ session: SESS, status })
$('#files').onclick = () => EXP.toggle()

/* ---------- 编辑器 ---------- */
let pt = 0, ap = 0
$.ev(src.el, {
  input() {
    clearTimeout(pt); pt = setTimeout(parse, 150)
    if ($('#auto').checked) { clearTimeout(ap); ap = setTimeout(play, 700) }
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
    if (k == 'F8') { go(() => DBG.nextFrame(pausedEv)); $.event.preventDefault() }        // 暂停后：到下一帧入口
    else if (k == 'F11') { go(() => DBG.stepLine(pausedEv)); $.event.preventDefault() }    // 暂停后：下一条语句
    else if (k == 'F5') { resume(); $.event.preventDefault() }
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
