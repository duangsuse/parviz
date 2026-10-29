/* session.js — 单文档会话：文本 + 文件句柄 + 脏标记。打开/保存/切换/改名都走这里，页面只装配。
   保存总是覆盖同名文件：没有句柄时，已打开目录 → 在目录里按名字 getFileHandle(create)（同名即覆盖）；
   没有目录 → showSaveFilePicker 选一次，之后记住句柄；只有两者都不可用（非 Chromium）才下载。
   onName(name)：名字变了（打开 / 改名 / 示例）；S.onCreate()：在目录里新建了文件（目录树要刷新，Explorer 挂上）。 */
(function (G) {
'use strict'
function create({ ed, onOpen, onName, status = () => { } }) {
  const S = { handle: null, name: '', base: '', dir: null }
  S.text = () => ed.value
  S.dirty = () => ed.value !== S.base
  S.set = (t, name, handle) => {
    ed.value = t; S.base = t; S.name = name || ''; S.handle = handle || null
    onName?.(S.name); onOpen?.(t, S.name)
  }
  S.mark = () => { S.base = ed.value }
  S.detach = () => { S.handle = null; S.name = ''; S.base = ed.value; onName?.('') }   // 编辑区内容改成程序给的(示例):不再对应已打开的文件,Ctrl+S 不会覆盖它,也不算“未保存修改”
  S.confirm = () => !S.dirty() || G.confirm('当前文件有未保存的修改，继续会丢掉它们。')
  S.openText = (t, name, handle) => { if (!S.confirm()) return false; S.set(t, name, handle); return true }
  S.openFile = async h => {
    if (!S.confirm()) return false
    try { const f = await h.getFile(); S.set(await f.text(), f.name, h); return true }
    catch (e) { status('打开失败：' + e.message); return false }
  }
  const ensureRW = async h => { if ((await h.queryPermission?.({ mode: 'readwrite' })) != 'granted') await h.requestPermission?.({ mode: 'readwrite' }) }
  const withExt = n => /\.[^./]+$/.test(n) ? n : n + '.lisp'
  // 没有句柄时给这个名字找一个可写的句柄；都做不到返回 null
  const handleFor = async name => {
    if (S.dir) { await ensureRW(S.dir); const had = await S.dir.getFileHandle(name).then(() => true, () => false); const h = await S.dir.getFileHandle(name, { create: true }); if (!had) S.onCreate?.(); return h }
    if (G.showSaveFilePicker) { try { return await G.showSaveFilePicker({ suggestedName: name }) } catch (e) { if (e.name == 'AbortError') throw e; return null } }
    return null
  }
  S.rename = async n => {
    n = withExt(String(n).trim()); if (n == '.lisp' || n == S.name) return false
    if (S.handle?.move) { try { await S.handle.move(n) } catch { S.handle = null } } else S.handle = null   // 不能原地改名：下次保存按新名字写（旧文件不动）
    S.name = n; onName?.(n); status('已改名 ' + n); return true
  }
  S.save = async () => {
    try {
      if (!S.handle) {
        const h = await handleFor(S.name || 'sketch.lisp')
        if (!h) return S.download()
        S.handle = h; if (!S.name) { S.name = h.name; onName?.(S.name) }
      }
      await ensureRW(S.handle)
      const w = await S.handle.createWritable()
      await w.write(S.text()); await w.close(); S.mark(); status('已保存 ' + S.name); return true
    } catch (e) { if (e.name != 'AbortError') status('保存失败：' + e.message); return false }
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
