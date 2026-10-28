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
same('(- x 2)\n(- y 1)\n(w@ (> 2x + 3y - 7) (> 2x + 3y > 3) (> 5 - 3 * 2) [> x <= y] (> 1 + 2 < 4 == true) (> x) (reduce [1 2 3] + 0))', ['0 true -1 false true 2 6'])   // (> …) 是唯一的中缀：多项式 / 比较 / 单项；[> …] 同；减法=加负数；优先级 比较 < +- < */%
for (const bad of ['(> 1 2)', '(> + 1)', '(> 1 +)', '(>)']) assert.deepStrictEqual(lisp(bad).errs, ['(> …) 里应是“项 运算符 项 …”交替，运算符是 + - * / % < <= > >= == !='], bad)   // 项 运算符 项 交替，否则报错
assert.notStrictEqual(lisp('(w@ (+ 1 + 2))').out[0], '3', '别的头里没有中缀')
same('(w@ {}.[-> {a 9}] (-> {a 1 b 2} {b 3}))', ['{a 9} {a 1 b 3}'])                                    // any + 对象字面量：合并
same('(- s {a 1 b 2})\n(- t s.[-> {b 3}])\ns.[-> "c" 4]\n(w@ s (== s t))', ['{a 1 b 3 c 4} true'])           // o.[-> …] 原地合并并返回 o（状态对象）
same('(w@ #66ccff ./a/b.wtf ../x (list #abc #12345678) #bad)\n#xyz 这是注释 (boom\n# #fff 也是注释', ['#66ccff ./a/b.wtf ../x ["#abc" "#12345678"] #bad'])   // 十六进制颜色 / 路径是字面量（#bad 也是）；其余 # 仍是注释
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
// ---- 脱离调试器独立运行：JS 互操作 / 自动 await / 回调 / 断点暂停 / 取消 ----
const gh = P.grammar(L.RULES), base = gh.builtins
const jsHost = (extra = {}) => { const h = Object.assign(L.hostOf(globalThis), { last: true }, extra); gh.builtins = { has: n => base.has(n) || h.has(n) }; L.host = h; return h }
const exec = async src => { const ss = P.feed(src); P.eat(gh, ss); assert.deepStrictEqual(ss.errs.map(e => e.msg), [], src); const log = []; const r = await L.start(ss.value, { push: i => log.push(i.out ?? 'warn:' + i.warn) }); return { ...r, log } }
;(async () => {
  jsHost()
  const saved = console.log, seen = []; console.log = (...a) => seen.push(a)
  let r = await exec('[console.log "hi" 123 (=>() 456)]'); console.log = saved
  assert.deepStrictEqual(seen[0].slice(0, 2), ['hi', 123]); assert.strictEqual(typeof seen[0][2], 'function'); assert.strictEqual(seen[0][2](), 456)   // Lisp 函数 → JS 回调；回调的 NO/值互转
  r = await exec('(- v (Promise.resolve 42))\n(w@ v (wait 5) "after")')
  assert.deepStrictEqual(r.log, ['42 NO after'])                                                   // Promise 自动 await；undefined → NO
  r = await exec('[setTimeout (=>() [w@ "later"]) 5]\n[wait 30]\n(w@ "end")')
  assert.deepStrictEqual(r.log, ['later', 'end'])                                                  // JS 回调进 Lisp（共用 log）
  r = await exec('(w@ (Promise.reject "boom"))'); assert.strictEqual(r.err, 'boom'); assert(r.x)   // rejected → 报错并指到调用节点
  r = await exec('(- o {a 1})\n o.[-> {b 2}]\n(w@ o (Math.max 1 5 3) (new Date 0).getTime)')
  assert.match(r.log[0], /^\{a 1 b 2\} 5 <builtin/)                                                // o.[-> …] 原地合并；Math.max；key 取出的方法绑定 this
  r = await exec('def f(a):\n  (- b 1)\n  (+ a b)\n...\n(w@ (f 3))'); assert.deepStrictEqual(r.log, ['4'])   // host.last：多语句函数取最后一句，不要求 OK
  // 断点：pause 返回 Promise 就挂起到它兑现；alive 为 false 即放弃
  let hits = 0
  jsHost({ pause: e => e.ph == 'ret' && e.f?.name == 'sq' ? new Promise(r => setTimeout(() => { hits++; r() }, 10)) : undefined })
  r = await exec('def sq(x) (* x x)\n(w@ (sq 3) (sq 4))'); assert.deepStrictEqual([r.log, hits], [['9 16'], 2])
  let alive = true; jsHost({ alive: () => alive }); setTimeout(() => { alive = false }, 5)
  r = await exec('[wait 20]\n(w@ "no")'); assert.strictEqual(r.cancelled, true); assert.deepStrictEqual(r.log, [])
  // 不装宿主时仍是封闭的：console 不是内建，解析期就报未定义
  L.host = null; const s0 = P.feed('[console.log 1]'); P.eat(g, s0); assert.deepStrictEqual(s0.errs.map(e => e.msg), ['未定义 console'])
  console.log('smoke ok (host/await)')
})().catch(e => { console.error(e); process.exit(1) })
