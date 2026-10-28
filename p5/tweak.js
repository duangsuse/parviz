/* tweak.js — p5.html 编辑器里的数值小工具。格式来自源码顶层的声明，不再按 p5 函数名硬编码：
   (tweak rect   (vec2 0 1) (vec2 2 3))   # x y；w h（第二组是尺寸）
   (tweak circle (vec2 0 1) (num 2))      # x y；直径
   (tweak fill   (color 0 1 2 3))         # r g b [a]
   (tweak rotate (angle 0))               # 一个角度（源码写弧度，滑块显示角度）
   声明只在顶层；它的实参下标指向调用处的位置。vec2/size → 画布缩略板上点/拖；color → 底色 + 拾色器；
   num/angle → 数字框 / 滑块。十六进制字面量（#rgb、#rrggbb…）仍然无条件识别，不需要声明。
   依赖 editor.js 的 Editor 与 parse.js 的 isT；p5ui.js 每次解析后调 Tweak.scan(ss)，启动时 Tweak.init(编辑器, 取画布尺寸)。 */
'use strict'
const Tweak = (() => {
  const { isT } = P
  const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
  const SAFE = /^[\w$@]+$/   // 声明里的函数名会进 RegExp 之外的比较，统一按纯文本处理
  const KINDS = new Set(['vec2', 'size', 'num', 'angle', 'color'])
  // 顶层声明 (tweak rect (vec2 0 1) (vec2 2 3)) → {rect: {groups:[{kind, idx, ns}], a, b}}；只读 value 的顶层语句
  function declsOf(v) {
    const m = new Map
    if (!isT(v)) return m
    for (const s of v.slice(1)) {
      if (!(isT(s) && s[0] == 'tweak')) continue
      const nm = isT(s[1]) ? s[1][1] : s[1], gs = []
      for (const sp of s.slice(2)) {
        if (!(isT(sp) && sp[0] == 'spec')) continue
        const kind = isT(sp[1]) ? sp[1][1] : sp[1]
        if (KINDS.has(kind)) gs.push({ kind, idx: sp.slice(2), ns: (sp.ns || []).slice(1) })
      }
      if (typeof nm == 'string' && SAFE.test(nm)) m.set(nm, { name: nm, groups: gs, a: s.a, b: s.b })
    }
    return m
  }
  // 调用头 → 名字：f … / p.f …（o.f 取键后调用也认，键是第一段）
  const callName = x => {
    const h = x[1]
    if (!isT(h)) return null
    if (h[0] == '$' || h[0] == '$$') return h[1]
    if (h[0] == '.' && isT(h[2])) return h[2][1]
    return null
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const parseHex = s => {
    s = s.slice(1); if (s.length < 6) s = [...s].map(c => c + c).join('')
    return [0, 2, 4, 6].map(i => s.length > i ? parseInt(s.slice(i, i + 2), 16) : 255)
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')

  let ed = null, ws = [], problems = [], decls = new Map, canvasSize = () => null, cv = [400, 300], hlNames = []
  let cur = null, pinned = false, mine = false, hideT = 0
  const tw = document.createElement('div'); tw.id = 'tw'; document.body.append(tw)
  const val = r => ed.value.slice(r.a, r.b)
  // 颜色部件的 nums：rgb = [r g b (a)]；hex = [字面量内容范围]；位置部件 nums = [x y]
  const span = w => [w.nums[0].a, w.nums[w.kind == 'rgb' ? 2 : w.nums.length - 1].b]
  const rgbOf = w => w.kind == 'hex' ? parseHex(val(w.nums[0])).slice(0, 3) : w.nums.slice(0, 3).map(r => clamp(+val(r), 0, 255))
  const alphaOf = w => w.kind == 'hex' ? parseHex(val(w.nums[0]))[3] : w.nums[3] ? clamp(+val(w.nums[3]), 0, 255) : 255

  /* ---------- 扫描：读顶层 (tweak …) 声明，再在 AST 里找这些函数的调用，记下每个可调实参的源码范围 ---------- */
  function scan(ss) {
    const s = ss.src, out = [], bad = []
    cv = [400, 300]
    const D = declsOf(ss.value); decls = D
    const numAt = (v, n, dec) => typeof v == 'number' && n && (dec ? /^-?\d+(\.\d+)?$/ : /^-?\d+$/).test(s.slice(n.a, n.b))
    const visit = x => {
      if (Array.isArray(x) && !isT(x)) return x.forEach(visit)
      if (!isT(x)) return
      if (x[0] == '' && typeof x[1] == 'string' && x.node && HEX.test(x[1])) {
        const q = s[x.node.a] == '"' ? 1 : 0
        out.push({ kind: 'hex', nums: [{ a: x.node.a + q, b: x.node.b - q }], quote: q })
      } else if ((x[0] == '()' || x[0] == '[]') && x.ns) {
        const nm = callName(x), n = x.length - 2
        const A = k => x[k + 2], N = k => x.ns[k + 1]
        const d = nm && D.get(nm)
        if (d) for (const g of d.groups) {
          const K = g.kind, idx = g.idx, fail = msg => bad.push({ a: d.a, b: d.b, msg: `${nm}: ${msg}` })
          if (K == 'vec2' || K == 'size') {
            if (idx.length != 2) { fail('需要两个下标'); continue }
            if (idx.some(k => k >= n)) { fail(`下标超出实参（${n} 个）`); continue }
            if (!idx.every(k => numAt(A(k), N(k), false))) continue        // 表达式实参：不生成部件，也不算错
            out.push({ kind: 'pos', size: K == 'size', nums: idx.map(k => ({ a: N(k).a, b: N(k).b })) })
          } else if (K == 'color') {
            if (idx.length != 3 && idx.length != 4) { fail('需要 3 或 4 个下标'); continue }
            const lit = []
            for (const k of idx) { if (k >= n || !numAt(A(k), N(k), false)) break; lit.push(k) }
            if (lit.length >= 3) out.push({ kind: 'rgb', nums: lit.map(k => ({ a: N(k).a, b: N(k).b })) })   // 灰阶 / 表达式通道：跳过
          } else {   // num / angle
            if (idx.length != 1) { fail('需要一个下标'); continue }
            if (idx[0] >= n) { fail(`下标超出实参（${n} 个）`); continue }
            if (!numAt(A(idx[0]), N(idx[0]), true)) continue
            out.push({ kind: K, nums: [{ a: N(idx[0]).a, b: N(idx[0]).b }] })
          }
        }
        if (nm == 'createCanvas' && n >= 2 && numAt(A(0), N(0), false) && numAt(A(1), N(1), false)) cv = [A(0), A(1)]
      }
      for (let i = 1; i < x.length; i++) visit(x[i])
    }
    try { if (isT(ss.value)) visit(ss.value) } catch { out.length = 0 }
    ws = out.sort((p, q) => p.nums[0].a - q.nums[0].a)
    problems = bad
    if (cur) {   // 弹层绑定到重新解析出的同一个部件
      const w = ws.find(x => x.kind == cur.w.kind && x.nums[0].a == cur.w.nums[0].a)
      if (w) cur.w = w; else { pinned = false; hide() }
    }
    paintAll()
  }

  /* ---------- 颜色底色 / 位置下划线：CSS.highlights（priority 压过语法色） ---------- */
  function paintAll() {
    if (!window.CSS?.highlights) return
    for (const n of hlNames) CSS.highlights.delete(n)
    hlNames = []
    let css = ''; const pos = []
    ws.forEach((w, i) => {
      const [a, b] = span(w), r = ed.range(a, b)
      if (w.kind == 'pos') return pos.push(r)
      const [R, G, B] = rgbOf(w), nm = 'tw-c' + i, hl = new Highlight(r)
      hl.priority = 10; CSS.highlights.set(nm, hl); hlNames.push(nm)
      css += `::highlight(${nm}){background-color:rgb(${R} ${G} ${B});color:${0.299 * R + 0.587 * G + 0.114 * B > 150 ? '#000' : '#fff'}}\n`
    })
    if (pos.length) { const hl = new Highlight(...pos); hl.priority = 10; CSS.highlights.set('tw-pos', hl); hlNames.push('tw-pos') }
    document.querySelector('#twst').textContent = css
  }

  /* ---------- 改源码：直接在唯一的文本节点上 replaceData，并挪动其他部件的范围；再发一个 input 让页面重解析 / 自动运行 ---------- */
  function rep(a, b, str) {
    const d = str.length - (b - a); ed.t.replaceData(a, b - a, str)
    for (const w of ws) for (const r of w.nums) if (r.a >= b) { r.a += d; r.b += d }
  }
  function setNums(w, strs) {
    if (!ed.fix()) return
    strs.forEach((str, i) => { const r = w.nums[i]; if (val(r) != str) { rep(r.a, r.b, str); r.b = r.a + str.length } })
    mine = true; try { ed.el.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })) } finally { mine = false }
    paintAll()
  }
  const setRgb = (w, [r, g, b]) => {
    if (w.kind == 'rgb') return setNums(w, [r, g, b].map(String))
    const t = val(w.nums[0]), hex = toHex(r, g, b) + (t.length == 5 || t.length == 9 ? parseHex(t)[3].toString(16).padStart(2, '0') : '')
    setNums(w, [hex])
  }

  /* ---------- 弹层 ---------- */
  function hide() { if (pinned) return; clearTimeout(hideT); tw.style.display = 'none'; tw.textContent = ''; cur = null }
  const later = () => { clearTimeout(hideT); hideT = setTimeout(hide, 220) }
  function place(w) {
    const [a, b] = span(w), q = ed.rect(a, b)
    tw.style.display = 'block'
    const W = tw.offsetWidth, H = tw.offsetHeight
    let y = q.top - H - 6; if (y < 4) y = q.bottom + 6   // 在文字上方（像 Monaco），免得挡住下一行的部件
    tw.style.left = clamp(q.left, 4, innerWidth - W - 8) + 'px'; tw.style.top = Math.max(4, y) + 'px'
  }
  function showColor(w) {
    const inp = document.createElement('input'), lab = document.createElement('span'), row = document.createElement('div')
    inp.type = 'color'; row.className = 'row'; row.append(inp, lab)
    const sync = () => {
      const [R, G, B] = rgbOf(cur.w), al = alphaOf(cur.w)
      lab.textContent = cur.w.kind == 'hex' ? val(cur.w.nums[0]) : `rgb(${R} ${G} ${B}${al < 255 ? ' / ' + al : ''})`
      return toHex(R, G, B)
    }
    inp.value = sync()
    inp.title = '点击打开拾色器；拖动即改源码'
    inp.onclick = () => { pinned = true }
    inp.oninput = () => { setRgb(cur.w, parseHex(inp.value).slice(0, 3)); sync() }
    inp.onchange = () => { pinned = false; later() }
    tw.append(row)
  }
  function showPos(w) {
    const [W, H] = canvasSize() || cv, s = Math.min(2, 260 / W, 200 / H), cw = Math.round(W * s), ch = Math.round(H * s), dpr = devicePixelRatio || 1
    const c = document.createElement('canvas'), cap = document.createElement('div'), g = c.getContext('2d'), sz = !!w.size
    c.width = cw * dpr; c.height = ch * dpr; c.style.width = cw + 'px'; c.style.height = ch + 'px'; g.scale(dpr, dpr)
    c.title = sz ? '点击或拖动改 w h' : '点击或拖动改 x y'
    const draw = () => {
      const [x, y] = cur.w.nums.map(r => +val(r)), px = x * s, py = y * s
      g.fillStyle = '#14161b'; g.fillRect(0, 0, cw, ch)
      const live = document.querySelector('#pv canvas')
      if (live) { try { g.globalAlpha = 0.55; g.drawImage(live, 0, 0, cw, ch) } catch { } g.globalAlpha = 1 }
      g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1; g.beginPath()
      for (let u = 50; u < W; u += 50) { g.moveTo(u * s + .5, 0); g.lineTo(u * s + .5, ch) }
      for (let u = 50; u < H; u += 50) { g.moveTo(0, u * s + .5); g.lineTo(cw, u * s + .5) }
      g.stroke()
      g.strokeStyle = 'rgba(229,192,123,.55)'; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, ch); g.moveTo(0, py); g.lineTo(cw, py); g.stroke()
      g.fillStyle = '#e5c07b'; g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill()
      g.strokeStyle = '#14161b'; g.lineWidth = 1.5; g.stroke()
      cap.textContent = sz ? `w ${x}   h ${y}   · ${W}×${H}` : `x ${x}   y ${y}   · ${W}×${H}`
    }
    const set = e => {
      const r = c.getBoundingClientRect()
      setNums(cur.w, [String(clamp(Math.round((e.clientX - r.left) / s), 0, W)), String(clamp(Math.round((e.clientY - r.top) / s), 0, H))]); draw()
    }
    c.onpointerdown = e => { pinned = true; c.setPointerCapture(e.pointerId); set(e) }
    c.onpointermove = e => { if (c.hasPointerCapture(e.pointerId)) set(e) }
    c.onpointerup = () => { pinned = false }
    tw.append(c, cap); draw()
  }
  // num / angle：一个数字的步进器；angle 的滑块按角度显示，源码里写弧度
  function showNum(w) {
    const inp = document.createElement('input'), row = document.createElement('div')
    row.className = 'row'; inp.type = 'number'; inp.step = 'any'; inp.value = val(cur.w.nums[0]); inp.style.width = '96px'
    inp.onfocus = () => { pinned = true }
    inp.onblur = () => { pinned = false; later() }
    inp.oninput = () => { setNums(cur.w, [inp.value === '' ? '0' : inp.value]) }
    row.append(inp); tw.append(row)
  }
  function showAngle(w) {
    const v = +val(w.nums[0]) || 0, inp = document.createElement('input'), lab = document.createElement('span'), row = document.createElement('div')
    row.className = 'row'; inp.type = 'range'; inp.min = 0; inp.max = 360; inp.step = 1
    inp.value = String((Math.round(v * 180 / Math.PI) + 360) % 360); lab.textContent = inp.value + '°'
    inp.oninput = () => { const deg = +inp.value; lab.textContent = deg + '°'; setNums(cur.w, [(deg * Math.PI / 180).toFixed(3)]) }
    inp.onpointerdown = () => { pinned = true }
    inp.onpointerup = () => { pinned = false; later() }
    row.append(inp, lab); tw.append(row)
  }
  function show(w) {
    if (pinned) return
    tw.textContent = ''; cur = { w }
    if (w.kind == 'pos') showPos(w)
    else if (w.kind == 'rgb' || w.kind == 'hex') showColor(w)
    else if (w.kind == 'angle') showAngle(w)
    else showNum(w)
    place(w)
  }

  /* ---------- 几何：pick 用声明把调用实参算成 bbox（实参是运行期值，不要求字面量） ---------- */
  // vec2 + size → 矩形；vec2 + num → 圆；两个 vec2 → 线段；单个 vec2 → 3px 的点
  function geo(name, args) {
    const d = decls.get(name); if (!d) return null
    const get = g => g.idx.map(i => args[i])
    const num = v => typeof v == 'number' && isFinite(v)
    const pts = [], szs = []; let rad
    for (const g of d.groups) {
      if (g.kind == 'vec2') pts.push(get(g))
      else if (g.kind == 'size') szs.push(get(g))
      else if (g.kind == 'num') rad = get(g)[0]
    }
    const ok = p => p.length == 2 && p.every(num)
    if (pts.length && szs.length && ok(pts[0]) && szs[0].every(num)) { const [x, y] = pts[0], [w, h] = szs[0]; return { x, y, w, h } }
    if (pts.length && num(rad) && ok(pts[0])) { const [x, y] = pts[0]; return { x: x - rad / 2, y: y - rad / 2, w: rad, h: rad } }
    if (pts.length >= 2 && ok(pts[0]) && ok(pts[1])) { const [x1, y1] = pts[0], [x2, y2] = pts[1]; return { x: Math.min(x1, x2) - 1, y: Math.min(y1, y2) - 1, w: Math.abs(x2 - x1) + 2, h: Math.abs(y2 - y1) + 2 } }
    if (pts.length && ok(pts[0])) { const [x, y] = pts[0]; return { x: x - 3, y: y - 3, w: 6, h: 6 } }
    return null
  }
  const inside = (g, x, y) => !!g && x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h

  function init(editor, sizeOf) {
    ed = editor; canvasSize = sizeOf
    const inRects = (w, x, y) => { const [a, b] = span(w); for (const q of ed.range(a, b).getClientRects()) if (x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 1 && y <= q.bottom + 1) return true; return false }
    $.ev(ed.el, {
      mousemove() {
        if (pinned) return
        const { clientX, clientY } = $.event
        const w = ws.find(w => inRects(w, clientX, clientY))
        if (!w) { if (cur) later(); return }
        clearTimeout(hideT); if (cur?.w !== w) show(w)
      },
      mouseleave: later,
      scroll() { pinned = false; hide() },
      input() { if (!mine) { pinned = false; hide() } },
    })
    $.ev(tw, { mouseenter() { clearTimeout(hideT) }, mouseleave: later })
    $.ev(window, { pointerdown() { const { target } = $.event; if (pinned && !tw.contains(target)) { pinned = false; hide() } } }, true)
    $.ev(window, { keydown() { if ($.event.key == 'Escape') { pinned = false; hide() } } })
  }
  return { init, scan, geo, inside, get decls() { return decls }, get widgets() { return ws }, get problems() { return problems } }
})()
