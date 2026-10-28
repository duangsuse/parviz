/* sloc.js — 源码跨度 ↔ DOM 的角标与连线（index.html / p5.html 共用）。
   三个纯函数，不读全局状态：
     label(host, text, rect, cls, handlers)  #mks 里放一个 fixed 角标（$5 / E1 / …），返回元素
     path(svg, a, b, cls, ref)               画一条贝塞尔；cls 'ar' 时带箭头（箭头扎进 a 那条边），ref 用于同编辑区内的引用
     textEnd(el)                             文字右端的零宽矩形（行内连线从右侧引出）
   rect 都是 getBoundingClientRect() 形状；svg 是 #ov 里的 <g>。 */
(function (G) {
'use strict'
const NS = 'http://www.w3.org/2000/svg'
const label = (host, text, r, cls, on) => {
  const m = document.createElement('div')
  m.className = 'mk ' + (cls || ''); m.textContent = text
  m.style.left = r.left + 'px'; m.style.top = r.top + 'px'
  if (on) Object.assign(m, on)
  host.append(m); return m
}
// a、b 连线：两端各落在朝向对方的边上；cls 'ar' 时箭头扎进 a 那条边；ref：同编辑区内的引用箭头
const path = (svg, a, b, cls, ref) => {
  const mid = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  const edge = (r, dx, dy) => {   // r 上朝 (dx,dy) 的边：点 + 外法线（竖直方向略占优）
    if (Math.abs(dy) > Math.abs(dx) * .5) return { p: { x: r.left + Math.min(r.width, 30) / 2, y: dy > 0 ? r.bottom : r.top }, n: { x: 0, y: dy > 0 ? 1 : -1 } }
    return { p: { x: dx > 0 ? r.right : r.left, y: r.top + r.height / 2 }, n: { x: dx > 0 ? 1 : -1, y: 0 } }
  }
  const ac = mid(a), bc = mid(b)
  const A = edge(a, bc.x - ac.x, bc.y - ac.y), B = edge(b, ac.x - bc.x, ac.y - bc.y)   // A = 箭头那端
  // 跨面板：按距离外推 12–60px；同一编辑区内的引用（ref）：控制点只取纵向间距的一半，不跨出两行之外
  const d = ref ? Math.abs(ac.y - bc.y) / 2 : Math.min(140, Math.max(12, Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y) / 2.5))
  const c1 = { x: B.p.x + B.n.x * d, y: B.p.y + B.n.y * d }, c2 = { x: A.p.x + A.n.x * d, y: A.p.y + A.n.y * d }
  const ar = cls == 'ar', L = 12, W = 11
  const tip = A.p, base = { x: tip.x + A.n.x * L, y: tip.y + A.n.y * L }   // 三角底在 a 外面，尖端扎进边里
  const q = { x: -A.n.y * W / 2, y: A.n.x * W / 2 }
  const flat = ar && Math.abs(ac.y - bc.y) < Math.max(a.height || 16, b.height || 16) * .5   // 同一行：横线会压着代码，只留箭头
  if (!flat) {
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', `M${B.p.x},${B.p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${(ar ? base : tip).x},${(ar ? base : tip).y}`)
    if (cls) p.setAttribute('class', cls)
    svg.append(p)
  }
  if (ar) {
    const hd = document.createElementNS(NS, 'path')
    hd.setAttribute('d', `M${tip.x},${tip.y} L${base.x + q.x},${base.y + q.y} L${base.x - q.x},${base.y - q.y}Z`)
    hd.setAttribute('class', 'ah')
    svg.append(hd)
  }
}
// 文字右端的零宽矩形：连线从右侧引出
const textEnd = el => {
  const rg = document.createRange(); rg.selectNodeContents(el)
  const rs = rg.getClientRects(), q = rs[rs.length - 1]
  return q ? { left: q.right, right: q.right, top: q.top, bottom: q.bottom, width: 0, height: q.height } : el.getBoundingClientRect()
}
G.SL = { label, path, textEnd }
if (typeof module != 'undefined') module.exports = G.SL
})(typeof globalThis != 'undefined' ? globalThis : window)
