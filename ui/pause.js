/* pause.js — 暂停视图:断点命中后怎么显示、怎么在这一帧里即时求值(两页共用,和宿主无关)。
   两种呈现,同一套行为(开关 Pause.mode,保存在 localStorage 'parviz.pause'):
     repl   暂停行进 Console,输入框挂在那一行下面(历史留在控制台里)
     popup  源码光标处弹出气泡(无 Console 要求),输入框和输出都在气泡里,继续时消失
   输入框(两种呈现一样):
     (+ x 1)        在这一帧的环境里求值并打印,继续停着(名字查帧环境)。A B C… = 这次调用的第 1 2 3… 个实参;$A $B… = 同一函数上一次暂停时的同位置实参(第一次是 NO);@args / @ret
     (OK 值)        用这个值替换这次调用的返回值并继续(暂停点兑现 { v },见 lisp.js call)
     ? 条件         这个函数转成日志断点:以后条件成立时只打印一行,不再暂停(单独 ? = 每次都打印)
     = 表达式       观察:每次暂停重算,值变了标 ≠;单独一个 = 清空
   API:Pause.create({ ed, dbg, push, last, name, show, resume, status?, sloc?, mode?, onEscape?, onChange? }) →
     { show(e, why), hide(), take(), reset(), evalAt(e, ast, prev), ev, active, mode(get/set), bindToggle(button) }
     ed      Editor(rect / range / scrollTo / el / setSel);dbg = ui/debug.js 的 DBG
     push    往 Console 追加一条 { cls, text, span? };last() = Console 最后一行的元素(REPL 的输入框挂在它下面)
     name(e) 这次事件的函数名;show(v) 值的文本;resume() 兑现暂停(之前已经 take() 过要替换的返回值)
     take()  取走并清除"要替换的返回值",给 DBG.resume / DBG.stepLine / LISP.step 当 send。 */
(function (G) {
'use strict'
const KEY = 'parviz.pause', LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids) if (k != null) e.append(k); return e }
const clip = (s, n) => s.length > n ? s.slice(0, n) + '…' : s
const TAGS = { frame: '下一帧', line: '语句', step: '单步', name: '函数断点', bp: '标记断点', brk: '判断/返回' }

function create(o) {
  const L = G.LISP, { feed, eat, grammar } = G.P
  const { ed, dbg, push, last, name, show: sh, resume, status = () => { }, sloc = () => '' } = o
  const gc = grammar(L.RULES); gc.builtins = { has: () => true }   // 即时求值:名字运行期查帧环境,解析期不报“未定义”
  const parseExpr = text => { const q = feed(text); eat(gc, q); return q.errs.length ? { err: q.errs[0].msg } : { ast: q.value } }
  const evalAt = (e, ast, prev) => {   // prev:这次之前同一函数的实参数组(日志断点自己带;手动输入 / 观察用 P_.prev)
    const x = { '@args': e.args, '@ret': e.v }
    ;(e.args || []).slice(0, 26).forEach((v, i) => { x[LETTERS[i]] = v; x['$' + LETTERS[i]] = prev?.[i] ?? L.NO })
    return L.evalIn(ast, e.env, x)
  }
  const P_ = { ev: null, why: null, prev: undefined }, lastArgs = new Map   // lastArgs:函数名 → 上一次暂停时的实参(给 $A)
  let mode = localStorage.getItem(KEY) || o.mode || 'repl', send = null, inp = null, userLeft = false
  let bub = null, car = null, log = null   // popup 的气泡、光标线、输出区
  const watches = []

  // 一行输出:repl → Console;popup → 气泡里的日志区
  const line = (text, cls = 'info') => {
    if (mode == 'popup' && log) { log.append(h('div', cls, text)); place(); log.scrollTop = log.scrollHeight }
    else push({ cls, text })
  }
  const err = text => line('✖ ' + text, 'eitem')

  function place() {
    const e = P_.ev; if (!bub || !e) return
    const pos = e.a ?? e.b ?? 0, r = ed.rect(pos, pos)
    Object.assign(car.style, { left: r.left + 'px', top: r.top + 'px', height: (r.height || 16) + 'px' })
    const mh = bub.offsetHeight, mw = bub.offsetWidth
    bub.style.left = Math.max(4, Math.min(r.left, innerWidth - mw - 8)) + 'px'
    bub.style.top = (r.bottom + 4 + mh > innerHeight ? Math.max(4, r.top - mh - 4) : r.bottom + 4) + 'px'
  }

  const watchLines = (e, initial) => {
    if (e.ph != 'ret' || !e.env) return
    for (const w of watches) {
      const r = evalAt(e, w.ast, P_.prev), s = r.err !== undefined ? '✗ ' + r.err : L.show(r.value, 1)
      line(`👁 ${w.text} ⇒ ${s}${!initial && w.last !== undefined && w.last !== s ? '   ≠ 上次 ' + w.last : ''}`); w.last = s
    }
  }

  function mountInput(host, e) {
    const i = h('input', 'pin'); i.placeholder = '求值 · A B 实参 · $A 上次 · (OK v) · ?条件 · =观察'
    i.onclick = i.onmousedown = ev => ev.stopPropagation()   // 输入框在可点击的控制台行里:别触发“跳转源码并聚焦编辑器”
    i.onblur = () => { if (inp === i && !userLeft && i.isConnected && P_.ev) setTimeout(() => { if (!userLeft && i.isConnected) i.focus({ preventScroll: true }) }, 0) }   // 选区 / 取源 / 点别处都会失焦:没主动离开就抢回
    i.onkeydown = ev => {
      if (ev.key == 'Escape') { ev.preventDefault(); userLeft = true; o.onEscape?.(); ed.el.focus(); return }
      if (!/^F\d+$/.test(ev.key)) ev.stopPropagation()   // 功能键(F8–F11)要漏给全局快捷键,其余按键留给输入框
      if (ev.key != 'Enter') return
      ev.preventDefault(); submit(i, e)
    }
    inp = i; userLeft = false; host.append(i); requestAnimationFrame(() => i.focus({ preventScroll: true }))
  }
  const bad = (i, msg) => { i.classList.add('bad'); status(msg) }
  function submit(i, e) {
    const t = i.value.trim(); if (!t) return
    if (t[0] == '=') {
      const text = t.slice(1).trim()
      if (!text) { watches.length = 0; line('👁 已清空观察表达式'); i.value = ''; return }
      const p = parseExpr(text); if (p.err) return bad(i, p.err)
      i.classList.remove('bad'); watches.push({ text, ast: p.ast }); i.value = ''
      const w = watches.at(-1), r = evalAt(e, w.ast, P_.prev); w.last = r.err !== undefined ? '✗ ' + r.err : L.show(r.value, 1)
      line(`👁 ${text} ⇒ ${w.last}`); i.focus(); return
    }
    const logp = t[0] == '?', p = parseExpr(logp ? (t.slice(1).trim() ? `(> ${t.slice(1).trim()})` : 'true') : t)
    if (p.err) return bad(i, p.err)
    i.classList.remove('bad')
    if (logp) {
      const nm = name(e), text = t.slice(1).trim() || 'true'
      dbg.name(nm, true); dbg.conds.set(nm, { text, ast: p.ast }); o.onChange?.()
      line(`⏺ 日志断点 ${nm} ? ${text}`); resume(); return
    }
    const r = evalAt(e, p.ast, P_.prev)
    if (r.err !== undefined) return err(r.err)
    if (r.ret) { send = { v: r.value }; line(`↩ 返回值替换为 ${L.show(r.value, 1)}`); resume(); return }
    line(`⇒ ${L.show(r.value, 1)}`); i.value = ''; i.focus()
  }

  const describe = (e, why) => {
    const tag = TAGS[why] || '断点', n = e.ph == 'ret' ? name(e) : e.f?.name || L.fname(e.f)
    const what = e.ph == 'ret' ? `[${n}${(e.args || []).map((a, i) => ` ${LETTERS[i] ?? ''}=${sh(a, 1)}`).join('')}] ⇒ ${sh(e.v, 1)}`
      : e.ph == 'if' ? `? ${sh(e.c, 1)} → ${e.t ? '真分支' : '假分支'}`
      : e.ph == 'in' ? '⇢ 进入' : `⇠ ${sh(e.v, 1)}`
    return { tag, what }
  }

  function dropBubble() { bub?.remove(); car?.remove(); bub = car = log = null }
  function hide() {
    P_.ev = null; inp = null; dropBubble(); G.HL?.set('ev', {})
  }
  function showEv(e, why, again) {
    dropBubble(); P_.ev = e; P_.why = why
    if (again) { /* 只是换呈现:prev 保持 */ } else if (e.ph == 'ret') { const nm = name(e); P_.prev = lastArgs.get(nm); lastArgs.set(nm, e.args) } else P_.prev = undefined
    const { tag, what } = describe(e, why), a = e.a, b = e.b
    if (a != null) { G.HL?.set('ev', { ev: [ed.range(a, Math.max(b, a + 1))] }); ed.scrollTo(a) }
    const can = e.ph == 'ret' && e.env
    if (mode == 'popup') {
      bub = h('div', 'pbub'); car = h('div', 'pcar'); log = h('div', 'plog')
      bub.append(h('div', 'hd', h('b', null, `${tag} ${what}`)))
      bub.append(h('div', 'fr', h('span', null, a != null ? clip(ed.value.slice(a, b).replace(/\s+/g, ' '), 40) : ''), h('span', 'sl', sloc(a ?? 0))))
      bub.append(log); document.body.append(car, bub)
      watchLines(e)
      if (can) mountInput(bub, e); else inp = null
      place()
    } else {
      push({ cls: 'pause', text: `⏸ ${what}   · ${tag}`, span: a != null ? { a, b } : null })
      if (can) mountInput(last(), e); else inp = null
      watchLines(e)
    }
    status('已暂停(F9 继续 · F10 下一行 · F8 取消此断点并继续 · F11 下一帧)')
  }
  addEventListener('pointerdown', e => { userLeft = !!inp && !inp.contains(e.target) && !bub?.contains(e.target) }, true)
  addEventListener('resize', place)

  return {
    show: showEv, hide, evalAt,
    reset() { lastArgs.clear(); watches.forEach(w => { w.last = undefined }); hide(); send = null },   // 新的一次运行:$A 从 NO 重新开始
    take() { const v = send; send = null; return v || undefined },
    get ev() { return P_.ev }, get active() { return !!P_.ev },
    // 暂停中改呈现:重新渲染当前这次暂停
    get mode() { return mode },
    set mode(m) { if (m != 'repl' && m != 'popup' || m == mode) return; mode = m; localStorage.setItem(KEY, m); if (P_.ev) { const e = P_.ev; inp?.remove(); dropBubble(); showEv(e, P_.why, true) } },
    // 重画当前暂停的气泡位置(源码滚动 / 重排之后)
    place,
    // 顶栏按钮:点击在 REPL / 弹框之间切换(两页共用同一个保存值)
    bindToggle(btn) {
      const sync = () => { btn.textContent = mode == 'repl' ? '⏸ REPL' : '⏸ 弹框'; btn.title = '暂停呈现:REPL = 暂停行和输入框在 Console 里;弹框 = 源码光标处的气泡(点击切换,两页共用)' }
      btn.onclick = () => { this.mode = mode == 'repl' ? 'popup' : 'repl'; sync() }; sync()
    },
  }
}
G.Pause = { create }
if (typeof module != 'undefined') module.exports = G.Pause
})(typeof globalThis != 'undefined' ? globalThis : window)
