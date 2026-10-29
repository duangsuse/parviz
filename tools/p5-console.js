#!/usr/bin/env node
/* tools/p5-console.js — 用真实的 p5.html 打开每一个示例，读 Console 面板（#out）里有没有 ✖ / ⚠ / eitem 行。
   需要先起静态服务（脚本不自己起）：
     python3 -m http.server 8765
     node tools/p5-console.js                 # 默认 http://127.0.0.1:8765
     BASE=http://127.0.0.1:9000 node tools/p5-console.js
   环境变量：CHROME（默认 chromium）、BUDGET（虚拟时间毫秒，默认 4000）。
   依赖：无（用 chromium --headless --dump-dom）。 */
'use strict'
const fs = require('fs'), os = require('os'), path = require('path'), { execFile } = require('child_process')
const BASE = process.env.BASE || 'http://127.0.0.1:8765'
const CHROME = process.env.CHROME || 'chromium'
const BUDGET = process.env.BUDGET || '4000'
const list = JSON.parse(fs.readFileSync(path.join(__dirname, '../demos/p5/index.json'), 'utf8'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parviz-console-'))
const args = i => ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--disable-breakpad',
  '--user-data-dir=' + path.join(tmp, 'u' + i), '--virtual-time-budget=' + BUDGET, '--dump-dom', BASE + '/p5.html#' + i]
const env = Object.assign({}, process.env, { HOME: tmp, XDG_CONFIG_HOME: tmp })
const run = a => new Promise(res => execFile(CHROME, a, { env, maxBuffer: 64 << 20, timeout: 60000 }, (e, out) => res(out || '')))
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const strip = s => unesc(s.replace(/<[^>]+>/g, '')).trim()

;(async () => {
  let bad = 0
  for (let i = 1; i <= list.length; i++) {
    const dom = await run(args(i))
    const m = dom.match(/<div id="out">([\s\S]*?)<\/div>\s*<\/div>\s*<div id="split"/) || dom.match(/<div id="out">([\s\S]*?)<\/div>\s*<\/section>/)
    const rows = m ? [...m[1].matchAll(/<div class="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g)] : []
    const msgs = rows.map(r => [r[1], strip(r[2])])
    const hits = msgs.filter(([c, t]) => /eitem|error|warn/.test(c) || /^[✖⚠]/.test(t))
    const st = (dom.match(/id="status">([^<]*)</) || [])[1] || ''
    if (hits.length) {
      bad++
      console.log(`✖ #${i} ${list[i - 1].name}`)
      for (const [c, t] of hits.slice(0, 8)) console.log('   ', c, t)
    } else if (process.env.V) console.log(`✓ #${i} ${list[i - 1].name} ${st}`)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  if (bad) { console.log(`\n${bad}/${list.length} 个示例的 Console 里有错误`); process.exit(1) }
  console.log(`p5 console ok（${list.length} 个示例，Console 都没有错误 / 警告）`)
})().catch(e => { console.error(e); process.exit(1) })
