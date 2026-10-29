/* extra.js — 额外示例：INI / URL / CSS / SQL SELECT / 迷你脚本，连同它们的 :func。
   由 ui/app.js 动态加载（#extra.js..CSS）：整份就是一句 (P) => { funcs, examples }，没有 IIFE / require / 全局。 */
(P) => {
const { T, parts } = P
const dec = s => { try { return decodeURIComponent(s) } catch { return s } }

const funcs = {
  // INI：行值是 undefined（空行）| 节名 | [键, 值]
  ini: lines => {
    const o = {}; let cur = o
    for (const l of lines) if (typeof l == 'string') cur = o[l.trim()] ??= {}; else if (Array.isArray(l)) cur[l[0]] = l[1]
    return o
  },
  dec,
  // URL：[scheme, user, host, port, path, query, frag]，可选部分为 undefined
  url: ([scheme, user, host, port, path, query, frag]) => ({
    scheme, user, host, port, path,
    query: query && Object.fromEntries(query.map(([k, v]) => [k, v ?? true])), fragment: frag,
  }),
  // CSS：[[选择器...], [[属性, 值文本]...]]...
  sheet: rules => rules.map(([sels, decls]) => ({ selectors: sels, decls: Object.fromEntries((decls || []).map(([p, v]) => [p, v])) })),
  // SQL：'..' 里 '' 转义
  sq: s => ({ str: s.slice(1, -1).replace(/''/g, "'") }),
  sqlcall: ([name, args]) => ({ call: name, args: args ?? [] }),
  select: ([distinct, cols, [table, alias], where, order, limit]) => ({
    distinct: !!distinct,
    columns: cols == '*' ? '*' : cols.map(([e, as]) => as ? { expr: e, as } : e),
    from: alias ? { table, as: alias } : table,
    where, orderBy: order?.map(([e, dir]) => ({ expr: e, dir: dir ?? 'ASC' })), limit,
  }),
  // 迷你脚本：Atom (Args *) → 逐个套成调用 ["()", f, 实参...]；树里显示为 [f 实参..]
  call: (v, n) => {
    const [f, calls] = v; if (!calls.length) return f
    const pn = parts(n), an = parts(pn[1]); let acc = f
    calls.forEach((as, k) => { acc = T('()', [acc, ...(as || [])], n, [k ? null : pn[0], ...parts(an[k])]) })
    return acc
  },
}

const INI = `# INI：[节] 与 键 = 值；; 或 # 开头是注释；值依次试 数字、布尔、"字符串"、裸文本
@skip /(?:[ \\t]+|[;#][^\\n]*)+/
@color Name=G Key=P Num=B Str=Y Raw=Y kw=B
Ini   (Line /\\r?\\n/ +) :ini
Line  ((> Sect Pair <) ?)
Sect  ("[" Name "]" :par)
Name  /[^\\]\\n]+/
Pair  Key "=" Val
Key   /[\\w.-]+/
Val   (> Num Bool Str Raw <)
Num   /-?\\d+(\\.\\d+)?(?=[ \\t]*(?:[;#\\r\\n]|$))/ :num
Bool  (> true false <)
Str   /"(\\\\.|[^"\\\\\\n])*"/ :str
Raw   /[^;#\\r\\n]*[^\\s;#]/`

const URL_RULES = `# URL：scheme://user@host:port/path?query#fragment，除 scheme 与 host 外都可选；%xx 由 :dec 解码
@skip none
@color Scheme=B Host=Y Port=B Key=P Val=Y Path=G
Urls    (Url /\\r?\\n/ +)
Url     Scheme "://" (User ?) Host (Port ?) (Path ?) (Query ?) (Frag ?) :url
Scheme  /[a-z][a-z0-9+.-]*/
User    /[^@\\/\\s]+/ "@"
Host    /[^\\s\\/:?#@]+/
Port    ":" /\\d+/ :num
Path    /\\/[^?#\\s]*/ :dec
Query   "?" (Param "&" +)
Param   Key ("=" Val ?)
Key     /[^=&#\\s]+/ :dec
Val     /[^&#\\s]*/ :dec
Frag    "#" /\\S*/`

const CSS = `# CSS 子集：选择器组 { 属性: 值; }，/* 注释 */ 跳过；值里的数字、颜色、字符串、函数分别着色，值本身取原文
@skip /(?:\\s+|\\/\\*[\\s\\S]*?\\*\\/)+/
@color Sel=G Prop=P Num=B Color=B Str=Y Fn=G
Sheet  (Rule *) :sheet
Rule   (Sel "," +) ("{" (Decl *) "}" :par)
Sel    /[^,{}\\/\\s](?:[^,{}\\/]*[^,{}\\/\\s])?/
Decl   Prop ":" Value (";" ?)
Prop   /-?[a-zA-Z][\\w-]*/
Value  (Val *) :text
Val    (> Num Color Str Call Word Sep <)
Num    /-?(?:\\d+\\.?\\d*|\\.\\d+)(?:%|[a-z]+)?/
Color  /#[0-9a-fA-F]{3,8}\\b/
Str    /"[^"\\n]*"|'[^'\\n]*'/
Call   Fn ("(" (Val *) ")" :par)
Fn     /[\\w-]+(?=\\()/
Word   /!?[\\w-]+/
Sep    /[,\\/]/`

const SQL = `# SQL SELECT 子集。大写关键字写成字面量 "SELECT"（元语言里小写词才是关键字）；
# WHERE/列 表达式用算符表，由松到紧：OR；AND；比较；+ -；* /。值是 [算符 左 右] 嵌套
@color Num=B Str=Y Ident=P Fn=G
Query  "SELECT" (Distinct ?) Cols "FROM" Table (Where ?) (Order ?) (Limit ?) :select
Distinct "DISTINCT" :text
Cols   (> ("*" :text) (Col "," +) <)
Col    Exp (As ?)
As     "AS" Ident
Table  Ident ((> As Ident <) ?)
Where  "WHERE" Exp
Order  "ORDER" "BY" (Key "," +)
Key    Exp (Dir ?)
Dir    /ASC|DESC/
Limit  "LIMIT" Num
Exp    (Atom (- "OR"; "AND"; "=" "<>" "!=" "<=" ">=" "<" ">"; "+" "-"; "*" "/" -))
Atom   (> Num Str Call ("(" Exp ")" :par) Ident <)
Call   Fn ("(" (> ("*" :text) (Exp "," +) <) ")" :par) :sqlcall
Fn     /[A-Za-z_]\\w*(?=\\()/
Num    /\\d+(\\.\\d+)?/ :num
Str    /'(?:''|[^'])*'/ :sq
Ident  /(?!(?:SELECT|DISTINCT|FROM|WHERE|ORDER|BY|LIMIT|AS|AND|OR|ASC|DESC)\\b)[A-Za-z_][\\w.]*/`

const ID = '(?!(?:let|if|then|else)\\b)[A-Za-z_][\\w@]*'   // 标识符：排除关键字；允许 @（内建 w@）
const MINI = `# 迷你脚本：let 定义、箭头函数、调用、if 表达式、数组；作用域全由 Lexscope 组合：
# :arg2nth 参数表 + :fn 闭合 lambda、:let 定义（值是 lambda 时函数名绿色）、:ref 引用、:global 顶层；
# 算符表 + :infix 产出 Lisp 调用，@walk calc 复用 Lisp 的 walker（程序取最后一句的值）
@color Num=B Str=Y
@walk calc
Prog   (Stmt ";" +) :global :tag("..")
Stmt   (> Let Exp <)
Let    "let" Var "=" Exp :let
Exp    (> If Lam Bin <)
If     "if" Exp "then" Exp "else" Exp :tag("?")
Lam    Params "=>" Exp :fn
Params (> ("(" ((Pname "," +) ?) ")") Pname <) :arg2nth
Bin    (Call (- "==" "!=" "<=" ">=" "<" ">"; "+" "-"; "*" "/" "%" -)) :infix
Call   Atom (Args *) :call
Args   ("(" ((Exp "," +) ?) ")" :par)
Atom   (> Num Str Arr ("(" Exp ")" :par) Name <)
Arr    ("[" ((Exp "," +) ?) "]" :par :tag(".."))
Num    /\\d+(\\.\\d+)?/ :num
Str    /"(\\\\.|[^"\\\\])*"/ :str
Var    /${ID}/
Pname  /${ID}/
Name   /${ID}/ :ref`

return {
funcs,
examples: [
  { name: 'INI', rules: INI, input: `; 全局设置
name = parviz
debug = true

[server]
host = "0.0.0.0"   ; 引号字符串
port = 8080
ratio = 0.75

[paths.data]
root = /var/lib/parviz` },
  { name: 'URL', rules: URL_RULES, input: `https://ada@example.com:8443/docs/a%20b.html?q=%E4%B8%AD&lang=zh&debug#top
ftp://files.example.org/pub
http://localhost:3000/?x=1&y=` },
  { name: 'CSS', rules: CSS, input: `/* 主题 */
body, html { margin: 0; font: 14px "Fira Code", monospace; color: #d7dae0 }
.card > h2:hover {
  background: linear-gradient(to right, #61afef, rgba(0, 0, 0, .5));
  padding: 4px 8px !important;
}` },
  { name: 'SQL SELECT（复杂）', rules: SQL, input: `SELECT DISTINCT name, age * 2 AS dbl, COUNT(*)
FROM users u
WHERE age >= 18 AND (city = 'Paris' OR city = 'Rome') AND score / 2 + 1 > 3
ORDER BY age DESC, name
LIMIT 10` },
  { name: '迷你脚本（复杂）', rules: MINI, input: `let fact = n => if n <= 1 then 1 else n * fact(n - 1);
let add = (a, b) => a + b;
let twice = (f, x) => f(f(x));
let xs = map(range(1, 6), x => x * x);
w@("fact(5) =", fact(5), "squares:", xs);
twice(y => add(y, 10), 1) + sum(xs)` },
],
}
}
