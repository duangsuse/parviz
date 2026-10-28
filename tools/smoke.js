#!/usr/bin/env node
/* tools/smoke.js — 冒烟：跑全部示例（含 extra.js），再检查 Lisp 的几条语法语义与 @skip some。
   用法：node tools/smoke.js    有失败则退出码 1。 */
const fs = require('fs'), assert = require('assert')
const P = require('../parse.js'), L = require('../lisp.js')
const x = eval(fs.readFileSync(__dirname + '/../extra.js', 'utf8'))(P); Object.assign(P.funcs, x.funcs)
const all = [...P.examples, ...x.examples]
for (const e of all) {
  const rules = e.rules ?? all.find(q => q.name == e.same)?.rules; if (!rules) continue
  const g = P.grammar(rules), ss = P.feed(e.input); P.eat(g, ss)
  const w = g.walk && P.walkers[g.walk], r = w && P.isT(ss.value) ? w.run(ss.value) : null
  console.log(e.name.padEnd(22), 'errs', ss.errs.length, r ? (r.err ?? w.show(r.value)) : '')
}
const g = P.grammar(L.RULES)
const lisp = src => { const ss = P.feed(src); P.eat(g, ss); const r = L.run(ss.value); return { errs: ss.errs.map(e => e.msg), out: r.log.filter(l => l.out != null).map(l => l.out), err: r.err, ss } }
const same = (src, out) => { const r = lisp(src); assert.deepStrictEqual([r.errs, r.err, r.out], [[], undefined, out], src) }
same('(- x 2)\n(- y 1)\n(w@ (> 2x + 3y - 7) (> 2x + 3y - 3) (+ 5 - 3 * 2) (reduce [1 2 3] + 0))', ['false true -1 6'])   // 中缀、减法=加负数
same('(w@ {}.[-> {a 9}] (-> {a 1 b 2} {b 3}))', ['{a 9} {a 1 b 3}'])                                    // any + 对象字面量：返回合并的新对象
same('(-> u {a 1})\n(-> u {b 2})\n(w@ u)', ['{a 1 b 2}'])                                                       // 名字 + 对象字面量：部分赋值，无则初始化
assert.deepStrictEqual(lisp('(- c 1)\n[-> c 2]').errs, ['c 由 - 定义，不能用 -> 改变'])                           // - 定义不可 ->
same('def d(b x y) (list b x y)\ndef a(c):\n  c.d 5 6\n...\n(w@ (a {k 1}))', ['[{k 1} 5 6]'])                  // c.d e f 即 c.(d e f)
same('def s(p q) (list p q)\ndef t(r):\n  s 1 2\n...\n(w@ (t 0))', ['[1 2]'])                                    // a b 即 (a b)
// "$"/"$$"：局部绑定是 $，内建 / 运行期全局是 $$
const tags = new Set; (function f(v) { if (P.isT(v)) { tags.add(v[0]); v.slice(1).forEach(f) } })(lisp('(- f 1)\n(w@ f (+ f 1))').ss.value)
assert(tags.has('$') && tags.has('$$'))
// @skip some：无色状态自动跳空白，有色规则内部不跳
const some = P.grammar(`@skip some\n@color Str=Y\nDoc (Item *)\nItem (Str Word <)\nStr ("'" /[^']*/ "'")\nWord /\\w+/`)
const s2 = P.feed("  'a'   'x  y'  w1 ", 'f'); P.eat(some, s2); assert.deepStrictEqual(s2.value, ['a', 'x  y', 'w1'])
const s3 = P.feed("' a '"); P.eat(some, s3); assert.deepStrictEqual(s3.value, [' a '])
console.log('smoke ok')
// ; 分隔语句、# 与 #@ @# 注释
same('def d(b x y) (list b x y)\ndef a(c): c.d 5 6 ...\ndef s(p q) (list p q)\ndef t(r): s 1 2; (OK (a r)) ...\n(w@ (t {k 1})); (w@ 2) # c\n#@ 多行\n(w@ 99) @#\n(w@ 3)', ['[{k 1} 5 6]', '2', '3'])
const two = lisp('def s(p) p\n(- c {d s})\ns 1; c.d 2'); assert.deepStrictEqual(two.ss.value.slice(1).map(x => x[0]), ['=', '=', '()', '.'])
console.log('smoke ok (;/#)')
