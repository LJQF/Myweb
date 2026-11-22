/* ==========================================================================
   shooter.js —— 打飞机：渲染 / 输入 / 存档
   ========================================================================== */
(function () {
  'use strict';

  var S = window.ShooterEngine;
  if (!S) return;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('board-wrap');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovScore = document.getElementById('ov-score');
  var ovDesc = document.getElementById('ov-desc');

  var W = S.W, H = S.H;
  var BEST_KEY = 'shooter.best.v1';
  var state = S.create({ seed: (Math.random() * 1e9) | 0 });
  var best = 0;
  var running = true;
  var started = false;
  var lastT = 0;
  var overShown = false;
  var keys = { left: false, right: false, up: false, down: false };
  var drag = { active: false, ox: 0, oy: 0, id: null };

  try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) { best = 0; }

  /* ---------------- 画布 ---------------- */
  function resize() {
    var rect = wrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    var s = canvas.width / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  function toWorld(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var s = rect.width / W;
    return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
  }

  /* ---------------- 绘制 ---------------- */
  function drawBg() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070d1c');
    g.addColorStop(0.55, '#0b1630');
    g.addColorStop(1, '#050a14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* 星云 */
    ctx.globalAlpha = 0.5;
    var n1 = ctx.createRadialGradient(120, 140, 10, 120, 140, 220);
    n1.addColorStop(0, 'rgba(80, 130, 255, .30)');
    n1.addColorStop(1, 'rgba(80, 130, 255, 0)');
    ctx.fillStyle = n1;
    ctx.fillRect(0, 0, W, H);

    var n2 = ctx.createRadialGradient(390, 520, 10, 390, 520, 240);
    n2.addColorStop(0, 'rgba(180, 80, 255, .22)');
    n2.addColorStop(1, 'rgba(180, 80, 255, 0)');
    ctx.fillStyle = n2;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    /* 星星 */
    for (var i = 0; i < state.stars.length; i++) {
      var st = state.stars[i];
      ctx.globalAlpha = 0.25 + st.z * 0.6;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillRect(st.x, st.y, 1.6 * st.z + 0.8, 1.6 * st.z + 0.8);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    var p = state.player;
    if (!p.alive) return;
    if (p.inv > 0 && Math.floor(p.inv * 14) % 2 === 0) return;   /* 无敌闪烁 */

    ctx.save();
    ctx.translate(p.x, p.y);

    /* 尾焰 */
    var flame = 12 + Math.sin(state.t * 30) * 4;
    var fg = ctx.createLinearGradient(0, 10, 0, 10 + flame);
    fg.addColorStop(0, 'rgba(120, 220, 255, .95)');
    fg.addColorStop(1, 'rgba(60, 120, 255, 0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-6, 10);
    ctx.lineTo(0, 10 + flame);
    ctx.lineTo(6, 10);
    ctx.closePath();
    ctx.fill();

    /* 机身 */
    ctx.fillStyle = '#e8f6ff';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(11, 8);
    ctx.lineTo(5, 6);
    ctx.lineTo(5, 13);
    ctx.lineTo(-5, 13);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-11, 8);
    ctx.closePath();
    ctx.fill();

    /* 座舱 */
    ctx.fillStyle = '#3ba9ff';
    ctx.beginPath();
    ctx.ellipse(0, -3, 3.6, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  var ENEMY_STYLE = {
    scout:  { body: '#ff6b6b', edge: '#ffb3b3' },
    dart:   { body: '#ffd166', edge: '#fff0b3' },
    gunner: { body: '#b794f6', edge: '#e0d0ff' }
  };

  function drawEnemy(e) {
    var st = ENEMY_STYLE[e.type] || ENEMY_STYLE.scout;
    ctx.save();
    ctx.translate(e.x, e.y);

    ctx.shadowColor = st.body;
    ctx.shadowBlur = e.hit > 0 ? 22 : 10;
    ctx.fillStyle = e.hit > 0 ? '#fff' : st.body;

    if (e.type === 'gunner') {
      ctx.beginPath();
      ctx.moveTo(0, e.r);
      ctx.lineTo(e.r, e.r * 0.2);
      ctx.lineTo(e.r * 0.6, -e.r * 0.8);
      ctx.lineTo(-e.r * 0.6, -e.r * 0.8);
      ctx.lineTo(-e.r, e.r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = st.edge;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'dart') {
      ctx.beginPath();
      ctx.moveTo(0, e.r);
      ctx.lineTo(e.r * 0.8, -e.r * 0.7);
      ctx.lineTo(0, -e.r * 0.3);
      ctx.lineTo(-e.r * 0.8, -e.r * 0.7);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, e.r);
      ctx.lineTo(e.r, 0);
      ctx.lineTo(0, -e.r);
      ctx.lineTo(-e.r, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBullets() {
    ctx.save();
    ctx.shadowColor = '#67e8f9';
    ctx.shadowBlur = 8;
    for (var i = 0; i < state.bullets.length; i++) {
      var b = state.bullets[i];
      ctx.fillStyle = '#aef4ff';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.r * 0.8, b.r * 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (var j = 0; j < state.ebullets.length; j++) {
      var eb = state.ebullets[j];
      var g = ctx.createRadialGradient(eb.x, eb.y, 0, eb.x, eb.y, eb.r * 2);
      g.addColorStop(0, 'rgba(255, 220, 130, 1)');
      g.addColorStop(0.55, 'rgba(255, 150, 60, .9)');
      g.addColorStop(1, 'rgba(255, 100, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, eb.r * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDrops() {
    state.drops.forEach(function (d) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.shadowColor = d.kind === 'power' ? '#67e8f9' : '#ff8fb1';
      ctx.shadowBlur = 14;
      ctx.fillStyle = d.kind === 'power' ? '#0ea5e9' : '#ec4899';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-11, -11, 22, 22, 6) : ctx.rect(-11, -11, 22, 22);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.kind === 'power' ? 'P' : '♥', 0, 1);
      ctx.restore();
    });
  }

  function drawParticles() {
    state.particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.5));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawScore() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 30px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(210, 235, 255, .92)';
    ctx.fillText(String(state.score), W / 2, 46);
    ctx.restore();
  }

  function drawStartHint() {
    if (started) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200, 230, 255, .92)';
    ctx.font = '700 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillText('点一下开始', W / 2, H * 0.56);
    ctx.font = '400 15px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(170, 205, 235, .75)';
    ctx.fillText('方向键 / 拖动都可以 · 会自动开火', W / 2, H * 0.56 + 32);
    ctx.restore();
  }

  function render() {
    drawBg();
    drawDrops();
    drawBullets();
    state.enemies.forEach(drawEnemy);
    drawPlayer();
    drawParticles();
    drawScore();
    drawStartHint();
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    document.getElementById('hud-score').textContent = String(state.score);
    document.getElementById('hud-power').textContent = String(state.player.power);
    var box = document.getElementById('hud-lives');
    var total = Math.max(3, state.lives);
    var html = '';
    for (var i = 0; i < total; i++) html += '<i class="' + (i >= state.lives ? 'off' : '') + '"></i>';
    box.innerHTML = html;
  }

  /* ---------------- 循环 ---------------- */
  function loop(now) {
    if (!running) return;
    if (!lastT) lastT = now;
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (started) {
      var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      var dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (dx || dy) S.move(state, dx, dy, dt);
      S.update(state, dt);
    } else {
      S.update(state, 0);           /* 只让背景星星动 */
      state.t += dt;
    }

    updateHud();

    if (state.phase === 'over' && !overShown) {
      overShown = true;
      window.setTimeout(showOver, 600);
    }

    render();
    window.requestAnimationFrame(loop);
  }

  function showOver() {
    if (state.score > best) {
      best = state.score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }
    ovTitle.textContent = state.score >= best && state.score > 0 ? '新纪录！' : '被击落了';
    ovScore.textContent = String(state.score);
    ovDesc.textContent = '最高分 ' + best + ' · 击落 ' + state.kills + ' 架';
    overlay.hidden = false;
  }

  function startGame() {
    state = S.create({ seed: (Math.random() * 1e9) | 0 });
    started = true;
    overShown = false;
    lastT = 0;
    overlay.hidden = true;
    updateHud();
  }

  /* ---------------- 输入 ---------------- */
  var KEYMAP = {
    arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down'
  };

  window.addEventListener('keydown', function (e) {
    var k = KEYMAP[String(e.key).toLowerCase()];
    if (!k) return;
    e.preventDefault();
    keys[k] = true;
    if (!started) startGame();
  });

  window.addEventListener('keyup', function (e) {
    var k = KEYMAP[String(e.key).toLowerCase()];
    if (!k) return;
    keys[k] = false;
  });

  window.addEventListener('blur', function () {
    keys.left = keys.right = keys.up = keys.down = false;
    drag.active = false;
  });

  wrap.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('button')) return;
    e.preventDefault();
    if (!started) { startGame(); return; }
    var p = toWorld(e.clientX, e.clientY);
    drag.active = true;
    drag.id = e.pointerId;
    /* 手指按住哪里，飞机就跟着走，保持一个偏移免得挡住飞机 */
    drag.ox = state.player.x - p.x;
    drag.oy = state.player.y - p.y;
    if (wrap.setPointerCapture) { try { wrap.setPointerCapture(e.pointerId); } catch (err) {} }
  });

  wrap.addEventListener('pointermove', function (e) {
    if (!drag.active || e.pointerId !== drag.id) return;
    e.preventDefault();
    var p = toWorld(e.clientX, e.clientY);
    S.setPos(state, p.x + drag.ox, p.y + drag.oy);
  });

  function endDrag(e) {
    if (e.pointerId !== undefined && e.pointerId !== drag.id) return;
    drag.active = false;
  }
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.getElementById('btn-again').addEventListener('click', function (e) {
    e.stopPropagation();
    startGame();
  });

  window.addEventListener('resize', resize);
  resize();
  updateHud();
  window.requestAnimationFrame(loop);

  /* 调试用 */
  window.ShooterDebug = {
    info: function () {
      return {
        phase: state.phase,
        started: started,
        score: state.score,
        lives: state.lives,
        power: state.player.power,
        enemies: state.enemies.length,
        bullets: state.bullets.length,
        kills: state.kills,
        overlay: !overlay.hidden,
        x: Math.round(state.player.x),
        y: Math.round(state.player.y)
      };
    },
    start: startGame,
    state: function () { return state; },
    setPos: function (x, y) { S.setPos(state, x, y); }
  };
}());
