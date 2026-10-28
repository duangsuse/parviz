#!/usr/bin/env node
/* tools/freq.js — 统计 Lisp AST 各 tag 的出现频次（节点常见度），用来给 tag 分配/排序。
   用法：node tools/freq.js [文件.lisp ...]   不带参数时统计 P.examples 里所有带 walker 的示例。 */
const fs = require('fs')
const P = require('../parse.js'); require('../lisp.js')
const count = new Map
const bump = k => count.set(k, (count.get(k) || 0) + 1)
const tally = x => { if (!P.isT(x)) { bump(typeof x == 'number' ? '#num' : typeof x == 'string' ? '#raw-str' : '#other'); return } bump(x[0]); for (const k of x.slice(1)) if (k !== undefined) tally(k) }
const rulesOf = (e, es) => e.rules ?? es.find(q => q.name == e.same)?.rules
const srcs = process.argv.length > 2 ? process.argv.slice(2).map(f => ({ name: f, rules: require('../lisp.js').RULES, input: fs.readFileSync(f, 'utf8') })) : P.examples
for (const e of srcs) {
  const rules = rulesOf(e, srcs); if (!rules) continue
  const g = P.grammar(rules); if (!g.walk) continue
  const ss = P.feed(e.input); P.eat(g, ss)
  if (P.isT(ss.value)) tally(ss.value)
}
const total = [...count.values()].reduce((a, b) => a + b, 0)
for (const [k, v] of [...count].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), (100 * v / total).toFixed(1).padStart(5) + '%', JSON.stringify(k))
