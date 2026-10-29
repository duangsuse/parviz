/* tweak.js — p5.html 编辑器里的数值小工具。格式来自源码顶层的声明，不再按 p5 函数名硬编码：
   (tweak rect   (vec2 0 1) (vec2 2 3))   # x y；w h（第二组是尺寸）
   (tweak circle (vec2 0 1) (num 2))      # x y；直径
   (tweak fill   (color 0 1 2 3))         # r g b [a]
   (tweak rotate (angle 0))               # 一个角度（源码写弧度，滑块显示角度）
   声明只在顶层；它的实参下标指向调用处的位置。vec2/size → 画布缩略板上点/拖；color → 底色 + 拾色器；
   num/angle → 数字框 / 滑块。十六进制字面量（#rgb、#rrggbb…）仍然无条件识别，不需要声明。
   没有声明的数字字面量（常量池里的每个格子）也有最基础的部件：悬停显示数字框，滚轮微调（同 DevTools：±1 · Shift ±10 · Alt ±0.1 · Ctrl/Cmd ±100）；
   每一步都会先看运行有没有报错——报错就退回上一个值，并把这个方向的区间记为边界（区间显示在部件里）。
   依赖 editor.js 的 Editor 与 parse.js 的 isT；p5ui.js 每次解析后调 Tweak.scan(ss)，启动时 Tweak.init(编辑器, 取画布尺寸)。 */
'use strict'
const Tweak = (() => {
  const { isT } = P
  const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
  const SAFE = /^[\w$@]+$/   // 声明里的函数名会进 RegExp 之外的比较，统一按纯文本处理
  const KINDS = new Set(['vec2', 'size', 'num', 'angle', 'color', 'enum'])
  // 顶层声明 → { m: 函数名 → 声明, recs: [对象声明] }；只读 value 的顶层语句
  //   (tweak rect (vec2 0 1) (vec2 2 3))               函数 rect 的调用，下标是实参位置
  //   (tweak {x y vx vy} (vec2 x y))                   含这些字段的对象（{x 1 y 2 …}），下标是字段名；组里可以再引用没列在 {} 里的可选字段
  const nameOf = i => isT(i) ? i[1] : i
  function declsOf(v) {
    const m = new Map, recs = []
    if (!isT(v)) return { m, recs }
    for (const s of v.slice(1)) {
      if (!(isT(s) && s[0] == 'tweak')) continue
      const rec = isT(s[1]) && s[1][0] == 'rec', gs = []
      for (const sp of s.slice(2)) {
        if (!(isT(sp) && sp[0] == 'spec')) continue
        const kind = nameOf(sp[1])
        if (KINDS.has(kind)) { const ix = sp.slice(2).map(nameOf); gs.push(kind == 'enum' ? { kind, idx: ix.slice(0, 1), opts: ix.slice(1).map(String), ns: (sp.ns || []).slice(1) } : { kind, idx: ix, ns: (sp.ns || []).slice(1) }) }   // (enum 0 LEFT CENTER RIGHT)：第一个是下标，其余是选项
      }
      if (rec) { const fields = s[1].slice(1).map(nameOf); recs.push({ rec: true, name: '{' + fields.join(' ') + '}', fields, groups: gs, a: s.a, b: s.b }) }
      else { const nm = nameOf(s[1]); if (typeof nm == 'string' && SAFE.test(nm)) m.set(nm, { name: nm, groups: gs, a: s.a, b: s.b }) }
    }
    return { m, recs }
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

  let ed = null, ws = [], problems = [], decls = new Map, rdecls = [], base = { m: new Map, recs: [] }, canvasSize = () => null, cv = [400, 300], hlNames = [], host = null, inferredNames = [], btnT = 0
  let openedAt = 0, probing = false, bounds = new Map
  let cur = null, pinned = false, mine = false, hideT = 0, anchor = null   // anchor：右键取源时弹层直接出现在鼠标处
  const tw = document.createElement('div'); tw.id = 'tw'; document.body.append(tw)
  const val = r => ed.value.slice(r.a, r.b)
  // 颜色部件的 nums：rgb = [r g b (a)]；hex = [字面量内容范围]；位置部件 nums = [x y]
  const span = w => w.kind == 'sw' || w.kind == 'btn' ? [w.nums[0].a, w.nums[0].b] : [w.nums[0].a, w.nums[w.kind == 'rgb' ? 2 : w.nums.length - 1].b]   // 开关 / 按钮：只有那个词条可点，不是整个块
  const rgbOf = w => w.kind == 'hex' ? parseHex(val(w.nums[0])).slice(0, 3) : w.nums.slice(0, 3).map(r => clamp(+val(r), 0, 255))
  const alphaOf = w => w.kind == 'hex' ? parseHex(val(w.nums[0]))[3] : w.nums[3] ? clamp(+val(w.nums[3]), 0, 255) : 255

  /* ---------- 扫描：读顶层 (tweak …) 声明，再在 AST 里找这些函数的调用，记下每个可调实参的源码范围 ---------- */
  function scan(ss, cells = []) {
    const s = ss.src, out = [], bad = []
    cv = [400, 300]
    const D = declsOf(ss.value); decls = D.m; rdecls = D.recs
    const numAt = (v, n, dec) => typeof v == 'number' && n && (dec ? /^-?\d+(\.\d+)?$/ : /^-?\d+$/).test(s.slice(n.a, n.b))
    const all = [...D.m.values(), ...D.recs]
    for (const d of all) if (d.groups.some(g => g.idx.some(i => typeof i != (d.rec ? 'string' : 'number')))) bad.push({ a: d.a, b: d.b, msg: `${d.name}: ${d.rec ? '对象声明的下标是字段名' : '下标需要整数'}` })
    // 一个声明作用于一处实参表：get(k) → { v, n:{a,b} } | null（调用 = 第 k 个实参；对象 = 字段 k 的值）。miss：下标越界时的报错（对象字段缺了不算错）
    const emit = (d, nm, get, miss) => {
      for (const g of d.groups) {
        const K = g.kind, idx = g.idx, fail = msg => bad.push({ a: d.a, b: d.b, msg: `${nm}: ${msg}` })
        if (idx.some(i => typeof i != (d.rec ? 'string' : 'number'))) continue
        const R = idx.map(get), at = r => ({ a: r.n.a, b: r.n.b })
        if (K == 'vec2' || K == 'size') {
          if (idx.length != 2) { fail('需要两个下标'); continue }
          if (R.some(r => !r)) { if (miss) fail(miss); continue }
          if (!R.every(r => numAt(r.v, r.n, false))) continue        // 表达式实参：不生成部件，也不算错
          out.push({ kind: 'pos', size: K == 'size', nums: R.map(at), nm, ix: idx })
        } else if (K == 'color') {
          if (idx.length != 3 && idx.length != 4) { fail('需要 3 或 4 个下标'); continue }
          const lit = []
          for (const r of R) { if (!r || !numAt(r.v, r.n, false)) break; lit.push(r) }
          if (lit.length >= 3) out.push({ kind: 'rgb', nums: lit.map(at), nm, ix: idx })   // 灰阶 / 表达式通道：跳过
        } else if (K == 'enum') {   // 下拉菜单：实参必须是一个名字（CENTER），选项是声明里列的
          if (!R[0]) { if (miss) fail(miss); continue }
          if (!/^[\w$]+$/.test(s.slice(R[0].n.a, R[0].n.b))) continue
          out.push({ kind: 'enum', opts: g.opts, nums: [at(R[0])], nm, ix: idx })
        } else {   // num / angle
          if (idx.length != 1) { fail('需要一个下标'); continue }
          if (!R[0]) { if (miss) fail(miss); continue }
          if (!numAt(R[0].v, R[0].n, true)) continue
          out.push({ kind: K, nums: [at(R[0])], nm, ix: idx })
        }
      }
    }
    const usedBase = new Set   // 没写声明、靠内置声明（Tweak.SIG）推断出部件的函数名
    const visit = x => {
      if (Array.isArray(x) && !isT(x)) return x.forEach(visit)
      if (!isT(x)) return
      if (x[0] == '' && typeof x[1] == 'string' && x.node && HEX.test(x[1])) {
        const q = s[x.node.a] == '"' ? 1 : 0
        out.push({ kind: 'hex', nm: 'hex', nums: [{ a: x.node.a + q, b: x.node.b - q }], quote: q })
      } else if ((x[0] == '()' || x[0] == '[]') && x.ns) {
        const nm = callName(x), n = x.length - 2
        const A = k => x[k + 2], N = k => x.ns[k + 1]
        const own = nm && D.m.get(nm), d = own || (nm && base.m.get(nm))
        if (d) { if (!own) usedBase.add(nm); emit(d, nm, k => k < n ? { v: A(k), n: N(k) } : null, own ? `下标超出实参（${n} 个）` : null) }
        if (nm == 'createCanvas' && n >= 2 && numAt(A(0), N(0), false) && numAt(A(1), N(1), false)) cv = [A(0), A(1)]
        // cond?.{ … }：开关。(isnt cond)?.{ … } 是关；点 ?.{ 在两种写法之间切换。nums = [?.{ 词条, 条件, 整个块]
        if (nm == 'As' && n == 2 && x.ns[0] && x.ns[1] && s.startsWith('?.{', x.ns[0].a)) {
          const t = x.ns[0], c = x.ns[1]
          out.push({ kind: 'sw', nm: 'switch', on: !/^\(isnt\s/.test(s.slice(c.a, c.b)), nums: [{ a: t.a, b: t.a + 3 }, { a: c.a, b: c.b }, { a: t.a, b: t.b }] })
        }
      } else if (x[0] == '{}' && x.ns) {   // 对象字面量 {x 170 y 100}：字段 → 值的源码范围
        const keys = new Map
        for (let i = 1; i < x.length; i++) {
          const pr = x[i], pn = x.ns[i - 1], mm = Array.isArray(pr) && typeof pr[0] == 'string' && pn ? /^\S+\s+/.exec(s.slice(pn.a, pn.b)) : null
          if (mm) keys.set(pr[0], { v: pr[1], n: { a: pn.a + mm[0].length, b: pn.b } })
        }
        if (keys.size) for (const d of recsFor(Object.fromEntries([...keys.keys()].map(k => [k, 1])))) emit(d, d.name, k => keys.get(k) || null, null)
      }
      for (let i = 1; i < x.length; i++) visit(x[i])
    }
    try { if (isT(ss.value)) visit(ss.value) } catch { out.length = 0 }
    // btn_ 开头、没有参数的 def（或 [- btn_x (=> () …)]）：按钮，点函数名执行
    try { if (isT(ss.value)) for (const st of ss.value.slice(1)) if (isT(st) && st[0] == '=' && typeof st[1] == 'string' && /^btn_/.test(st[1]) && isT(st[2]) && st[2][0] == '=>' && isT(st[2][1]) && st[2][1].length == 1 && st.ns?.[0]) out.push({ kind: 'btn', nm: 'btn', name: st[1], nums: [{ a: st.ns[0].a, b: st.ns[0].b }] }) } catch { }
    // 其余数字字面量（常量池的格子）：基础部件。声明已经管着的、(tweak …) 声明自己的下标都不算
    const used = new Set(out.flatMap(w => w.nums.map(r => r.a)))
    for (const c of cells) if (!used.has(c.a) && !all.some(d => c.a >= d.a && c.b <= d.b)) out.push({ kind: 'lit', nums: [{ a: c.a, b: c.b }] })
    const prevN = ws.length
    const seen = new Set   // 几个声明管同一处（对象声明可以重叠）：同类部件只留一个
    ws = out.filter(w => { const k = w.kind + ':' + w.nums.map(r => r.a); return !seen.has(k) && seen.add(k) }).sort((p, q) => p.nums[0].a - q.nums[0].a)
    const cnt = new Map   // 预设的键：声明名[下标]#第几个；源码结构不变时稳定
    for (const w of ws) { if (!w.nm || w.kind == 'btn') { w.key = null; continue } const p = w.nm + (w.ix ? ':' + w.ix.join(',') : ''), k = (cnt.get(p) || 0) + 1; cnt.set(p, k); w.key = p + '#' + k }
    inferredNames = [...usedBase]
    if (ws.length != prevN) bounds.clear()   // 结构变了：划定的区间按序号记，不再对得上
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
    let css = ''; const grp = { 'tw-pos': [], 'tw-enum': [], 'tw-on': [], 'tw-off': [], 'tw-dim': [], 'tw-btn': [] }
    const rg = r => ed.range(r.a, r.b)
    ws.forEach((w, i) => {
      if (w.kind == 'sw') { grp[w.on ? 'tw-on' : 'tw-off'].push(rg(w.nums[0])); if (!w.on) grp['tw-dim'].push(rg(w.nums[2])); return }
      if (w.kind == 'btn') return grp['tw-btn'].push(rg(w.nums[0]))
      const [a, b] = span(w), r = ed.range(a, b)
      if (w.kind == 'pos') return grp['tw-pos'].push(r)
      if (w.kind == 'enum') return grp['tw-enum'].push(r)
      if (w.kind != 'rgb' && w.kind != 'hex') return
      const [R, G, B] = rgbOf(w), nm = 'tw-c' + i, hl = new Highlight(r)
      hl.priority = 10; CSS.highlights.set(nm, hl); hlNames.push(nm)
      css += `::highlight(${nm}){background-color:rgb(${R} ${G} ${B});color:${0.299 * R + 0.587 * G + 0.114 * B > 150 ? '#000' : '#fff'}}\n`
    })
    for (const [nm, rs] of Object.entries(grp)) if (rs.length) { const hl = new Highlight(...rs); hl.priority = 10; CSS.highlights.set(nm, hl); hlNames.push(nm) }
    document.querySelector('#twst').textContent = css
  }

  /* ---------- 改源码：直接在唯一的文本节点上 replaceData，并挪动其他部件的范围；再发一个 input 让页面重解析 / 自动运行 ---------- */
  function rep(a, b, str) {
    const d = str.length - (b - a); ed.t.replaceData(a, b - a, str)
    for (const w of ws) for (const r of w.nums) if (r.a >= b) { r.a += d; r.b += d }
  }
  // 只改文本和范围（不发 input）：预设一次改很多个，最后统一提交一次
  function editW(w, strs) {
    if (w.kind == 'sw') { const want = strs[0] == 'on'; if (want != w.on) flip(w); return }
    strs.forEach((str, i) => { const r = w.nums[i]; if (val(r) != str) { rep(r.a, r.b, str); r.b = r.a + str.length } })
  }
  function flip(w) {   // cond ↔ (isnt cond)
    const c = w.nums[1], t = val(c), m = /^\(isnt\s+([\s\S]*)\)$/.exec(t), nt = m ? m[1] : `(isnt ${t})`
    rep(c.a, c.b, nt); c.b = c.a + nt.length; w.on = !!m
  }
  function commit() {
    mine = true; try { ed.el.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })) } finally { mine = false }
    paintAll()
  }
  function setNums(w, strs) { if (!ed.fix()) return; editW(w, strs); commit() }
  const valOf = w => w.kind == 'sw' ? [w.on ? 'on' : 'off'] : w.nums.map(val)
  // 预设：{ 键: [值…] } ↔ 源码里所有带键的部件
  const snapshot = () => Object.fromEntries(ws.filter(w => w.key).map(w => [w.key, valOf(w)]))
  function apply(vals) {
    if (!ed.fix()) return 0
    let n = 0
    for (const w of [...ws]) { const v = w.key && vals[w.key]; if (!Array.isArray(v) || v.length != valOf(w).length || v.some(x => typeof x != 'string')) continue; editW(w, v); n++ }
    if (n) commit()
    return n
  }
  const setOne = (w, j, str) => setNums(w, w.nums.map((r, i) => i == j ? str : val(r)))
  const setRgb = (w, [r, g, b]) => {
    if (w.kind == 'rgb') return setNums(w, [r, g, b].map(String))
    const t = val(w.nums[0]), hex = toHex(r, g, b) + (t.length == 5 || t.length == 9 ? parseHex(t)[3].toString(16).padStart(2, '0') : '')
    setNums(w, [hex])
  }

  /* ---------- 弹层 ---------- */
  function hide() { if (pinned) return; clearTimeout(hideT); tw.style.display = 'none'; tw.textContent = ''; cur = null; anchor = null }
  const later = () => { clearTimeout(hideT); hideT = setTimeout(hide, 220) }
  function place(w) {
    const [a, b] = span(w), q = ed.rect(a, b)
    tw.style.display = 'block'
    const W = tw.offsetWidth, H = tw.offsetHeight
    if (anchor) { tw.style.left = clamp(anchor.x + 6, 4, innerWidth - W - 8) + 'px'; tw.style.top = clamp(anchor.y + 26, 4, innerHeight - H - 8) + 'px'; return }
    let y = q.bottom; if (y + H > innerHeight - 4) y = Math.max(4, q.top - H)   // 紧贴这一行下方（中间不留缝：鼠标往下走会先经过下一行的数字，进不了弹层）；放不下才翻到上方
    tw.style.left = clamp(q.left, 4, innerWidth - W - 8) + 'px'; tw.style.top = y + 'px'
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
    // 缩略图跟着运行里的画布走（重跑 / 热编辑 / 动画都会变），部件开着就每帧重画
    const loop = () => { if (!c.isConnected || tw.style.display == 'none') return; draw(); requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  }
  // num / angle：一个数字的步进器；angle 的滑块按角度显示，源码里写弧度
  function showNum(w) {
    const inp = document.createElement('input'), row = document.createElement('div')
    row.className = 'row'; inp.type = 'number'; inp.step = 'any'; inp.value = val(cur.w.nums[0]); inp.style.width = '96px'
    inp.onfocus = () => { pinned = true }
    inp.onblur = () => { pinned = false; later() }
    inp.oninput = () => { setNums(cur.w, [inp.value === '' ? '0' : inp.value]) }
    row.append(inp); tw.append(row)
    const cap = document.createElement('div'); cap.className = 'cap'; tw.append(cap); capOf(cap, cur.w, 0)
  }
  // 说明行：滚轮提示 + 已划定的区间
  const keyOf = (w, j) => ws.indexOf(w) * 8 + j
  function capOf(el, w, j) {
    const b = bounds.get(keyOf(w, j)) || {}, r = b.lo != null || b.hi != null ? `   区间 [${b.lo ?? '−∞'}, ${b.hi ?? '+∞'}]` : ''
    el.textContent = '滚轮微调 ±1 · Shift ±10 · Alt ±0.1 · Ctrl ±100' + r
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
  function showEnum(w) {
    const sel = document.createElement('select'), row = document.createElement('div'), t = val(w.nums[0])
    row.className = 'row'
    for (const o of w.opts.includes(t) ? w.opts : [t, ...w.opts]) sel.append(new Option(o, o))
    sel.value = t
    sel.onfocus = sel.onmousedown = () => { pinned = true }
    sel.onblur = () => { pinned = false; later() }
    sel.onchange = () => setNums(cur.w, [sel.value])
    row.append(sel); tw.append(row)
  }
  function show(w) {
    if (pinned) return
    tw.textContent = ''; cur = { w }
    if (w.kind == 'pos') showPos(w)
    else if (w.kind == 'rgb' || w.kind == 'hex') showColor(w)
    else if (w.kind == 'angle') showAngle(w)
    else if (w.kind == 'enum') showEnum(w)
    else showNum(w)
    place(w)
  }

  /* ---------- 几何：pick 用声明把调用实参算成 bbox（实参是运行期值，不要求字面量） ---------- */
  // vec2 + size → 矩形；vec2 + num → 圆；两个 vec2 → 线段；单个 vec2 → 3px 的点
  function geo(name, args, d = byName(name)) {
    if (!d) return null
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

  /* ---------- 文字里的检测（控制台行 / 帧缓冲面板悬停）：与源码里的部件用同一套声明 ----------
     [名字 实参…]（暂停行、⏺ 日志行、调用清单）按函数声明；{k v k v …}（show 打出的对象、快照里的变量）按对象声明；
     颜色字面量（#hex、rgb()、(color r g b)）无条件识别。用户的声明优先；没有时退回 defaults() 装进来的内置声明（同一种 (tweak …) 写法）。 */
  const NUM = '-?\\d+(?:\\.\\d+)?'
  const RE_COL = new RegExp(`#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\\b|rgba?\\(\\s*(${NUM})[ ,]+(${NUM})[ ,]+(${NUM})(?:[ ,/]+(${NUM}))?\\s*\\)|\\(color\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})(?:\\s+(${NUM}))?\\)`, 'gi')
  // 内置声明（推断用）：没写 (tweak …) 的函数按这里的格式生成部件；写了就以写的为准。将来 p5 的文档可以直接生成这一段
  const DEFAULT_SRC = `(tweak createCanvas (size 0 1))
(tweak circle (vec2 0 1) (num 2))
(tweak square (vec2 0 1) (num 2))
(tweak ellipse (vec2 0 1) (size 2 3))
(tweak rect (vec2 0 1) (size 2 3) (num 4))
(tweak arc (vec2 0 1) (size 2 3))
(tweak line (vec2 0 1) (vec2 2 3))
(tweak triangle (vec2 0 1) (vec2 2 3) (vec2 4 5))
(tweak point (vec2 0 1))
(tweak text (vec2 1 2))
(tweak translate (vec2 0 1))
(tweak rotate (angle 0))
(tweak textSize (num 0))
(tweak strokeWeight (num 0))
(tweak frameRate (num 0) (num 1))
(tweak fill (color 0 1 2 3))
(tweak stroke (color 0 1 2 3))
(tweak background (color 0 1 2 3))
(tweak textAlign (enum 0 LEFT CENTER RIGHT) (enum 1 TOP CENTER BOTTOM BASELINE))
(tweak rectMode (enum 0 CORNER CORNERS CENTER RADIUS))
(tweak ellipseMode (enum 0 CENTER RADIUS CORNER CORNERS))
(tweak imageMode (enum 0 CORNER CORNERS CENTER))
(tweak colorMode (enum 0 RGB HSB HSL))
(tweak strokeCap (enum 0 ROUND SQUARE PROJECT))
(tweak strokeJoin (enum 0 MITER BEVEL ROUND))
(tweak textStyle (enum 0 NORMAL ITALIC BOLD BOLDITALIC))
(tweak {x y} (vec2 x y) (size w h) (num r))
(tweak {r g b} (color r g b a))`
  const baseLines = new Map(DEFAULT_SRC.split('\n').flatMap(l => { const m = /^\(tweak\s+([\w$@]+)/.exec(l); return m ? [[m[1], l]] : [] }))
  const defaults = ss => { base = declsOf(ss.value) }
  const byName = n => decls.get(n) || base.m.get(n)
  // 含这些字段的对象声明：用户的全用；没有才取内置里最具体（字段最多）的
  function recsFor(o) {
    const has = d => d.fields.every(f => f in o), mine = rdecls.filter(has)
    if (mine.length) return mine
    const b = base.recs.filter(has), top = Math.max(0, ...b.map(d => d.fields.length))
    return b.filter(d => d.fields.length == top)
  }
  const hexRgba = h => { h = h.slice(1); if (h.length < 6) h = [...h].map(c => c + c).join(''); return [0, 2, 4, 6].map(i => h.length > i ? parseInt(h.slice(i, i + 2), 16) : 255) }
  const num = t => t !== '' && isFinite(+t) ? +t : t
  // 文本 → { cols: [[r,g,b,a]], dots: [{x,y,w,h}], spans: [[a,b]] }；spans 是文本里被检测到的片段（颜色字面量、声明用到的实参 / 字段），悬停时高亮；没有可检测内容返回 null
  function detect(text) {
    if (text.length > 600) return null
    const cols = [], dots = [], spans = []
    for (const m of text.matchAll(RE_COL)) {
      if (m[0][0] == '#') cols.push(hexRgba(m[0]))
      else { const n = m[1] != null ? m.slice(1, 5) : m.slice(5, 9); cols.push([+n[0], +n[1], +n[2], n[3] == null ? 255 : +n[3] * (m[1] != null && +n[3] <= 1 ? 255 : 1)]) }
      spans.push([m.index, m.index + m[0].length])
    }
    // at：实参下标（函数声明）或字段名（对象声明）→ 文本里的 [起, 止]
    const use = (d, args, at) => {
      const g = geo(null, args, d); if (g && !dots.some(q => q.x == g.x && q.y == g.y && q.w == g.w && q.h == g.h)) dots.push(g)
      for (const grp of d.groups) {
        let hit = !!g && (grp.kind == 'vec2' || grp.kind == 'size' || grp.kind == 'num')
        if (grp.kind == 'color') {   // 声明过的颜色实参（含小数）
          const v = grp.idx.map(i => args[i])
          if (v.length >= 3 && v.slice(0, 3).every(x => typeof x == 'number')) { cols.push([v[0], v[1], v[2], typeof v[3] == 'number' ? v[3] : 255].map(x => Math.max(0, Math.min(255, Math.round(x))))); hit = true }
        }
        if (hit) for (const i of grp.idx) if (at[i]) spans.push(at[i])
      }
    }
    const toks = (s, base) => [...s.matchAll(/\S+/g)].map(t => [base + t.index, base + t.index + t[0].length])
    for (const m of text.matchAll(/\[([^\s\[\]]+)([^\[\]]*)\]/g)) {
      const d = byName(m[1]); if (!d) continue
      const ts = toks(m[2], m.index + 1 + m[1].length)
      use(d, ts.map(([a, b]) => num(text.slice(a, b))), ts)
    }
    for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
      const ts = toks(m[1], m.index + 1); if (ts.length < 2 || ts.length % 2) continue
      const o = Object.create(null), at = Object.create(null)
      for (let i = 0; i < ts.length; i += 2) { const k = text.slice(...ts[i]); o[k] = num(text.slice(...ts[i + 1])); at[k] = [ts[i][0], ts[i + 1][1]] }
      for (const d of recsFor(o)) use(d, o, at)
    }
    return cols.length || dots.length ? { cols, dots, spans } : null
  }

  // 悬停点落在哪个部件的哪个数字上：[部件, 数字下标]（十六进制颜色不是数字）
  const numAt = (x, y) => {
    for (const w of ws) { if (w.kind == 'hex' || w.kind == 'enum' || w.kind == 'sw' || w.kind == 'btn') continue
      for (let j = 0; j < w.nums.length; j++) for (const q of ed.range(w.nums[j].a, w.nums[j].b).getClientRects()) if (x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 1 && y <= q.bottom + 1) return [w, j] }
    return null
  }
  // 滚轮一步：改一个数字；先让运行证明这个值没问题，报错就退回并把这个方向的区间划到上一个值
  const frames = n => new Promise(r => { const f = () => --n > 0 ? requestAnimationFrame(f) : r(); requestAnimationFrame(f) })
  async function wheelStep(w, j, dir, e) {
    const idx = ws.indexOf(w), t = val(w.nums[j]), dec = (t.split('.')[1] || '').length
    // 同 DevTools：默认 ±1，Shift ±10，Alt ±0.1，Ctrl/Cmd ±100（小数位数只增不减，避免 1.25 → 2）
    const step = e.ctrlKey || e.metaKey ? 100 : e.shiftKey ? 10 : e.altKey ? 0.1 : 1, d2 = Math.min(6, Math.max(dec, e.altKey ? 1 : 0))
    const fmt = v => { const s = v.toFixed(d2); return +s === 0 ? (0).toFixed(d2) : s }
    const nv = +fmt(+t + dir * step), key = keyOf(w, j), lim = bounds.get(key) || {}
    const hard = w.kind == 'rgb' ? [0, 255] : []
    if ((lim.hi != null && nv > lim.hi) || (lim.lo != null && nv < lim.lo) || (hard[1] != null && nv > hard[1]) || (hard[0] != null && nv < hard[0])) return
    const apply = s => { const x = ws[idx]; if (x) setOne(x, j, s) }
    probing = true
    try {
      const ok = host?.probe ? await host.probe(() => apply(fmt(nv)), () => apply(t)) : (apply(fmt(nv)), true)
      if (!ok) { const b = bounds.get(key) || {}; if (dir > 0) b.hi = +t; else b.lo = +t; bounds.set(key, b); host?.note?.(`${t} → ${fmt(nv)} 报错，${dir > 0 ? '上' : '下'}界定为 ${t}`) }
      await frames(1)
      const x = ws[idx]; if (x) { if (cur?.w !== x) { pinned = false; show(x) } else { const c = tw.querySelector('.cap'); if (c) capOf(c, x, j); const i = tw.querySelector('input[type=number]'); if (i) i.value = val(x.nums[0]) } }
    } finally { probing = false }
  }
  // 打开某个位置所在行的第一个部件并钉住（取源右键用）
  function openFirst(a, pt) {
    const s = ed.value, ls = s.lastIndexOf('\n', a - 1) + 1, le = (i => i < 0 ? s.length : i)(s.indexOf('\n', a))
    const w = ws.find(w => { if (w.kind == 'sw' || w.kind == 'btn') return false; const x = span(w)[0]; return x >= ls && x < le }); if (!w) return false
    anchor = pt || null; pinned = false; show(w); pinned = true; openedAt = performance.now(); return true
  }
  function init(editor, sizeOf, h = null) {
    ed = editor; canvasSize = sizeOf; host = h
    const inRects = (w, x, y) => { const [a, b] = span(w); for (const q of ed.range(a, b).getClientRects()) if (x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 1 && y <= q.bottom + 1) return true; return false }
    $.ev(ed.el, {
      mousemove() {
        const { clientX, clientY } = $.event
        const w = ws.find(w => inRects(w, clientX, clientY)), act = w && (w.kind == 'sw' || w.kind == 'btn')
        ed.el.style.cursor = act ? 'pointer' : ''   // 开关 / 按钮：只有那个词条是可点的
        if (pinned) return
        if (!w || act) { if (cur) later(); return }
        clearTimeout(hideT); if (cur?.w !== w) show(w)
      },
      click() {   // 点开关的 ?.{ 立即切换；点 btn_ 函数名执行（等一下，免得双击设断点时先跑一次）
        const e = $.event
        if (e.button || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || !getSelection().isCollapsed) return
        const w = ws.find(w => (w.kind == 'sw' || w.kind == 'btn') && inRects(w, e.clientX, e.clientY)); if (!w) return
        if (w.kind == 'sw') { if (e.detail == 1) setNums(w, [w.on ? 'off' : 'on']) }
        else { clearTimeout(btnT); if (e.detail == 1) btnT = setTimeout(() => host?.press?.(w.name), 260) }
      },
      dblclick() { clearTimeout(btnT) },
      mouseleave: later,
      scroll() { if (performance.now() - openedAt < 250) return; pinned = false; hide() },
      input() { if (!mine) { pinned = false; hide() } },
    })
    $.ev(ed.el, {   // 悬停在数字上滚轮：微调（不在数字上时照常滚动编辑器）
      wheel() {
        const e = $.event, dy = e.deltaY || e.deltaX   // Shift / Alt + 滚轮在 Chromium(Linux) 里常被换算成横向滚动：deltaY 为 0、deltaX 有值
        if (!dy) return
        const hit = numAt(e.clientX, e.clientY); if (!hit) return
        e.preventDefault(); if (probing) return   // 含 Ctrl：数字上不缩放页面
        wheelStep(hit[0], hit[1], dy < 0 ? 1 : -1, e)
      },
    }, { passive: false })
    $.ev(tw, { mouseenter() { clearTimeout(hideT) }, mouseleave: later })
    $.ev(window, { pointerdown() { const { target } = $.event; if (pinned && !tw.contains(target)) { pinned = false; hide() } } }, true)
    $.ev(window, { keydown() { if ($.event.key == 'Escape') { pinned = false; hide() } } })
  }
  const condOf = w => val(w.nums[1]).replace(/^\(isnt\s+([\s\S]*)\)$/, '$1'), colorOf = w => toHex(...rgbOf(w)), lineOf = w => ed.value.slice(0, w.nums[0].a).split('\n').length
  return { init, scan, geo, inside, detect, defaults, DEFAULT_SRC, openFirst, set: setNums, setColor: setRgb, colorOf, condOf, valOf, lineOf, snapshot, apply, get inferred() { return inferredNames.map(n => baseLines.get(n)).filter(Boolean) }, get mine() { return mine }, get decls() { return decls }, get widgets() { return ws }, get problems() { return problems } }
})()
