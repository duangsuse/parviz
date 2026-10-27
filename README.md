# parviz

浏览器里的递归下降解析器实验台：用一套很小的元语言写文法，实时得到 CST、语法树、代码高亮、错误恢复和逐步解析轨迹；同一套引擎上还带一个可求值的 Lisp。

界面速记：

- 输入区失焦自动解析；`Ctrl+Enter` 用 `@walk` 指定的 walker 执行。
- 点一个位置，`→` 步进，`Shift+→` 连返回一起看，双击底部栏+`F8` 断点。

# 一、元语言：组合子、`/re/` 与特殊用法

## 1.1 一条规则长什么样

文法是一行一条规则，**第一条就是起始规则**（没有 `@start`）：

```text
Name(P, Q)  item item ...   # 规则；P、Q 是参数
@skip /re/ | none           # 词法跳过（空白 / 注释）
@color Name=B Key=P ...     # 颜色：B 蓝、Y 黄、G 绿、R 红、P 紫
@walk lisp                  # Ctrl+Enter 使用的 walker
# 注释到行尾
```

规则体是隐式序列。每个 item 可以：

- 是 `/re/`、`"字面量"`、小写关键字、大写规则引用、`Recur`，或 `( ... )` 分组；
- 后面跟后缀操作符 `<` `+` `*` `?`，或 `:func` / `:par` / `:setRecur`；
- 用 `A|B` 做项级别的内联选择。

**值的形状**：序列把非字面量、非错误、非分隔符的子项值收起来——0 个是 `undefined`，1 个直接是那个值，多个是数组。`+` / `*` 匹配 0 次时值是 `[]`。分隔符和 `err` 节点不进值。`:par` 默认取内层的值。

失败会回溯：`seq` 失败回到组起点，`alt` 失败回到选择起点再试下一项。

## 1.2 `+`、`*`、`-`、`<`（以及 `?`）

| 写法 | 含义 | 要点 |
| --- | --- | --- |
| `(A B <)` | 有序选择 | 按书写顺序试，第一个成功者胜；每一项可以是一个序列 |
| `(Element Sep +)` | join，0~N 个 | **最后一项是分隔符**，不是“前一项重复一次以上” |
| `(A B *)` | 重复，0~N 次 | 重复整个序列 `(A B)`；不处理分隔符语义 |
| `(A B ?)` | 可选 | 整个序列出现 0 或 1 次；缺省值是 `undefined` |
| `(kw1 kw2 -)` | 关键字集合 | 最长优先匹配；`-` 表示可以什么都不吃，并登记补齐候选 |
| `(A (- "+" "-"; "*" "/" -))` | TDOP 算符表 | `;` 分级，越往后越紧，全部左结合；末尾 `-` 收尾 |
| `A\|B` | 内联选择 | 项级别；`(A B <)` 是组级别，两者不要混用 |
| `(open inner close :par)` | 配对 | 括号提示、嵌套扫描、错误恢复 |
| `(A :setRecur)` + `Recur` | 递归起点 | `Recur` 调用最近的 `:setRecur`；不支持左递归 |

### `<`：有序选择

```text
Val  (Num Bool Str Raw <)
```

依次尝试 `Num`、`Bool`、`Str`、`Raw`。前一项即使吃掉了一些字符，失败后也会回到 `(` 的位置，再从下一项开始。所以**顺序就是优先级**：`Num` 要放在 `Raw` 前面，否则裸文本会把数字吃掉。

`A|B` 只作用于一个 item：

```text
Lit  Num|Str
```

等价于 `(Num Str <)`。

### `+`：带分隔符的 0~N 连接

```text
Ini   (Line /\r?\n/ +) :ini
Cols  (Col "," +)
```

`(Line Sep +)` 表示 0 个或多个 `Line`，相邻两个之间有一个 `Sep`。**末尾的分隔符不算**：

```text
L  (I "," +)
I  /[a-z]+/
```

- 输入 `a,b` → `["a", "b"]`
- 输入空串 → `[]`
- 输入 `a,b,` → 在 `,` 处报“缺少一项”；`+` 不会吞掉尾部空项

如果分隔符前有多项，前面的项先组成一个序列，例如 `(A B C +)` 是 `(A B)` 与 `C` 的连接。

### `*`：纯重复

```text
Sheet  (Rule *)      # 0~N 条 Rule
Value  (Val *)       # 0~N 个 Val
```

`*` 只是把括号里的序列重复 0~N 次，**不认识分隔符**。对比：

```text
List  (Item "," +)   # 推荐：a,b,c，不要求尾逗号
List  (Item "," *)   # 重复 (Item ",")：a,b, 可以；a,b 的最后一个 b 不匹配，会报错
```

`*` 在 `:par` 或顶层遇到失败时，会跳过一块并插入 `err` 节点继续读；这就是 CSS 里一条坏声明不会毁掉整张表的原因。

### `?`：可选

```text
(Where ?)            # 没有 WHERE 也行
(";" ?)              # 分号可省
```

缺省值是 `undefined`；如果外层序列把多个值收集成数组，这个位置就是数组里的一个 `undefined`。注意它作用于整个括号内的序列：`(A B ?)` 是“A B 一起可选”，不是“A 后面跟一个可选的 B”。

### `-`：只有两个位置有意义

`-` 不是通用的“空解析器”，它只出现在两种地方：

1. **关键字集合**：`(pub priv pro override -)`
   - 按最长优先匹配其中一个关键字；
   - 末尾的 `-` 表示这个集合可以什么都不吃（返回 `undefined`）；
   - 当前解析位置会登记到 `ss.comp`，供 UI 的补齐菜单使用；
   - 去掉 `-` 就变成“必须匹配一个关键字”。

2. **算符表**：`(Atom (- "OR"; "AND"; "="; "+" "-"; "*" "/" -))`
   - 开头的 `(-` 标记算符表，结尾的 `-` 标记结束；
   - `;` 分隔优先级，**越往后结合越紧**；
   - 全部左结合，不支持右结合；
   - 表中的算符修饰紧挨在它前面的操作数解析器；
   - 每个结合产生一个 `bin` 节点，值是 `[算符, 左值, 右值]`；
   - 右边缺项时退回到算符之前，把错误留给外层。

写 `(A -)` 或把 `-` 当普通 item 会直接在编译文法时报错。

## 1.3 `/re/`

`/re/` 是粘性正则：只在**当前输入位置**匹配，不会向后搜索。正则本身不跳过空白；真正的“词法空白”由 `@skip` 在每次 token 尝试前处理。

```text
@skip /(?:[ \t]+|[;#][^\n]*)+/
```

- `@skip` 的正则要能一次吃掉一段（用 `+`），否则两个 token 之间可能有剩余空白，最后报“后面多出了 …”。
- `@skip none` 完全关闭跳过。URL 示例就是自己用 `\s` 和 `[^...]` 管住空白。
- `/re/` 里的 `/` 要写成 `\/`；字符类里的 `/` 可以不转义。
- 正则里可以用 `${P}` 插入规则参数，参数必须是字符串字面量；插入时按正则字符转义。CSV/TSV 复用同一组规则就是靠这个：

```text
Table(D)  (Row(D) /\r?\n/ +) :table
Row(D)    (Field(D) D +)
Num(D)    /-?\d+(?:\.\d+)?(?=[${D}\r\n]|$)/ :num

Csv  Table(",")
Tsv  Table("\t")
```

### 字面量与关键字

```text
"SELECT"     # 字符串字面量：匹配 SELECT 这 6 个字符
SELECT       # 大写 = 规则引用（这里会找名为 SELECT 的规则）
select       # 小写裸词 = 关键字 token
```

小写词是关键字，这是元语言的硬规则；所以 SQL 示例把大写关键字写成 `"SELECT"`、`"FROM"`、`"AS"` 这样的字面量。`lit` 在结尾是单词字符时会检查右侧词边界，避免 `true` 匹配到 `truex`。

`@color` 里的规则名按规则染色，`kw` 给关键字染色；`:num` / `:str` 只做值转换，颜色仍由 `@color` 决定。

## 1.4 特殊用法

### `:par`：配对、嵌套扫描与错误恢复

```text
Sect   ("[" Name "]" :par)
Rule   (Sel "," +) ("{" (Decl *) "}" :par)
```

- 第一个 item 是开符，最后一个是闭符，中间是内层；
- 内层的值默认就是 `:par` 的值；要换 tag 再套 `:tag("()")`；
- 开符和闭符都是字符串字面量时，会登记到 `g.pairs`。`skipTo` 用它做嵌套深度扫描，并跳过字符串里的括号；
- 内层出错时，`join` 会落到最近的分隔符或闭符；闭符丢了会一直扫到配对位置，仍找不到就记“需要闭合”，错误挂在开符和闭符上；
- 如果开/闭符是正则而不是字面量，就不会自动登记配对关系。

### `:setRecur` / `Recur`：把递归钉在某一层

```text
Json  ((Val Lit null true false <) :setRecur)
Val   (("[" (Recur "," +) "]" :par) ("{" (Str ":" Recur "," +) "}" :par :obj) <)
```

`Recur` 不是“起始规则”，而是**最近的 `:setRecur` 包住的那个解析器**。这里 `Recur` 会重新进入 `Json`，于是数组和对象可以无限嵌套。`:setRecur` 可以嵌套，取最近的一层。

`Recur` 不能出现在会立刻重新进入自己的最左位置，否则会无限递归；引擎会捕获 `RangeError` 并报“递归过深（左递归？）”。

### `:func`：解析后处理

`:func` 接收 `(value, node, ss)`，返回值替换原值；返回 `FAIL` 则视为这次匹配失败（位置回退，记入期望集合）。

内置常用：

| 写法 | 作用 |
| --- | --- |
| `:num` / `:int` | `Number` / `parseInt` |
| `:str` | `JSON.parse`，失败则去掉首尾引号 |
| `:unq` | CSV 的 `""` 反转义 |
| `:text` | 原样截取源码区间，保留空白与引号 |
| `:obj` | `Object.fromEntries`，把 `[键, 值]` 数组变成对象 |
| `:table` | 首行当表头，其余行变对象数组 |
| `:tag("()")` | 把值包成 `[tag, ...值]`；值是数组就展开，`undefined` 变 `[tag]` |
| `:chainl` | 把 `[首项, [[算符, 项]...]]` 从左往右折叠成数值 |
| `:infix` | 把 TDOP 的 `bin` 节点转成 Lisp 调用 `[算符 左 右]` |

自定义函数通过 `grammar(text, { funcs })` 传入，或先 `Object.assign(P.funcs, funcs)` 再编译。`extra.js` 用的就是后者。节选（完整实现见 `extra.js`）：

```js
ini:    lines => { /* 行值 → 嵌套对象 */ },
dec:    s => { try { return decodeURIComponent(s) } catch { return s } },
url:    ([scheme, user, host, port, path, query, frag]) => ({
          scheme, user, host, port, path,
          query: query && Object.fromEntries(query.map(([k, v]) => [k, v ?? true])),
          fragment: frag,
        }),
sq:     s => ({ str: s.slice(1, -1).replace(/''/g, "'") }),
sqlcall: ([name, args]) => ({ call: name, args: args ?? [] }),
select: ([distinct, cols, [table, alias], where, order, limit]) => ({ /* ... */ }),
```

### `:chainl` 与“不要左递归”

PEG 风格的递归下降不能直接写 `Sum ← Sum "+" Prod`，会无限递归。`lisp.js` 的朴素计算器把它写成链：

```text
Sum   Prod ((Add Prod) *) :chainl
Prod  Atom ((Mul Atom) *) :chainl
Add   /[+-]/
Mul   /[*\/]/
```

`*` 先把 `(Add Prod)` 重复出来，`:chainl` 再从左到右折叠成数值。这个文法不需要作用域，也不需要 walker。


| 文件 | 作用 |
| --- | --- |
| `parse.js` | 组合子核心：`feed` / `eat`、结构组合子、元语言编译器、Lexscope 工具包、i18n 报错 |
| `ui.js` | 编辑器、语法树 / 编译结果、逐步解析、逐步执行、颜色表 |
| `index.html` | 页面入口 |
| `lisp.js` | Lisp 文法（用元语言写）+ 按 tag 分派的求值 walker；另含 TDOP / 朴素 Chain 四则运算 |
| `extra.js` | 额外示例模块：INI / URL / CSS / SQL SELECT / 迷你脚本，以及它们的 `:func` |

- 树节点单击按当前工具处理，双击总是打 `[n]` 标记；`F12` 控制台里 `$1` 是输入流，`$2` 最后悬停节点，`$3` 编译后的语法，`$4` 最近结果，`$5..` 是标记。
- 规则区本身也用元语言描述（`META` v2），所以规则区有高亮、引用跳转和“未定义规则”提示。

---

# 二、Lisp：`=>`、`=`、`.()`、`{}`、`[]`

`lisp.js` 在 `parse.js` 上做了两件事：

1. 用元语言写 Lisp 文法 `RULES`；
2. 写一个**与解析无关**的 walker：只认标签式 AST，按 `tag` 分派。

Lisp 源码里的注释是 `;` 到行尾；元语言文法里的注释才是 `#`。

`@walk lisp` 让 `Ctrl+Enter` 走这个 walker；在 Node 里可以直接：

```js
const P = require('./parse.js')
const L = require('./lisp.js')

const g = P.grammar(L.RULES)
const ss = P.feed('(w@ "hi")')
P.eat(g, ss)
console.log(L.run(ss.value))
```

walker 的公开入口是 `P.walkers.lisp`：`run(program)`、`steps(ast)`、`node(ast, program)`、`show(value)`。`@walk calc` 是同一个 walker 的变体，程序取最后一句的值，所以四则运算不需要 `OK`。

## 2.1 一切皆 tag

Lisp 的 AST 不是类继承，而是“标签式多态调用”：

```text
[fact 5]          →  ["[]", ["", "fact"], 5]        // 语句位置，求值时等价于 ["()", ...]
(fact 5)          →  ["()", ["", "fact"], 5]
(=> (a b) e)      →  ["=>", ["..", "a", "b"], e]
[= f e]           →  ["=", "f", e]
{name "parviz"}   →  ["{}", ["name", "parviz"]]
[1 2 3]           →  ["[]", 1, 2, 3]                // 表达式位置 = 数组
(c)? a Or b       →  ["?", c, a, b]
```

标签为空串 `""` 的节点是名字引用；`".."` 是语句/参数表，`"()"` 是调用，`"[]"` 在语句位置也是调用。`"."`、`"?"`、`"="`、`"=>"`、`"{}"` 都只是 tag；walker 的 `Walk` 表按 tag 取生成器：

```js
const Walk = {
  '': function* (x, env) { /* 名字解析 */ },
  '()': function* (x, env) { /* 调用 */ },
  '[]': function* (x, env, stmt) { /* 语句=调用，表达式=数组 */ },
  '..': function* (x, env) { /* 逐句执行 */ },
  '{}': function* (x, env) { /* 对象 */ },
  '?': function* (x, env) { /* if */ },
  '=>': function* (x, env) { /* lambda */ },
  '=': function* (x, env) { /* 定义 */ },
  '.': function* (x, env) { /* 把基座插为第一个实参 */ },
}
```

解析器用 Lexscope 组合作用域；walker 只关心 tag。两者可以分开替换。

## 2.2 `=>`：lambda

两种括号、两种参数表都行：

```lisp
(=> (a b) (+ a b))
[=> [a b] (+ a b)]
```

参数的括号可以是 `()` 或 `[]`，外层也可以用 `()` 或 `[]`；两者得到完全相同的 AST（`["=>", ["..", "a", "b"], ...]`）。

调用：

```lisp
(w@ ((=> (x) (* x x)) 7))                 ; 49
(w@ (((=> (a) (=> (b) (+ a b))) 2) 3))    ; 5
```

要点：

- `=>` 在 `:fn` 处闭合作用域：参数、函数体内的 `[= ...]` 局部定义都在这个 lambda 的环境里；外层变量仍然可见（闭包）。
- 柯里化就是嵌套 lambda；没有单独的“多参柯里化”魔法。
- 函数体可以有多条语句，但**多语句必须用 `OK` 返回值**：

```lisp
[= add (=> (a b) [= s (+ a b)] (OK s))]
(OK (add 2 3))        ; 5
```

单语句函数体直接返回该语句的值；多语句函数体没有 `OK` 时，副作用照做，但值是 `NO`，并在 log 里给出“多语句缺少 OK 返回”。

- 参数不足时，缺少的参数绑定为 `NO`，不会报参数个数错误。

## 2.3 `=`：定义

`(= 名字 值)` 和 `[= 名字 值]` 都产生 `["=", 名字, 值]`，在当前位置的环境里定义，并返回值。值是匿名 lambda 时，会把函数名补上，便于显示和调试。

```lisp
[= f (=> (a b) (+ a b))]
(OK (f 2 3))          ; 5
```

`def` 是语法糖，和 `=` + `=>` 得到相同 AST：

```lisp
def sq(x) (* x x)
(OK (sq 6))           ; 36

; 等价写法：
[= sq (=> (x) (* x x))]
```

注意 `def` 的体只接受**一个**表达式（文法里是 `Defn "def" Var Params Recur`）。需要多条语句时用 `[= f (=> (参数...) 语句1 语句2 ...)]`。

`[= ...]` 在表达式位置也是定义，因为文法里 `Let` 排在 `Brk` 前面，且用 `(?=\s*=\s)` 前瞻：

```lisp
(w@ [= x 1] x)     ; 1 1
```

作用域：

- 顶层 `Lisp (Exp *) :global :tag("..")` 绑定顶层定义；
- 函数调用创建子 `Env`，参数和局部 `=` 不会泄漏到外层；
- 引用解析不到、又不是内建时，解析阶段就会在 `:global` 报“未定义 xxx”；
- 函数体里的递归引用能解析到外层的 `def` / `= f`，因为 lambda 的 `env` 指向定义处的外层环境。

## 2.4 `.()` / `.[]`：把基座插为第一个实参

`base.(f a b)` 脱糖为 `(f base a b)`；`.` 是左结合的：

```lisp
(w@ [1 2 3].(len))          ; 3
(w@ 5.(+ 2).[* 10])         ; 70
(w@ [1 2 3].(map (=> (x) (* x x))))   ; [1 4 9]
```

`.()` 和 `.[]` 都可以，后者把方括号里的内容当调用：

```lisp
[= user {name "parviz" langs ["js" "lisp"]}]
(OK user.[get "name"])         ; parviz
```

`[len a].[+ 1]` 也是同一个机制：这里 `[len a]` 处在函数体的**语句位置**，先按调用求值为 `(len a)`；随后 `.[+ 1]` 把结果插到 `+` 的第一个实参位置，等价于 `(+ (len a) 1)`。

要点：

- `.` 后面只能是 `( … )` 或 `[ … ]`；`x.(=> ...)` 不合法，因为 `(=> ...)` 是 `Lam`，不是 `List`。
- 语法树会显示脱糖后的形式，例如 `[3 14 15 9 26].(big 10)` 显示为 `[big [3 14 15 9 26] 10]`。
- `.` 的基座继承 `.` 自身所在的位置：作为实参时是表达式（`[1 2 3]` 是数组），作为函数体语句时是语句（`[len a]` 是调用）。`. ` 右边的实参始终按表达式求值。

## 2.5 `{}`：对象

```lisp
(w@ {name "parviz" langs ["js" "lisp"]})
; {name "parviz" langs ["js" "lisp"]}

(w@ {"a b" 1 n 2})
; {a b 1 n 2}
```

- 键可以是裸符号（`SYM+`，不能含 `()[]{}",;?.` 和空白），也可以是带引号的字符串；带引号的键通过 `:str` 变成真正的字符串，所以可以含空格。
- 值可以是任意表达式；键不参与求值。
- 空对象是 `{}`；重复键后写覆盖先写。
- 取值用 `(get obj "key")`，列键用 `(keys obj)`。

## 2.6 `[]`：数组还是调用，取决于位置

这是 Lisp 里最容易踩的一点：

- **语句位置**：`[f a b]` 是调用，等价于 `(f a b)`；
- **表达式位置**：`[1 2 3]` 是数组。

“语句位置”包括顶层程序的每条语句，以及函数体里的每条语句；“表达式位置”包括实参、`=` 的值、对象值、`OK` 的实参、`?` 的条件与分支等。`.` 的基座不在这个固定列表里：它继承 `.` 自身的位置（见上一节）。

```lisp
(w@ [1 2 3])      ; [1 2 3]      —— 实参位置，数组
(OK [1 2 3])         ; [1 2 3]      —— OK 的实参位置，数组
[1 2 3]              ; 错误：1 不可调用 —— 顶层语句位置，当成调用
```

因此，若程序/函数体的最后要“返回一个数组”，要写成 `(OK [1 2 3])`，不能只写 `[1 2 3]`。

特例：

- `[= x 1]` 即使出现在表达式位置也解析成 `Let`（不是数组），因为 `Let` 规则先匹配 `=` 前瞻；
- `.[...]` 里的 `[]` 由 `.` 的 walker 直接当调用处理，不管它处在什么位置；
- `[fact 5]` 在语句位置求值时走 `Walk['[]']` 的 `stmt` 分支，和 `(fact 5)` 等价；AST 里仍然保留 `[]` 标签。

## 2.7 `? ... Or ...`、`NO`、`OK`

### 条件表达式

```lisp
(> x 10)? x Or NO
```

文法里 `? ... Or ...` 是 `["?", 条件, 真值, 假值]`。`Or` 在这里是字面量分隔符；`Name` 规则的前瞻排除了单独的 `Or`，所以 `Order` 可以，裸 `Or` 不行。

```lisp
(w@ ((=> (x) (> x 3)? "big" Or "small") 5))   ; big
```

真值判断只把 `NO`、`false`、`null` 当假；`0` 和 `""` 都是真。比较运算返回 JS 布尔值，所以可以：

```lisp
(w@ (not (> 1 2)))    ; true
```

### `NO`

`NO` 是“没有值”的哨兵：

- `(at arr i)` 越界、`(get obj k)` 缺键都返回 `NO`；
- `(not NO)` → `true`；
- `mapNotNO` 会过滤掉回调返回的 `NO`。

```lisp
(w@ (at [1] 9))       ; NO
(w@ [1 20 3 40].(mapNotNO (=> (x) (> x 10)? x Or NO)))   ; [20 40]
```

### `OK`

`OK` 是流控返回：它抛出 `Ret`，由函数体/程序的 `body` 捕获。

- 单语句体直接取该语句的值；
- 多语句体/程序必须用 `(OK value)` 返回，否则最后值是 `NO` 并记录警告；
- `@walk calc` 使用 `last=true`，多语句程序取最后一句的值，所以四则运算示例不需要 `OK`。

```lisp
[= add (=> (a b) [= s (+ a b)] (OK s))]
(OK (add 2 3))     ; 5
```

### 常用内建

| 类别 | 名字 |
| --- | --- |
| 算术 | `+` `-` `*` `/` `%` |
| 比较 | `>` `<` `>=` `<=` `==` `!=` |
| 逻辑 | `not` |
| 数组 / 对象 | `at` `get` `len` `keys` `list` `concat` `push` `range` `sum` |
| 高阶 | `map` `filter` `mapNotNO` `reduce` |
| 流控 / 输出 | `OK` `w@` |
| 常量 | `NO` |

`w@` 每次求值会往 `log` 里写一行，并返回最后一个实参。

## 2.8 综合示例

这段就是 `lisp.js` 里的 `Lisp` 示例，覆盖了 `=`、`=>`、`def`、`.()`、`{}`、`[]`、`? ... Or ...`、`NO`、`OK`：

```lisp
; 语句位置的 [..] 是调用；[e1].[e2] 即 (e1).(e2 ..) 即 [e2 [e1] ..]
[= big (=> (xs n) xs.(mapNotNO (=> (x) (> x n)? x Or NO)))]
def fact(n) (<= n 1)? 1 Or (* n (fact (- n 1)))
[= inc1 (=> (a) [len a].[+ 1])]
[= user {name "parviz" langs ["js" "lisp"]}]
(w@ "fact 5 =" (fact 5) "big:" [3 14 15 9 26].(big 10) user.[get "name"] (inc1 [1 2 3]))
(OK [123].(mapNotNO (=> (x) (> x 10)? x Or NO)).[at 0])
```

运行结果：

```text
fact 5 = 120 big: [14 15 26] parviz 4
```

最终值：

```text
123
```

逐段看：

- `big` 接收数组 `xs` 和阈值 `n`，用 `.()` 把 `xs` 插到 `mapNotNO` 的第一个实参位置；回调 `(> x n)? x Or NO` 不满足时返回 `NO`，`mapNotNO` 过滤掉。
- `def fact(n)` 定义递归函数；`(<= n 1)? 1 Or (* n (fact (- n 1)))` 是条件表达式。
- `inc1` 用 `[len a].[+ 1]`：先取长度，再作为 `+` 的第一个实参。
- `user` 是对象；`user.[get "name"]` 是 `(get user "name")`。
- `w@` 的参数里，`[3 14 15 9 26]` 是数组，`[123]` 也是数组；最后的 `OK` 让程序返回 `123`，而不是 `NO`。

---

# 三、API 速查

```js
const P = require('./parse.js')
const L = require('./lisp.js')

// 1) 编译文法
const g = P.grammar(rulesText)
console.log(g.errs)        // 文法自身的错误
console.log(g.start)       // 起始解析器

// 2) 准备输入流并解析
const ss = P.feed(srcText, 'feed$A')
const value = P.eat(g, ss)

console.log(value)         // 根值
console.log(ss.tree)       // CST（Node）
console.log(ss.errs)       // [{a,b,msg,node}]
console.log(ss.sloc(ss.tree))  // './feed$A:1:0'

// 3) Lisp 求值
const r = L.run(value)     // { value, log, steps } 或 { err, x, log }
console.log(L.show(r.value))
```

- `P.feed(src, file, i=0)` 返回 `ss`：`ss(n)` 偷看/吃掉 `n` 个字符（负数表示吃掉），`ss.i` 是当前位置，`ss.sloc` / `ss.nodeOf` / `ss.marks` / `ss.onedit` / `ss.comp` 是 UI 和调试接口。
- `P.grammar(text, { funcs })` 在编译时合并 `P.funcs`；自定义 `:func` 要在编译前注册。
- `P.eat(g, ss)` 会设置 `ss.tree`、`ss.errs`、`ss.value`，返回根值。
- `L.run(ast)` 最多执行 300000 步；`L.steps(ast)` 返回可逐步迭代的生成器；`L.node(ast, program)` 在完整程序环境里单独求值某个节点。
- `P.walkers.lisp` / `P.walkers.calc` 是 `@walk` 可用的 walker；`P.examples` 里是内置示例，`extra.js` 通过 `(P) => ({ funcs, examples })` 追加。

`extra.js` 里的 URL、迷你脚本等示例还会用到：

- `@skip none` 与 `:dec`（`decodeURIComponent`）；
- `:chainl` 的朴素左结合；
- `:apply` / `:infix` / `:arg2nth` / `:fn` / `:let` 把迷你脚本直接编译成 Lisp AST，再用 `@walk calc` 执行。

它们都可以在页面示例下拉框里直接切换查看。
