/* console.js — 控制台条目模型 + 渲染（index.html / p5.html 共用）。
   条目：{ cls, text, lead?, note?, span?:{a,b}, html?, title? }
     cls   行类名：log / warn / eitem / pause / val / cm / info / error…
     lead  行首加粗（调试器的 $4）
     note  行尾灰字（"// 12ms · 0 个错误"）
     （hooks.enter(el)：悬停任意一行时回调，p5 页用它按需检测颜色 / 坐标）
     span  源码区间：点击 → hooks.open(span)，悬停 → hooks.hover(span, el)，离开 → hooks.leave(span, el)
     html  直接写 innerHTML（p5 的 html 函数/echo），其余一律 textContent
   push 追加（p5 的实时输出，超过 limit 丢最旧）；set 整块替换（调试器每次重绘）；clear 清空。 */
(function (G) {
'use strict'
const mk = (cls, kids) => { const e = document.createElement('div'); e.className = cls; for (const k of kids) if (k != null) e.append(k); return e }
const tx = (tag, cls, s) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = s; return e }
const spanOf = s => s && typeof s == 'object' && s.a != null ? { a: s.a, b: s.b ?? s.a } : null

function mount(host, hooks = {}) {
  const limit = hooks.limit || 400
  const row = it => {
    let e
    if (it.html != null) { e = mk(it.cls || 'log', []); e.innerHTML = it.html }
    else e = mk(it.cls || 'log', [it.lead ? tx('b', null, it.lead) : null, it.text != null ? String(it.text) : null, it.note ? tx('span', 'cm', it.note) : null])
    if (it.title) e.title = it.title
    if (hooks.enter) e.addEventListener('mouseenter', () => hooks.enter(e))   // 任何行（不要求有 span）：悬停才检测内容
    const sp = spanOf(it.span)
    if (sp) {
      e.dataset.a = sp.a; e.dataset.b = sp.b
      if (hooks.open) e.onclick = () => hooks.open(sp, e)
      if (hooks.hover) {
        e.onmouseenter = () => hooks.hover(sp, e)
        e.onmouseleave = () => hooks.leave?.(sp, e)
      }
    }
    return e
  }
  const trim = () => { while (host.childElementCount > limit) host.firstChild.remove() }
  const toEnd = () => { host.scrollTop = host.scrollHeight }
  return {
    push(it) { host.append(row(it)); trim(); toEnd() },
    // 整块替换：停在顶部（先看第一条错误）
    set(items) { host.textContent = ''; for (const it of items) host.append(row(it)); trim() },
    clear() { host.textContent = '' },
  }
}
G.Console = { mount }
if (typeof module != 'undefined') module.exports = G.Console
})(typeof globalThis != 'undefined' ? globalThis : window)
