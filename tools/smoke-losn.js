#!/usr/bin/env node
/* tools/smoke-losn.js — LOSN 冒烟：语法 / 转译 / 运行时 / 10 个语言特性 demo / 工具链（池 / 缓存 / 事件 / 快照）/ 30 个 p5 示例源码。
   用法：node tools/smoke-losn.js   有失败则退出码 1（V=1 时打印每条检查名）。
   旧的 tools/smoke.js 继续测 lisp.js，不动。 */
'use strict'
const fs = require('fs'), path = require('path'), assert = require('assert')
const P = require('../parse.js')
const factory = new Function('return (' + fs.readFileSync(path.join(__dirname, '../losn.js'), 'utf8') + ')')()
const module_ = factory(P)
const L = module_.LOSN
const ROOT = path.join(__dirname, '..')
let n = 0
const ok = m => { n++; if (process.env.V) console.log('  ✓', m) }

function parseIt(src, file = 't') {
  const ss = L.parse(src, file)
  if (ss.errs.length) throw new Error(file + ' 解析失败：' + ss.errs.map(e => `${e.msg}@${e.a}`).join('; '))
  return ss
}
function baseHost(file) {
  const names = Object.create(null), log = []
  const host = {
    has: k => k in names || L.builtinNames.has(k),
    get: k => names[k],
    log,
    req: p => {
      const f = path.isAbsolute(p) ? p : path.resolve(path.dirname(file || '.'), p)
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
    },
  }
  return { host, names, log }
}
function runSrc(src, file = 't', opts = {}) {
  const ss = parseIt(src, file)
  const { host, log, names } = baseHost(file)
  if (opts.names) Object.assign(names, opts.names)
  const mod = L.compile(ss, { has: host.has, get: host.get })
  if (mod.errs.length) throw new Error(file + ' 编译失败：' + mod.errs.map(e => e.msg + '@' + e.a).join('; '))
  if (opts.before) opts.before(mod, host)
  const r = L.exec(L.steps(mod, host), host)
  if (r instanceof Promise) throw new Error(file + '：这一步不应异步')
  if (r.err !== undefined) throw new Error(file + ' 运行错误：' + r.err)
  return { out: log.filter(x => x.out != null).map(x => x.out), mod, ss, host, log, value: r.value }
}
function runFile(file, opts) { return runSrc(fs.readFileSync(file, 'utf8'), file, opts) }
function same(src, out, msg) {
  const r = runSrc(src)
  assert.deepStrictEqual(r.out, out, (msg || src.split('\n')[0]).slice(0, 80))
  ok(msg || src.split('\n')[0].slice(0, 60))
}

/* ================= ① 语法 ================= */
{
  const ss = parseIt(`- a 1 - b 2
- f [-x-y]> $(x + y)
w@ (f a b)
- o {k 1}
{->o {k $(it + 1)}}
{t $(a)}`)
  assert.deepStrictEqual(ss.value.slice(1).map(x => x[0]), ['=', '=', '=', '()', '=', 'upd', '->'])
  ok('两种位置 / - 连写 / {} 三种读法')
}
{
  const ss = parseIt('w@ [1 2 3] (len [1 2 3])')
  const c = ss.value[1]
  assert.strictEqual(c[0], '()'); assert.strictEqual(c[2][0], '[]'); assert.strictEqual(c[3][0], '()')
  ok('语句位置 [..] 是调用、参数位置是列表')
}
{
  const ss = parseIt('x.a.(b 1).[2]  y?.{ u }  z.{ it }')
  const tags = new Set
  const walk = v => { if (Array.isArray(v) && P.isT(v)) { tags.add(v[0]); for (let i = 1; i < v.length; i++) walk(v[i]) } }
  walk(ss.value)
  for (const t of ['()', '.', 'at', '=>']) assert(tags.has(t), '缺 ' + t)
  ok('点号链 / ?.{ } / .{ } / .[i]')
}
{
  const ss = parseIt('w@ $(2x + 3y > 7)')
  const c = ss.value[1][2]
  assert.strictEqual(c[0], 'op'); assert.strictEqual(c[2][0], 'op')
  parseIt('[-z]> $(z * 2)\nis $(1 > 0)? "y" Or "n"')
  ok('$() 中缀 / 多项式系数 / is 链')
}
{
  const ss = parseIt('console.\n  (log "x" 1)\nimp.alert "hi"')
  assert.strictEqual(ss.value[1][0], '()'); assert.strictEqual(ss.value[1][1][0], '.')
  ok('行尾 . 续行 / imp')
}
{
  const t = parseIt('(tweak circle (vec2 0 1) (num 2))').value[1]
  assert.strictEqual(t[0], 'tweak')
  assert.deepStrictEqual(t.slice(1).map(s => s[1]), ['circle', 'vec2', 'num'])
  assert.deepStrictEqual(t.slice(2).map(s => s[0]), ['spec', 'spec'])
  ok('(tweak …) 声明')
}
{
  const ss = parseIt('w@ nope')
  const m = L.compile(ss, { has: () => false, get: () => 1 })
  assert(m.errs.length && /nope/.test(m.errs[0].msg) && m.errs[0].b > m.errs[0].a)
  ok('未定义名字：编译期报错 + 跨度')
}
{
  // u 作用域：自由的小写名变 u.key，模块名 / 内建 / 大写名不受影响
  const r = runSrc('- n 10\nw@ [1 2]?.{ $(u + n) }\n- o {k 3}\nw@ o?.{ $(u.k * 2) }')
  assert.deepStrictEqual(r.out, ['[11 12]', '6'])
  ok('u 规则：u.key / 模块名优先')
}
{
  const ss = parseIt('- add [-a-b]> $(a + b)\n- xs [1 2]')
  const mod = L.compile(ss, { has: () => false, get: () => 1 })
  assert.strictEqual(mod.names.has('add'), true)
  ok('顶层 - 绑定进模块名字表')
}

/* ================= ② 运行时语义 ================= */
same('w@ (list 1 "a" true NO [2 3] {k 1})', ['[1 "a" true NO [2 3] {k 1}]'], '值 / NO / 数组 / 对象')
same('- t 0\n{t $(t + 1)}\n{t $(t + 1)}\nw@ t', ['2'], '重赋值')
same('def f(a ..):\n  [xargs {b_ 1}]\n  OK (list a b_ (xargs))\n...\nw@ (f 0) (f 0 2) (f 0 NO 3)', ['[0 1 []] [0 2 [2]] [0 1 [NO 3]]'], 'xargs 可选参数')
same('w@ [1 2 3]?.{ $(u * 2) } []?.{ $(u + 1) } NO?.{ $(u + 1) }', ['[2 4 6] [] NO'], '?.{ }：逐项 / 丢 NO')
same('w@ (map [1 2 3] [-x]> $(x + 10)) (filter [1 2 3 4] [-x]> $(x % 2 == 0))', ['[11 12 13] [2 4]'], 'map / filter')
same('w@ (str "a" 1 true) `x${1 + 2}y`', ['a1true x3y'], 'str / 模板字符串')
same('w@ (is 0) (is "") (is []) (is {}) (is false)', ['true false false true false'], '真值：0 为真（平对象 {} 也为真）')
same('def wall(x):\n  is $(x < 0)? "L"\n  Or $(x > 9)? "R"\n  Or "M"\n...\nw@ (wall -1) (wall 10) (wall 5)', ['L R M'], 'is / Or else-if 链')
same('w@ $((1 + 2) == 3) $(2 < 3) $(3 <= 3) $(4 != 5)', ['true true true true'], '比较运算')
same('w@ (reduce [1 2 3] [-a-b]> $(a + b) 0) (each [1 2] [-x-i]> $(x * i))', ['6 [1 2]'], 'reduce / each')
same('w@ $(1 + 2 * 3) $(2 * 3 + 1) $(10 - 2 - 3) $(2 * (3 + 1)) $(1 + 2 == 3 && 4 > 2)', ['7 7 5 8 true'], '$() 优先级：*/ > +- > 比较 > &&')
{
  const r = runSrc('w@ $((clock) + 1) $((len [1 2]) * 2)', 't', { names: { clock: () => 5 } })
  assert.deepStrictEqual(r.out, ['6 4'])
  ok('$() 里的调用要括号：单名零参 / 带参')
}
same('- n 0\ndef bump():\n  {n $(n + 1)}\n...\n(bump)\n(bump)\nw@ n', ['2'], '{名字 值} 在函数里改的是模块绑定')
{
  // host 里用 L.gen + L.call 包一层（p5/app.js 的 scope 就是这样）：L.call 必须是可用的生成器入口
  assert.strictEqual(typeof L.call, 'function', 'LOSN.call')
  const scope = Object.assign(L.gen(function* (f) { return yield* L.call(f, []) }), { bname: 'scope' })
  const r = runSrc('w@ (scope [-]> $(1 + 1))', 't', { names: { scope } })
  assert.deepStrictEqual(r.out, ['2'])
  ok('L.gen + L.call：host 提供的生成器（scope 这类）')
}
same('- o {at_ [-i]> $(i * 100)}\nw@ o.[2] [5 6 7].[1] "abc".[0]', ['200 6 a'], 'at_ 覆盖 / 默认下标')
same('- a "abc"..(w@)\nw@ a', ['abc', 'abc'], '管道：..(f) 零额外实参')
same('def Pair(A B) {- A - ["B"] B}\ndef get() (OK u.A)\ndef OK\n- p (Pair "k" 9)\nw@ p.A (p.get)', ['k k'], 'def 类型 + 方法 + def OK')
{
  const r = runSrc('def Pair(A B) {- A - ["B"] B}\ndef get() (OK u.B)\ndef OK\n- p (Pair "k" 9)\nw@ (p.get)')
  assert.deepStrictEqual(r.out, ['9'])
  assert.strictEqual(r.mod.M.p instanceof r.mod.M.Pair, true, 'instanceof')
  assert.strictEqual(r.mod.M.p.constructor, r.mod.M.Pair)
  ok('类型对象 instanceof / 方法在 prototype 上')
}
{
  const r = runFile(path.join(ROOT, 'demos/lang/08-mod.losn'))
  assert.deepStrictEqual(r.out, [])
  const r2 = runSrc('- m (req ./demos/lang/08-mod.losn)\nw@ (m.twice 4) m.name')
  assert.deepStrictEqual(r2.out, ['8 mod-08'])
  ok('req：执行模块并取值')
}

/* ================= ③ 10 个语言特性 demo ================= */
const DEMO_OUT = {
  '01-bindings.losn': ['11', 'true false false true false true', '22 {a 1 b 2}'],
  '02-lambdas.losn': ['720 55 34 12', '11'],
  '03-higher-order.losn': ['[1 4 9 16 25 36]', '[2 4 6]', '21', '[10 20 30 40 50 60]', '[2 3 4 5 6 7]', '[4 5 6]', '[0 2 4 6]'],
  '04-objects.losn': ['ann! 21 2', '{x 1 y 20}', '{a 1 b 2}'],
  '05-pipes.losn': ['10 30', '20', 'el HELLO', '3 30', 'abc', '[0 3 6 9 12] [1 4 7 10 13]'],
  '06-text.losn': ['hi world!', '[[\"a\" \"b\" \"c\"] [1 2]]', '[0 1 10 []] [0 5 50 [5]] [0 1 7 [NO 7]] [0 5 6 [5 6]]', 'line1\nline2'],
  '07-types.losn': ['x 1 [\"x\" 1] x', '3', '[7 8] 8'],
  '08-req.losn': ['42 mod-08', 'true'],
  '09-truthy.losn': ['true false false true false true', 'left right mid', '2', '1 2 1'],
  '10-tooling.losn': ['{x 3 y 6 n 3}', '2'],
}
for (const f of Object.keys(DEMO_OUT).sort()) {
  const r = runFile(path.join(ROOT, 'demos/lang', f))
  assert.deepStrictEqual(r.out, DEMO_OUT[f], f)
  ok('demo ' + f)
}
assert.strictEqual(Object.keys(DEMO_OUT).length, 10)
ok('10 个语言 demo')

/* ================= ④ 工具链：写入事件 / 快照 / 序列化 / 缓存 / 常量池 ================= */
{
  const src = `- st {x 0 y 0}
def bump():
  {->st {x $(it + 1)  y $(it + 2)}}
...
(bump)`
  const writes = []
  const r = runSrc(src, 'w', { before: mod => { L.R.onWrite = e => writes.push(Object.assign({ at: L.R.S[e.site] }, e)) } })
  L.R.onWrite = null
  assert.strictEqual(writes.length, 2)
  assert.deepStrictEqual(writes.map(w => [w.k, w.old, w.v]), [['x', 0, 1], ['y', 0, 2]])
  assert(writes.every(w => w.at && w.at.a >= 0), '写入事件带调用点跨度')
  ok('{->} 写入事件：键 / 旧值 / 新值 / 调用点')
  const snap = r.mod.snap()
  assert.deepStrictEqual(snap.envs[0].vars.st, { x: 1, y: 2 })
  ok('R.snap：深拷贝 {->} 目标')
  const cyc = { a: 1 }; cyc.self = cyc
  const sv = L.ser({ cyc, f: r.mod.M.bump, n: undefined })
  assert.deepStrictEqual(sv.cyc.self, { $: '↻' })
  assert.strictEqual(sv.f.$, 'fn'); assert.strictEqual(sv.f.name, 'bump')
  assert.deepStrictEqual(sv.n, { $: 'NO' })
  ok('R.ser：环 / 函数 / NO')
}
{
  // 模板缓存：只改数字 / 颜色 / 字符串内容不重编；改结构只重编那一个函数
  const a = `def kk1(n) $(n * 2 + 1)\ndef kk2(x) $(x + 3)\nw@ (kk1 2) (kk2 4)`
  const c0 = L.stats.compiles
  const r1 = runSrc(a); assert.deepStrictEqual(r1.out, ['5 7'])
  const c1 = L.stats.compiles
  assert(c1 > c0, '首次要编译')
  const r2 = runSrc(a.replace('$(n * 2 + 1)', '$(n * 9 + 1)')); assert.deepStrictEqual(r2.out, ['19 7'])
  assert.strictEqual(L.stats.compiles, c1, '改数字不重编')
  const r3 = runSrc(a.replace('$(n * 2 + 1)', '$(n * 2 - 1)')); assert.deepStrictEqual(r3.out, ['3 7'])
  assert.strictEqual(L.stats.compiles, c1 + 1, '改结构只重编一个函数')
  ok('结构签名缓存：改字面量命中 / 改结构只重编一个')
}
{
  // 常量池：锚点 / onedit（num / color / str）/ 运行中的模块直接读新值
  const src = `- s "hi"\n- c #112233\n- n 5\nw@ s c n`
  const ss = parseIt(src, 'p')
  const host = { has: k => L.builtinNames.has(k), get: () => 1, log: [] }
  const mod = L.compile(ss, { has: host.has, get: host.get })
  const an = mod.anchors()
  assert.strictEqual(an.length, mod.cells.length)
  assert.strictEqual(mod.onedit(an[0], '7'), null, '字符串格子不接受裸数字')
  const nc = mod.cells.find(c => c.kind === 'num')
  const ni = mod.cells.indexOf(nc)
  assert(mod.onedit(mod.anchors()[ni], '9'), '数字热替换')
  assert.strictEqual(nc.v, 9)
  const cc = mod.cells.find(c => c.kind === 'color')
  assert(mod.onedit(mod.anchors()[mod.cells.indexOf(cc)], '#aabbcc'))
  assert.strictEqual(cc.v, '#aabbcc')
  const sc = mod.cells.find(c => c.kind === 'str')
  assert(mod.onedit(mod.anchors()[mod.cells.indexOf(sc)], '"yo"'))
  assert.strictEqual(sc.v, 'yo')
  const r = L.exec(L.steps(mod, host), host)
  assert.deepStrictEqual(host.log.map(x => x.out), ['yo #aabbcc 9'])
  ok('常量池：anchors / onedit 三种 kind / 运行中读新值')
}
{
  // 编辑后 apply：结构相同 → 把值写回运行中的池，不重跑
  const src = `- st {x 1}\ndef ff(a) $(a + 2)\nw@ (ff 1)`
  const ss = parseIt(src, 'p2')
  const host = { has: k => L.builtinNames.has(k), get: () => 1, log: [] }
  const mod = L.compile(ss, { has: host.has, get: host.get })
  L.exec(L.steps(mod, host), host)
  const next = L.compile(parseIt(src.replace('$(a + 2)', '$(a + 40)'), 'p2'), { has: host.has, get: host.get })
  const ch = mod.apply(next)
  assert(ch && ch.length, 'apply 应返回改动')
  host.log.length = 0
  L.exec(L.steps(mod, host), host)
  assert.deepStrictEqual(host.log.map(x => x.out), ['41'])
  assert.strictEqual(mod.apply(L.compile(parseIt('w@ 1', 'p3'), { has: host.has, get: host.get })), null, '结构变了返回 null')
  ok('apply：热替换 / 结构变化返回 null')
}

/* ================= ⑤ 错误 / 断点事件 / 帧 ================= */
{
  const ss = parseIt('w@ $(1 + 2)\n(3 4)')
  const host = { has: k => L.builtinNames.has(k), get: () => 1, log: [] }
  const mod = L.compile(ss, { has: host.has, get: host.get })
  const r = L.exec(L.steps(mod, host), host)
  assert.strictEqual(r.err, '3 不可调用')
  assert.strictEqual(ss.src.slice(r.a, r.b), '(3 4)')
  ok('运行时错误指到调用点')
}
{
  const ss = parseIt('def loop(n) (loop $(n + 1))\n(loop 0)')
  const host = { has: k => L.builtinNames.has(k), get: () => 1, log: [] }
  const mod = L.compile(ss, { has: host.has, get: host.get })
  const r = L.exec(L.steps(mod, host), host)
  assert.strictEqual(r.err, '递归过深（调用栈溢出）')
  ok('递归过深：RangeError → 源码跨度')
}
;(async () => {
  const events = []
  let replaced = false
  const ss = parseIt('def f(x) $(x + 1)\nw@ (f 1)')
  const host = {
    has: k => L.builtinNames.has(k), get: () => 1, log: [], watch: { rets: true },
    pause: e => {
      events.push({ ph: e.ph, name: e.f && e.f.$.name, args: e.args, v: e.v, frame: e.frame && e.frame() })
      if (!replaced && e.f && e.f.$.name === 'f') { replaced = true; return Promise.resolve({ v: 99 }) }
    },
  }
  const mod = L.compile(ss, { has: host.has, get: host.get })
  const r = await L.exec(L.steps(mod, host), host)
  assert.strictEqual(r.err, undefined)
  const ev = events.find(e => e.name === 'f')
  assert(ev && ev.ph === 'ret')
  assert.deepStrictEqual(ev.args, [1])
  assert.deepStrictEqual(ev.frame, { x: 1 })
  assert.deepStrictEqual(host.log.map(x => x.out), ['99'], '(OK v) 替换返回值')
  ok('ret 事件 / frame / 恢复值替换')
  {
    // 异步 req（浏览器里 host.req 返回 Promise<源码>）
    const file = path.join(ROOT, 'demos/lang/08-mod.losn')
    const ss2 = parseIt('- m (req ./08-mod.losn)\nw@ (m.twice 5)', path.join(ROOT, 'demos/lang/t.losn'))
    const host2 = { has: k => L.builtinNames.has(k), get: () => 1, log: [], req: () => Promise.resolve(fs.readFileSync(file, 'utf8')) }
    const mod2 = L.compile(ss2, { has: host2.has, get: host2.get })
    const r2 = await L.exec(L.steps(mod2, host2), host2)
    assert.deepStrictEqual(host2.log.map(x => x.out), ['10'])
    assert.strictEqual(r2.err, undefined)
    ok('req：异步宿主（Promise<源码>）')
  }
  complete()
})().catch(e => { console.error(e); process.exit(1) })

function complete() {
  /* ================= ⑥ p5 示例源码（真正的绘制在 tools/p5-run.html 里无头跑） ================= */
  {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'demos/p5/index.json'), 'utf8'))
    assert.strictEqual(list.length, 30, '要 30 个 p5 demo')
    for (const d of list) {
      const ss = L.parse(fs.readFileSync(path.join(ROOT, d.file), 'utf8'), d.file)
      assert.deepStrictEqual(ss.errs.map(e => e.msg), [], d.file)
      const mod = L.compile(ss, { has: () => true, get: () => 1 })
      assert.deepStrictEqual(mod.errs.map(e => e.msg), [], d.file)
    }
    ok('30 个 p5 demo：解析 + 编译')
  }
  /* ================= ⑦ demo.losn 的小节 ================= */
  {
    const src = fs.readFileSync(path.join(ROOT, 'demo.losn'), 'utf8')
    const parts = src.split(/^#== (.*) ==$/m)
    let n2 = 0
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i], code = parts[i + 1]
      const ss = L.parse(code, 'demo.losn')
      if (/作用域\/错误/.test(name)) { assert(ss.errs.length > 0, '这一节本来就带错误'); continue }
      assert.deepStrictEqual(ss.errs.map(e => e.msg), [], name)
      n2++
    }
    assert(n2 >= 8)
    const lisp = parts[parts.indexOf('Lisp (lisp.js 内置示例)') + 1]
    const r = runSrc(lisp, path.join(ROOT, 'demo.losn'))
    assert.deepStrictEqual(r.out, [
      'fact 5 = 120 big: [14 15 26] parviz 40 4',
      'Dr. ann ×1,另有 0 个 Prof. bo ×2,另有 2 个',
      '[2 4 6] NO 41 [1 4 9]',
      'true false',
    ])
    ok('demo.losn：小节解析 + 第一节的运行结果')
  }
  console.log(`smoke-losn ok (${n} 项检查)`)
}
