/* pick.js — 取源：画布上的一个点 → 画出它的那次 Lisp 调用（名字 + 源码跨度）。
   主路径是 IDEA.md 的“亮点”：在帧起点（p.draw 里、用户第一笔绘制之前）把那个像素涂成随机色；之后每个会写画布的
   ctx 方法返回时读回像素——颜色变了就说明“刚才这个调用盖住了它”，记下栈顶的 Lisp 调用并重新撒点，
   于是最后一个盖住它的调用就是屏幕上看到的那一笔。只在被请求的那一帧里装钩子、读像素，帧末还原像素，不改动草图的状态。
   兜底：声明了 (tweak …) 几何的调用另记一份 bbox（background / clear 视为整张画布）；没有 tick 的草图（只画一次）只能走这条路，
   所以 setup 期间就一直记，之后不再改动。
   依赖 lisp.js（L.cx 取当前调用栈）与 tweak.js（Tweak.geo / Tweak.inside）。 */
'use strict'
const Pick = (() => {
  const { isT } = P, L = LISP
  // 调用头的名字：f … / p.f … / o.f（键）
  const headName = x => !isT(x) ? null : x[0] == '$' || x[0] == '$$' ? x[1] : x[0] == '.' && isT(x[2]) && x[2][0] == '' ? x[2][1] : null
  const ALL = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }
  const DIRTY = ['fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'putImageData', 'fillText', 'strokeText']
  let sink = null                         // 当前记录调用的数组（null = 不记）
  const px = { g: null, saved: null, d: 1, x: 0, y: 0, mark: null, by: null, under: null, planting: false }

  // hooks.ext：Lisp 调用到 JS 之后触发；只有声明了几何的名字才记，逐帧数组保持很小
  function call({ f, x, a, b, args }) {
    if (!sink || sink.length > 2000) return
    const name = headName(x?.[1]) || f?.bname || f?.name; if (!name) return
    const g = name == 'background' || name == 'clear' ? ALL : Tweak.geo(name, args)
    if (g) sink.push({ name, a, b, g })
  }
  const byBox = (list, x, y) => { for (let i = (list?.length || 0) - 1; i >= 0; i--) if (Tweak.inside(list[i].g, x, y)) return list[i]; return null }

  // 亮点落在整数设备像素上：上下文被 pixelDensity 缩放过，先在设备坐标里算 X/Y，撒点时临时把变换置成单位阵
  const dev = () => { const g = px.g; return { X: Math.max(0, Math.min(g.canvas.width - 1, Math.floor(px.x * px.d))), Y: Math.max(0, Math.min(g.canvas.height - 1, Math.floor(px.y * px.d))) } }
  function plant() {
    const g = px.g; if (!g || px.planting) return
    const c = [1 + ((Math.random() * 254) | 0), 1 + ((Math.random() * 254) | 0), 1 + ((Math.random() * 254) | 0)]
    px.mark = c
    const { X, Y } = dev()
    px.planting = true   // 撒点自己的 fillRect 不能再触发 after（否则递归）
    try { g.save(); g.setTransform?.(1, 0, 0, 1, 0, 0); g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(X, Y, 1, 1) } finally { g.restore(); px.planting = false }
  }
  function after() {
    const g = px.g, m = px.mark; if (!g || !m || px.planting) return
    const { X, Y } = dev()
    let q; try { q = g.getImageData(X, Y, 1, 1).data } catch { return }
    if (q[0] === m[0] && q[1] === m[1] && q[2] === m[2] && q[3] === 255) return
    const fr = L.cx?.stack.at(-1)
    if (fr) px.by = { name: headName(fr.x?.[1]) || fr.f?.bname || fr.f?.name, a: fr.a, b: fr.b }
    px.under = [q[0], q[1], q[2], q[3]]   // 这个像素真实的内容（重新撒点会盖住它，帧末要还回去）
    plant()
  }

  // 请求的那一帧：p.draw 在用户代码之前调 begin，之后调 end
  function begin(p, x, y, hooks) {
    const g = p.drawingContext; if (!g) return false
    px.g = g; px.d = p.pixelDensity ? p.pixelDensity() : 1; px.x = x; px.y = y; px.by = null; px.under = null; px.saved = {}
    for (const k of DIRTY) { const o = g[k]; if (typeof o != 'function') continue; px.saved[k] = o; g[k] = function (...a) { const r = o.apply(this, a); after(); return r } }
    try { const { X, Y } = dev(); px.under = Array.from(g.getImageData(X, Y, 1, 1).data) } catch { px.under = null }
    sink = []; hooks.ext = call; plant()
    return true
  }
  // 返回 { by, calls }：by 是像素读回得到的归属（可能为 null），calls 是本帧记下的几何调用
  function end(hooks) {
    const g = px.g, calls = sink || []; sink = null; hooks.ext = null
    if (g) {
      for (const k in px.saved) g[k] = px.saved[k]
      try {   // 标记还在 = 之后没有调用盖住它：把像素还成真实内容
        const { X, Y } = dev(), q = g.getImageData(X, Y, 1, 1).data, m = px.mark
        if (m && q[0] === m[0] && q[1] === m[1] && q[2] === m[2] && px.under) g.putImageData(new ImageData(new Uint8ClampedArray(px.under), 1, 1), X, Y)
      } catch { }
    }
    const by = px.by; px.g = null; px.saved = null; px.mark = null; px.by = null; px.under = null
    return { by, calls }
  }
  // setup 期间一直记（没有 tick 的草图只画这一次）；用 sink 指向 run 自己的数组
  const record = (hooks, list) => { sink = list; hooks.ext = list ? call : null }
  return { headName, begin, end, record, byBox }
})()
