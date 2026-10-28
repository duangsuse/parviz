#!/usr/bin/env node
/* tools/smoke.js — 冒烟：跑全部示例（含 extra.js），再检查 Lisp 的几条语法语义与 @skip some。
   用法：node tools/smoke.js    有失败则退出码 1。 */
const fs = require('fs'), assert = require('assert')
const P = require('../parse.js'), L = require('../lisp.js')
const x = eval(fs.readFileSync(__dirname + '/../extra.js', 'utf8'))(P); Object.assign(P.funcs, x.funcs)
const all = [...P.examples, ...x.examples]
for (const e of all) {
  const rules = e.rules ?? all.find(q => q.name == e.same)?.rules
  if (!rules) throw new Error(`${e.name}: rules 为空且 same 指向的示例不存在`)   // 别静默少跑一个示例
  const g = P.grammar(rules), ss = P.feed(e.input); P.eat(g, ss)
  const w = g.walk && P.walkers[g.walk], r = w && P.isT(ss.value) ? w.run(ss.value) : null
  console.log(e.name.padEnd(22), 'errs', ss.errs.length, r ? (r.err ?? w.show(r.value)) : '')
}
// 显示层契约：三种 Doc 的结构不变量（换 CST 表示时先挂在这里）
{
  const Doc = require('../ui/doc.js')
  let docs = 0, bad = 0
  for (const e of all) {
    const rules = e.rules ?? all.find(q => q.name == e.same)?.rules; if (!rules) continue
    const g = P.grammar(rules), ss = P.feed(e.input); P.eat(g, ss)
    for (const d of [Doc.cst(ss, g), Doc.val(ss), Doc.gram(g)]) {
      docs++
      for (let i = 0; i < d.kind.length; i++) {
        if (i !== d.root && d.parent[i] < 0) bad++
        if (d.payload[i] >= d.objs.length) bad++
        if (d.a[i] >= 0 && d.b[i] < d.a[i]) bad++
        for (const p of [d.first[i], d.next[i], d.parent[i]]) if (p >= d.kind.length) bad++
      }
    }
  }
  assert.strictEqual(bad, 0, 'Doc 结构不变量'); console.log(`doc ok (${docs} docs)`)
}
const g = P.grammar(L.RULES)
const lisp = src => { const ss = P.feed(src); P.eat(g, ss); const r = L.run(ss.value); return { errs: ss.errs.map(e => e.msg), out: r.log.filter(l => l.out != null).map(l => l.out), err: r.err, ss } }
const same = (src, out) => { const r = lisp(src); assert.deepStrictEqual([r.errs, r.err, r.out], [[], undefined, out], src) }
same('(- x 2)\n(- y 1)\n(w@ (> 2x + 3y - 7) (> 2x + 3y > 3) (> 5 - 3 * 2) [> x <= y] (> 1 + 2 < 4 == true) (> x) (reduce [1 2 3] + 0))', ['0 true -1 false true 2 6'])   // (> …) 是唯一的中缀：多项式 / 比较 / 单项；[> …] 同；减法=加负数；优先级 比较 < +- < */%
for (const bad of ['(> 1 2)', '(> + 1)', '(> 1 +)', '(>)']) assert.deepStrictEqual(lisp(bad).errs, ['(> …) 里应是“项 运算符 项 …”交替，运算符是 + - * / % < <= > >= == !='], bad)   // 项 运算符 项 交替，否则报错
assert.notStrictEqual(lisp('(w@ (+ 1 + 2))').out[0], '3', '别的头里没有中缀')
same('(w@ {}..[-> {a 9}] (-> {a 1 b 2} {b 3}))', ['{a 9} {a 1 b 3}'])                                   // any + 对象字面量：合并
same('(- s {a 1 b 2})\n(- t s..[-> {b 3}])\ns..[-> "c" 4]\n(w@ s (== s t))', ['{a 1 b 3 c 4} true'])          // o..[-> …] 原地合并并返回 o（状态对象）
same('(w@ #66ccff ./a/b.wtf ../x (list #abc #12345678) #bad)\n#xyz 这是注释 (boom\n# #fff 也是注释', ['#66ccff ./a/b.wtf ../x ["#abc" "#12345678"] #bad'])   // 十六进制颜色 / 路径是字面量（#bad 也是）；其余 # 仍是注释
same('(-> u {a 1})\n(-> u {b 2})\n(w@ u)', ['{a 1 b 2}'])                                                       // 名字 + 对象字面量：部分赋值，无则初始化
assert.deepStrictEqual(lisp('(- c 1)\n[-> c 2]').errs, ['c 由 - 定义，不能用 -> 改变'])                           // - 定义不可 ->
same('def d(b x y) (list b x y)\ndef a(c):\n  c..(d 5 6)\n...\n(w@ (a {k 1}))', ['[{k 1} 5 6]'])                 // c..(d e f) 即 (d c e f)
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
same('def d(b x y) (list b x y)\ndef a(c): c..(d 5 6) ...\ndef s(p q) (list p q)\ndef t(r): s 1 2; (OK (a r)) ...\n(w@ (t {k 1})); (w@ 2) # c\n#@ 多行\n(w@ 99) @#\n(w@ 3)', ['[{k 1} 5 6]', '2', '3'])
const two = lisp('def s(p) p\n(- c {d s})\ns 1; c.d 2'); assert.deepStrictEqual(two.ss.value.slice(1).map(x => x[0]), ['=', '=', '()', '()'])   // c.d 2 是 (o.d 2)：取键再调用
// ---- 点号：o.[k a] 方法调用 / x..(f a) 管道 / ?.{ } / .{ } / 模板字符串 / 可选参数 ----
same('(- inc (=> (a) [len a]..[+ 1]))\n(w@ (inc [1 2 3]) (list 1 2)..(len) 5..(list 6))', ['4 2 [5 6]'])        // 管道；语句位置的基 [len a] 是调用，参数位置的 [..] 是数组
same('(- o {f len k 7})\n(w@ o.[f [1 2 3]] o.(f "ab") o.k)', ['3 2 7'])                                         // o.[k a] 即 [o.k a]：k 是键，不是名字
same('(- o {n 4})\n(w@ [1 2 3]?.{ (> u * 2) } o.n?.{ (> u + 1) } o.zz?.{ (> u + 1) } (map [1 2 3]).{ (> u * u) })', ['[2 4 6] 5 NO [1 4 9]'])   // ?.{ } 即 (As 值 (=> (u) …))；.{ } 追加回调
same('(- w "x")\n(w@ `a ${w} ${w}b${(+ 1 2)}` `l1\nl2` `\\$ \\u0041 e\\n`)', ['a x xb3 l1\nl2 $ A e\n'])      // 模板字符串：插值（段内空白保留）/ 多行 / 转义
same('def tg(s ..): (OK (list s (xargs))) ...\n(w@ tg`a${1}b${2}c` tg`z`)', ['[["a" "b" "c"] [1 2]] [["z"] []]'])   // tag`…` 即 (tag [段…] 值…)
same('def f(x ..):\n  [xargs {a_ 1 b_ (+ a_ 10)}]\n  (OK (list x a_ b_ (xargs)))\n...\n(w@ (f 0) (f 0 5) (f 0 NO 7) (f 0 5 6 9))', ['[0 1 11 []] [0 5 15 [5]] [0 1 7 [NO 7]] [0 5 6 [5 6 9]]'])   // 可选参数：按序、NO/缺省取默认值
assert.deepStrictEqual(lisp('def f(a ..): [xargs {b 1}] a ...').errs, ['可选参数名必须以 _ 结尾'])
assert.match(lisp('def g(a): [xargs {b_ 1}] (OK b_) ...\n(g 1)').err, /xargs/)                                  // 没有 .. 的参数表不能声明可选参数
// ---- (tweak …) 声明 / @stmt / Doc.stmts ----
assert.strictEqual(g.stmt, 'Stmt', '@stmt 指令')
{
  const s = P.feed('(tweak list (vec2 0 1) (size 2 3))\n[list 1 2 3 4]\n(w@ 1)'); P.eat(g, s)
  assert.deepStrictEqual(s.errs.map(e => e.msg), [])
  assert.strictEqual(s.value[1][0], 'tweak')
  assert.strictEqual(s.value[1][2][1][1], 'vec2')
  const r = L.run(s.value); assert.deepStrictEqual(r.log.filter(l => l.out != null).map(l => l.out), ['1'])   // 声明不进运行期求值
  const d = require('../ui/doc.js').cst(s, g)
  assert.strictEqual(d.stmts.length, 3)
  assert.strictEqual(s.src.slice(...d.stmts[1]), '[list 1 2 3 4]')
  const s2 = P.feed('def f(): (tweak rect (vec2 0 1)) ...\n(w@ 1)'); P.eat(g, s2)
  assert.deepStrictEqual(s2.errs.map(e => e.msg), ['(tweak …) 只能在顶层'])
  const gb = P.grammar('@stmt Nope\nStart "x"'); assert.deepStrictEqual(gb.errs.map(e => e.msg), ['@stmt Nope 没有定义'])
}
// ---- DBG：语句二分 / F11 边界 / 断点优先级 ----
{
  const D = require('../ui/debug.js')
  D.doc = [[0, 10], [10, 20], [20, 30]]
  assert.deepStrictEqual([D.stmtOf(5), D.stmtOf(10), D.stmtOf(29), D.stmtOf(30)], [0, 1, 2, -1])
  D.mode = 'line'; D.lastKey = null
  assert.strictEqual(D.hit({ a: 5, b: 9, ph: 'in' }), null)                 // 第一步只记下当前语句
  assert.strictEqual(D.hit({ a: 11, b: 19, ph: 'in' }), 'line')
  assert.strictEqual(D.hit({ a: 12, b: 19, ph: 'in' }), null)
  D.mode = 'run'; D.range(11, 19)
  assert.strictEqual(D.hit({ a: 11, b: 19, ph: 'in' }), 'bp')
  D.name('f')
  assert.strictEqual(D.hit({ ph: 'ret', f: { name: 'f' }, a: 99, b: 99 }), 'name')
  D.mode = 'frame'; D.frameNo = 3; D.target = 4
  assert.strictEqual(D.hit({ a: 99, b: 99, ph: 'in' }), null); D.frame()
  assert.strictEqual(D.hit({ a: 99, b: 99, ph: 'in' }), 'frame')
}
// ---- Doc.edges：引用 → 定义的 Doc 下标 ----
{
  const Doc = require('../ui/doc.js'), s = P.feed('(- a 1)\n(w@ (+ a 2))'); P.eat(g, s)
  const d = Doc.cst(s, g)
  assert.strictEqual(d.edges.length, 1)
  const [a, b] = d.edges[0]
  assert.strictEqual(s.src.slice(d.a[a], d.b[a]), 'a')
  assert.strictEqual(s.src.slice(d.a[b], d.b[b]), 'a')
}
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
  r = await exec('(w@ (Promise.reject "boom"))'); assert.strictEqual(r.err, 'boom'); assert(r.a != null && r.b > r.a)   // rejected → 报错并指到调用节点的源码区间
  r = await exec('(- o {a 1})\n o..[-> {b 2}]\n(w@ o (Math.max 1 5 3) (new Date 0).getTime)')
  assert.match(r.log[0], /^\{a 1 b 2\} 5 <builtin/)                                                // o..[-> …] 原地合并；Math.max；key 取出的方法绑定 this
  seen.length = 0; console.log = (...a) => seen.push(a)
  r = await exec('console.[log "m" 1]\n[console.log "n" 2]\nconsole.log "o" 3\n(w@ Math.[max 1 5 3] (new Date 0).[getTime])'); console.log = saved
  assert.deepStrictEqual([seen.map(a => a.join(' ')), r.log], [['m 1', 'n 2', 'o 3'], ['5 0']])        // console.[log …] ≡ [console.log …] ≡ console.log …：JS 的 OOP，this 是 console
  r = await exec('def f(a):\n  (- b 1)\n  (+ a b)\n...\n(w@ (f 3))'); assert.deepStrictEqual(r.log, ['4'])   // host.last：多语句函数取最后一句，不要求 OK
  // 断点：pause 返回 Promise 就挂起到它兑现；alive 为 false 即放弃
  let hits = 0
  jsHost({ pause: e => e.ph == 'ret' && e.f?.name == 'sq' ? new Promise(r => setTimeout(() => { hits++; r() }, 10)) : undefined })
  r = await exec('def sq(x) (* x x)\n(w@ (sq 3) (sq 4))'); assert.deepStrictEqual([r.log, hits], [['9 16'], 2])
  // 暂停点兑现 { v } → 替换这次调用的返回值；暂停时 ev.env 是这一帧的环境，evalIn 在里面即时求值（OK = 返回）
  let seenEnv = null
  jsHost({ pause: e => e.ph == 'ret' && e.f?.name == 'sq' ? (seenEnv = e.env, Promise.resolve({ v: 100 })) : undefined })
  r = await exec('def sq(x) (* x x)\n(w@ (sq 3))'); assert.deepStrictEqual(r.log, ['100'])
  const q = P.feed('(+ x 1)\n(OK (* x 10))'); P.eat(Object.assign(P.grammar(L.RULES), { builtins: { has: () => true } }), q)
  assert.deepStrictEqual(q.errs, [])
  const ev = L.evalIn(q.value, seenEnv, { '@ret': 9 }); assert.deepStrictEqual([ev.value, ev.ret], [30, true])   // x = 3；OK 提前返回
  // 日志断点：有条件的名字不暂停，条件成立才通知 onCond
  { const D = require('../ui/debug.js'); D.reset(); D.name('sq', true); D.conds.set('sq', { text: 'c' })
    const got = []; D.onCond = (e, c, n) => got.push(n)
    assert.strictEqual(D.hit({ ph: 'ret', f: { name: 'sq' }, a: 1, b: 2 }), null); assert.deepStrictEqual(got, ['sq'])
    assert.strictEqual(D.hit({ ph: 'ret', f: {}, x: ['()', ['$$', 'sq']], a: 1, b: 2 }), null)   // JS 函数的 f.name 是空的：靠调用头名字
    D.conds.clear(); assert.strictEqual(D.hit({ ph: 'ret', f: {}, x: ['()', ['$$', 'sq']], a: 1, b: 2 }), 'name') }
  let alive = true; jsHost({ alive: () => alive }); setTimeout(() => { alive = false }, 5)
  r = await exec('[wait 20]\n(w@ "no")'); assert.strictEqual(r.cancelled, true); assert.deepStrictEqual(r.log, [])
  // 不装宿主时仍是封闭的：console 不是内建，解析期就报未定义
  L.host = null; const s0 = P.feed('[console.log 1]'); P.eat(g, s0); assert.deepStrictEqual(s0.errs.map(e => e.msg), ['未定义 console'])
  console.log('smoke ok (host/await)')
})().catch(e => { console.error(e); process.exit(1) })
