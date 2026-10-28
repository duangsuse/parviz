# goal-viz.md — 下一版（可视化调试）实施计划

状态：设计定稿，未开始实现。前置条件已满足：上一轮重构把显示层收成了扁平 `Doc`
（`ui/doc.js` 三生产者 + `ui/tree.js` Mithril 同步渲染 + 共享 `ui/console.js` / `ui/sloc.js`），
并在 headless Chromium 实测过树、步进、F8、xref、控制台跳转、增量顺延。

本版四项功能：

1. `w@` / Console 的输出能定位到 sloc（像报错一样连线、点击跳转）；p5 页的编辑器与主页一样支持 xref。
2. p5 的示例支持 Ctrl+E 左侧折叠 explorer（Chrome 上接 FSA），未来可扩到多文档。
3. 调试器打印能被 Tweak 检测（颜色等可视化）、能改返回值；F8 暂停到下一帧入口，F11 逐行；主页也能点函数名打断点。
4. p5 的 vec2 / color 参数不再硬编码，由 Lisp 自己声明格式（含 W×H 的第二组 vec2）。

---

## 0. 已定决策

| 决策 | 选择 |
|---|---|
| 起步顺序 | 事件/打印通道优先（约半天），其余按 P1→P5 跟进 |
| 打印定位 | `w@` 改成 gen 内置（生成器拿上下文），`console.*` 走同步游标 |
| 断点表示 | 源码 `Range` 集合 + 共享 controller 匹配（名字断点在 controller 里转范围） |
| F11 粒度 | 语法语句边界（`@stmt` 声明的规则），不是行号、不是逐事件 |
| 格式声明 | Lisp 源码里的顶层声明 `(tweak …)`，跟文件走 |
| 改值落点 | 有 span 写源码；无 span（打印出的对象/合成值）改暂停帧里的运行时值 |
| explorer | 单文档 + 目录树 + FSA 句柄，同一时刻只有一个编辑区 |

---

## 1. 总底座：per-exec 的 `cx`

### 1.1 形状

```js
// lisp.js
const newCx = (run, log) => ({ run, log, stack: [], hooks: null })
let CX = null                     // 当前同步段的 cx；每次 it.next() 前后保存/恢复
const at = cx => cx.stack.length ? cx.stack[cx.stack.length - 1] : null
```

- `run`：运行标识（p5 的 run 对象 / 主页一次执行），控制台行归属、Tweak 部件失效判断都用它。
- `log`：该次执行的 sink（`host.log` 或 `[]`），取代模块级 `LOG` 和 `globals()` 闭包里的 log。
- `stack`：`[{ f, x, a, b }]`，`call()` 进入 push、`finally` pop。
- `hooks`：默认 `null`；只有 pick 模式挂 `{ ext }`（见 §2.2）。

`cx.at` 不单独存，`at(cx)` 从栈顶派生——避免两份真相。

### 1.2 生命周期

一个入口 = 一个 `cx`：

| 入口 | cx |
|---|---|
| `L.start(prog, log)` | `newCx(h?.run, log)` |
| `L.run(prog)` / `L.node(ast, prog)`（调试器独立求值） | 同上，log 用空数组 |
| `L.callback(f, args, h, tag)`（JS 回调进 Lisp） | `newCx(h.run, h.log)`，**新栈**，共享 run/log |
| `L.exec(it, h, cx)` / `drive(it, cx)` | 接收调用方的 cx，不新建 |

`drive`/`exec` 的循环里：

```js
for (;;) {
  const prev = CX; CX = cx
  let r; try { r = it.next(send) } finally { CX = prev }
  …
}
```

同步段（包括外部 JS 调用，如被打补丁的 `console.log`）读 `L.cx`/`CX` 拿到当前 `cx`；
生成器跨 `yield` 期间 `CX` 是外层值，不会串。

### 1.3 为什么必须是自维护栈（不是 `Error().stack`）

`loadImage` 之后才 `image()` 这类代码：生成器在 await 事件处挂起，JS 栈已经没了；
恢复执行时 `Error().stack` 里只剩驱动器。`cx.stack` 是暂停时不退栈（`finally` 也挂起），
恢复后照常 pop，所以暂停/pick/打印在任何时刻都能拿到“用户代码在哪个调用里”。

并发注意：JS 回调重入时**不能复用外层 cx 的 stack**（外层还在挂起）。`callback()` 新开 cx，
只继承 `{run, log}`；这样“异步打印落回同一 Console”和“栈不串”同时成立。

### 1.4 迁移清单

| 现在 | 改成 |
|---|---|
| `let LOG = null` / `warn(m, n)` | `warn(cx, m, n)` → `cx.log.push({ warn, n })` |
| `globals(log)` 闭包里的 log | `globals(cx)`，`w@` 用 `cx.log` |
| `steps(ast, prog, last, log)` | `steps(ast, prog, cx)`（`last` 留在 prog 侧或并入 cx.flags） |
| `exec(it, h)` / `drive(it)` | `exec(it, h, cx)` / `drive(it, cx)` |
| `L.host.log` | 保留为 sink 接口；p5 的 `{push}`、主页的数组都合法 |
| `L.at`（尚无，P1 新增） | 不新增；外部 JS 分支读 `at(cx)` |

### 1.5 `ctxGen` 协议（`w@` 用）

生成器拿不到调用点，所以只有显式声明要上下文的生成器才改签名：

```js
const ctxGen = f => (f.gen = 1, f.ctx = 1, f)
// call() 内：
if (f.gen) v = yield* (f.ctx
  ? f({ cx, a: x?.a, b: x?.b, node: x, args: x ? x.slice(2) : [] }, ...args)
  : f(...args))
```

`ctx.args` 是**未求值的实参值节点**，都带 `.a/.b`，所以打印行可以给每个实参一个可调部件。

`w@`：

```js
const wAt = ctxGen(function* (c, ...a) {
  c.cx.log.push({
    out: a.map(show).join(' '),
    a: c.a, b: c.b,
    spans: c.args.map(v => v && v.a >= 0 ? [v.a, v.b] : null),
    run: c.cx.run,
  })
  return a.at(-1) ?? NO
})
```

`console.log` 的定位：p5 的拦截器读 `L.cx` 的栈顶（只当栈顶的 `f` 就是被包装的那个函数时才算），
异步回调里的 `console.log` 在 `cx.stack` 为空 → 无定位（写进已知边界）。

---

## 2. 四个预留点

### 2.1 `cx.stack`（P1 落地）

- `call()`：`push({f,x,a,b})` → 执行 → `finally pop()`；所有分支（Lisp fn / gen / bname 内建 / 外部 JS / 回调还原）共用。
- 暂停（`ph:'await'`、断点、pick）时读 `at(cx)` 取跨度；不读 `Error().stack`。
- 验收：`(w@ …)` 在被 await 挂起过的语句里仍报正确调用点；`setTimeout` 回调里的 `w@` 报回调自己的调用点。

### 2.2 `cx.hooks.ext`：可开关且零成本（P1 落地）

```js
// call() 里，仅在真正调用了内置/外部 JS 之后：
if (cx.hooks && cx.hooks.ext) cx.hooks.ext({ cx, f, x, a: x?.a, b: x?.b, v })
```

- 默认 `cx.hooks === null`，正常运行时是一次属性读 + 假分支，没有 else 体、没有数组分配。
- pick 模式开启时挂 `{ ext }`，关闭时**置回 `null`**（不是留空对象）。
- `ext` 只在“Lisp 调用 → 内置/外部 JS”后触发；Walk 内部步骤不触发，避免噪音。
- pick 模式下才读像素；`ext` 里读之前先判 `pick.on`，且优先用已声明的格式算几何（见 2.3/P2）。

### 2.3 帧起点 = `DBG.frame()`（P3 落地）

- “帧起点”定义在 tick 入口（`p.draw` 里、本帧第一条 tick 之前调一次 `DBG.frame()`），
  **不**挂在 `clearRect`/`fillRect` 上。
- 原因：p5 的 `background()` 走 `fillRect`（内部还会 `clearRect`）。若把帧起点挂在 clearRect，
  标记/亮点会被紧随其后的 `fillRect` 覆盖，pick 的归属会永远落到 `fillRect`/background。
- pick 模式的“亮点”必须在用户代码第一笔绘制**之前**撒下去；之后的绘制调用才可能覆盖/更新它。
- `DBG.frame()` 同时清零本帧的 pick 记录（调用列表、序号、亮点状态），这是每帧唯一的重置点。

### 2.4 `Sloc.pick` 通道（P4 落地）

和 `ref`/`rev` 同一层，不是新机制：

```js
Sloc.pick = { from: DOMRect, to: DOMRect, label, cls }   // 画布矩形 → 源码矩形：一条线 + 一个角标
```

- `from` 是画布上的点/小矩形（点击位置），`to` 是源码里被命中的调用的跨度。
- 与 `ref` 一样在 `Sloc.draw()` 末尾统一绘制；切换/重绘时清空。
- p5 顺便得到“点画布 → 源码”的可视反馈：点击 → 选中源码 → 画线 → 角标显示函数名/参数摘要。
- 命中不到任何调用（空白处）时只画角标“无调用”，不画线。

---

## 3. 阶段计划

### P1 事件/打印通道 + `cx`（约半天）

改动：

- `lisp.js`：`newCx`/`CX`/`ctxGen`；`call()` 维护栈、`ctx` 实参、`ext` 钩子；
  `w@` 改 `ctxGen`；`warn` 走 `cx.log`；`steps/drive/exec/callback/start/run/node` 传 cx。
- `ui/console.js`：条目加 `span` / `spans` / `value` / `run`（渲染逻辑不变）。
- `ui/app.js`：`renderOut` 把 `l.a/l.b` 变成 `span`；`$4` 行带 `value`。
- `p5/app.js`：`con()` 同上；`console.*` 拦截读 `L.cx` 栈顶补 `span`。

验收：

- `(w@ 1 (+ 1 2))` 行悬停：连线两端都落在源码；点击跳转。
- p5 的 `console.log` 从 Lisp 调用进来有跨度；从 `setTimeout` 回调进来没有（文档写明）。
- 正常运行时 `cx.hooks === null`，`call()` 不新增分配（代码审查 + 一次 profiling 对比）。
- `node tools/smoke.js` 全过；`L.run` 的返回值形状不变（`{value, log, steps}` / `{err,a,b}`）。

### P2 Tweak 描述符 + `Doc.stmts`（约 1 天）

改动：

- `parse.js`：`grammar()` 支持 `@stmt Name`（写进 `g.stmt`）。
- `lisp.js` 的 `RULES`：加 `@stmt Stmt` 与 `Tweak` 规则；`Walk.tweak` 返回 `NO`（不执行实参）。
- `ui/doc.js`：`lowerCST` 收集 `Doc.stmts = [[a,b],…]`（按 `g.stmt` 命中规则，按 a 排序）。
- `p5/tweak.js` → 拆成 `ui/tweak.js`（部件与交互）+ `p5/formats.js`（声明消费）；
  删除 `COLOR`/`POS` 硬编码表。
- 格式表同时登记“几何描述”（P3 的 pick 用）：`vec2/size` 给出 bbox，`color` 给出色块。

声明语法（顶层，关键字不进作用域）：

```lisp
(tweak rect   (vec2 0 1) (vec2 2 3))   # x y；w h —— 第二组就是现在调不了的 W×H
(tweak circle (vec2 0 1) (size 2))     # x y；直径（size 按画布尺寸换算）
(tweak fill   (color 0 1 2 3))         # r g b a；少一个就是 (color 0 1 2)
```

验收：

- `rect` 两组 vec2 都能拖；`fill` 3/4 参与都行；第二组 `vec2` 按画布 W/H 显示相对值。
- 未声明的函数没有部件；`#rrggbb` 字面量仍然无条件识别。
- 声明写错（非整数下标、调用实参不够）→ 解析/扫描期报错并给声明处的跨度。
- `(tweak …)` 写进函数体是解析错误（不是静默当调用）。
- `Doc.stmts` 在 Lisp 语法下非空；JSON/CSV 示例为空（F11 自动退化为逐事件）。

### P3 调试控制器 `DBG` + pick（约 1–2 天）

改动：

- 新文件 `ui/debug.js`：`{ mode, bps:Set, names:Set, frame(), at(ev), stepLine(), nextFrame(), resume() }`。
  - `at(ev)` 读 `Ev` 事件与 `Doc.stmts`（二分找语句），三种命中：范围断点、名字断点、F11 语句变化。
  - `frame()` 只由 p5 的 `p.draw` 调；主页无帧概念，`nextFrame()` 退化为 `resume()`。
- `ui/app.js`：删 `fnBreaks`；`EvStep` 只负责取事件 → `DBG.at` → 渲染暂停；点名字 → `DBG.names`。
- `p5/app.js`：`run.host.pause` 转给 `DBG.at`；`run.fire` 前后不动，`p.draw` 里调 `DBG.frame()`；
  双击函数名保留（调 `DBG.toggleName`）。
- pick 模式：`cx.hooks.ext` 记录本帧的调用（名字、跨度、bbox 来自 P2 的几何声明）；
  点击画布 → 读像素/命中 → `Sloc.pick` + 选中源码 + 角标。
- Tweak 运行时改值：暂停时对 `$4`/打印行里的对象字段生成部件，`set` 直接改对象并重绘该行；
  无暂停帧或已结束的运行 → 部件禁用（带 tooltip）。

验收：

- 主页点函数名 → 断点；F8 停在该函数每次返回；F11 每语句一停。
- p5 暂停后 F8 → 下一帧 tick 入口；F11 在 tick 内逐语句。
- pick：`background` 不会抢走归属（亮点在 `DBG.frame()` 里、早于第一笔用户绘制）。
- 未声明格式的调用在 pick 下只报名字，不参与 bbox 命中（明确降级）。
- 暂停时改 `$4` 对象字段 → 下一步读到新值；恢复运行后控制台行显示“已改”。

### P4 xref 共享 + p5 对齐（约半天）

改动：

- 把 `ui/app.js` 的 `wireScope` 抽成 `ui/xref.js`（`{ed, ssOf, draw}`），p5 装入。
- `ui/sloc.js` 增加 `pick` 参数绘制；p5 的 `Sloc` 补 `ref`/`rev`/`pick` 三段（每段几行）。
- `ui/doc.js`：`lowerCST` 填 `Doc.edges`（def/ref 对）；主页的 `declAt/usesOf` 改吃 `edges`（脱离 CST 的第一步）。
- p5 控制台行：hover 连线、点击跳转（已有）+ 画布 pick。

验收：

- p5 悬停引用出箭头、点引用跳定义、点声明反查引用。
- 主页 xref 行为不变；`Doc.edges` 与 `ss.tree` 的 `def` 指针一致（smoke 加一条不变量）。
- `Sloc.pick` 与 `ref` 同时出现时不打架（pick 优先，ref 清空）。

### P5 会话模型 + explorer（约 2 天）

改动：

- 新文件 `ui/session.js`：`{ text, ss, doc, vdoc, bps, run, file:{handle,name}, dirty }` + `open/save/setText`。
- `ui/app.js`：当前模块级 `S` 改成 `S.session`，`app.js` 只做装配。
- 新文件 `ui/explorer.js`：Ctrl+E 开合、目录树、`showDirectoryPicker`、权限查询、`<input type=file>` 回退；
  切文件前 `dirty` 拦截。
- `Editor.value` 的 setter 已存在（重建文本节点，顺带清高亮），打开文件后走一次 `compile()/parse()`。

验收：

- 打开目录 → 选文件 → 编辑 → 写回原文件；权限被拒有提示。
- 切换文件不串 `ss/doc/bps/run`；旧运行的异步回调不再往新会话写（`cx.run` 校验）。
- 非 Chromium：explorer 降级为“打开文件”，Ctrl+E 仍可开合。

---

## 4. 数据结构与接口草案

```js
// 控制台条目（console.js，两页共用）
{ cls, text, span?: {a,b}, spans?: ([a,b]|null)[], value?, run?, html? }

// 执行事件（已有，lisp.js）
{ ph: 'in'|'out'|'ret'|'if'|'await', a, b, x?, f?, args?, v?, c?, t?, p? }

// 解析事件（parse.js，F8 解析步进用）
{ t, label, a, b, n, ok, ch, f, al }        // f = frames 池下标，已不再复制栈

// Doc（ui/doc.js）
Doc.stmts  : [[a,b], …]                     // 按 @stmt 规则收集，a 升序
Doc.edges  : [defId, refId, …]              // P4 填

// Tweak 描述符（P2）
{ name, groups: [{ kind:'vec2'|'size'|'color'|'num'|'angle', idx:[i…], a, b }] }

// DBG（P3）
{ mode:'run'|'line'|'frame'|'pick', bps:Set<'a:b'>, names:Set<string> }

// Sloc 层（P4）
Sloc.pick = { from: DOMRect, to: DOMRect, label, cls }
```

---

## 5. 风险与已知边界

- `cx` 要贯穿 `ev/Walk/body/call/steps` 的签名，改动面广但机械；一次切换，靠 smoke + 浏览器实测兜底。
- `w@` 变成生成器：每次调用多一个生成器对象；只对它用 `ctxGen`，不要批量改内建。
- `console.log` 的定位只在同步段有效；异步回调里无跨度（写进 README）。
- `L.cx` 是“当前同步段”指针，p5 内部库自己打的 log 可能带上前一次调用的跨度；
  拦截器必须校验栈顶 `f` 就是被包装的 console 函数，否则不加跨度。
- `ext` 钩子只在“调用到 JS”后触发；Walk 内部步骤不触发，避免 pick 记录被语法噪音污染。
- F11 依赖 `@stmt`；没有语句规则的语法退化为逐事件（JSON/CSV）。
- pick 的几何来自 P2 的声明；未声明格式只能报名字。
- 亮点/标记的撒点时机固定在 `DBG.frame()`；不要改成挂 `clearRect`，否则 `background` 会覆盖它。
- FSA 需要用户手势 + 权限，`file://` 下不可用；单文档模式切文件会丢撤销栈（Editor 无 undo），先做 `dirty` 提示。
- 多 Tab 并存、撤销历史、按颜色 ID 的 pick 渲染、非 Chromium 的目录写入：本版不做。

---

## 6. 验收总表

| 功能 | 验收 |
|---|---|
| 1 打印定位 | 主页与 p5 的 `w@` / `console.log` 行 hover 连线、click 跳转；p5 编辑器有 xref |
| 2 explorer | Ctrl+E 目录树；打开/保存/权限/回退；切文件不串状态 |
| 3 调试器 | Tweak 认打印值（颜色/数值）；暂停时可改返回值；F8 帧入口；F11 逐语句；主页点名字打断点 |
| 4 参数格式 | `(tweak …)` 声明；`rect` 两组 vec2（含 W×H）；未声明降级；声明错误有跨度 |
