function setup() {
  createCanvas(500,500);
  angleMode(DEGREES);
  button = createButton('Time');
  button.mouseClicked(voice);
}

function draw() {
  background(0);
  translate(250,250);
  rotate(-90);

  let hr = hour();
  let min = minute();
  let sec = second();

  strokeWeight(6);
  stroke(160, 104, 255);
  noFill();
  let secondAngle = map(sec, 0, 60, 0, 360);
  arc(0, 0, 270, 270, 0, secondAngle);

  stroke(255,146,227);
  let minuteAngle = map(min, 0, 60, 0, 360);
  arc(0, 0, 250, 250, 0, minuteAngle);

  stroke(255);
  let hourAngle = map(hr % 12, 0, 12, 0, 360);
  arc(0, 0, 230, 230, 0, hourAngle);

  push();
  rotate(secondAngle);
  stroke(160, 104, 255);
  line(10, 0, 100, 0);
  pop();

  push();
  rotate(minuteAngle);
  stroke(255,146,227);
  line(10, 0, 80, 0);
  pop();

  push();
  rotate(hourAngle);
  stroke(255);
  line(10, 0, 60, 0);
  pop();

  stroke(255);
  point(0, 0);

  rotate(90);
  let m = month()
  let d = day()
  let y = year()
  strokeWeight(4);
  stroke(255,146,227);
  textSize(35);
  text(d + ' / ' + m + ' / ' + y, -88,-210)
  strokeWeight(4);
  stroke(160, 104, 255);
  textSize(35);
  text(hr%12 + ' : ' + min, -55,-165);
  if(hr>=12%12){
  text('pm',37,-165);
  }
  else{
    text('am',35,-165);
  }

  let col = color(160, 104, 255);
  button.style('font-size', '35px');
  button.style('background-color', col);
  button.position(205,420);
}

function voice(){
 let voice = new p5.Speech();
 let a = hour()%12;
 let b = minute();
 let c = second();
 voice.speak('The time is'+a+' '+b);
 if(a>=12%12){
 voice.speak('PM');
  }
 else{
   voice.speak('AM');
  }
}

//wccc challenge
//did I code all these by hand? yes
//do I wish I had taken more time with figuring out new p5 type features? yes
//will I do it later? I hope so
let t = 0;

function setup() {
  cnv = createCanvas(600, 600);
  background(70);
  angleMode(DEGREES);
  rectMode(CENTER);
  noStroke();
  describe(
    "a through z lower case letters being drawn on a dark grey canvas with a splotchy random chalk effect"
  );
}

function draw() {
  t += randomGaussian(2, 1);
  translate(0, height / 12);
  testLetters();
}

function letters(l, w, r) {
  push();
  fill(40, 40, 40, 2); //,1+10*sin(t/4+r));
  rect(0, 0, w * 1.5, w * 3);
  noStroke();
  translate(0, -w / 2);
  s = w / 20 + randomGaussian(0, w / 20);

  fill(255 - random(30), 255 - random(30), 255 - random(10));
  t1 = t + r + random(-20, 20);
  if (l === "a") {
    circle((w / 3) * cos(t1), w / 2 + (w / 3) * sin(t1), s);
    circle(w / 2 - (w / 2 - w / 3), w / 2 + (w / 2.5) * sin(t1), s);
  }
  if (l === "b") {
    circle((w / 3) * cos(t1), w / 2 + (w / 3) * sin(t1), s);
    circle(-w / 2 + (w / 2 - w / 3), (w / 1.2) * sin(t1), s);
  }
  if (l === "c") {
    t2 = 180 - 140 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
  }
  if (l === "d") {
    circle((w / 3) * cos(t1), w / 2 + (w / 3) * sin(t1), s);
    circle(w / 2 - (w / 2 - w / 3), (w / 1.2) * sin(t1), s);
  }
  if (l === "e") {
    t2 = 190 - 140 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    circle((-w / 4) * cos(t1), w / 3, s);
  }
  if (l === "f") {
    t2 = 240 - 60 * sin(t1);
    circle(w / 5 + (w / 5) * cos(t2), -w / 2 + (w / 3) * sin(t2), s);
    circle(w / 5 + (-w / 5) * cos(t1) - w / 5, 0, s);
    circle(w / 5 + -w / 2 + (w / 2 - w / 5), (w / 1.4) * cos(t1) + w / 5, s);
  }
  if (l === "g") {
    t2 = 90 + 90 * sin(t1);
    circle((w / 3) * cos(t1), w / 2 + (w / 3) * sin(t1), s);
    circle(w / 2 - (w / 2 - w / 3), w / 2 + (w / 2.2) * sin(t1), s);
    circle((w / 3) * cos(t2), w + (w / 3) * sin(t2), s);
  }
  if (l === "h") {
    t2 = -90 + 90 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    circle(-w / 2 + (w / 2 - w / 3), (w / 1.2) * sin(t1), s);
    circle(w / 2 - (w / 2 - w / 3), w / 1.45 + (w / 6.5) * sin(t1), s);
  }
  if (l === "i") {
    circle(0, w / 2 + (w / 3) * sin(t1), s);
    circle((w / 20) * cos(t1), -w / 5 + (w / 20) * sin(t1), s);
  }
  if (l === "j") {
    t2 = 240 + 180 - 60 * sin(t1 - 90);
    circle(0, w / 1.6 + (w / 2.5) * sin(t1), s);
    circle((w / 20) * cos(t1), -w / 5 + (w / 20) * sin(t1), s);
    circle(-w / 2 + w / 3.4 + (w / 5) * cos(t2), w + (w / 3) * sin(t2), s);
  }
  if (l === "k") {
    x1 = -w / 12 + (w / 4) * cos(t1);
    y1 = x1 + w / 1.5;
    x2 = -w / 12 + (w / 4) * cos(t1 + 90);
    y2 = -x2;
    circle(x1, y1, s);
    circle(x2, y2, s);
    circle(-w / 2 + (w / 2 - w / 3), (w / 1.2) * sin(t1), s);
  }
  if (l === "l") {
    circle(0, (w / 1.2) * sin(t1), s);
  }
  if (l === "m") {
    t2 = -90 + 90 * sin(t1);
    circle(w / 4 + (w / 4) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    circle(-w / 4 - (w / 4) * cos(t2), w / 2 + (w / 3) * sin(t2), s);

    circle(
      w / 5.5 + w / 2 - (w / 2 - w / 3),
      w / 1.45 + (w / 6.5) * sin(t1),
      s
    );
    circle(
      -w / 5.5 - w / 2 + (w / 2 - w / 3),
      w / 1.45 + (w / 6.5) * sin(t1),
      s
    );
  }
  if (l === "n") {
    t2 = -90 + 90 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    circle(-w / 2 + (w / 2 - w / 3), w / 2 + (w / 3) * sin(t1), s);
    circle(w / 2 - (w / 2 - w / 3), w / 1.45 + (w / 6.5) * sin(t1), s);
  }
  if (l === "o") {
    circle((w / 3) * cos(t1), w / 2 + (w / 3) * sin(t1), s);
  }
  if (l === "p") {
    circle((w / 3) * cos(t1), w / 2 + (w / 3) * sin(t1), s);
    circle(-w / 2 + (w / 2 - w / 3), w + (w / 2) * sin(t1), s);
  }
  if (l === "q") {
    circle((w / 3) * cos(t1), w / 2 + (w / 3) * sin(t1), s);
    circle(w / 2 - (w / 2 - w / 3), w + (w / 2) * sin(t1), s);
  }
  if (l === "r") {
    t2 = -90 + 45 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    circle(-w / 2 + (w / 2 - w / 3), w / 2 + (w / 3) * sin(t1), s);
  }
  if (l === "s") {
    t2 = -90 + 45 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    t2 = 90 + 45 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    x1 = (w / 6) * cos(t1);
    y1 = x1 + w / 2;
    circle(x1, y1, s);
  }
  if (l === "t") {
    circle(w / 5 + (-w / 5) * cos(t1) - w / 5, 0, s);
    circle(w / 5 + -w / 2 + (w / 2 - w / 5), (w / 1.4) * cos(t1) + w / 5, s);
  }
  if (l === "u") {
    t2 = 90 + 90 * sin(t1);
    circle((w / 3) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    circle(w / 2 - (w / 2 - w / 3), w / 2 + (w / 3) * sin(t1), s);
    circle(-w / 2 + (w / 2 - w / 3), w / 3 + (w / 5) * sin(t1), s);
  }
  if (l === "v") {
    x1 = -w / 5 + (w / 6) * cos(t1);
    y1 = 2 * x1 + w / 1.1;
    x2 = w / 5 - (w / 6) * cos(t1);
    y2 = -2 * x2 + w / 1.1;
    circle(x1, y1, s);
    circle(x2, y2, s);
  }
  if (l === "w") {
    t2 = 90 + 90 * sin(t1);
    circle(w / 4 + (w / 4) * cos(t2), w / 2 + (w / 3) * sin(t2), s);
    circle(-w / 4 - (w / 4) * cos(t2), w / 2 + (w / 3) * sin(t2), s);

    circle(w / 5.5 + w / 2 - (w / 2 - w / 3), w / 3 + (w / 6.5) * sin(t1), s);
    circle(-w / 5.5 - w / 2 + (w / 2 - w / 3), w / 3 + (w / 6.5) * sin(t1), s);
  }
  if (l === "x") {
    x1 = (w / 3) * cos(t1);
    y1 = x1 + w / 2;
    x2 = (w / 3) * cos(t1 + 90);
    y2 = -x2 + w / 2;
    circle(x1, y1, s);
    circle(x2, y2, s);
  }
  if (l === "y") {
    x1 = -w / 5 + (w / 6) * cos(t1);
    y1 = 2 * x1 + w / 1.1;
    x2 = (w / 3) * cos(t1);
    y2 = -2 * x2 + w / 1.1;
    circle(x1, y1, s);
    circle(x2, y2, s);
  }
  if (l === "z") {
    circle((w / 3) * cos(t1), w / 6, s);
    circle((w / 3) * cos(t1), w / 1.1, s);
    x1 = (w / 3) * cos(t1);
    y1 = 0.9 * x1 + w / 2;
    circle(x1, y1, s);
  }

  pop();
}

function testLetters() {
  w1 = 40;
  w2 = w1 * 1.6;
  push();
  translate(50, 80);
  letters("a", w1, 20);
  translate(w2, 0);
  letters("b", w1, 40);
  translate(w2, 0);
  letters("c", w1, 50);
  translate(w2, 0);
  letters("d", w1, 80);
  translate(w2, 0);
  letters("e", w1, 150);
  translate(w2, 0);
  letters("f", w1, 120);
  translate(w2, 0);
  letters("g", w1, 100);
  translate(w2, 0);
  letters("h", w1, 90);
  translate(w2, 0);
  letters("i", w1, 110);
  translate(-width + w1 * 3, w1 * 2 + w2 / 1.2);
  letters("j", w1, 140);
  translate(w2, 0);
  letters("k", w1, 120);
  translate(w2, 0);
  letters("l", w1, 110);
  translate(w2, 0);
  letters("m", w1, 100);
  translate(w2, 0);
  letters("n", w1, 0);
  translate(w2, 0);
  letters("o", w1, 190);
  translate(w2, 0);
  letters("p", w1, 150);
  translate(w2, 0);
  letters("q", w1, 50);
  translate(-width + w1 * 3, w1 * 2 + w2 / 1.2);
  letters("r", w1, 250);
  translate(w2, 0);
  letters("s", w1, 350);
  translate(w2, 0);
  letters("t", w1, 220);
  translate(w2, 0);
  letters("u", w1, 10);
  translate(w2, 0);
  letters("v", w1, 110);
  translate(w2, 0);
  letters("w", w1, 160);
  translate(w2, 0);
  letters("x", w1, 30);
  translate(w2, 0);
  letters("y", w1, 230);
  translate(w2, 0);
  letters("z", w1, 310);
  pop();
}


<html>
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dat-gui/0.7.9/dat.gui.min.js"></script>
    <style>
      body {
        margin: 0;
        overflow: hidden;
      }
      canvas {
        display: block;
      }
      #images img {
        position: absolute;
        opacity: 0;
        filter: grayscale(100%);
        transition: opacity 1s ease;
        pointer-events: none;
        z-index: 10;
        object-fit: cover;
      }
      #images:hover {
        background:#red;
      }
      .dg.ac {
        z-index: 1000 !important;
      }

    </style>
  </head>
  <body>
    <div id="images"></div>
    <script>
      let params = {
        cols: 4,
        rows: 3,
        hoverColor: '#0c0d0e',
        highlightColor: '#ffffff',
        normalColor: '#000000',
        animationSpeed: 0.1,
        selectedWeight: 3,
        showNumbers: true
      };

      let gui;
      let grid = [];
      let selectedIndex = -1;
      let initialized = false;

      function setup() {
        createCanvas(windowWidth, windowHeight);
        setupGUI();
        createGrid();
        setupImages();
      }

      function draw() {
        background(params.normalColor);
        document.body.style.backgroundColor = params.normalColor;
        updateWeights();
        updateLayout();

        for (let i = 0; i < grid.length; i++) {
          let cell = grid[i];

          if (!initialized) {
            cell.x = cell.targetX;
            cell.y = cell.targetY;
            cell.w = cell.targetW;
            cell.h = cell.targetH;
          } else {
            cell.x = lerp(cell.x, cell.targetX, params.animationSpeed);
            cell.y = lerp(cell.y, cell.targetY, params.animationSpeed);
            cell.w = lerp(cell.w, cell.targetW, params.animationSpeed);
            cell.h = lerp(cell.h, cell.targetH, params.animationSpeed);
          }

          fill(i === selectedIndex ? params.highlightColor : params.normalColor);
          noStroke();
          rect(cell.x, cell.y, cell.w, cell.h);

          if (params.showNumbers) {
            fill(i === selectedIndex ? params.normalColor : params.highlightColor);
            textAlign(CENTER, CENTER);
            textSize(min(cell.w, cell.h) / 3);
            text(i + 1, cell.x + cell.w / 2, cell.y + cell.h / 2);
          }
        }

        for (let i = 0; i < grid.length; i++) {
          const img = document.getElementById('img-' + i);
          const cell = grid[i];
          img.style.left = cell.x + 'px';
          img.style.top = cell.y + 'px';
          img.style.width = cell.w + 'px';
          img.style.height = cell.h + 'px';
          img.style.opacity = (selectedIndex === i) ? 1 : 0;
        }

//         for (let i = 0; i < grid.length; i++) {
//           let cell = grid[i];
//           let isHovered = mouseX > cell.x && mouseX < cell.x + cell.w &&
//               mouseY > cell.y && mouseY < cell.y + cell.h;

//           fill(isHovered ? params.hoverColor : params.normalColor);
//           rect(cell.x, cell.y, cell.w, cell.h);
//         }


        initialized = true;
      }

      function createGrid() {
        grid = [];
        for (let y = 0; y < params.rows; y++) {
          for (let x = 0; x < params.cols; x++) {
            let index = y * params.cols + x;
            grid.push({
              row: y,
              col: x,
              weight: 1,
              targetW: 0,
              targetH: 0,
              targetX: 0,
              targetY: 0,
              x: 0,
              y: 0,
              w: 0,
              h: 0,
              imgUrl: `https://picsum.photos/seed/building${index}/800/600`
            });
          }
        }
      }

      function setupImages() {
        const container = document.getElementById('images');
        container.innerHTML = '';
        for (let i = 0; i < grid.length; i++) {
          const img = document.createElement('img');
          img.src = grid[i].imgUrl;
          img.id = 'img-' + i;
          container.appendChild(img);
        }
      }

      function updateWeights() {
        for (let i = 0; i < grid.length; i++) {
          grid[i].weight = (i === selectedIndex) ? params.selectedWeight : 1;
        }
      }

      function updateLayout() {
        let rowTotals = Array(params.rows).fill(0);
        let colTotals = Array(params.cols).fill(0);

        for (let cell of grid) {
          rowTotals[cell.row] += cell.weight;
          colTotals[cell.col] += cell.weight;
        }

        let rowHeights = rowTotals.map(rt => height * rt / rowTotals.reduce((a,b)=>a+b));
        let colWidths = colTotals.map(ct => width * ct / colTotals.reduce((a,b)=>a+b));

        let yOffsets = [0];
        for (let i = 1; i < rowHeights.length; i++) {
          yOffsets[i] = yOffsets[i-1] + rowHeights[i-1];
        }

        let xOffsets = [0];
        for (let i = 1; i < colWidths.length; i++) {
          xOffsets[i] = xOffsets[i-1] + colWidths[i-1];
        }

        for (let cell of grid) {
          cell.targetX = xOffsets[cell.col];
          cell.targetY = yOffsets[cell.row];
          cell.targetW = colWidths[cell.col];
          cell.targetH = rowHeights[cell.row];
        }
      }

      function mousePressed() {
        for (let i = 0; i < grid.length; i++) {
          let cell = grid[i];
          if (
            mouseX > cell.x &&
            mouseX < cell.x + cell.w &&
            mouseY > cell.y &&
            mouseY < cell.y + cell.h
          ) {
            selectedIndex = (selectedIndex === i) ? -1 : i;
            break;
          }
        }
      }

      function windowResized() {
        resizeCanvas(windowWidth, windowHeight);
        createGrid();
        setupImages();
      }

      function setupGUI() {
        gui = new dat.GUI();
        gui.close();
        gui.add(params, 'cols', 1, 20, 1).onChange(() => {
          createGrid();
          setupImages();
          selectedIndex = -1;
        });
        gui.add(params, 'rows', 1, 20, 1).onChange(() => {
          createGrid();
          setupImages();
          selectedIndex = -1;
        });
        gui.addColor(params, 'highlightColor');
        gui.addColor(params, 'normalColor');
        gui.add(params, 'animationSpeed', 0.01, 0.5, 0.01);
        gui.add(params, 'selectedWeight', 1, 30, 0.1);
        gui.add(params, 'showNumbers');
      }
    </script>
  </body>
</html>


var canvas = document.getElementById('bend');
paper.install(window);
paper.setup(canvas);

var h = window.innerHeight,
    w = window.innerWidth,
    horizon = h / 2,
    pathCounts = 13,
    pathPoints = 15,
    strokeWidth = 2,
    strokeColor = '#7aa4c3',
    fillColor = 'rgba(108, 236, 229, .0)',
    speed = 1.6,
    offset = 7,
    frequency = [0, -30, 50, -50, -35, 35, 0, -30, 50, -50, -35, 35, -30, 50, -50, -35, 35],
    delay = 0.9,
    mousePos = view.center / 2,
    path = [];

initializePath();

function initializePath() {
  h = window.innerHeight;
  w = window.innerWidth;
  horizon = h / 2;

  //clear
  paper.project.activeLayer.removeChildren();

  for (i = 0; i < pathCounts; i++) {
    path[i] = new paper.Path();

    path[i].add(new paper.Point(-10, h));
    path[i].add(new paper.Point(-10, horizon));

    for (var p = 0; p < pathPoints - 1; p++) {
      height =
        path[i].add(new paper.Point(w / (pathPoints - 1) * p + p, horizon + frequency[p]));
    }

    path[i].add(new paper.Point(w + 10, horizon));
    path[i].add(new paper.Point(w + 10, h));

    path[i].strokeWidth = strokeWidth;
    path[i].strokeColor = strokeColor;

    if (i == 0) {
      path[i].fillColor = 'rgba(255, 255, 255, 1)';
    }

    path[i].smooth();
  }
}
// paper.view.draw();

view.onFrame = function(event) {
  for (p = 0; p < pathCounts; p++) {
    for (s = 0; s < pathPoints; s++) {
      // skip first two points because they are the base of the path
      var value = (s % 2) ? -1 : 1;
      var segment = path[p].segments[2 + s];
      segment.point.y = horizon + ((Math.sin((event.time + s * delay) * speed)) * (frequency[s] * value + (p * offset * value)));
    }
  }
}

window.onresize = function(event) {
  initializePath();
}


const grid = document.querySelector('.grid');
const rows = [...document.querySelectorAll('.row')];
const cells = [...document.querySelectorAll('.cell')];

let clicked = false;
let reset_all = false;

const pull_distance = 70;

const updateCellPositions = () => {
  cells.forEach((cell) => {
    const rect = cell.getBoundingClientRect();
    cell.center_position = {
      x: (rect.left + rect.right) / 2,
      y: (rect.top + rect.bottom) / 2,
    };
  });
};

const handleCellClick = (e, i) => {
  if (clicked) {
    return;
  }

  clicked = true;

  gsap.to('.cell', {
    duration: 1.6,
    physics2D: {
      velocity: 'random(400, 1000)',
      angle: 'random(250, 290)',
      gravity: 2000
    },
    stagger: {
      grid: [rows.length, rows[0].children.length],
      from: i,
      amount: 0.3
    },
    onComplete: function () {
      this.timeScale(-1.3);
    },
    onReverseComplete: () => {
      clicked = false;
      reset_all = true;
      handlePointerMove();
    },
  });
};

const handlePointerMove = (e = { x: -pull_distance, y: -pull_distance }) => {
  if (clicked) {
    return;
  }

  const { pageX: pointer_x, pageY: pointer_y } = e;
  cells.forEach((cell, i) => {
    const diff_x = pointer_x - cell.center_position.x;
    const diff_y = pointer_y - cell.center_position.y;
    const distance = Math.sqrt(diff_x * diff_x + diff_y * diff_y);

    if (distance < pull_distance) {
      const percent = distance / pull_distance; // Should probably be 1 - distance / pull_distance but I like this effect better
      cell.pulled = true;
      gsap.to(cell, {
        duration: 0.2,
        x: diff_x * percent,
        y: diff_y * percent,
      });
    } else {
      if (!cell.pulled) {
        return;
      }

      cell.pulled = false;

      gsap.to(cell, {
        duration: 1,
        x: 0,
        y: 0,
        ease: "elastic.out(1, 0.3)",
      });
    }
  });

  if (reset_all) {
    reset_all = false;
    gsap.to(cells, {
      duration: 1,
      x: 0,
      y: 0,
      ease: "elastic.out(1, 0.3)",
    });
  }
};

const init = () => {
  updateCellPositions();
  window.addEventListener('resize', updateCellPositions);
  window.addEventListener('pointermove', handlePointerMove);
  document.body.addEventListener('pointerleave', () => handlePointerMove());

  cells.forEach((cell, i) =>
    cell.addEventListener('pointerup', (e) => handleCellClick(e, i))
  );
};

init();

//=

// Machine translation because I'm not good at English!

//------------------------------------
// CONFIG
//------------------------------------

// デフォルトの武器
// Default weapon
var WEPON_DEFAULT = {
	// 武器の名前
	// Weapon name
  name: 'NORMAL BEAM',
  // 与えるダメージ 0~1
  // Damage dealt 0 ~ 1
	power: 0.3,
	// 弾のスピード
  // Bullet speed
	speed: 3,
	// 弾の長さ
  // Bullet length
	length: 10,
	// 弾の幅
  // Bullet width
	width: 1,
	// 弾の色, 特殊武器の場合アイテムの色に反映される, CSS カラーで指定
  // The color of the bullet, in the case of special weapons, reflected in the color of the item, specified by CSS color
	color: 'white',
	// 連射速度
  // Fire rate
	shootingInterval: 1000 * 0.35,
	// 貫通弾か示す
	// true の場合着弾しても消滅しない
	// explosion を指定した場合はそちらが優先される
  // Indicates whether the bullet
  // If true, will not disappear even if it lands
  // If explosion is specified, it takes precedence.
	through: false,
	// 爆発による着弾後の範囲攻撃
	// 以下のプロパティを持つオブジェクトで指定する
	// { range: 爆発範囲, speed: 爆発の速度 }
	// * 範囲攻撃の威力は武器の基本威力の半分
	// Range attack after landing due to explosion
	// Specify with an object that has the following properties:
	// { range: Explosion range, speed: Explosion speed }
	// * The power of range attacks is half the basic power of weapons
	explosion: false
};

// 特殊武器の配列, UFO を撃破するとランダムで出現する
// Special weapon array, Randomly appear when you destroy a UFO
var WEPON_SPECIAL = [
{
  name: 'TINY BEAM',
  power: 0.1,
  speed: 10,
  length: 5,
  width: 1,
  color: 'rgb(131, 224, 8)',
  shootingInterval: 1000 * 0.1,
  through: false,
  explosion: false
},
{
  name: 'BLASTER',
  power: 1,
  speed: 3,
  length: 15,
  width: 3,
  color: 'rgb(244, 0, 122)',
  shootingInterval: 1000 * 0.3,
  through: false,
  explosion: false
},
{
  name: 'LASER',
  power: 0.2,
  speed: 35,
  length: 200,
  width: 2,
  color: 'rgb(138, 227, 252)',
  shootingInterval: 1000 * 0.6,
  through: true,
  explosion: false
},
{
  name: 'EXPLOSION BEAM',
  power: 0.15,
  speed: 15,
  length: 10,
  width: 2,
  color: 'rgb(255, 153, 0)',
  shootingInterval: 1000 * 0.5,
  through: false,
  explosion: {
    range: 100,
    speed: 4.5
  }
}/*
,{
  name: 'INSANE BEAM',
  power: 0.035,
  speed: 7.5,
  length: 5,
  color: 'rgb(255, 246, 0)',
  width: 2,
  shootingInterval: 1000 * 0.015,
  through: true,
  explosion: false,
	explosion: {
		range: 75,
		speed: 2
	}
}//*/
];

var ASTEROID_MAX_SIZE = 80; // 小惑星の最大サイズ
var ASTEROID_MIN_SIZE = 5;　// 小惑星の最小サイズ
var ASTEROID_MAX_NUM = 75;　// 小惑星の最大数
var ASTEROID_SPAWN_TIME = 350;　// 小惑星の復活時間
var SHIP_SPEED = 1.5; // 自機のスピード
var UFO_SPEED = 2; // UFO のスピード
var ITEM_SPEED = 0.5; // アイテムのスピード

// UFO の出現率 0~1
var UFO_INCIDENCE = 0.0035;

// 特殊武器の持続時間
var SPECIAL_WEPON_TIME = 1000 * 20;

// 各種スコア
var SCORE = {
  ASTEROID_DAMAGE: 10,
  ASTEROID_DESTROY: 50,
  UFO_DAMAGE: 0,
  UFO_DESTROY: 300
}

//------------------------------------
// CONSTANTS
//------------------------------------

var PI = Math.PI;
var TWO_PI = PI * 2;
var DEG_TO_RAD = PI / 180;
var FPS = 60;

//------------------------------------
// VARS
//------------------------------------

var canvas;
var canvasWidth;
var canvasHeight;
var context;
var mouse;
var isMouseDown = false;
var ship; // Ship
var beams; // Collection of Beam
var asteroids; // Collection of Asteroid
var splinters; // Collection of Splinter
var debris; // Collection of Debri
var ufo; // Ufo
var item; // Item
var asteroidLastSpawn = 0; // 小惑星が最後に復活した時間
var ufoLastSpawn = 0; // UFO が最後に復活した時間
var debriLastSpawn = 0; // 背景の星屑が最後に出現した時間
var fieldRange; // フィールドの範囲
var score = 0; // スコア
var isPlay = false; // ゲームが開始されているか示す
var dom = {
	menu: null,
	title: null,
	message: null,
	tweet: null,
	start: null,
	score: null,
	wepon: null
}


//------------------------------------
// INITIALIZE
//------------------------------------

function init() {
	canvas = document.getElementById('c');
	fieldRange = new Range();

	window.addEventListener('resize', resize, false);
	resize();

	mouse = new Point();

	dom.menu    = document.getElementById('menu');
	dom.title   = document.getElementById('title');
	dom.message = document.getElementById('message');
	dom.start   = document.getElementById('start');
	dom.score   = document.getElementById('score');
	dom.wepon   = document.getElementById('wepon');

	dom.start.addEventListener('click', start, false);
	canvas.addEventListener('mousemove', mouseMove, false);
	canvas.addEventListener('mousedown', mouseDown, false);
	canvas.addEventListener('mouseup', mouseUp, false);
	canvas.addEventListener('click', click, false);

	canvas.addEventListener('touchmove', touchMove, false);
	canvas.addEventListener('touchstart', mouseDown, false);
	canvas.addEventListener('touchend', mouseUp, false);

	debris = new Collection();
	for (var i = 0; i < 30; i++) {
		debris.push(new Debri(randInt(canvasWidth)));
	}

	setInterval(loop, 1000 / FPS);
}


//------------------------------------
// EVENT HANDLERS
//------------------------------------

function resize(e) {
	canvas.width  = canvasWidth  = fieldRange.right  = window.innerWidth;
	canvas.height = canvasHeight = fieldRange.bottom = window.innerHeight;

	context = canvas.getContext('2d');
	context.fillStyle = 'white';
	context.strokeStyle = 'white';
	context.lineWidth = 1;
}

function start(e) {
	play();
	dom.menu.style.display = 'none';
	e.preventDefault();
}

function mouseMove(e) { mouse.set(e.clientX, e.clientY); }
function touchMove(e) { mouse.set(e.touches[0].clientX, e.touches[0].clientY); console.log(e.touches[0].clientX, e.touches[0].clientY) }
function mouseDown(e) { isMouseDown = true; }
function mouseUp(e) { isMouseDown = false; }
function click(e) { if (ship) ship.fire(beams); }


//------------------------------------
// FRAME LOOP
//------------------------------------

function loop() {
	context.clearRect(0, 0, canvasWidth, canvasHeight);

	var now = new Date().getTime();

	// Spawn Debri
	if (now - debriLastSpawn > 300) {
		debris.push(new Debri(canvasWidth));
		debriLastSpawn = now;
	}

	// Debri update
	debris.eachUpdate();

	if (isPlay) {
		// Spawn

		if (now - asteroidLastSpawn > ASTEROID_SPAWN_TIME && asteroids.length < ASTEROID_MAX_NUM) {
			asteroids.push(Asteroid.spawn());
			asteroidLastSpawn = now;
		}

		if (!ufo && !item && Math.random() < UFO_INCIDENCE) {
			ufo = Ufo.spawn();
		}

		// Update

		if (ship) {
			if (isMouseDown) ship.fire(beams);
			ship.update(mouse);
		}

		if (ufo) {
			ufo.update();
			if (ufo.vanished) {
				item = new Item(ufo.x, ufo.y);
				ufo = null;
			} else if (hitDetection(ufo, ship)) {
				gameOver();
			}
		}

		if (item) {
			item.update();
			if (item.vanished) {
				item = null;
			} else if (hitDetection(item, ship)) {
				ship.setSpecialWepon(item.wepon);
				item = null;
			}
		}

		beams.eachUpdate(function(index, beam) {
			for (var i = 0; i < asteroids.length; i++) {
				asteroid = asteroids[i];
				if (hitDetection(beam, asteroid)) {
					score += asteroid.damage(beam.power, splinters);
					beam.notifyHit();
				}
			}

			if (ufo && hitDetection(beam, ufo)) {
				score += ufo.damage(beam.power, splinters);
				beam.notifyHit();
			}
		});

		asteroids.eachUpdate(function(index, asteroid) {
			if (hitDetection(asteroid, ship)) {
				gameOver();
			}
		});

		splinters.eachUpdate();

		// Display

		dom.wepon.innerHTML = ship.currentWepon.name;
		dom.score.innerHTML = score;
	}

	// Draw

	context.beginPath();
	context.strokeStyle = 'rgb(255, 255, 255)';
	context.lineWidth = 1;
	if (ship) ship.draw(context);
	if (ufo) ufo.draw(context);
	if (asteroids) asteroids.eachDraw(context);
	context.stroke();

	// Beam は個別に描画
	if (beams) beams.eachDraw(context);

	if (item) {
		context.beginPath();
		context.strokeStyle = item.wepon.color;
		context.lineWidth = 1;
		item.draw(context);
		context.stroke();
	}

	context.beginPath();
	context.fillStyle = 'rgb(255, 255, 255)';
	if (splinters) splinters.eachDraw(context);
	if (debris) debris.eachDraw(context);
	// Game over
	if (ship && ship.died) {
		ship.update();
		ship.splinter.draw(context);
	}
	context.fill();

}


//------------------------------------
// FUNCTIONS
//------------------------------------

function play() {
	ship = new Ship(canvasWidth / 2, canvasHeight / 2, 8);
	mouse.set(ship.x, ship.y);
	beams = new Collection();
	asteroids = new Collection();
	splinters = new Collection();
	ufo = null;
	item = null;
	score = 0;
	isMouseDown = false;
	isPlay = true;
}

function gameOver() {
	ship.destroy();
	isPlay = false;
	dom.title.innerHTML = 'GAME OVER!';
	dom.message.innerHTML = 'YOUR SCORE ' + score + ' POINTS<br />';
	dom.message.appendChild(tweetLink());
	dom.menu.style.display = 'block';
}

function tweetLink() {
	var exc = score < 1000 ? '...' : score > 3000 ? '!!!' : '!';
	if (!dom.tweet) {
		dom.tweet = document.createElement('a');
		dom.tweet.id = 'tweet';
		dom.tweet.innerHTML = 'TWEET YOUR SCORE';
	}
	dom.tweet.href = 'https://twitter.com/intent/tweet?url=https://codepen.io/akm2/pen/eYYyELr&text=SCORE ' + score + ' PTS' + exc + ' - ASTEROIDS';
	dom.tweet.target = '_blank';
	return dom.tweet;
}

// パスの衝突判定を行う
// 引数に指定するオブジェクトは path プロパティから Path オブジェクトが参照可能であること
// Perform path collision detection
// The object specified in the argument can be referenced from the path property.
function hitDetection(a, b) {
	var ap = a.path, bp = b.path;
	var as, bs; // Segments
	var a1, a2, b1, b2; // Points

	for (i = 0, ilen = ap.segmentNum(); i < ilen; i++) {
		as = ap.segment(i);
		a1 = as[0];
		a2 = as[1];
		for (j = 0, jlen = bp.segmentNum(); j < jlen; j++) {
			bs = bp.segment(j);
			b1 = bs[0];
			b2 = bs[1];
			if (intersection(a1, a2, b1, b2)) return true;
		}
	}

	return false;
}

// hitDetection　で使用される直線の交差判定
// 交差しているなら true
// Straight line intersection detection used in hitDetection
// True if they intersect
function intersection(a1, a2, b1, b2) {
	var ax = a2.x - a1.x, ay = a2.y - a1.y;
	var bx = b2.x - b1.x, by = b2.y - b1.y;
	return (ax * (b1.y - a1.y) - ay * (b1.x - a1.x)) *
		   (ax * (b2.y - a1.y) - ay * (b2.x - a1.x)) <= 0 &&
		   (bx * (a1.y - b1.y) - by * (a1.x - b1.x)) *
		   (bx * (a2.y - b1.y) - by * (a2.x - b1.x)) <= 0;
}



//------------------------------------
// UTILS
//------------------------------------

function extend() {
  var target = arguments[0] || {}, o, p;

  for (var i = 1, len = arguments.length; i < len; i++) {
	o = arguments[i];

	if (!isObject(o) || isNull(o)) continue;

	for (p in o) {
	  target[p] = o[p];
	}
  }

  return target;
};

function randUniform(max, min) {
	if (min === undefined) min = 0;
	return Math.random() * (max - min) + min;
};

function randInt(max, min) {
	if (min === undefined) min = 0;
	return Math.floor(Math.random() * (max - min + 1) + min);
};

isObject = function(value) {
  return typeof value === 'object' && value !== null;
};

isNumber = function(value) {
  return typeof value === 'number';
};

isNumeric = function(value) {
  return !isNaN(value) && isFinite(value);
};

isString = function(value) {
  return typeof value === 'string';
};

isFunction = function(value) {
  return typeof value === 'function';
};

isArray = function(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
};

isNull = function(value) {
  return value === null;
};

isUndefined = function(value) {
  return typeof value === 'undefined';
};


//------------------------------------
// CLASSES
//------------------------------------

/**
 * Collection
 *
 * @super Array
 */
function Collection() {
	for (var i = 0, len = arguments.length; i < len; i++) {
		this.push(arguments[i]);
	}
}

Collection.prototype = extend([], {
	eachUpdate: function(callback) {
		for (var i = 0, len = this.length, item; i < len; i++) {
			item = this[i];

			if (item.vanished) {
				this.splice(i, 1);
				len--;
				i--;
				continue;
			}
			item.update();

			if (callback) callback.call(this, i, item);
		}
	},

	eachDraw: function(ctx) {
		for (var i = 0, len = this.length; i < len; i++) {
			this[i].draw(ctx);
		}
	}
})


/**
 * Path
 *
 * @super Array
 */
function Path(points, closed) {
  if (isArray(points)) {
	  for (var i = 0, len = points.length; i < len; i++) {
		  this.push(points[i]);
	  }
  }

  this.closed = isUndefined(closed) ? true : closed;
}

Path.prototype = extend([], {
  closed: true,

  segment: function(index) {
	  if (index > this.segmentNum()) return null;
	  return [
		  this[index],
		  this[index === this.length - 1 ? 0 : index + 1]
	  ];
  },

  segmentNum: function() {
	  return this.closed ? this.length : this.length - 1;
  },

  eachSegments: function(callback) {
	  for (var i = 0, len = this.segmentNum(); i < len; i++) {
		  if (callback.call(this, this.segment(i), i) === false) break;
	  }
  },

  eachPoints: function(callback) {
	  for (var i = 0, len = this.length; i < len; i++) {
		  if (callback.call(this, this[i], i) === false) break;
	  }
  },

  draw: function(ctx) {
	  this.eachPoints(function(p, i) {
		  ctx[i === 0 ? 'moveTo' : 'lineTo'](p.x, p.y);
	  });

	  if (this.closed && this.length > 2) {
		  var p = this[0];
		  ctx.lineTo(p.x, p.y);
	  }
  }
});


/**
 * Point
 */
function Point(x, y) {
  this.set(x, y);
};

Point.interpolate = function(p1, p2, f) {
  var dx = p2.x - p1.x,
	  dy = p2.y - p1.y;
  return new Point(p1.x + dx * f, p1.y + dy * f);
};

Point.polar = function(length, angle) {
  return new Point(length * Math.cos(angle), length * Math.sin(angle));
};

Point.prototype = {
	set: function(x, y) {
		if (isObject(x)) {
			y = x.y;
			x = x.x;
		}

		this.x = x || 0;
		this.y = y || 0;

		return this;
	},

	offset: function(x, y) {
		this.x += x || 0;
		this.y += y || 0;

		return this;
	},

	add: function(p) {
		this.x += p.x;
		this.y += p.y;

		return this;
	},

	sub: function(p) {
		this.x -= p.x;
		this.y -= p.y;

		return this;
	},

	scale: function(scale) {
		this.x *= scale;
		this.y *= scale;

		return this;
	},

	length: function() {
		return Math.sqrt(this.x * this.x + this.y * this.y);
	},

	lengthSq: function() {
		return this.x * this.x + this.y * this.y;
	},

	normalize: function(thickness) {
		if (isUndefined(thickness)) thickness = 1;

		var len = Math.sqrt(this.x * this.x + this.y * this.y);
		var nx = 0, ny = 0;

		if (len) {
			nx = this.x / len;
			ny = this.y / len;
		}

		this.x = nx * thickness;
		this.y = ny * thickness;

		return this;
	},

	angle: function() {
		return Math.atan2(this.y, this.x);
	},

	angleTo: function(p) {
		var dx = p.x - this.x,
			dy = p.y - this.y;
		return Math.atan2(dy, dx);
	},

	distanceTo: function(p) {
		var dx = this.x - p.x,
			dy = this.y - p.y;
		return Math.sqrt(dx * dx + dy * dy);
	},

	distanceToSq: function(p) {
		var dx = this.x - p.x,
			dy = this.y - p.y;
		return dx * dx + dy * dy;
	},

	negate: function() {
		this.x *= -1;
		this.y *= -1;

		return this;
	},

	eq: function(p) {
		return this.x === p.x && this.y === p.y;
	},

	isEmpty: function() {
		return !this.x && !this.y;
	},

	clone: function() {
		return new Point(this.x, this.y);
	},

	toArray: function() {
		return [this.x, this.y];
	},

	toString: function() {
		return '(x:' + this.x + ', y:' + this.y + ')';
	}
};


/**
 * Range
 */
function Range(left, right, top, bottom) {
	this.left = left || 0;
	this.right = right || 0;
	this.top = top || 0;
	this.bottom = bottom || 0;
}

Range.prototype = {
	contains: function(x, y, inflate) {
		if (!inflate) inflate = 0;
		return x > this.left - inflate && x < this.right + inflate
			&& y > this.top - inflate && y < this.bottom + inflate;
	}
};


/**
 * Ship
 *
 * @super Point
 */
function Ship(x, y, size) {
	Point.call(this, x, y);
	this.size = size; // 船のサイズ
	this.currentWepon = WEPON_DEFAULT;
  // 前回の位置, 弾の射出時にのせるスピードを算出する
  // Calculate the speed at the time of the previous position and bullet firing
	this.latest = this.clone();
	this.path = new Path();
  // 基準点を示すパス, path の回転の基準とする
  // A path indicating a reference point, used as a reference for rotation of path
	this._referencePath = new Path();
	this.v = new Point(); // 移動ベクトル

	// 船体の描画点を作成
	// Create hull drawing points
	var d = [0, 140, 180, 220], c, r, p;
	for (var i = 0, len = d.length; i < len; i++) {
		c = DEG_TO_RAD * d[i],
		r = i === 2 ? this.size / 2 : this.size;
		p = Point.polar(r, c).add(this);
		this.path.push(p);
		this._referencePath.push(p.clone());
	}
}

Ship.prototype = extend(new Point(), {
	angle: 0, // 自機の向き
	possibleShooting: true, // ビームの射出が可能か示す
	specialWeponSetTime: 0, // 特殊武器を設定した時間
	died: false, // 自機が破壊されているか示す
	splinter: null, // 自機の破片

	// 特殊武器を設定する
	setSpecialWepon: function(wepon) {
		this.specialWeponSetTime = new Date().getTime();
		this.currentWepon = wepon;
	},

	// 自機の破壊, died フラグをたてて自機破片用の Splinter を作成する
	destroy: function() {
		this.died = true;
		this.splinter = new Splinter(this.x, this.y, 100, 100);
	},

	// ビームを射出, 射出が可能な場合は引数で渡された Collection に Beam を追加する
  // Beam is emitted, and if injection is possible, Beam is added to the Collection passed as an argument
	fire: function(beams) {
		if (!this.possibleShooting) return false;
		this.possibleShooting = false;

		var p = Point.polar(this.size, this.angle).add(this);
		var beam = new Beam(p.x, p.y, this.angle, this.currentWepon);

		// 自機のスピードをのせる
		// Put your own speed
		var currentSpeed = this.latest.distanceTo(this);
		if (currentSpeed > SHIP_SPEED) currentSpeed = SHIP_SPEED;
		beam.speed += currentSpeed;

		var self = this;
		setTimeout(function() { self.possibleShooting = true; }, beam.shootingInterval);

		beams.push(beam);
	},

	update: function(mouse) {
		if (this.died) {
			// 破壊されているなら破片を更新
			this.splinter.update();
			return;
		}

		this.latest.set(this);

		var v = this.v.set(mouse).sub(this);
		var vlen = v.length();

		if (vlen > SHIP_SPEED) v.normalize(SHIP_SPEED);

		// マウス直前まで移動
		var i, len;
		if (vlen > this.size + 10) {
			this.add(v);
			for (i = 0, len = this.path.length; i < len; i++) {
				this._referencePath[i].add(v);
			}
		}

		var angle = this.angle = v.angle();

		var cos = Math.cos(angle);
		var sin = Math.sin(angle);
		var p, rp, dx, dy;

		for (i = 0, len = this.path.length; i < len; i++) {
			p = this.path[i];
			rp = this._referencePath[i];
			dx = rp.x - this.x;
			dy = rp.y - this.y;
			p.x = this.x + dx * cos - dy * sin;
			p.y = this.y + dx * sin + dy * cos;
		}

		if (new Date().getTime() - this.specialWeponSetTime > SPECIAL_WEPON_TIME) {
			this.currentWepon = WEPON_DEFAULT;
		}
	},

	draw: function(ctx) {
		if (!this.died) this.path.draw(ctx);
	}
});


/**
 * Beam
 *
 * @super Point
 */
function Beam(x, y, angle, wepon) {
	Point.call(this, x, y);
	this.angle = angle;

	// 線が短かったり移動が速い場合に当たり判定がとれずにすり抜けてしまう問題を解決するため
	// 当たり判定用の path は前回の後尾位置と現在の先頭位置をとり, 描画用のパスは renderPath とする
  // In order to solve the problem that the hit judgment can not be taken when the line is short or the movement is fast
	// The path for hit detection takes the last position and the current start position, and render path is renderPath
	this.path = new Path([this, this.clone()], false);
	this.renderPath = new Path([this, this.clone()], false);

	extend(this, wepon || WEPON_DEFAULT);
}

Beam.prototype = extend(new Point(), {
	releaseCompleted: false, // 射出完了フラグ
	vanished: false, // 消失フラグ
	exploding: false,

	notifyHit: function() {
		if (this.explosion) {
			if (!this.exploding) {
				this.power *= 0.5;
				this.width = 1;
				this.path = this.renderPath = new ExplosionPath(this.x, this.y, this.explosion);
				this.exploding = true;
			}
		} else if (!this.through) {
			this.vanished = true;
		}
	},

	update: function() {
		if (this.vanished) return;

		if (this.exploding) {
			this.path.update(); // Explosion update
			if (this.path.complete) this.vanished = true;
			return;
		}

		var v = Point.polar(this.speed, this.angle);
		var renderTail = this.renderPath[1];

		// 画面外に出たら消失
		if (!fieldRange.contains(renderTail.x, renderTail.y)) {
			this.vanished = true;
			return;
		}

		// 前回の後尾位置をとる
		this.path[1].set(renderTail);
		// 先頭位置を移動
		this.add(v);

		// 射出の判定を行って描画用パスを更新する, 射出が完了するまでは後尾の座標は移動しない
    // 射出の判定を行って描画用パスを更新する, 射出が完了するまでは後尾の座標は移動しない
		if (this.releaseCompleted) {
			// 射出が完了しているなら後尾を移動
			renderTail.add(v);
		} else {
			// Update the drawing path by determining the injection, and the tail coordinate does not move until the injection is completed
			this.releaseCompleted = this.distanceTo(renderTail) > this.length;
			if (this.releaseCompleted) {
				renderTail.set(Point.polar(this.length, this.angle - PI).add(this));
			}
		}
	},

	draw: function(ctx) {
		ctx.beginPath();
		ctx.strokeStyle = this.color;
		ctx.lineWidth = this.width;
		this.renderPath.draw(ctx);
		ctx.stroke();
	}
});


/**
 * Explosion
 *
 * @super Path
 */
function ExplosionPath(x, y, options) {
	this.x = x;
	this.y = y;
	extend(this, options);
}

ExplosionPath.prototype = extend(new Path(), {
	currentRange: 0,
	complete: false,

	update: function() {
		if (this.complete) return;

		this.currentRange += this.speed * 2;

		if (this.currentRange > this.range) {
			this.currentRange = this.range;
			this.complete = true;
		}

		for (var i = 0, p; i < 10; i++) {
			p = Point.polar(this.currentRange / 2, TWO_PI / 10 * i).add(this);

			// 配列を継承したクラスの場合番地を直接指定しての挿入では length がうまく反映されないので最初は push を使用する
      // In the case of a class that inherits an array, the length is not reflected well in the insertion by specifying the address directly, so push is used first
			if (!this[i]) {
				this.push(p);
			} else {
				this[i] = p;
			}
		}
	}
});


/**
 * Asteroid
 *
 * @super Point
 */
function Asteroid(x, y, radius, angle) {
	Point.call(this, x, y);
	this.radius = radius; // 最大半径
	this.angle = angle; // 進行方向の角度

	this.make();
}

// ランダムなパラメータを与えられた新しい Asteroid オブジェクトを返す
// 出現場所は画面外で画面内へ侵入する進行角度を持つ
// Returns a new Asteroid object with random parameters
// Appearance location has a traveling angle to enter the screen outside the screen
Asteroid.spawn = function() {
	var side = randInt(3); // 出現位置をランダムに決定
	var angle = randUniform(PI * 0.5);
	var x, y;

	// 0: Left, 1: Right
	if (side === 0 || side === 1) {
		y = randUniform(canvasHeight + ASTEROID_MAX_SIZE, -ASTEROID_MAX_SIZE);
		x = (side === 0) ? - ASTEROID_MAX_SIZE : canvasWidth + ASTEROID_MAX_SIZE;
		angle = (side === 0) ? angle - PI * 0.25 : angle + PI * 0.75;
	}
	// 2: Top, 3: Bottom
	else {
		x = randUniform(canvasWidth + ASTEROID_MAX_SIZE, -ASTEROID_MAX_SIZE);
		y = (side === 2) ? - ASTEROID_MAX_SIZE : canvasHeight + ASTEROID_MAX_SIZE;
		angle = (side === 2) ? angle + PI * 0.25 : angle - PI * 0.75;
	}

	// Asteroid.MIN_SIZE ~ ASTEROID_MAX_SIZE の間でランダム
	var radius = randUniform(ASTEROID_MAX_SIZE, ASTEROID_MIN_SIZE);
	return new Asteroid(x, y, radius, angle);
};

Asteroid.prototype = extend(new Point(), {
	vanished: false,
	make: function() {
		this.v = Point.polar(1, this.angle);
		this.v.normalize((1 - this.radius / ASTEROID_MAX_SIZE) * 1.75 + 0.25);

		this.path = new Path();
		for (var i = 0, num = 12, radius; i < num; i++) {
			radius = randUniform(this.radius, this.radius * 0.5);
			this.path.push(Point.polar(radius, TWO_PI * i / num).add(this));
		}
	},

	// 与えられた damage 分半径を小さくする, ASTEROID_MIN_SIZE を下回った場合消失
	// damage は 1 までの割合で指定, ASTEROID_MAX_SIZE の係数としてダメージの割合を表現する
	// 引数で渡された Collection に小惑星の大きさを反映した Splinter を追加する
  // Decrease radius by given damage, disappear if it falls below ASTEROID_MIN_SIZE
	// damage is specified as a ratio up to 1, and the damage ratio is expressed as a coefficient of ASTEROID_MAX_SIZE
	// Add a Splinter that reflects the size of the asteroid to the Collection passed as an argument
	damage: function(damage, splinters) {
		if (damage <= 0) return;
		if (damage > 1) damage = 1;

		var radiusTemp = this.radius;
		var debrisNum = Math.round(32 * damage);
		var score = SCORE.ASTEROID_DAMAGE;

		this.radius -= ASTEROID_MAX_SIZE * damage;

		if (this.radius < ASTEROID_MIN_SIZE) {
			// ASTEROID_MIN_SIZE を下回るなら消失
			this.vanished = true;
			score = SCORE.ASTEROID_DESTROY;

		} else {
			// 進行角度を最大 30 度ずらす
			this.angle += DEG_TO_RAD * randUniform(30, -30);
			this.make();
		}

		splinters.push(new Splinter(this.x, this.y, radiusTemp, debrisNum));

		return score;
	},

	update: function() {
		if (this.vanished) return;

		// 画面外に出たら消失
		if (!fieldRange.contains(this.x, this.y, ASTEROID_MAX_SIZE + 10)) {
			this.vanished = true;
			return;
		}

		var v = this.v;
		this.add(v);
		this.path.eachPoints(function(p, i) { p.add(v); });
	},

	draw: function(ctx) {
		this.path.draw(ctx);
	}
});


/**
 * Ufo
 *
 * @super Point
 */
function Ufo(x, y) {
	Point.call(this, x, y);

	var P = function(px, py) {
		return new Point(x + px, y + py);
	};

	this.path = new Path([
		P(-4.5, -5),
		P(4.5, -5),
		P(7, 0), // 2
		P(15, 4.5), // 3
		P(7, 9),
		P(-7, 9),
		P(-15, 4.5), // 6
		P(-7, 0) // 7
	]);

	this.destination = new Point(randUniform(canvasWidth), randUniform(canvasHeight));
	this.v = new Point();
}

// ランダムなパラメータを与えられた新しい Ufo オブジェクトを返す
Ufo.spawn = function() {
	var x, y, side = randInt(3); // 出現位置をランダムに決定

	// 0: Left, 1: Right
	if (side === 0 || side === 1) {
		y = randUniform(canvasHeight + 30, -30);
		x = (side === 0) ? - 30 : canvasWidth + 30;
	}
	// 2: Top, 3: Bottom
	else {
		x = randUniform(canvasWidth + 30, -30);
		y = (side === 2) ? - 30 : canvasHeight + 30;
	}

	return new Ufo(x, y);
};

Ufo.prototype = extend(new Point(), {
	vanished: false,
	hp: 100, // UFO の HP
	damagedBlink: 0, // ダメージ時の点滅表現のフレームカウント用

	damage: function(damage, splinters) {
		if (damage <= 0) return;
		if (damage > 1) damage = 1;

		var splinterRadius = 10;
		var splinterNum = 5;
		var score = SCORE.UFO_DAMAGE;

		this.hp -= damage * 100;
		if (this.hp <= 0) {
			this.vanished = true;
			splinterRadius = 25;
			splinterNum = 20;
			score = SCORE.UFO_DESTROY;
		}

		splinters.push(new Splinter(this.x, this.y, splinterRadius, splinterNum));

		// 4 フレームごとに 1 回　で 10 回点滅
		this.damagedBlink = 40;

		return score;
	},

	update: function() {
		var v = this.v;
		var destination = this.destination;

		v.set(destination).sub(this);

		var dist = v.length();
		if (dist > UFO_SPEED) {
			v.normalize(UFO_SPEED);
		} else if (dist < 0.1) {
			destination.set(randUniform(canvasWidth), randUniform(canvasHeight));
		}

		this.add(v);
		this.path.eachPoints(function(p, i) { p.add(v); });
	},

	draw: function(ctx) {
		if (this.damagedBlink) {
			var off = this.damagedBlink % 4 === 0;
			this.damagedBlink--;
			if (off) return;
		}

		var path = this.path;
		path.draw(ctx);

		// 内側のライン
		var a1 = path[2], a2 = path[7];
		ctx.moveTo(a1.x, a1.y);
		ctx.lineTo(a2.x, a2.y);
		var b1 = path[3], b2 = path[6];
		ctx.moveTo(b1.x, b1.y);
		ctx.lineTo(b2.x, b2.y);
	}
});


/**
 * Item
 *
 * @super Point
 */
function Item(x, y) {
	Point.call(this, x, y);

	var path = this.path = new Path();

	var d = TWO_PI / 6;
	for (var i = 0; i < 6; i++) {
		path.push(Point.polar(10, d * i).add(this));
	}

	this.wepon = WEPON_SPECIAL[randInt(WEPON_SPECIAL.length - 1)];

	this.v = Point.polar(ITEM_SPEED, randUniform(TWO_PI));
}

Item.prototype = extend(new Point(), {
	update: function() {
		var v = this.v;
		this.add(v);
		this.path.eachPoints(function(p, i) { p.add(v); });

		// 画面外に出たら消失
		if (!fieldRange.contains(this.x, this.y, 20)) {
			this.vanished = true;
			return;
		}
	},

	draw: function(ctx) {
		this.path.draw(ctx);
		// 対角線を描画
		this.path.eachPoints(function(p, i) {
			if (i === 3) return false;
			ctx.moveTo(p.x, p.y);
			var p2 = this[i + 3];
			ctx.lineTo(p2.x, p2.y);
		});
	}
});


/**
 * Splinter
 *
 * @super Point
 */
function Splinter(x, y, radius, num) {
	Point.call(this, x, y);

	var values = this._values = [];
	for (var i = 0; i < num; i++) {
		values.push({
			x: x, y: y,
			angle: randUniform(TWO_PI),
			radius: randUniform(radius),
			dist: Math.random()
		});
	}

	this._time = new Date().getTime();
}

Splinter.prototype = extend(new Point(), {
	vanished: false,

	update: function() {
		var o, c, r, x, y;

		for (var i = 0, len = this._values.length; i < len; i++) {
			o = this._values[i];
			c = o.angle;
			r = o.radius;
			x = o.x = Math.round(this.x + r * Math.cos(c));
			y = o.y = Math.round(this.y + r * Math.sin(c));

			// 画面外に出たら消失
			if (!fieldRange.contains(x, y)) {
				this._values.splice(i, 1);
				len--;
				i--;
				continue;
			}

			this._values[i].radius += o.dist;
		}

		// 破片が全て画面外に消失しているか, 発生から指定時間が経過しているなら消失
		this.vanished = this._values.length === 0 || new Date().getTime() - this._time > 1000 * 7;
	},

	draw: function(ctx) {
		for (var i = 0, len = this._values.length, o; i < len; i++) {
			o = this._values[i];
			ctx.rect(o.x, o.y, 1, 1);
		}
	}
});


/**
 * Debri
 *
 * @super Point
 */
function Debri(x) {
	Point.call(this, x, randInt(canvasHeight));
	this.speed = randUniform(2, 0.5);
}

Debri.prototype = extend(new Point(), {
	vanished: false,

	update: function() {
		if (this.vanished) return;

		// 画面外に出たら消失
		if (this.x < 0) {
			this.vanished = true;
			return;
		}

		this.x = Math.round(this.x - this.speed);
	},

	draw: function(ctx) {
		ctx.rect(this.x, this.y, 1, 1);
	}
});


// Init
window.addEventListener('load', init, false);

