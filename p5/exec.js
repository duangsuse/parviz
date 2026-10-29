/* exec.js — p5.html 的 7 个内置示例（Lisp）。
   约定：toplevel 语句 = setup；tick.{ … } 每个重画帧跑一次，see.{ … } 固定 20 Hz 的物理帧（frameRate 60 20 的第二个数）；两者都可随时动态注册，返回句柄给 off；on "事件" 注册事件；
   语句里同一行并列即调用：fill 1 2 3、console.log "hi"；零实参要写 [noStroke]，参数位置要写 (f a b)；.{ … } 块里同样是语句，隐式参数叫 u；
   中缀只在头是 > 的括号里：(> a + 2b)、比较 [> a <= b]?，减法 (> a - b)，取负 (neg a)；
   状态放对象里，用 s..[-> {k v}] 原地改；#66ccff 是颜色字面量，悬停整数实参 / 颜色可在编辑器里调。 */
const P5EX = [{
  name: 'Hello：toplevel 即 setup',
  src: `# toplevel 语句就是 setup，只跑一次；JS 函数直接当 Lisp 函数调：同一行里 f a b 并列即调用
# 格式声明：没写的 p5 函数（fill / rect / text / textAlign …）按内置声明推断出悬停部件（Tweak 面板里列出推断的声明，可写进源码）；自己写 (tweak …) 就以它为准
(tweak circle (vec2 0 1) (num 2))
createCanvas 400 300
background 30 30 46
[noStroke]                    # 没有实参的调用要写括号，否则只是名字
fill #f38ba8                  # 颜色字面量：悬停拾色；整数实参（fill / circle …）也能悬停调
circle 120 150 90
fill 166 227 161 210
rect 180 90 120 120 20
fill 255
textSize 20
textAlign CENTER CENTER
text "hello, p5 × lisp" 200 250

# cond?.{ … } 是开关：点 ?.{ 在 cond 与 (isnt cond) 之间切换（关掉时整块变灰）
"on"?.{ rect 20 20 60 30 8 }
# btn_ 开头、没有参数的 def 是按钮：点函数名（或 Tweak 面板里的 ▶ 执行）运行它
def btn_dot():
  fill (random 255) (random 255) (random 255)
  circle (random width) (random height) 40
...

# console.* 也进下面的 Console；Lisp 函数可以当回调参数传给 JS
console.log "canvas" width height
console.log "hi" 123 (=>() 456)    # console.log … 是 JS 的方法调用，this 是 console

# 模板字符串可多行；echo\`…\` 调 echo(字符串段数组, 值…)，多出来的实参用 (xargs) 取；html … 往 Console 输出 HTML
(- World "p5")
def echo(strs ..):
  (- vs (xargs))
  html (reduce (range (len vs)) (=> (acc i) \`\${acc}<b style="color:#f38ba8">\${(at vs i)}</b>\${(at strs (+ i 1))}\`) (at strs 0))
...
echo\`Hello \${World}, \${width}×\${height}\`
`,
}, {
  name: '跟随鼠标：tick',
  src: `createCanvas 400 300
[noStroke]

# tick.{ … } 每个重画帧跑一次（see.{ … } 才是固定 20 Hz 的物理帧）；mouseX / width 这些 p5 变量每次引用都读最新值
tick.{
  background 24 24 37 40                         # 带透明度，留下拖尾
  fill (remap mouseX 0 width 80 255) 140 (remap mouseY 0 height 255 80)
  circle mouseX mouseY 36
}
`,
}, {
  name: '弹球：see 物理帧 + tick 重画',
  src: `createCanvas 400 300
frameRate 60 20                  # 最多 60 fps 重画；see 的物理帧 20 Hz
[noStroke]

# 名字是不可变绑定，会变的状态放进对象，用 ball..[-> {…}] 原地改
(- ball {x 200 y 60 vx 9 vy 0 r 18})
(- gravity 1.2)

# see：物理，固定 20 Hz，和重画帧率无关（所以每一步的位移是 tick 版的三倍）
see.{
  ball..[-> {vx (if-wall ball.x ball.r width ball.vx)  vy (> ball.vy + gravity)}]
  ball..[-> {x (> ball.x + ball.vx)  y (> ball.y + ball.vy)}]
  (> ball.y + ball.r > height)? ball..[-> {y (> height - ball.r)  vy (> ball.vy * -0.92)}] Or NO
}
# tick：每个重画帧画一次（物理 20 Hz、画面 60 fps，球一格一格地动）
tick.{
  background 17 17 27
  fill 249 226 175
  circle ball.x ball.y (> ball.r * 2)
}

# x 碰墙就反向
def if-wall(x r w vx):
  (> x + r > w)? (neg (abs vx)) Or (> x < r)? (abs vx) Or vx
...
`,
}, {
  name: '正弦波：each + range',
  src: `createCanvas 480 240
[noStroke]

# [each …].{ … }：块是最后一个实参，u 是当前下标
tick.{
  background 20 20 30
  [each (range 48)].{
    fill (> 120 + 3u) 150 (> 255 - 3u)
    circle (> 12 + 9.5u) (> 120 + 80 * (sin (> 0.3u + 0.06 * frameCount))) 14
  }
}
`,
}, {
  name: '点击生成粒子：动态注册 tick / on',
  src: `createCanvas 480 300
[noStroke]
tick.{ background 18 18 28 }                     # 最先注册，每帧最先跑：清屏

# 每个粒子是一个自己注册、自己 off 的 tick：tick.{ … } 返回句柄
def spawn(x y):
  (- s {x x y y vx (random -2 2) vy (random -4 -1) a 255})
  (- h tick.{
    s..[-> {x (> s.x + s.vx)  y (> s.y + s.vy)  vy (> s.vy + 0.08)  a (> s.a - 4)}]
    fill 243 139 168 s.a
    circle s.x s.y 12
    (> s.a < 0)? (off h) Or NO
  })
...

[on "mousePressed"].{ [each (range 14)].{ spawn mouseX mouseY } }
console.log "点一下画布"
`,
}, {
  name: '异步：自动 await Promise',
  src: `# 返回 Promise 的调用自动 await：toplevel / tick 里可以直接顺序等待
createCanvas 420 200
background 30 30 46
[noStroke]
console.log "start" (Promise.resolve 42)         # 打印 42，不是 Promise

[each (range 5)].{
  fill (> 50u) 150 220
  circle (> 50 + 80u) 100 50
  wait 400                                       # wait 返回 Promise；setup 在这里等
}
console.log "setup 结束，draw 才开始"

# tick 里 await：这个 tick 没跑完时后续帧跳过它 = 协程，一秒一次
(- st {n 0})
tick.{
  st..[-> {n (> st.n + 1)}]
  fill 255 st.n
  textSize 18
  text (str "tick " st.n) 20 (> 170 + st.n % 3 * 10)
  wait 1000
}

# (fetch "https://...") 也是 Promise；(.json) 之类的方法写成 (r.json)
`,
}, {
  name: '分形树：def 递归 + 断点',
  src: `# 双击函数名（如 branch / grow）设断点，每次返回都暂停，F9 继续
createCanvas 480 360
frameRate 30
(- st {a 0.5})

def branch(len depth):
  strokeWeight (> 1 + 0.8depth)
  line 0 0 0 (neg len)
  translate 0 (neg len)
  (> depth > 0)? (grow len depth) Or NO
...

def grow(len depth):
  scope.{
    rotate st.a
    branch (> len * 0.72) (> depth - 1)
  }
  scope.{
    rotate (neg st.a)
    branch (> len * 0.72) (> depth - 1)
  }
...

tick.{
  background 24 24 37
  st..[-> {a (remap mouseX 0 width 0.1 1)}]
  stroke 166 227 161
  scope.{
    translate (> width / 2) height
    branch 80 7
  }
}
`,
}]
