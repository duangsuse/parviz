/* app.js — p5.html 的页面逻辑：用 Lisp 写 p5.js 草图（不依赖 ui.js 的调试器视图）。
   模型：toplevel 语句 = setup（在 p5 的 setup 里跑一遍，可以 await）；tick.{ … } 注册每个重画帧的函数（draw），see.{ … } 注册固定 20 Hz 的物理帧函数；
   on "mousePressed" [=> ...] 注册事件；全都可以在任何地方动态注册，返回的句柄交给 off 取消。
   名字回退（宿主）：Lisp 内建 > 作用域 > 本页的 tick/see/on/off/scope/remap/p > p5 实例 > p5 原型 > window。
   Lisp 的 map/get/push/set 等集合函数优先，被盖住的 p5 同名函数走 p.map / p.push / p.get …。 */
'use strict'
const { feed, eat, grammar, walk, isT } = P, L = LISP, tr = P.f
p5.disableFriendlyErrors = true   // FES 会给每个 p5 函数套一层检查，每帧上百次调用时很慢

const src = new Editor($('#src'), 'src'), out = $('#out')
Tweak.init(src, () => cur?.p ? [cur.p.width, cur.p.height] : null, { probe, note: t => con({ warn: t }), press: name => runBtn(name) })   // 颜色 / 位置 / 数字 / 下拉 / 开关 / 按钮小工具（tweak.js）
const status = t => $('#status').textContent = t
const g = grammar(L.RULES)
{ const d = feed(Tweak.DEFAULT_SRC); eat(g, d); Tweak.defaults(d) }   // 悬停预览的内置格式：与用户写的 (tweak …) 是同一种声明

/* ---------- 控制台 / sloc：与调试器共用 console.js + sloc.js ---------- */
const ovg = $('#ov svg g'), mks = $('#mks')
const OUT = Console.mount(out, {
  open: s => goto(s.a, s.b),
  hover: (s, el) => { Sloc.hov = { el, a: s.a, b: s.b }; Sloc.draw() },
  leave: () => { Sloc.hov = null; Sloc.draw() },
  enter: el => enterRow(el),   // 只在悬停时检测；有结果才替换。控制台来的标记等下一帧重画或“清空”时消失
})
const Sloc = {
  hov: null, pick: null, ref: null, rev: null, vis: null,   // vis：控制台行 / 帧缓冲面板里检测到的 { dots: [{x,y,w,h}], hl: [Range] }（文字高亮），轨迹：悬停过的位置依次追加,Esc / 清空 / 重跑才消失
  reset() { this.vis = null; this.clear() },
  clear() { mks.textContent = ''; ovg.textContent = '' },
  draw(srcSs = ss) {
    this.clear()
    if (this.vis?.hl?.length) CSS.highlights.set('det', new Highlight(...this.vis.hl)); else CSS.highlights.delete('det')   // 被检测到的文字片段
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
    const v = this.vis, cv = document.querySelector('#pv canvas.fbv') || pvCanvas()   // 控制台行 / 帧缓冲面板里的坐标：画在画布上（读帧时画在副本上）
    if (v && cv && cur?.p) {
      const q = cv.getBoundingClientRect(), k = q.width / cur.p.width, NS = 'http://www.w3.org/2000/svg'
      const el = (tag, at) => { const e = document.createElementNS(NS, tag); for (const n in at) e.setAttribute(n, at[n]); ovg.append(e) }
      const n = v.dots.length, c = d => [q.left + (d.x + d.w / 2) * k, q.top + (d.y + d.h / 2) * k]
      if (n > 1) el('polyline', { points: v.dots.map(d => c(d).join(',')).join(' '), fill: 'none', stroke: 'var(--Y)', 'stroke-width': 1, 'stroke-opacity': .5 })   // 轨迹：按悬停先后连线
      v.dots.forEach((d, i) => {
        const [cx, cy] = c(d), age = n - 1 - i, o = Math.max(.25, 1 - age * .12)   // 越旧越淡；最后悬停的一行最亮
        if (d.w > 8 || d.h > 8) el('rect', { x: q.left + d.x * k, y: q.top + d.y * k, width: d.w * k, height: d.h * k, fill: 'none', stroke: 'var(--Y)', 'stroke-width': 1.2, 'stroke-dasharray': '3 2', opacity: o })
        el('circle', { cx, cy, r: age == 0 ? 5 : 3.5, fill: 'var(--Y)', stroke: '#000', 'stroke-width': 1, opacity: o })
      })
    }
    const rv = this.rev   // 点声明：每处引用一个箭头扎回去
    if (rv?.decl) { const dr = src.rect(rv.decl.a, rv.decl.b); for (const u of rv.uses) { const ur = src.rect(u.a, Math.max(u.b, u.a + 1)); if (src.visible(ur)) SL.path(ovg, ur, dr, 'ar', 1) } }
  },
}

/* ---------- 宿主名字：解析期（高亮/“未定义”判断）与运行期共用同一批名字 ---------- */
const EVENTS = new Set('mousePressed mouseReleased mouseClicked doubleClicked mouseMoved mouseDragged mouseWheel keyPressed keyReleased keyTyped windowResized touchStarted touchMoved touchEnded'.split(' '))
// p5 的变量不全在原型上（width / mouseX 等在实例上），解析期补一份名单；运行期取值总是查实例（每次引用读到最新值）
const PVARS = Object.fromEntries('width height mouseX mouseY pmouseX pmouseY winMouseX winMouseY movedX movedY mouseButton mouseIsPressed key keyCode keyIsPressed frameCount deltaTime windowWidth windowHeight displayWidth displayHeight focused pixels touches drawingContext'.split(' ').map(n => [n, 0]))
const DEFS = ['tick', 'see', 'on', 'off', 'scope', 'remap', 'html', 'p', 'frameBuffer', 'frameRate']
const staticHost = L.hostOf(Object.fromEntries(DEFS.map(n => [n, 0])), p5.prototype, PVARS, globalThis)
const base = g.builtins; g.builtins = { has: n => base.has(n) || staticHost.has(n) }

/* ---------- 一次运行 = 一个 p5 实例 + 一份宿主；停止/重跑后旧运行里挂起的执行都会作废 ---------- */
let cur = null, lastPool = null
// 断点：函数名（Lisp 函数的名字，或调用处写的名字，JS 函数如 circle / log 也行）；状态在 DBG.names 里

const headName = Pick.headName

function newRun(ss) {
  const run = { alive: true, p: null, ss, ticks: new Map, evs: new Map, n: 0, ready: false, pool: null, errs: 0, setupCalls: [], lastCalls: null, pk: null, draws: 0, seeN: 0, fps: 60, physHz: 20, paused: false, t0: performance.now() }
  const reg = (m, f, what, hz, phys) => { if (f?.t != 'fn') throw new TypeError(tr`${what} 需要函数`); const id = ++run.n; m.set(id, { f, busy: false, period: hz > 0 ? 1000 / hz : 0, next: 0, phys }); return id }
  // 处理器在返回 Promise（里面 await 过）时占用自己：没跑完前跳过后续帧/事件，等价于一个协程
  const fire = (m, id, args) => {
    const h = m.get(id); if (!h || h.busy || !run.alive) return false
    const per = h.phys ? 1000 / run.physHz : h.period   // see：物理帧，固定 physHz（frameRate 的第二个实参，默认 20）；(tick 30 f)：Hz 上限
    if (per) {   // 落后太多就重新对齐，不补发
      const t = performance.now(); if (t < h.next) return false
      h.next = !h.next || t - h.next > per * 2 ? t + per : h.next + per
    }
    const r = L.callback(h.f, args.map(L.fromJS), run.host, { m, id })
    if (r instanceof Promise) { h.busy = true; r.finally(() => { h.busy = false }) }
    if (h.phys) run.seeN++
    return true
  }
  run.fire = fire
  const def = (name, f) => Object.assign(f, { bname: name })
  const defs = {
    tick: def('tick', (a, b) => typeof a == 'number' ? reg(run.ticks, b, 'tick', a) : reg(run.ticks, a, 'tick')),   // tick.{ … } 每个重画帧跑一次；(tick 30 f)：最多每秒 30 次
    see: def('see', f => reg(run.ticks, f, 'see', 0, true)),   // see.{ … } 物理帧：固定 20 Hz（[frameRate 60 20] 的第二个数），与重画帧率无关
    frameRate: def('frameRate', (f, hz) => {   // [frameRate 60 20]：最多 60 fps 重画，see 的物理帧 20 Hz
      if (hz !== undefined) { if (!(hz > 0)) throw new TypeError(tr`frameRate 的物理帧率需要正数`); run.physHz = hz }
      if (f === undefined) return run.p.frameRate()
      if (!(f > 0)) throw new TypeError(tr`frameRate 需要正数`)
      run.fps = f; run.p.frameRate(f); return f
    }),
    on: def('on', (ev, f) => {
      if (!EVENTS.has(ev)) throw new TypeError(tr`未知事件 ${ev}`)
      let m = run.evs.get(ev)
      if (!m) { m = new Map; run.evs.set(ev, m); const mm = m; run.p[ev] = (...a) => { for (const id of [...mm.keys()]) fire(mm, id, a) } }
      return reg(m, f, 'on')
    }),
    off: def('off', id => { let hit = run.ticks.delete(id); for (const m of run.evs.values()) hit = m.delete(id) || hit; return hit }),
    scope: Object.assign(L.gen(function* (f) { run.p.push(); try { return yield* L.call(f, []) } finally { try { run.p.pop() } catch { } } }), { bname: 'scope' }),
    remap: def('remap', (...a) => run.p.map(...a)),
    frameBuffer: def('frameBuffer', n => {   // [frameBuffer N]：保留最近 N 帧（画布 + 内存快照）；0 关闭。上限 600
      if (typeof n != 'number' || !(n >= 0)) throw new TypeError(tr`frameBuffer 需要帧数`)
      run.fb = n >= 1 ? Fbuf.create(Math.min(Math.floor(n), 600)) : null; return n
    }),
    html: def('html', s => { const fr = L.cx?.stack.at(-1); con({ html: String(s), ...(fr?.a != null ? { a: fr.a, b: fr.b } : {}) }); return s }),   // 往 Console 输出一行 HTML（echo`…` 这类 tag 函数用）
    get p() { return run.p },
  }
  run.host = Object.assign(L.hostOf(defs, () => run.p, p5.prototype, PVARS, globalThis), {
    run,          // cx.run：控制台行/后续 Tweak 部件按运行归属
    hooks: { ext: null },   // 取源的钩子：setup 期间 / 被请求的那一帧才装（见 pick.js），平时 call() 只多一次 null 判断
    watch: DBG.watch,       // 没有范围断点、也不在单步时，lisp.js 不产出 in/out/if 节点事件
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
/* ---------- 暂停:呈现与即时求值在 ui/pause.js(REPL / 弹框两种呈现,同一套输入框;开关在顶栏 #pmode) ---------- */
const callName = e => DBG.nameOf(e) || headName(e.x?.[1]) || e.f?.name || L.fname(e.f)
const PAUSE = Pause.create({
  ed: src, dbg: DBG, status, resume: () => resume(), mode: 'repl',
  push: item => OUT.push(item), last: () => OUT.last(),
  name: callName, show: L.show, sloc: a => cur?.ss ? cur.ss.sloc(a) : '',
  onEscape: () => { Sloc.vis = null; Sloc.draw() }, onChange: () => paintBp(),
})
const evalAt = PAUSE.evalAt
PAUSE.bindToggle($('#pmode'))
DBG.onCond = (e, c, name) => {
  if (c.bad) return
  const r = evalAt(e, c.ast, c.prev); c.prev = e.args
  if (r.err !== undefined) { c.bad = true; con({ warn: `日志断点 ${name} ? ${c.text}：${r.err}（已停用）`, a: e.a, b: e.b }); return }
  if (L.truthy(r.value)) con({ out: `⏺ [${name}${(e.args || []).map(a => ' ' + L.show(a, 1)).join('')}] ⇒ ${L.show(e.v, 1)}`, a: e.a, b: e.b })
}
DBG.onPause = (e, why) => { PAUSE.show(e, why); $('#resume').hidden = false }
function resume() {
  if (!cur) return
  const more = DBG._q.length > 1
  PAUSE.hide(); if (!more) { $('#resume').hidden = true; status('运行中') }
  DBG.resume(PAUSE.take())
}
function go(fn) {
  const more = DBG._q.length > 1
  PAUSE.hide(); if (!more) { $('#resume').hidden = true; status('运行中') }
  fn()
}
$('#resume').onclick = resume

/* ---------- 取源（pick）：悬停画布 → 箭头指向画这一笔的调用；右键 → 选中源码并打开那一行的第一个部件 ----------
   请求挂在 run.pk 上，由下一帧的 p.draw 兑现（pick.js 的 begin/end 夹住用户的 tick）：不额外重画，动画的状态不会多走一步；
   没在循环的草图（noLoop）才主动 redraw 一次。结果 = 像素读回的归属，读不到就用 (tweak …) 几何 / setup 期记下的 bbox 兜底。 */
let armed = false   // F8 按下后等一次右键取源：点中的调用名设为断点
const pvCanvas = () => document.querySelector('#pv canvas:not(.fbv)')
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
  mousemove() { if (!$.event.target.closest('canvas:not(.fbv)') || !$('#auto').checked) return; pickAt($.event, false) },   // 悬停取源只在自动刷新开着时生效
  contextmenu() { if (!$.event.target.closest('canvas:not(.fbv)')) return; $.event.preventDefault(); pickAt($.event, true) },
  mouseleave() { if (cur) cur.pk = null; if (Sloc.pick && !Sloc.pick.sticky) { Sloc.pick = null; Sloc.draw() } },
})

/* ---------- 速率：fps = p.draw 的实际次数，Hz = see 的物理帧每秒次数 ---------- */
{
  const el = $('#rate'); let last = null
  setInterval(() => {
    const r = cur, t = performance.now()
    if (!r) { el.textContent = '— fps · — Hz'; last = null; return }
    if (last?.r === r) {
      const s = (t - last.t) / 1000
      el.textContent = `${((r.draws - last.d) / s).toFixed(0)} fps · ${[...r.ticks.values()].some(h => h.phys) ? ((r.seeN - last.k) / s).toFixed(0) : '—'} Hz`
    }
    last = { r, t, d: r.draws, k: r.seeN }
  }, 500)
}
// 点 fps：在 0 fps（停止重画）与 frameRate 的值（源码没写是 60）之间切换；只改这次运行，不改源码
$('#rate').onclick = () => {
  const r = cur; if (!r?.p) return
  r.paused = !r.paused
  if (r.paused) { r.p.noLoop(); status('0 fps：已停止重画（再点恢复）') }
  else { r.p.loop(); r.p.frameRate(r.fps); status(`${r.fps} fps`) }
}

/* ---------- 帧缓冲时间轴：#right 标签栏里的进度条 = 缓冲占用，点击读取那一帧（画布副本 + 当时的内存快照 + 这帧的 p5 调用） ----------
   大小由源码里的 [frameBuffer N] 决定（点“缓冲”按钮补上，再用数字部件滚轮调）。读帧时暂停录制，Esc / ● 实时 回到实时画面。 */
const fbEl = $('#fb'), fbBar = fbEl.querySelector('i'), fbMark = fbEl.querySelector('u'), fbInfo = $('#fbinfo')
function fbUpdate() {
  const r = cur, fb = r?.fb, n = fb?.frames.length || 0, N = fb?.size || 0
  $('#fbn').textContent = N ? `缓冲 ${n}/${N}` : '缓冲：未开启'
  $('#fbn').title = N ? `${r.p ? `约 ${(r.p.width * r.p.height * 4 * N / 1e6).toFixed(0)} MB（画布副本）· ` : ''}${r.view != null ? '点击：回到实时' : '点击：定位到源码里的 [frameBuffer N]'}` : '帧缓冲：保留最近 N 帧的画布与内存快照。点击：在源码里补 [frameBuffer N]'
  fbBar.style.width = N ? n / N * 100 + '%' : '0'
  fbMark.style.display = N && r.view != null ? 'block' : 'none'
  if (N && r.view != null) fbMark.style.left = `calc(${(r.view + .5) / N * 100}% - 1px)`
}
function fbShow(run, k) {
  const f = run.fb?.frames[k]; if (!f) return
  // 换帧不清悬停标记：轨迹跟着面板留着，直到 Esc / 清空 / 回到实时 / 悬停到另一行有检测结果
  run.view = k
  const pv = $('#pv'); pv.classList.add('view')
  const live = pv.querySelector('canvas:not(.fbv)'); let cv = pv.querySelector('canvas.fbv')
  if (!cv) { cv = h('canvas', 'fbv'); pv.append(cv) }
  cv.width = f.cv.width; cv.height = f.cv.height
  cv.style.width = live?.style.width || f.cv.width + 'px'; cv.style.height = live?.style.height || f.cv.height + 'px'
  cv.getContext('2d').drawImage(f.cv, 0, 0)
  fbInfo.textContent = ''; fbInfo.hidden = false; $('#fblive').hidden = false
  fbInfo.append(h('div', 'hd', `帧 #${f.no}（${k + 1}/${run.fb.frames.length}）· ${f.calls.length} 次 p5 调用 · 点调用跳到源码 · 悬停：颜色 / 位置`))
  const row = (cls, text) => { const e = h('div', cls, text); e.addEventListener('mouseenter', () => enterRow(e)); return e }   // 与控制台行同一套悬停检测
  const cs = h('div', 'calls')
  for (const c of f.calls) { const el = h('span', 'call', `[${c.name} ${c.args.map(v => typeof v == 'number' ? +v.toFixed(2) : v).join(' ')}]`.replace(' ]', ']')); el.onclick = () => goto(c.a, c.b); el.addEventListener('mouseenter', () => enterRow(el)); cs.append(el) }
  fbInfo.append(cs, ...Fbuf.fmt(f.state).split('\n').map(t => row('st', t)))
  fbUpdate()
}
function fbLeave(run = cur) {
  Sloc.vis = null
  if (run) run.view = null
  const pv = $('#pv'); pv.classList.remove('view'); pv.querySelector('canvas.fbv')?.remove()
  fbInfo.hidden = true; $('#fblive').hidden = true; fbUpdate()
}
const fbStep = d => { const r = cur; if (r?.view == null) return false; fbShow(r, Math.max(0, Math.min(r.fb.frames.length - 1, r.view + d))); return true }
const topCalls = () => ss.value.slice(1).filter(x => isT(x) && (x[0] == '()' || x[0] == '[]') && isT(x[1])), topName = x => x[1][0] == '$' || x[1][0] == '$$' ? x[1][1] : null
function fbDecl() {   // 补 [frameBuffer 120]（紧跟 createCanvas，没有就放最前），并定位到它（不弹部件）
  if (ss?.src !== src.value) parse()
  if (!ss.value || ss.errs.length) { status('先修好语法错误'); return }
  const find = () => ss.value && topCalls().find(x => topName(x) == 'frameBuffer')
  if (!find() && src.fix()) {
    const cc = [...topCalls()].reverse().find(x => topName(x) == 'createCanvas'), s = src.value
    if (cc) src.t.replaceData((i => i < 0 ? s.length : i)(s.indexOf('\n', cc.b)), 0, '\n[frameBuffer 120]'); else src.t.replaceData(0, 0, '[frameBuffer 120]\n')
    parse(); refresh(true)
  }
  const f = find()
  if (f) { src.scrollTo(f.a); requestAnimationFrame(() => Sloc.draw()) }
  status('帧缓冲：[frameBuffer N]——数字上滚轮调整；悬停进度条读取某一帧')
}
$('#fbn').onclick = () => { const r = cur; if (r?.fb && r.view != null) fbLeave(r); else fbDecl() }   // 已展开（在看某一帧）时 = [实时]
$('#fblive').onclick = () => fbLeave()
const fbSeek = e => {   // 鼠标在进度条上的位置 = 帧：悬停即读取
  const r = cur; if (!r?.fb) return
  const n = r.fb.frames.length; if (!n) return
  const b = fbEl.getBoundingClientRect(), k = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - b.left) / b.width * r.fb.size)))
  if (r.view !== k || fbInfo.hidden) fbShow(r, k)
}
fbEl.onmousemove = fbSeek
fbEl.onclick = e => { if (!cur?.fb) return fbDecl(); fbSeek(e) }
setInterval(fbUpdate, 250)
/* ---------- 控制台 #out ---------- */
const goto = (a, b) => { src.el.focus(); src.setSel(a, b); src.scrollTo(a); requestAnimationFrame(() => Sloc.draw()) }
// 颜色：直接把这一行的文字设成它（很暗的颜色配浅底，不然看不见）
function tint(el, [r, g, b, a]) {
  el.style.color = `rgba(${r},${g},${b},${a / 255})`
  el.style.background = 0.299 * r + 0.587 * g + 0.114 * b < 70 ? 'var(--fg)' : ''
}
// 悬停一行（控制台行 / 帧缓冲面板的调用与变量）：检测颜色 → 文字着色；检测位置 → 画布上画点；被检测到的文字片段高亮。声明与源码里的部件同一套（Tweak.detect）；没有可检测内容就保留上一次的标记
function enterRow(el) {
  const v = Tweak.detect(el.textContent); if (!v) return
  if (v.cols.length) tint(el, v.cols[0])
  const old = Sloc.vis?.dots || [], fresh = v.dots.filter(d => d), trail = fresh.length ? [...old.filter(o => !fresh.some(d => d.x == o.x && d.y == o.y && d.w == o.w && d.h == o.h)), ...fresh].slice(-200) : old   // 轨迹：每次悬停的位置追加到后面（同一位置移到最新），最多 200 个
  Sloc.vis = { dots: trail, hl: rangesIn(el, v.spans), keep: !!el.closest('#fbinfo') }; Sloc.draw()   // keep：帧缓冲面板里的标记跟着面板，不随实时帧消失
}
function rangesIn(el, spans) {   // 元素里的文本偏移 → Range（元素内可能有多个文本节点）
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let o = 0
  for (let t; t = w.nextNode();) { nodes.push([t, o]); o += t.length }
  const at = i => { for (const [t, s] of nodes) if (i <= s + t.length) return [t, i - s]; return null }
  return spans.flatMap(([a, b]) => { const x = at(a), y = at(b); if (!x || !y) return []; const r = new Range; r.setStart(...x); r.setEnd(...y); return [r] })
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
  paint(src, ss.tree, g.colors); paintBp(); Tweak.scan(ss, ss.pool?.cells); Pane.sync(); Sloc.pick = null; Sloc.draw()
  const sig = Tweak.problems.map(p => p.a + ':' + p.msg).join('|')   // 声明写错时只提示一次（每次编辑后重解析）
  if (sig !== twSig) { twSig = sig; for (const p of Tweak.problems) con({ warn: `tweak ${p.msg}`, a: p.a, b: p.b }) }
  return ss
}
function stop() {
  const run = cur; if (!run) return
  cur = null; run.alive = false; run.pk = null; L.host = null
  fbLeave(run)
  DBG.cancel(); DBG.mode = 'run'; DBG.lastKey = null; PAUSE.hide()
  $('#resume').hidden = true
  try { run.p?.remove() } catch { }
  Sloc.reset(); Sloc.pick = null; status('已停止')
}
function play() {
  stop(); parse(); OUT.clear(); Sloc.reset()
  if (ss.errs.length) {
    for (const e of ss.errs) OUT.push({ cls: 'eitem', text: `✖ ${ss.sloc(e.a)}  ${e.msg}`, span: e })
    Sloc.draw(); status(`${ss.errs.length} 个语法错误，未运行`); return
  }
  DBG.reset(); PAUSE.reset(); $('#resume').hidden = true   // 旧运行挂起的暂停先兑现
  const run = cur = newRun(ss); L.host = run.host; run.pool = ss.pool
  new p5(p => {
    run.p = p
    // 鼠标坐标只在画布内更新（p5 默认监听 window，鼠标在编辑器 / 控制台上也会改 mouseX / mouseY）；按下后拖到画布外仍然跟随
    for (const n of ['_onmousemove', '_onmousedown']) {
      const f = p[n]
      p[n] = function (e) {
        const c = p.canvas, r = c?.getBoundingClientRect()
        if (r && ((e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) || (n == '_onmousemove' && p.mouseIsPressed))) return f.call(this, e)
      }
    }
    p.setup = () => {
      const fin = res => { Pick.record(run.host.hooks, null); if (res.err) con({ err: res.err, n: res.a != null ? { a: res.a, b: res.b } : null }); run.ready = true }
      Pick.record(run.host.hooks, run.setupCalls)   // setup 期间一直记几何调用（没有 tick 的草图只画这一次）
      const it = L.steps(run.pool.code, run.pool.code, true, run.host.log); run.env = () => it.cx.env   // 顶层环境：btn_ 按钮按名字取函数
      const r = L.exec(it, run.host)
      r instanceof Promise ? r.then(fin) : fin(r)
    }
    // 帧起点：先于用户代码第一笔绘制。取源请求（run.pk）在这一帧兑现：begin 撒亮点，用户的 tick 跑完后 end 读回
    p.draw = () => {
      run.draws++
      if (Sloc.vis && !Sloc.vis.keep && !run.paused && run.view == null) { Sloc.vis = null; Sloc.draw() }   // 控制台悬停记在画布上：下一帧重画就消失；0 fps 暂停（含取源触发的单次重画）/ 正在看缓冲帧时一直留着
      if (run.ready && run.ticks.size) DBG.frame()
      const rec = run.fb && run.view == null && run.ready && run.ticks.size ? Fbuf.begin(run.fb, run.host.hooks) : null   // 帧缓冲：先于 Pick.begin 装钩子（Pick 会串起来）
      const pk = run.pk, picking = pk && run.ready && Pick.begin(p, pk.x, pk.y, run.host.hooks)
      let fired = false
      if (run.ready) for (const id of [...run.ticks.keys()]) fired = run.fire(run.ticks, id, []) || fired
      if (picking) { run.pk = null; finishPick(run, pk, Pick.end(run.host.hooks)) }
      if (rec) { if (fired) Fbuf.end(run.fb, rec, run.host.hooks, p, () => Fbuf.rootsOf(run), DBG.frameNo); else run.host.hooks.ext = null }
    }
  }, $('#pv'))
  status('运行中')
}
$('#play').onclick = play
// btn_ 按钮：执行这次运行的顶层函数（改了源码没重跑时仍是旧函数）。出错 / 暂停走和 tick 一样的通道
function runBtn(name) {
  const r = cur; if (!r?.ready) return status('先运行（Ctrl+Enter）')
  const f = r.env?.()?.find(name)?.m.get(name)
  if (f?.t != 'fn') return status(`${name} 不是函数（改过源码后需要重新运行）`)
  status(`▶ ${name}`); L.callback(f, [], r.host)
}

/* ---------- 会话 / 目录树（Ctrl+E 打开，Ctrl+S 保存） ---------- */
const tabEl = $('#tabname')
const SESS = Session.create({
  ed: src, status,
  onName: n => { tabEl.textContent = n || 'sketch.lisp' },
  onOpen: () => { parse(); if (cur) play(); else if ($('#auto').checked) play() },   // 打开文件后重解析；在跑就重跑
})
const EXP = Explorer.mount({ session: SESS, status })
$('#files').onclick = () => EXP.toggle()
// 双击文件名改名:Enter 确认(预设跟着搬到新名字下),Esc 取消
tabEl.ondblclick = () => {
  const b = tabEl, i = document.createElement('input'), old = b.textContent
  i.value = old; i.style.cssText = 'font:inherit;width:' + Math.max(12, old.length + 2) + 'ch;background:var(--bg);color:var(--fg);border:1px solid var(--bd)'
  b.replaceWith(i); i.focus(); i.select()
  let done = false
  const end = async ok => {
    if (done) return; done = true
    const key = 'parviz.presets:' + (SESS.name || location.hash || 'sketch')
    if (ok && i.value.trim() && await SESS.rename(i.value)) { const v = localStorage.getItem(key); if (v != null) { localStorage.setItem('parviz.presets:' + SESS.name, v); localStorage.removeItem(key) } }
    i.replaceWith(b); b.textContent = SESS.name || 'sketch.lisp'
  }
  i.onkeydown = e => { e.stopPropagation(); if (e.key == 'Enter') end(true); else if (e.key == 'Escape') end(false) }
  i.onblur = () => end(true)
}
Pane.init({ ed: src, status, goto: (a, b) => goto(a, b), press: name => runBtn(name), docKey: () => SESS.name || location.hash || 'sketch' })

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
        const e = PAUSE.ev, nm = e.ph == 'ret' ? DBG.nameOf(e) : null
        if (nm) DBG.name(nm, false); else if (DBG.hasRange(e.a, e.b)) DBG.range(e.a, e.b)
        paintBp(); resume(); status(nm ? `已取消断点 ${nm}，继续运行` : '继续运行')
      }
    }
    else if (k == 'F9') { resume(); $.event.preventDefault() }
    else if (k == 'F10') { const e = PAUSE.ev, v = PAUSE.take(); go(() => DBG.stepLine(e, v)); $.event.preventDefault() }
    else if (k == 'F11') { const e = PAUSE.ev, v = PAUSE.take(); go(() => DBG.nextFrame(e, v)); $.event.preventDefault() }
    else if (k == 'Escape' && cur?.view != null) fbLeave()
    else if ((k == 'ArrowLeft' || k == 'ArrowRight') && cur?.view != null && !$.event.target.isContentEditable) { fbStep(k == 'ArrowLeft' ? -1 : 1); $.event.preventDefault() }
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
  ex.selectedIndex = i; src.value = P5EX[i].src; SESS.detach(); history.replaceState(null, '', '#' + (i + 1)); play()
}
ex.onchange = () => load(ex.selectedIndex)
load(Math.min(Math.max((parseInt(location.hash.slice(1)) || 1) - 1, 0), P5EX.length - 1))
