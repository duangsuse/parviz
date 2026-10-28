/* tree.js — Doc → DOM（Mithril，m.render 同步；渲染完就能量几何）。只认 doc.js 的扁平数组：
   节点表 + 折叠键（按源码范围的字符串，跨重解析稳定）。事件由容器级委托处理（见 ui/app.js hookTree）。 */
(function (G) {
'use strict'
const m = G.m, D = G.Doc, K = D.K, F = D.F

function render(host, doc, o = {}) {
  const folds = o.folds || new Set, unfold = o.unfold || new Set
  const s = i => doc.str[i] || ''
  const folded = (id, par) => { const k = s(doc.key[id]); return !!k && (par ? !unfold.has(k) : folds.has(k)) }
  const kids = id => { const r = []; for (let c = doc.first[id]; c >= 0; c = doc.next[c]) r.push(nd(c)); return r }
  const nd = id => {
    const k = doc.kind[id], text = s(doc.text[id]), title = s(doc.title[id])
    const at = { key: id, 'data-id': id }
    if (title) at.title = title
    if (k == K.TOK) {
      const c = s(doc.color[id])
      return m('span', { ...at, class: 'nd' + (c ? ' ' + c : '') + (doc.flags[id] & F.ERR ? ' err' : '') }, text)
    }
    if (k == K.ERR) return m('span', { ...at, class: 'nd R err' }, text || '😡😡😡')
    if (k == K.MORE) return m('span', { ...at, class: 'more' }, '…')
    if (k == K.PAR) {
      const f = folded(id, true), pos = (p, t) => p >= 0 ? m('span', { 'data-pos': p }, t) : m('span', null, t)
      return m('span', { ...at, class: 'par' + (f ? ' fold' : ''), 'data-k': s(doc.key[id]) }, [
        m('span', { class: 'br' }, '['), m('span', { class: 'tag' }, ':par'),
        m('span', { class: 'pv' }, [pos(doc.pa[id], text), pos(doc.pb[id], s(doc.sub[id]))]),
        m('span', { class: 'br' }, ']')])
    }
    if (k == K.BOX) {
      const tag = s(doc.tag[id]), c = s(doc.color[id]), rule = s(doc.rule[id])
      const f = folded(id, false), anon = doc.flags[id] & F.ANON
      const ta = { class: 'tag' + (anon ? ' anon' : '') + (c ? ' ' + c : '') }
      if (rule) ta['data-rule'] = rule
      return m('span', { ...at, class: 'nd box' + (doc.flags[id] & F.BLK ? ' blk' : '') + (f ? ' fold' : ''), 'data-k': s(doc.key[id]) }, [
        m('span', { class: 'br' }, '['), m('span', ta, tag), m('span', { class: 'kids' }, kids(id)), m('span', { class: 'br' }, ']')])
    }
    return m('span', at, kids(id))   // ROOT（只在展示子树时出现）
  }
  const list = [], root = o.root ?? doc.root
  if (o.root != null) list.push(nd(o.root))   // 缩放：从被点的节点本身开始
  else for (let c = doc.first[root]; c >= 0; c = doc.next[c]) { list.push(nd(c)); if (doc.br) list.push(m('br', { key: 'br' + c })) }   // br 的 key 用子节点 id，不能重复
  m.render(host, m('div', { class: 'tree' }, doc.header ? [m('div', { class: 'gh', key: 'hd' }, doc.header), ...list] : list))
  return host.firstChild
}
G.Tree = { render }
if (typeof module != 'undefined') module.exports = G.Tree
})(typeof globalThis != 'undefined' ? globalThis : window)
