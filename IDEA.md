> 1

写一个递归下降算法可视化，示范是用于解析JSON格式，以及解析CSV/TSV的组合子代码复用。 

解析需输出CST和代码高亮。如 `u=eat(json, ss=feed("[1,{}]")); ss.sloc(u[1])=="./feed.In1:1:3"` ，高亮直接用CSS.hilight。更新时若不破坏词条的语法，直接顺延Range对象并触发 ss.onedit("old","new")

语法树可视化总是 [123 s[exp] "r"] 格式，也有高亮，可悬停点击交互查看。 页面UI竖排这样： [输入区CtrlEnter] [语法树区 80%, 语法规则区 20% 有下拉示例选择] 

步骤可视化方法： 输入区的selectionStart/End。 用户随取一个位置，方向右键，就进入可视化模式。

之后右键可以看到逐步触发的规则，以及“调用栈”（像补齐菜单一样在光标下显示，含规则名与起始sloc），吃完一个规则sel.start会标出吃了什么。左键回溯的同时将菜单变成临时语法树（和语法树区一样）。

组合子的元语言参考：

```
# see also https://regex101.com/r/tA9pM8/1
Json  ((Val Lit null true false <) ~) # 有序选择（PEG）和指定递归"Recur"起点。不支持左递归，支持链

Val ( ("[" (Recur "," +) "]" :par)   ("{" (Str":"Recur "," +) "}" :par) <)

# (... +) for join(0~N), (... :par) for custom func (add pairing hint)

Lit Num|Str

Num /-?(0|[1-9][0-9]*)(\.\d+)?([eE][+-]?\d+)?/
Str /"/ ( EscAtEnd *)  /"/
EscAtEnd /(\\(?>[nrtbf"\\]|u[0-9a-fA-F]{4})|[^\\])*/
```

对错误输入要能落到最近的repeat结构，或其外层:par闭合符继续读。sloc模块需要统求全屏提示的位置，点击goto悬停连线，让源码的对应位置也有 [1] [2] 的小字marker。 

对理解递归下降友好的交互方法，你可以再加。

第二部分还要支持Lisp [= fname (=> (arg1) [e1].[e2] 赋值与def语法)] ，其中 [e1].[e2]，即 (e1).(e2 ..) 或 [e2, [e1], ..] 是为了测试parse后数据结构处理时的灵活性

代码高亮分BYGRP五种。数字蓝色，字符串黄，错误红波浪，参数紫色。 这意味着词法作用域（变量区分）也要在组合层存在，支持参数和新赋值的处理、全局键引用、Ctrl点击跳转到定义，接口由你设计。


可供参考的代码风格：

```js
feed=(s,i=0)=>n=>{let q=n<0,r=s.slice(i,i+(q?-n:n)); if(q)i-=n; return r}
Many=(p ,r)=>s=>{let a=[];while(r=p(s))a.push(r) ;return a}

lisp=Many((s ,ret)=>(
  re(s, /(\d+)/,parseInt)||re(s, /(\w+)/,str=>str) ||
  (s(1)=='('? (s(-1), ret=lisp(s), s(-1)==')', ret) : null)
))

num=[/\d/, parseInt] // 要自带后处理功能。第二部分可能 AST walk 也要能封装为 {Def(rep,...lit){rep(变换)}, } 从而实现逐步执行

eat(num, feed("   567").also{it.skip=/\s+/})==567; // 如果 it.st 高亮状态存则，则不自动跳过空格

//错误时跳到该 repeat 的分隔符
```

> 1 ack

小写一定关键字字面量，不可能是规则名

CSV/TSV：RFC4180（引号字段、`""` 转义、首行表头），分隔符参数化

eval可以随第三部分一起写了。  `(OK [123].(mapNotNO (=>(x) (> x 10)? x Or NO )).[at 0] )` ， ()? A Or B 是if表达式，OK是流控返回（多语句时必须），[] {} 在表达式位置应是数组/KV

- 规则区可编辑，它自己给自己写个语法
- :par 就是实现配对提示和报错，生成的数据可以作为 [s "litvalue" [:par "sloc"] [: ..]] 挂在尾部，默认逐个折叠
- 要点是键盘右键就像parser一样往右直扫，不需要对理解回溯很有用，只要在遇选择时使用黄色为选区颜色
- sloc模块负责渲染与交互，以全屏为单位打标，所以可以执行连接线draw等操作
- 绿色G是给函数名，注意颜色表的复用。

> 2

【编译】应为切换语法编译结果展示。  当结构性编辑时，注意恢复光标位置和避免高亮闪烁。 上边的BYGRP点了可以用颜色picker，保存。

解析结果不是 "值 = " 而要是 "$4 = .."，最后悬停的项目是"$2"，确保F12时易用

【步进】应为聚焦任意位置，右方向时即启用，和Alt键无关。

AST 显示应为如下格式： [Val.A [.. "name" "parviz"]  ] [-Table [Row [..name age quote]] ] ，[-Tag] 表示Tag已折叠，[Tag] 照常

总之，确保像函数调用。Lisp 不要把 =, => 这些噪音显示出来，而是 [.. [= big [=> [.. xs n]]] ...] 那样，正确利用多态

步进面板，不显示失败的回溯的，只是在选区为黄色时显示 (Val Lit null.. <) 包含的那些项（显示其前缀）。  stack不要只显示规则名，是 "预览前缀 ./feed$A:row:col" ，规则名在悬停时才用setSelection在#rules里指出来。 默认文件名改成 feed$A

【解析】等按钮让人困惑。应该删掉此栏（手机上改为对右键和Ctrl+Ent,F8..的模拟按钮）。  实际应onblur自动解析，Ctrl+Enter执行带walker的语法。 确保eval的实现足够独立，手工可维护

在顶栏上select/wheel可切换点击Node时的工具： [n]标记(应从$5往右继续数)、[n]标记带指示线、折叠展开、独立求值、清空[n]标记。 标记在 feed.marks=[] 里可赋值修改

> 3

解析器步进，不要包含Tsv-Table-Row-Field这样的纯粹递归进入，trace里也（在nav给个开关）折叠掉，直接定位到Field。 只有Shift+右键时会显示递归返回。 

F8只在有[n]标记的地方中断，或者在下个返回或判断时中断，连参数带返回一起显示。 不要给名字解析和函数的进入中断，除非标记了

Lisp 的 [=>] 不应该是魔法，如果用 def Name"(" (Args :arg2nth) ")" Exp 来写，应该完全一样，它属于parsec提供的Lexscope工具包。 "=", "=>" 这些前缀只是标签， [fact 5] 这些AST在walk步骤被视为等同 ["()" ["" "fact"] 5]， 它只是多态调用， "..", "?" 同理

加个input（在匹配函数名处中断），默认是 "?|.*" ，行为和现在一样

折叠需要对多行[rule]有效。增加【深度折叠展开】工具

上下面板给个resize。 (A ~) 语法给换成 (A :setRecur)

不要有 @start 。第一条就是start，TSV/CSV 两个版本直接用常量拼

加一个 Kwd  (pub priv pro override -) 语法，它本身不消耗什么，但能指示代码补齐UI。比如在 Kwd overri^ fun Name 里光标位置可用补齐，但 (Kwd Kwd *) fun 这样，就等效于 (/pub|pro../ *)

> 4

点击括号折叠，只有在折叠工具中有效，其他按工具（默认=独立求值）。双击视为标记。 [1-6] 切换工具

删掉trace里左键临时语法树，精简其代码。 【吃下】时临时用箭头连接到对应AST。 判定状态的选区、trace都改成蓝色（颜色B）风格

报错显示： ∅改成"😡😡😡"

onedit留最近一次就够了，"// 仅顺延了 Range 与 CST 区间，.."  提示改成 "// try ss.onedit=alert" 即可。 onedit 需要使用hashline算法（关于自身及左侧至行首字符），解析完先通知一遍，有变更再执行。 占位实现就是写 #out.val 并显示该词条被编辑了几遍

#menu.hd，比如 → "t 做一个5字符红色渐变…… 写好了： text linear-gradient(95deg, white, 1em, white, 1em, red, 50%, transparent)

Meta 你再补充个 v1 的版本，确保现在的v2复用了lexscope，有较高代码质量

修改报错文本，并允许国际化（设计 f`${}` 字符串，利用外部json翻译其常量段落）

```
E1 ./feed$A:1:0  未闭合的 [（期望 "]"）
E2 ./feed$A:1:4  缺少元素；期望 "[" 或 "{" 或 Num 或 Str 或 null 或 true 或 false
E3 ./feed$A:1:10  无法识别 "\"a\" 1"；期望 ":"
E4 ./feed$A:1:28  无法识别 "4"；期望 ","
E5 ./feed$A:1:36  无法识别 "}"；期望 ","
E6 ./feed$A:2:14  无法识别 "nul"；期望 "[" 或 "{" 或 Num 或 Str 或 null 或 true 或 false
E7 ./feed$A:2:26  缺少 "]"；期望 "," 或 "]"

->

E1 ./feed$A:1:0  这有个 [ 需要闭合 "]"
E2 ./feed$A:1:4  缺少一项，比如 "[" 或 "{"
E3 ./feed$A:1:10  其中有 ":" ——不是 "\"a\" 1"
E4 ./feed$A:1:28  其中有 "," ——不是 "4"
E5 ./feed$A:1:36  其中有 "," ——不是 "}"
E6 ./feed$A:2:14  什么是 "nul" ？这里支持 "[" 或 "{"
E7 ./feed$A:2:26  需要闭合 "]"

```

> 5

coll 好像无效了？(在判定 <) 里含判定的层仍然是要折叠的。  nav BYGRP 的演示自身也没有颜色了                                                                                                                                        
对于 [=] 和函数名的mark应视为在body上打的暂停                                                                                                                                                                                     

Lisp的函数调试应该和表达式断点一样，一次性展示参数列表和返回                                                                                                                                                                     
                                                                                                                                                                                                                                  
lisp.js 的头部预先写一个+-*/和括号的文法， 支持单参lexscope，如 -> y x+1 ; -> y1 x*2                                                                                                                                             
参考的TDOP算法风格：                                                                                                                                                                                                             
                                                                                                                                                                                                                                  
 #3                                                                                                                                                                                                                             
                                                                                                                                                                                                                                  
仍然添加在 ( -) 语法中，使用 (- "+" "-"; "*" .. -) 风格即可，不支持右结合。

再加一个朴素Chain（左递归）风格四则计算器，不需要scope
