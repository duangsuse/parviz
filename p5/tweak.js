/* tweak.js — p5.html 编辑器里的数值小工具。按 p5 函数名硬编码判定整数实参是颜色还是位置，不看别的语义：
   颜色  fill / stroke / background / tint 的 3 或 4 个整数实参（r g b [a]）、#rrggbb 字面量、"#rrggbb" 字符串
         → 数字底色就是该颜色；悬停出预览 + 原生拾色器（Monaco 风格），拾色即改源码。
   位置  circle / rect / text / line / translate … 里的 (x y) 两个整数实参 → 虚线下划线；悬停出画布缩略板（叠着当前预览），
         点击或拖动改 x y（Tweakpane 风格）。
   依赖 editor.js 的 Editor 与 parse.js 的 isT；p5ui.js 每次解析后调 Tweak.scan(ss)，启动时 Tweak.init(编辑器, 取画布尺寸)。 */
'use strict'
const Tweak = (() => {
  const { isT } = P
  const COLOR = new Set(['fill', 'stroke', 'background', 'tint'])
  const POS = { circle: [0, 1], ellipse: [0, 1], rect: [0, 1], square: [0, 1], arc: [0, 1], point: [0, 1], translate: [0, 1], text: [1, 1], image: [1, 1], line: [0, 2], triangle: [0, 3], quad: [0, 4] }   // [首个坐标的实参下标, 坐标对数]
  const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const parseHex = s => {
    s = s.slice(1); if (s.length < 6) s = [...s].map(c => c + c).join('')
    return [0, 2, 4, 6].map(i => s.length > i ? parseInt(s.slice(i, i + 2), 16) : 255)
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')

  let ed = null, ws = [], canvasSize = () => null, cv = [400, 300], hlNames = []
  let cur = null, pinned = false, mine = false, hideT = 0
  const tw = document.createElement('div'); tw.id = 'tw'; document.body.append(tw)
  const val = r => ed.value.slice(r.a, r.b)
  // 颜色部件的 nums：rgb = [r g b (a)]；hex = [字面量内容范围]；位置部件 nums = [x y]
  const span = w => [w.nums[0].a, w.nums[w.kind == 'rgb' ? 2 : w.nums.length - 1].b]
  const rgbOf = w => w.kind == 'hex' ? parseHex(val(w.nums[0])).slice(0, 3) : w.nums.slice(0, 3).map(r => clamp(+val(r), 0, 255))
  const alphaOf = w => w.kind == 'hex' ? parseHex(val(w.nums[0]))[3] : w.nums[3] ? clamp(+val(w.nums[3]), 0, 255) : 255

  /* ---------- 扫描：在 AST 里找调用与字面量，记下每个可调数字在源码里的范围 ---------- */
  function scan(ss) {
    const s = ss.src, out = []
    cv = [400, 300]
    const isInt = (v, n) => typeof v == 'number' && Number.isInteger(v) && n && /^-?\d+$/.test(s.slice(n.a, n.b))
    const visit = x => {
      if (Array.isArray(x) && !isT(x)) return x.forEach(visit)
      if (!isT(x)) return
      if (x[0] == '' && typeof x[1] == 'string' && x.node && HEX.test(x[1])) {
        const q = s[x.node.a] == '"' ? 1 : 0
        out.push({ kind: 'hex', nums: [{ a: x.node.a + q, b: x.node.b - q }], quote: q })
      } else if ((x[0] == '()' || x[0] == '[]') && x.ns) {
        const hd = x[1], name = isT(hd) && (hd[0] == '$$' || hd[0] == '$') ? hd[1] : null
        const A = k => x[k + 2], N = k => x.ns[k + 1], n = x.length - 2
        const ints = k => isInt(A(k), N(k))
        if (COLOR.has(name) && (n == 3 || n == 4) && [...Array(n).keys()].every(ints)) out.push({ kind: 'rgb', nums: [...Array(n).keys()].map(k => ({ a: N(k).a, b: N(k).b })) })
        else if (name == 'createCanvas' && n >= 2 && ints(0) && ints(1)) cv = [A(0), A(1)]
        else if (POS[name]) {
          const [from, pairs] = POS[name]
          for (let p = 0; p < pairs; p++) { const k = from + 2 * p; if (ints(k) && ints(k + 1)) out.push({ kind: 'pos', nums: [N(k), N(k + 1)].map(r => ({ a: r.a, b: r.b })) }) }
        }
      }
      for (let i = 1; i < x.length; i++) visit(x[i])
    }
    try { if (isT(ss.value)) visit(ss.value) } catch { out.length = 0 }
    ws = out.sort((p, q) => p.nums[0].a - q.nums[0].a)
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
    const c = document.createElement('canvas'), cap = document.createElement('div'), g = c.getContext('2d')
    c.width = cw * dpr; c.height = ch * dpr; c.style.width = cw + 'px'; c.style.height = ch + 'px'; g.scale(dpr, dpr)
    c.title = '点击或拖动改 x y'
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
      cap.textContent = `x ${x}   y ${y}   · ${W}×${H}`
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
  function show(w) {
    if (pinned) return
    tw.textContent = ''; cur = { w }
    w.kind == 'pos' ? showPos(w) : showColor(w)
    place(w)
  }

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
  return { init, scan, get widgets() { return ws } }
})()
