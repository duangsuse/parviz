#!/usr/bin/env node
/* tools/bench-losn.js — 同一程序的 lisp.js 与 LOSN 粗对比（fib 22 + 300 次对象更新循环）。
   只量“函数调用与算术”的相对量级，不是微基准：两边都跑 3 次取最好。 */
'use strict'
const fs = require('fs'), path = require('path')
const P = require('../parse.js'), LISP = require('../lisp.js')
const make = new Function('return (' + fs.readFileSync(path.join(__dirname, '../losn.js'), 'utf8') + ')')()
const LOSN = make(P).LOSN
const best = (f, n = 3) => { let b = Infinity; for (let i = 0; i < n; i++) { const t0 = performance.now(); f(); b = Math.min(b, performance.now() - t0) } return b }
const fmt = ms => ms.toFixed(1) + ' ms'

// 旧 Lisp
const g = P.grammar(LISP.RULES)
const lispSrc = `def fib(n) (> n < 2)? n Or (+ (fib (> n - 1)) (fib (> n - 2)))
(w@ (fib 22))`
LISP.host = { has: () => false, get: () => 0, log: [], watch: { nodes: false, rets: false } }
const lrun = () => {
  const ss = P.feed(lispSrc); P.eat(g, ss)
  const r = LISP.start(ss.value)
  if (r && r.err) throw new Error(r.err)
}
// LOSN
const lsrc = `def fib(n) $(n < 2)? n Or $((fib $(n - 1)) + (fib $(n - 2)))
w@ (fib 22)`
const nrun = () => {
  const ss = LOSN.parse(lsrc, 'bench')
  const host = { has: k => LOSN.builtinNames.has(k), get: () => 1, log: [] }
  const mod = LOSN.compile(ss, { has: host.has, get: host.get })
  if (mod.errs.length) throw new Error(mod.errs[0].msg)
  const r = LOSN.exec(LOSN.steps(mod, host), host)
  if (r && r.err) throw new Error(r.err)
}
const tl = best(lrun), tn = best(nrun)
console.log(`fib 22   lisp.js ${fmt(tl)}   LOSN ${fmt(tn)}   ×${(tl / tn).toFixed(2)}`)
