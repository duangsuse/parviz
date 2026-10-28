/* session.js — 单文档会话：文本 + 文件句柄 + 脏标记。打开/保存/切换都走这里，页面只装配。
   没有句柄时保存 = 下载一份 .lisp（非 Chromium 的回退）。多文档不在本版范围内（同一时刻只有一个编辑区）。 */
(function (G) {
'use strict'
function create({ ed, onOpen, status = () => { } }) {
  const S = { handle: null, name: '', base: '', dir: null }
  S.text = () => ed.value
  S.dirty = () => ed.value !== S.base
  S.set = (t, name, handle) => {
    ed.value = t; S.base = t; S.name = name || ''; S.handle = handle || null
    onOpen?.(t, S.name)
  }
  S.mark = () => { S.base = ed.value }
  S.confirm = () => !S.dirty() || G.confirm('当前文件有未保存的修改，继续会丢掉它们。')
  S.openText = (t, name, handle) => { if (!S.confirm()) return false; S.set(t, name, handle); return true }
  S.openFile = async h => {
    if (!S.confirm()) return false
    try { const f = await h.getFile(); S.set(await f.text(), f.name, h); return true }
    catch (e) { status('打开失败：' + e.message); return false }
  }
  S.save = async () => {
    if (!S.handle) return S.download()
    try {
      const w = await S.handle.createWritable()
      await w.write(S.text()); await w.close(); S.mark(); status('已保存 ' + S.name); return true
    } catch (e) { status('保存失败：' + e.message); return false }
  }
  S.download = () => {
    const blob = new Blob([S.text()], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = (S.name || 'sketch.lisp').replace(/\.[^.]*$/, '') + '.lisp'
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    status('已下载 ' + a.download); return false
  }
  return S
}
G.Session = { create }
if (typeof module != 'undefined') module.exports = G.Session
})(typeof globalThis != 'undefined' ? globalThis : window)
