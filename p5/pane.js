/* pane.js — Tweakpane 式面板（p5.html 编辑器上方，可折叠）：
   · 参数：源码里每个可调部件（位置 / 颜色 / 数字 / 角度 / 下拉 / 开关 / 按钮）一行控件，改它就是改源码（与悬停弹层是同一个 Tweak.set）；标签点一下跳到源码；
   · 预设：summary 里的下拉 =【当前预设】（改了值就回到它）/ 已存的预设 / ＋ 保存为新预设（自动命名）/ － 重命名或删除当前预设（留空 = 删除）；输入框粘贴 JSON 导入，右边是导出和各预设的直达链接（名字截 3 字）；
   · 声明：没写 (tweak …) 的 p5 函数靠内置声明推断出部件；这里列出用到的推断声明，可以一键写进源码顶部（以后就是用户声明）。
   依赖 Tweak（widgets / set / snapshot / apply / inferred）；源码结构不变时只刷新控件的值，不重建（输入框不丢焦点）。 */
'use strict'
const Pane = (() => {
  const root = $('#tp'), rows = $('#tprows'), sel = $('#tppre'), links = $('#tplinks'), head = $('#tphead'), hpre = $('#tphpre')
  let host = null, sig = '', list = [], dirty = true, cur = null   // cur：当前预设名（最近选择 / 保存的）
  const store = () => 'parviz.presets:' + host.docKey()
  const load = () => { try { return JSON.parse(localStorage[store()] || '{}') } catch { return {} } }
  const save = o => { localStorage[store()] = JSON.stringify(o) }
  const num = (v, on) => { const i = h('input'); i.type = 'number'; i.step = 'any'; i.value = v; i.oninput = () => on(i.value === '' ? '0' : i.value); return i }

  // 每种部件一个控件：build 返回 { el, upd(w) }；事件里一律读 row.w（重新解析后指向新的部件对象）
  function control(row) {
    const w = row.w, K = w.kind, val = () => Tweak.valOf(row.w)
    if (K == 'pos') {
      const a = num('', () => send()), b = num('', () => send()), send = () => Tweak.set(row.w, [a.value || '0', b.value || '0'])
      return { el: [a, b], upd: () => { const [x, y] = val(); if (document.activeElement !== a) a.value = x; if (document.activeElement !== b) b.value = y } }
    }
    if (K == 'rgb' || K == 'hex') {
      const c = h('input'); c.type = 'color'
      c.oninput = () => Tweak.setColor(row.w, [1, 3, 5].map(i => parseInt(c.value.slice(i, i + 2), 16)))
      return { el: [c], upd: () => { c.value = Tweak.colorOf(row.w) } }
    }
    if (K == 'angle') {
      const r = h('input'), l = h('span'); r.type = 'range'; r.min = 0; r.max = 360
      r.oninput = () => { l.textContent = r.value + '°'; Tweak.set(row.w, [(r.value * Math.PI / 180).toFixed(3)]) }
      return { el: [r, l], upd: () => { if (document.activeElement !== r) r.value = (Math.round(+val()[0] * 180 / Math.PI) + 360) % 360; l.textContent = r.value + '°' } }
    }
    if (K == 'enum') {
      const s = h('select'); s.onchange = () => Tweak.set(row.w, [s.value])
      return { el: [s], upd: () => { const t = val()[0], os = row.w.opts.includes(t) ? row.w.opts : [t, ...row.w.opts]; if (s.options.length != os.length || [...s.options].some((o, i) => o.value != os[i])) { s.textContent = ''; for (const o of os) s.append(new Option(o, o)) } s.value = t } }
    }
    if (K == 'sw') {
      const c = h('input'); c.type = 'checkbox'; c.onchange = () => Tweak.set(row.w, [c.checked ? 'on' : 'off'])
      return { el: [c], upd: () => { c.checked = row.w.on } }
    }
    if (K == 'btn') {
      const b = h('button'); b.textContent = '▶ 执行'; b.onclick = () => host.press(row.w.name)
      return { el: [b], upd: () => { } }
    }
    const n = num('', v => Tweak.set(row.w, [v]))   // num
    return { el: [n], upd: () => { if (document.activeElement !== n) n.value = val()[0] } }
  }
  const labelOf = w => w.kind == 'btn' ? w.name.replace(/^btn_/, '') : w.kind == 'sw' ? '开关 ' + Tweak.condOf(w).slice(0, 28) : w.kind == 'hex' ? '#颜色' : `${w.nm} ${w.ix.join(' ')}`

  function sync() {
    if (!host) return
    mark()
    const ws = Tweak.widgets.filter(w => w.kind != 'lit' && (w.key || w.kind == 'btn'))
    $('#tpn').textContent = ws.length ? `· ${ws.length} 个参数` : ''
    if (!root.open) { dirty = true; return }
    dirty = false
    const s = ws.map(w => w.kind + ':' + (w.key || w.name)).join('|')
    if (s === sig) { ws.forEach((w, i) => { list[i].w = w; list[i].upd() }); renderHead(); return }
    sig = s; rows.textContent = ''; list = []
    for (const w of ws) {
      const row = { w }, c = control(row), lab = h('span', 'lb'), ln = h('i')
      row.upd = c.upd
      lab.textContent = labelOf(w); lab.title = '跳到源码'
      lab.onclick = () => host.goto(row.w.nums[0].a, row.w.nums[w.kind == 'sw' ? 0 : row.w.nums.length - 1].b)
      const el = h('div', 'row', lab, ...c.el)
      row.el = el; c.upd(); list.push(row); rows.append(el)
    }
    if (!ws.length) rows.append(h('div', 'empty', '没有可调参数：写 fill 255 0 0 / circle 10 20 30 / textAlign CENTER CENTER，或 btn_xxx 按钮、cond?.{ … } 开关'))
    renderHead()
  }
  function renderHead() {
    const ls = Tweak.inferred
    $('#tphn').textContent = ls.length ? `· ${ls.length} 条` : ''
    head.hidden = !ls.length
    if (head.open) hpre.textContent = ls.join('\n')
  }
  // 把推断的声明写进源码顶部（之后就是用户声明，推断不再管它们）
  function put(ed) {
    const ls = Tweak.inferred; if (!ls.length || !ed.fix()) return 0
    ed.t.replaceData(0, 0, ls.join('\n') + '\n\n')
    ed.el.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
    return ls.length
  }

  const same = (snap, p) => Object.entries(p).every(([k, v]) => snap[k] && JSON.stringify(snap[k]) == JSON.stringify(v))
  // 下拉停在当前预设上，直到值被改动（与存的不一样）才回到【当前预设】
  function mark() {
    const p = load(), on = cur && p[cur] && same(Tweak.snapshot(), p[cur])
    sel.value = on ? 'p:' + cur : ''
    for (const a of links.children) a.classList.toggle('on', !!on && a.title == cur)
  }
  function presets() {   // 重建下拉和直达链接
    const p = load(), names = Object.keys(p)
    if (cur && !p[cur]) cur = null
    sel.textContent = ''; sel.append(new Option('【当前预设】', ''))
    for (const n of names) sel.append(new Option(n, 'p:' + n))
    sel.prepend(new Option('＋ 保存为新预设', '+'), new Option('－ 重命名或删除当前预设', '-'))
    links.textContent = ''
    for (const n of names) {
      const a = h('a'); a.href = '#'; a.title = n; a.textContent = [...n].slice(0, 3).join('')
      a.onclick = e => { e.preventDefault(); apply(n) }
      links.append(a, ' ')
    }
    mark()
  }
  function apply(name) {
    const p = load()[name]; if (!p) return
    cur = name
    const n = Tweak.apply(p); host.status(n ? `预设 ${name}：改了 ${n} 个参数` : `预设 ${name}：没有对得上的参数（源码结构变了？）`)
    mark()
  }
  function add() {   // 保存当前所有参数为新预设：不问名字，自动 预设1、预设2…
    const snap = Tweak.snapshot(); if (!Object.keys(snap).length) return host.status('没有可保存的参数')
    const p = load(); let k = 1; while (p['预设' + k]) k++
    cur = '预设' + k; p[cur] = snap; save(p); host.status(`已保存为 ${cur}`)
  }
  function rename() {   // 重命名当前预设；留空 = 删除
    const p = load(); if (!cur || !p[cur]) return host.status('没有当前预设（先选一个预设）')
    const t = prompt('重命名当前预设（留空 = 删除）', cur); if (t === null) return
    const n = t.trim()
    if (n && n != cur && p[n]) return host.status(`已有同名预设 ${n}`)
    const o = {}; for (const [k, v] of Object.entries(p)) if (k != cur) o[k] = v; else if (n) o[n] = v
    save(o); host.status(n ? `已重命名为 ${n}` : `已删除预设 ${cur}`); cur = n || null
  }
  function importJson(t) {   // 单个预设、单行 JSON：{"parviz":"preset","name":…,"v":{键:[值…]}}；重名自动加序号
    if (!t.trim()) return
    try {
      const o = JSON.parse(t); if (o?.parviz != 'preset' || !o.v || typeof o.v != 'object') throw 0
      const p = load(), base = String(o.name || '导入').trim() || '导入'; let n = base, k = 2
      while (p[n]) n = base + k++
      p[n] = o.v; save(p); cur = n; presets(); host.status(`导入了预设 ${n}`)
    } catch { host.status('不是预设 JSON（单个预设：{"parviz":"preset",…}）') }
  }
  function init(h_) {
    host = h_
    root.ontoggle = () => { if (root.open && dirty) sync() }
    head.ontoggle = () => { if (head.open) renderHead() }
    $('#tp>summary').onclick = e => { if (e.target.closest('select,input,button,a')) e.preventDefault() }   // summary 里的控件不触发折叠
    sel.onchange = () => {
      const v = sel.value
      if (v == '+') add(); else if (v == '-') rename(); else if (v.startsWith('p:')) { apply(v.slice(2)); return }
      presets()
    }
    $('#tpexp').onclick = async () => {   // 导出当前这一套参数值（选中了预设且没改动时带上它的名字）
      const snap = Tweak.snapshot(); if (!Object.keys(snap).length) return host.status('没有可导出的参数')
      const on = sel.value.startsWith('p:'), txt = JSON.stringify({ parviz: 'preset', name: on ? cur : '', v: snap })
      try { await navigator.clipboard.writeText(txt); host.status('预设 JSON 已复制到剪贴板（单行）') } catch { prompt('预设 JSON（复制）', txt) }
    }
    const imp = $('#tpimp')
    imp.onchange = () => { importJson(imp.value); imp.value = '' }
    imp.onpaste = () => setTimeout(() => { importJson(imp.value); imp.value = '' }, 0)
    $('#tphput').onclick = () => { const n = put(host.ed); host.status(n ? `已把 ${n} 条推断声明写进源码顶部` : '没有可写入的声明') }
    presets()
  }
  return { init, sync, presets }
})()
