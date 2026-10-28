/* xref.js — 引用热区（index.html / p5.html 共用）：悬停画箭头、点引用跳定义、点声明反查全部引用。
   纯逻辑 + 注入：{ ed, ssOf, sloc, status }；sloc 只要 ref/rev 两个字段和 draw()（页面自己实现连线）。
   deepest/declAt/usesOf 也从这里导出，两个页面用同一份。 */
(function (G) {
'use strict'
const { walk } = G.P
// 最深且满足 ok 的节点（点击/悬停位置 → CST 节点）
const deepest = (root, i, ok = () => true) => {
  let best = null
  walk(root, n => { if (n.a <= i && i < Math.max(n.b, n.a + 1)) { if (ok(n)) best = n; return } return false })
  return best
}
const declAt = (ss, i) => { let d = null; walk(ss.tree, n => { for (const x of n.defs || []) if (x.node && i >= x.node.a && i < x.node.b) d = x }); return d }
const usesOf = (ss, tok) => { const u = []; walk(ss.tree, n => { if (n.def === tok && n !== tok) u.push(n) }); return u }

function wire({ ed, ssOf, sloc, status }) {
  let refHot = null, saved = ''
  const at = e => { const ss = ssOf(); if (!ss?.tree || ss.src !== ed.value) return null; const i = ed.offsetAt(e.clientX, e.clientY); return i < 0 ? null : { ss, i } }
  $.ev(ed.el, {
    mousemove() {
      const a = at($.event), u = a && deepest(a.ss.tree, a.i, n => n.def), d = u?.def || null
      if (d === refHot) return
      refHot = d; sloc.ref = d ? { ed, d, u } : null
      if (d) { if (!saved) saved = $('#status').textContent; status(`定义于 ${a.ss.sloc(d)} · 点击跳到`) }
      else { status(saved); saved = '' }
      sloc.draw()
    },
    mouseleave() { if (!refHot) return; refHot = null; sloc.ref = null; status(saved); saved = ''; sloc.draw() },
    click() {   // 点引用：跳到定义；点声明：箭头反查全部引用
      const a = at($.event); if (!a) return
      const { ss, i } = a, u = deepest(ss.tree, i, n => n.def)
      if (u) { ed.setSel(u.def.a, u.def.b); ed.scrollTo(u.def.a); status(`定义于 ${ss.sloc(u.def)}，共 ${usesOf(ss, u.def).length} 处引用`); sloc.draw(); return }
      const d = declAt(ss, i); if (!d) { if (sloc.rev) { sloc.rev = null; sloc.draw() } return }
      const on = sloc.rev?.decl === d.node
      sloc.rev = on ? null : { ed, decl: d.node, uses: usesOf(ss, d.node) }
      status(on ? '' : `${d.name}：${sloc.rev.uses.length} 处引用`)
      sloc.draw()
    },
  })
}
G.Xref = { wire, deepest, declAt, usesOf }
if (typeof module != 'undefined') module.exports = G.Xref
})(typeof globalThis != 'undefined' ? globalThis : window)
