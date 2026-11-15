/* ==========================================================================
   snake-game.js —— 贪吃蛇界面（Canvas）
   ========================================================================== */
(function () {
  'use strict';

  var S = window.SnakeEngine;
  if (!S) return;

  var COLS = 20;
  var ROWS = 20;
  var BEST_KEY = 'xiaozhan.snake.best';

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovDesc = document.getElementById('ov-desc');
  var btnStart = document.getElementById('btn-start');
  var btnPause = document.getElementById('btn-pause');
  var btnRestart = document.getElementById('btn-restart');
  var boardWrap = canvas.parentNode;

  var state = null;
  var running = false;
  var paused = false;
  var over = false;
  var acc = 0;
  var last = 0;
  var size = 300;
  var best = 0;
  var overlayAction = null;

  try {
    best = parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
  } catch (e) { best = 0; }

  bestEl.textContent = String(best);

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    size = rect.width;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ---------------- 绘制 ---------------- */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function theme() {
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return dark
      ? { grid: 'rgba(255,255,255,.045)', body1: '#34d399', body2: '#059669', head: '#10b981', eye: '#052e16', food: '#f87171', gl: 'rgba(248,113,113,.45)' }
      : { grid: 'rgba(15,23,42,.045)', body1: '#4ade80', body2: '#16a34a', head: '#22c55e', eye: '#08331c', food: '#ef4444', gl: 'rgba(239,68,68,.35)' };
  }

  function draw() {
    if (!size) return;
    var t = theme();
    var cell = size / COLS;

    ctx.clearRect(0, 0, size, size);

    /* 淡格线 */
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < COLS; i++) {
      ctx.moveTo(Math.round(i * cell) + 0.5, 0);
      ctx.lineTo(Math.round(i * cell) + 0.5, size);
      ctx.moveTo(0, Math.round(i * cell) + 0.5);
      ctx.lineTo(size, Math.round(i * cell) + 0.5);
    }
    ctx.stroke();

    if (!state) return;

    /* 食物 */
    if (state.food) {
      var fx = (state.food.x + 0.5) * cell;
      var fy = (state.food.y + 0.5) * cell;
      ctx.save();
      ctx.shadowColor = t.gl;
      ctx.shadowBlur = cell * 0.8;
      ctx.fillStyle = t.food;
      ctx.beginPath();
      ctx.arc(fx, fy, cell * 0.31, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath();
      ctx.arc(fx - cell * 0.1, fy - cell * 0.1, cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 蛇身 */
    var n = state.snake.length;
    for (var k = n - 1; k >= 0; k--) {
      var seg = state.snake[k];
      var pad = cell * 0.08;
      var x = seg.x * cell + pad;
      var y = seg.y * cell + pad;
      var w = cell - pad * 2;

      var ratio = n > 1 ? k / (n - 1) : 0;
      ctx.fillStyle = k === 0 ? t.head : mix(t.body1, t.body2, ratio);

      roundRect(x, y, w, w, cell * (k === 0 ? 0.34 : 0.28));
      ctx.fill();
    }

    /* 眼睛 */
    var head = state.snake[0];
    var hx = (head.x + 0.5) * cell;
    var hy = (head.y + 0.5) * cell;
    var d = state.dir;
    var ex = d.y !== 0 ? cell * 0.16 : 0;
    var ey = d.x !== 0 ? cell * 0.16 : 0;
    var fx2 = d.x * cell * 0.12;
    var fy2 = d.y * cell * 0.12;

    ctx.fillStyle = t.eye;
    ctx.beginPath();
    ctx.arc(hx - ex + fx2, hy - ey + fy2, cell * 0.075, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx + ex + fx2, hy + ey + fy2, cell * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }

  function mix(a, b, t) {
    var pa = hex(a);
    var pb = hex(b);
    var r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
    var g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
    var bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function hex(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  /* ---------------- 流程 ---------------- */
  function speed() {
    return Math.max(70, 140 - state.score * 3);
  }

  function showOverlay(title, desc, label, action) {
    ovTitle.textContent = title;
    ovDesc.innerHTML = desc;
    btnStart.textContent = label;
    overlayAction = action;
    overlay.hidden = false;
  }

  function start() {
    state = S.create({ cols: COLS, rows: ROWS });
    over = false;
    paused = false;
    acc = 0;
    last = 0;
    scoreEl.textContent = '0';
    btnPause.textContent = '暂停';
    overlay.hidden = true;
    if (!running) {
      running = true;
      window.requestAnimationFrame(frame);
    }
    draw();
  }

  function resume() {
    paused = false;
    last = 0;
    btnPause.textContent = '暂停';
    overlay.hidden = true;
  }

  function togglePause() {
    if (over || !state) return;
    if (paused) { resume(); return; }
    paused = true;
    btnPause.textContent = '继续';
    showOverlay('已暂停', '按空格或点下面的按钮继续', '继续游戏', resume);
  }

  function gameOver() {
    running = false;
    over = true;
    if (state.score > best) {
      best = state.score;
      bestEl.textContent = String(best);
      try { window.localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* 忽略 */ }
    }
    draw();
    showOverlay('游戏结束', '这一局吃了 <b>' + state.score + '</b> 个 · 最高 ' + best, '再来一次', start);
  }

  function win() {
    running = false;
    over = true;
    draw();
    showOverlay('满屏通关！', '整块棋盘都被你填满了，太狠了', '再来一次', start);
  }

  function tick() {
    var res = S.step(state);
    if (res.ate) {
      scoreEl.textContent = String(state.score);
      if (state.score > best) {
        best = state.score;
        bestEl.textContent = String(best);
      }
    }
    if (res.dead) { gameOver(); return; }
    if (res.won) { win(); return; }
  }

  function frame(ts) {
    if (!running) return;

    if (!paused) {
      if (!last) last = ts;
      var dt = Math.min(ts - last, 220);
      last = ts;
      acc += dt;
      var stepMs = speed();
      var guard = 0;
      while (acc >= stepMs && !over && !paused && guard++ < 8) {
        acc -= stepMs;
        tick();
      }
    }

    draw();
    if (running) window.requestAnimationFrame(frame);
  }

  /* ---------------- 输入 ---------------- */
  var KEYS = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', k: 'up', j: 'down', h: 'left', l: 'right'
  };

  function steer(dir) {
    if (over || !state) return;
    if (!running) { start(); }
    if (paused) resume();
    S.setDir(state, dir);
  }

  window.addEventListener('keydown', function (e) {
    var k = String(e.key).toLowerCase();

    if (k === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (over || !state) start();
      else togglePause();
      return;
    }

    if (k === 'r') { start(); return; }

    var dir = KEYS[k];
    if (!dir) return;
    e.preventDefault();
    if (over) { start(); return; }
    steer(dir);
  });

  var touchStart = null;

  boardWrap.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  boardWrap.addEventListener('touchend', function (e) {
    if (!touchStart) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 'right' : 'left');
    else steer(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  boardWrap.addEventListener('touchmove', function (e) {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  var pad = document.querySelector('.pad');
  if (pad) {
    pad.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-dir]');
      if (btn) steer(btn.dataset.dir);
    });
  }

  btnStart.addEventListener('click', function () { if (overlayAction) overlayAction(); });
  btnPause.addEventListener('click', togglePause);
  btnRestart.addEventListener('click', start);

  window.addEventListener('resize', resize);
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(boardWrap);

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { draw(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------------- 启动 ---------------- */
  state = null;
  overlayAction = start;
  resize();
  draw();
}());
