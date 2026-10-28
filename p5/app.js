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
  hov: null,
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
let cur = null
const bps = new Set   // 断点：函数名（Lisp 函数的名字，或调用处写的名字，JS 函数如 circle / log 也行）

const headName = x => !isT(x) ? null : x[0] == '$' || x[0] == '$$' ? x[1] : x[0] == '.' && isT(x[2]) && x[2][0] == '' ? x[2][1] : null

function newRun(ss) {
  const run = { alive: true, p: null, ss, ticks: new Map, evs: new Map, n: 0, ready: false, paused: [] }
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
    html: def('html', s => { con({ html: String(s) }); return s }),   // 往 Console 输出一行 HTML（echo`…` 这类 tag 函数用）
    get p() { return run.p },
  }
  run.host = Object.assign(L.hostOf(defs, () => run.p, p5.prototype, PVARS, globalThis), {
    last: true,   // 函数体取最后一句的值，不要求 OK
    log: { push: item => con(item) },
    alive: () => run.alive,
    error: (r, tag) => { con({ err: r.err, n: r.a != null ? { a: r.a, b: r.b } : null }); if (tag) tag.m.delete(tag.id) },   // 出错的处理器摘掉，免得每帧刷屏
    pause: e => {
      if (e.ph != 'ret' || !bps.size) return
      const hn = headName(e.x?.[1])
      if (!(bps.has(hn) || bps.has(e.f?.name) || bps.has(e.f?.bname))) return
      return new Promise(res => { run.paused.push(res); showPause(e, hn) })
    },
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
  if (ss?.tree && bps.size) walk(ss.tree, n => { if (!n.kids.length && n.k == 'tok' && n.b > n.a) { const t = ss.src.slice(n.a, n.b); if (bps.has(t) && NAME.test(t)) rs.push(src.range(n.a, n.b)) } })
  HL.set('bp', { bp: rs })
}
$.ev(src.el, {
  dblclick() {
    const { clientX, clientY } = $.event
    if (ss?.src !== src.value) parse()
    const i = src.offsetAt(clientX, clientY), n = i < 0 ? null : nameTokAt(i); if (!n) return
    const t = ss.src.slice(n.a, n.b), on = !bps.delete(t); if (on) bps.add(t)
    src.setSel(n.b); paintBp(); status(`断点 ${t} ${on ? '已设置' : '已取消'}（共 ${bps.size} 个）`)
  },
})
function showPause(e, hn) {
  const a = e.a, b = e.b, sh = L.show, name = e.f?.name || hn || L.fname(e.f)
  con({ pause: `⏸ [${name}${e.args.map(a => ' ' + sh(a, 1)).join('')}] ⇒ ${sh(e.v, 1)}`, n: a != null ? { a, b } : null })
  if (a != null) { HL.set('ev', { ev: [src.range(a, Math.max(b, a + 1))] }); src.scrollTo(a) }
  $('#resume').hidden = false; status('已暂停（F8 继续）')
}
function resume() {
  const r = cur?.paused.shift(); if (!r) return
  HL.set('ev', {}); if (!cur.paused.length) { $('#resume').hidden = true; status('运行中') }
  r()
}
$('#resume').onclick = resume

/* ---------- 控制台 #out ---------- */
const goto = (a, b) => { src.el.focus(); src.setSel(a, b); src.scrollTo(a); requestAnimationFrame(() => Sloc.draw()) }
function con(it) {
  const at = it.n, sl = at && cur?.ss ? '  ' + cur.ss.sloc(at.a) : ''
  OUT.push(
    it.err != null ? { cls: 'eitem', text: `✖ ${it.err}${sl}`, span: at }
      : it.warn != null ? { cls: 'warn', text: `⚠ ${it.warn}` }
      : it.pause != null ? { cls: 'pause', text: it.pause, span: at }
      : it.html != null ? { cls: 'log', html: it.html }
      : { cls: it.cls || 'log', text: it.out })
}
const fmt = v => v instanceof Error ? v.message : L.show(L.fromJS(v))
for (const k of ['log', 'info', 'warn', 'error']) {   // console.* 同时进 #out
  const o = console[k].bind(console)
  console[k] = (...a) => { o(...a); con({ out: a.map(fmt).join(' '), cls: k == 'error' ? 'error' : k }) }
}
$.ev(window, {
  error() { con({ out: $.event.message, cls: 'error' }) },
  unhandledrejection() { con({ out: `Promise: ${fmt($.event.reason)}`, cls: 'error' }) },
})
$('#clr').onclick = () => { OUT.clear(); Sloc.clear() }

/* ---------- 解析 / 运行 / 停止 ---------- */
let ss = null
function parse() {
  ss = feed(src.value); eat(g, ss)
  paint(src, ss.tree, g.colors); paintBp(); Tweak.scan(ss); Sloc.draw()
  return ss
}
function stop() {
  const run = cur; if (!run) return
  cur = null; run.alive = false; L.host = null
  run.paused.splice(0).forEach(r => r()); HL.set('ev', {}); $('#resume').hidden = true
  try { run.p?.remove() } catch { }
  Sloc.clear(); status('已停止')
}
function play() {
  stop(); parse(); OUT.clear(); Sloc.clear()
  if (ss.errs.length) {
    for (const e of ss.errs) OUT.push({ cls: 'eitem', text: `✖ ${ss.sloc(e.a)}  ${e.msg}`, span: e })
    Sloc.draw(); status(`${ss.errs.length} 个语法错误，未运行`); return
  }
  const run = cur = newRun(ss); L.host = run.host
  new p5(p => {
    run.p = p
    p.setup = () => {
      const fin = res => { if (res.err) con({ err: res.err, n: res.a != null ? { a: res.a, b: res.b } : null }); run.ready = true }
      const r = L.start(ss.value, run.host.log)
      r instanceof Promise ? r.then(fin) : fin(r)
    }
    p.draw = () => { if (run.ready) for (const id of [...run.ticks.keys()]) run.fire(run.ticks, id, []) }
  }, $('#pv'))
  status('运行中')
}
$('#play').onclick = play
$('#stop').onclick = stop

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
$.ev(window, { keydown() { if ($.event.key == 'F8') { resume(); $.event.preventDefault() } }, resize() { Sloc.draw() } })
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
