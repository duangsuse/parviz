/* explorer.js — 左侧的目录树（Ctrl+E；index.html / p5.html 共用，面板 DOM 自己建，样式见 ui/explorer.css）。
   API：Explorer.mount({ session, status, host? }) → { toggle, save, close, dir }；session = ui/session.js 的 Session.create(...)。Chrome 上用 File System Access 句柄打开目录、读写文件；
   没有 showDirectoryPicker 时退回 <input type=file>（只读打开）+ 下载保存。目录逐层加载，点目录展开。 */
(function (G) {
'use strict'
const OK = /\.(lisp|txt|md|js|json|css|html?)$/i

function mount({ session, status, host = document.body }) {
  const panel = document.createElement('aside'), list = document.createElement('div'), title = document.createElement('b'), close = document.createElement('button')
  panel.className = 'exp'; panel.hidden = true; list.className = 'exlist'; title.textContent = '目录'; close.textContent = '×'; close.title = '关闭（Ctrl+E）'
  const hd = document.createElement('div'); hd.className = 'hd'; hd.append(title, close); panel.append(hd, list); host.append(panel)
  const place = () => { panel.style.top = (document.querySelector('header')?.offsetHeight ?? 36) + 'px' }   // 顶栏高度因页面而异
  const showPanel = () => { place(); panel.hidden = false }
  let dir = null, input = null

  function entryRow(host, e, depth) {
    const wrap = document.createElement('div')   // 每个条目一个容器：子目录的内容放在它自己的容器里，不会混进上层
    const r = document.createElement('div')
    wrap.append(r); host.append(wrap)
    r.className = e.kind == 'directory' ? 'dir' : ''
    r.textContent = (e.kind == 'directory' ? '▸ ' : '') + e.name
    r.title = e.name; r.style.paddingLeft = 8 + depth * 12 + 'px'
    if (e.kind == 'directory') {
      const kids = document.createElement('div'); kids.hidden = true; wrap.append(kids)
      let open = false
      r.onclick = async () => {
        open = !open; r.textContent = (open ? '▾ ' : '▸ ') + e.name; kids.hidden = !open
        if (open && !kids.childElementCount) await listDir(kids, e, depth + 1)
      }
    } else {
      r.onclick = async () => {
        if (!(await session.openFile(e))) return
        for (const x of list.querySelectorAll('.cur')) x.classList.remove('cur')
        r.classList.add('cur'); title.textContent = (dir ? dir.name + '/' : '') + e.name
      }
    }
  }
  async function listDir(host, h, depth) {
    let any = false
    for await (const e of h.values()) {
      if (e.name.startsWith('.')) continue
      if (e.kind == 'file' && !OK.test(e.name)) continue
      any = true; entryRow(host, e, depth)
    }
    if (!any && depth == 0) { const d = document.createElement('div'); d.className = 'dir'; d.textContent = '（没有可打开的文件）'; host.append(d) }
  }
  async function pickDir() {
    if (!G.showDirectoryPicker) return pickFile()
    try { dir = await G.showDirectoryPicker({ mode: 'readwrite' }) } catch (e) { if (e.name != 'AbortError') status('打开文件夹失败：' + e.message); return }
    session.dir = dir; title.textContent = dir.name; list.textContent = ''
    await listDir(list, dir, 0); showPanel()
  }
  function pickFile() {
    if (!input) {
      input = document.createElement('input'); input.type = 'file'; input.accept = '.lisp,.txt,.md,.js,.json,.css,.html'
      input.onchange = async () => {
        const f = input.files[0]; if (!f) return
        if (session.openText(await f.text(), f.name, null)) { title.textContent = f.name; showPanel() }
      }
    }
    input.click()
  }
  async function toggle() {
    if (!panel.hidden) { panel.hidden = true; return }
    if (!dir) return pickDir()
    showPanel(); list.textContent = ''; await listDir(list, dir, 0)
  }
  close.onclick = () => panel.hidden = true
  session.onCreate = () => { if (dir && !panel.hidden) { list.textContent = ''; listDir(list, dir, 0) } }   // 保存时在目录里新建了文件
  return { toggle, save: () => session.save(), close: () => panel.hidden = true, get dir() { return dir } }
}
G.Explorer = { mount }
if (typeof module != 'undefined') module.exports = G.Explorer
})(typeof globalThis != 'undefined' ? globalThis : window)
