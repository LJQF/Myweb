/* ==========================================================================
   flappy.js —— 飞扬的小鸟：渲染 / 输入 / 存档
   ========================================================================== */
(function () {
  'use strict';

  var F = window.FlappyEngine;
  if (!F) return;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('board-wrap');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovScore = document.getElementById('ov-score');
  var ovDesc = document.getElementById('ov-desc');
  var bestEl = document.getElementById('best-score');

  var W = F.W, H = F.H;
  var state = F.create({ seed: (Math.random() * 1e9) | 0 });
  var running = true;
  var lastT = 0;
  var best = 0;
  var deadShown = false;
  var BEST_KEY = 'flappy.best.v1';

  try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = String(best);

  function resize() {
    var rect = wrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    var s = canvas.width / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  /* ---------------- 绘制 ---------------- */
  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6ec8ee');
    g.addColorStop(0.6, '#a8dcf3');
    g.addColorStop(1, '#d6edf6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* 云 */
    var off = state.scroll * 0.6;
    for (var i = 0; i < 4; i++) {
      var cx = ((i * 190 - off * 0.5) % (W + 220) + W + 220) % (W + 220) - 110;
      var cy = 90 + i * 78;
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.arc(cx + 34, cy + 6, 22, 0, Math.PI * 2);
      ctx.arc(cx - 32, cy + 8, 20, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPipes() {
    state.pipes.forEach(function (p) {
      var capH = 26;
      /* 上管 */
      ctx.fillStyle = '#5fbf3b';
      ctx.fillRect(p.x, 0, F.PIPE_W, p.top - capH);
      ctx.fillStyle = '#4aa32f';
      ctx.fillRect(p.x + F.PIPE_W - 12, 0, 12, p.top - capH);
      ctx.fillStyle = '#7ed957';
      ctx.fillRect(p.x, 0, 10, p.top - capH);
      /* 上管口 */
      ctx.fillStyle = '#5fbf3b';
      ctx.fillRect(p.x - 6, p.top - capH, F.PIPE_W + 12, capH);
      ctx.strokeStyle = '#3d8b26';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 6, p.top - capH, F.PIPE_W + 12, capH);

      /* 下管 */
      var by = p.bottom;
      ctx.fillStyle = '#5fbf3b';
      ctx.fillRect(p.x, by + capH, F.PIPE_W, state.groundY - by - capH);
      ctx.fillStyle = '#4aa32f';
      ctx.fillRect(p.x + F.PIPE_W - 12, by + capH, 12, state.groundY - by - capH);
      ctx.fillStyle = '#7ed957';
      ctx.fillRect(p.x, by + capH, 10, state.groundY - by - capH);
      /* 下管口 */
      ctx.fillStyle = '#5fbf3b';
      ctx.fillRect(p.x - 6, by, F.PIPE_W + 12, capH);
      ctx.strokeStyle = '#3d8b26';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 6, by, F.PIPE_W + 12, capH);
    });
  }

  function drawGround() {
    var y = state.groundY;
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = '#c9c37d';
    for (var x = -24 + (state.scroll % 24); x < W + 24; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, y + 22);
      ctx.lineTo(x + 12, y + 34);
      ctx.lineTo(x + 24, y + 22);
      ctx.fill();
    }
    ctx.fillStyle = '#8ed05c';
    ctx.fillRect(0, y, W, 14);
    ctx.fillStyle = '#6fb944';
    ctx.fillRect(0, y + 14, W, 6);
  }

  function drawBird() {
    var b = state.bird;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot * 0.9);

    /* 翅膀 */
    var wing = Math.sin((1 - b.wing) * Math.PI) * 8;
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    ctx.ellipse(-6, 4 + wing * 0.6, 12, 8 - wing * 0.3, -0.3, 0, Math.PI * 2);
    ctx.fill();

    /* 身体 */
    ctx.fillStyle = '#facd1a';
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e0ab00';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 肚皮 */
    ctx.fillStyle = '#fdeaa0';
    ctx.beginPath();
    ctx.ellipse(2, 6, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 眼睛 */
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(6, -6, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(8, -6, 3, 0, Math.PI * 2);
    ctx.fill();

    /* 嘴 */
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(24, 3);
    ctx.lineTo(14, 8);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawScore() {
    if (state.phase === 'ready') return;
    ctx.save();
    ctx.font = '700 62px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(20,30,40,.55)';
    ctx.strokeText(String(state.score), W / 2, 96);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(state.score), W / 2, 96);
    ctx.restore();
  }

  function drawReadyHint() {
    if (state.phase !== 'ready') return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(15, 32, 46, .82)';
    ctx.font = '700 30px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillText('点一下开始', W / 2, H * 0.62);
    ctx.font = '400 17px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(15, 32, 46, .58)';
    ctx.fillText('点屏幕 / 空格 让小鸟往上飞', W / 2, H * 0.62 + 34);
    ctx.restore();
  }

  function render() {
    drawSky();
    drawPipes();
    drawGround();
    drawBird();
    drawScore();
    drawReadyHint();
  }

  /* ---------------- 循环 ---------------- */
  function loop(now) {
    if (!running) return;
    if (!lastT) lastT = now;
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    F.update(state, dt);

    if (state.phase === 'dead' && !deadShown && state.deadT > 0.7) {
      deadShown = true;
      showDead();
    }

    render();
    window.requestAnimationFrame(loop);
  }

  function showDead() {
    var score = state.score;
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }
    var isBest = score > 0 && score >= best;
    ovTitle.textContent = isBest ? '新纪录！' : '撞上了';
    ovScore.textContent = String(score);
    ovDesc.textContent = '最高分 ' + best + (score < 5 ? ' · 再试一次？' : '');
    overlay.hidden = false;
  }

  function restart() {
    state = F.create({ seed: (Math.random() * 1e9) | 0 });
    deadShown = false;
    lastT = 0;
    overlay.hidden = true;
  }

  /* ---------------- 输入 ---------------- */
  function tap() {
    if (state.phase === 'dead') {
      if (deadShown) restart();
      return;
    }
    F.flap(state);
  }

  wrap.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (e.target.closest && e.target.closest('button')) return;
    tap();
  });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      if (!overlay.hidden) return;
      tap();
    }
  });

  document.getElementById('btn-again').addEventListener('click', function (e) {
    e.stopPropagation();
    restart();
  });

  window.addEventListener('resize', resize);
  resize();
  window.requestAnimationFrame(loop);

  /* 调试用 */
  window.FlappyDebug = {
    info: function () {
      return {
        phase: state.phase,
        score: state.score,
        best: best,
        y: Math.round(state.bird.y),
        pipes: state.pipes.length,
        overlay: !overlay.hidden
      };
    },
    flap: function () { return F.flap(state); },
    restart: restart,
    state: function () { return state; }
  };
}());
