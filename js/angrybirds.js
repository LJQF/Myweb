/* ==========================================================================
   angrybirds.js —— 渲染 / 输入 / 关卡流程
   ========================================================================== */
(function () {
  'use strict';

  var Matter = window.Matter;
  var E = window.BirdsEngine;
  var LEVELS = window.BirdsLevels.LEVELS;
  if (!Matter || !E || !LEVELS) return;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('board-wrap');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovDesc = document.getElementById('ov-desc');
  var ovStars = document.getElementById('ov-stars');

  var W = E.WIDTH, H = E.HEIGHT, GROUND = E.GROUND_Y;
  var SLING = E.SLING;

  var state = null;
  var levelIndex = 0;
  var running = false;
  var lastT = 0;
  var trail = [];
  var drag = { active: false, x: SLING.x, y: SLING.y, id: null };
  var STORE_KEY = 'birds.stars.v1';
  var stars = {};
  var finished = false;

  try { stars = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { stars = {}; }

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
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y + h, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var SKY_TOP = '#8fd3f0';
  var SKY_BOT = '#d8f0fb';

  function drawBackground(now) {
    var g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(1, SKY_BOT);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND);

    /* 太阳 */
    ctx.fillStyle = 'rgba(255, 240, 170, .85)';
    ctx.beginPath();
    ctx.arc(1380, 150, 62, 0, Math.PI * 2);
    ctx.fill();

    /* 远山 */
    ctx.fillStyle = 'rgba(122, 190, 150, .55)';
    ctx.beginPath();
    ctx.moveTo(-50, GROUND);
    ctx.quadraticCurveTo(280, 470, 620, GROUND);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(420, GROUND);
    ctx.quadraticCurveTo(820, 420, 1180, GROUND);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(96, 170, 132, .65)';
    ctx.beginPath();
    ctx.moveTo(900, GROUND);
    ctx.quadraticCurveTo(1260, 500, 1700, GROUND);
    ctx.closePath();
    ctx.fill();

    /* 云 */
    var clouds = [[300, 150, 1], [760, 110, .8], [1150, 210, .7]];
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    clouds.forEach(function (c) {
      var dx = Math.sin(now / 9000 + c[0]) * 18;
      ctx.beginPath();
      ctx.arc(c[0] + dx, c[1], 34 * c[2], 0, Math.PI * 2);
      ctx.arc(c[0] + dx + 40 * c[2], c[1] + 8, 26 * c[2], 0, Math.PI * 2);
      ctx.arc(c[0] + dx - 38 * c[2], c[1] + 10, 22 * c[2], 0, Math.PI * 2);
      ctx.fill();
    });

    /* 草地 */
    ctx.fillStyle = '#7bc86c';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#67b45a';
    ctx.fillRect(0, GROUND, W, 14);
    ctx.fillStyle = '#5aa34e';
    for (var x = 0; x < W; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND + 14);
      ctx.lineTo(x + 9, GROUND + 4);
      ctx.lineTo(x + 18, GROUND + 14);
      ctx.fill();
    }
  }

  function drawSlingshot() {
    ctx.strokeStyle = '#8b5a2b';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(SLING.x, GROUND + 6);
    ctx.lineTo(SLING.x, SLING.y + 46);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(SLING.x, SLING.y + 52);
    ctx.lineTo(SLING.x - 22, SLING.y - 6);
    ctx.moveTo(SLING.x, SLING.y + 52);
    ctx.lineTo(SLING.x + 22, SLING.y - 6);
    ctx.stroke();
  }

  function drawBand(anchor, birdPos) {
    ctx.strokeStyle = '#4b2e1a';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(SLING.x - 22, SLING.y - 4);
    ctx.lineTo(birdPos.x, birdPos.y);
    ctx.moveTo(SLING.x + 22, SLING.y - 4);
    ctx.lineTo(birdPos.x, birdPos.y);
    ctx.stroke();
  }

  function drawBird(x, y, angle, r) {
    r = r || E.BIRD_R;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);

    ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.beginPath();
    ctx.ellipse(0, r + 8, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e11d48';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fde2e6';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.42, r * 0.58, r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 眼睛 */
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.05, -r * 0.28, r * 0.3, 0, Math.PI * 2);
    ctx.arc(r * 0.52, -r * 0.28, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(r * 0.12, -r * 0.28, r * 0.13, 0, Math.PI * 2);
    ctx.arc(r * 0.55, -r * 0.28, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    /* 眉毛 */
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = r * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.6);
    ctx.lineTo(r * 0.28, -r * 0.42);
    ctx.stroke();

    /* 嘴 */
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(r * 0.62, -r * 0.02);
    ctx.lineTo(r * 1.18, r * 0.16);
    ctx.lineTo(r * 0.6, r * 0.36);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawPig(b) {
    var r = b.game.r;
    var x = b.position.x, y = b.position.y;
    var hurt = 1 - Math.max(0, b.game.hp) / b.game.maxHp;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.angle);

    ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.beginPath();
    ctx.ellipse(0, r + 7, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hurt > 0.5 ? '#7fae4a' : '#8cc63f';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    /* 耳朵 */
    ctx.fillStyle = '#79b236';
    ctx.beginPath();
    ctx.ellipse(-r * 0.62, -r * 0.72, r * 0.26, r * 0.2, -0.5, 0, Math.PI * 2);
    ctx.ellipse(r * 0.62, -r * 0.72, r * 0.26, r * 0.2, 0.5, 0, Math.PI * 2);
    ctx.fill();

    /* 鼻子 */
    ctx.fillStyle = '#a8dc6b';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.28, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5f8f2c';
    ctx.beginPath();
    ctx.arc(-r * 0.15, r * 0.28, r * 0.07, 0, Math.PI * 2);
    ctx.arc(r * 0.15, r * 0.28, r * 0.07, 0, Math.PI * 2);
    ctx.fill();

    /* 眼睛 */
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-r * 0.34, -r * 0.22, r * 0.24, 0, Math.PI * 2);
    ctx.arc(r * 0.34, -r * 0.22, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.22, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.38, -r * 0.22, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  var MAT_STYLE = {
    wood:  { fill: '#c98b45', edge: '#8d5a22' },
    stone: { fill: '#9aa1a9', edge: '#6b7076' },
    ice:   { fill: '#bfe9fa', edge: '#7fc4e0' }
  };

  function drawBlock(b) {
    var g = b.game;
    var st = MAT_STYLE[g.mat] || MAT_STYLE.wood;
    var hurt = 1 - Math.max(0, g.hp) / g.maxHp;

    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);

    ctx.fillStyle = 'rgba(0,0,0,.10)';
    roundRect(-g.w / 2 + 3, -g.h / 2 + 4, g.w, g.h, 6);
    ctx.fill();

    ctx.fillStyle = st.fill;
    roundRect(-g.w / 2, -g.h / 2, g.w, g.h, 6);
    ctx.fill();

    ctx.strokeStyle = st.edge;
    ctx.lineWidth = 3;
    roundRect(-g.w / 2, -g.h / 2, g.w, g.h, 6);
    ctx.stroke();

    /* 玻璃质感 */
    if (g.mat === 'ice') {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      roundRect(-g.w / 2 + 5, -g.h / 2 + 5, Math.max(6, g.w - 10), Math.max(4, g.h * 0.22), 3);
      ctx.fill();
    }

    /* 裂纹 */
    if (hurt > 0.3) {
      ctx.strokeStyle = 'rgba(40, 30, 20, ' + Math.min(0.75, hurt).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-g.w * 0.3, -g.h * 0.3);
      ctx.lineTo(-g.w * 0.05, g.h * 0.1);
      ctx.lineTo(-g.w * 0.22, g.h * 0.34);
      if (hurt > 0.6) {
        ctx.moveTo(g.w * 0.28, -g.h * 0.28);
        ctx.lineTo(g.w * 0.06, g.h * 0.05);
        ctx.lineTo(g.w * 0.2, g.h * 0.36);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTrail() {
    if (trail.length < 2) return;
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (var i = 0; i < trail.length; i += 2) {
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles(st) {
    for (var i = 0; i < st.particles.length; i++) {
      var p = st.particles[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawAimHint() {
    if (!drag.active) return;
    var dx = drag.x - SLING.x;
    var dy = drag.y - SLING.y;
    var len = Math.hypot(dx, dy);
    if (len < 6) return;
    var power = Math.min(1, len / E.MAX_DRAG);

    /* 反方向的箭头 */
    var ux = -dx / len, uy = -dy / len;
    var sx = SLING.x + ux * 60, sy = SLING.y + uy * 60;
    var ex = SLING.x + ux * (60 + 90 * power), ey = SLING.y + uy * (60 + 90 * power);

    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 5;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * 18 - uy * 10, ey - uy * 18 + ux * 10);
    ctx.lineTo(ex - ux * 18 + uy * 10, ey - uy * 18 - ux * 10);
    ctx.closePath();
    ctx.fill();
  }

  function render(now) {
    if (!state) return;

    drawBackground(now);
    drawSlingshot();
    drawTrail();

    state.blocks.forEach(drawBlock);
    state.pigs.forEach(drawPig);

    if (state.bird) {
      drawBird(state.bird.position.x, state.bird.position.y, state.bird.angle);
    } else if (state.phase === 'aiming' && state.birdsLeft > 0) {
      var bx = SLING.x + (drag.active ? (drag.x - SLING.x) : 0);
      var by = SLING.y + (drag.active ? (drag.y - SLING.y) : 0);
      drawBand({ x: SLING.x, y: SLING.y }, { x: bx, y: by });
      var ang = drag.active ? Math.atan2(drag.y - SLING.y, drag.x - SLING.x) : -0.2;
      drawBird(bx, by, ang * 0.35);
    }

    drawParticles(state);
    drawAimHint();
  }

  /* ---------------- 循环 ---------------- */
  function loop(now) {
    if (!running) return;
    if (!lastT) lastT = now;
    var dt = Math.min(48, now - lastT);
    lastT = now;

    E.update(state, dt);

    if (state.bird) {
      trail.push({ x: state.bird.position.x, y: state.bird.position.y });
      if (trail.length > 60) trail.shift();
    }

    updateHud();

    if (state.phase === 'over' && !finished) {
      finished = true;
      window.setTimeout(function () { showResult(); }, 550);
    }

    render(now);

    if (!running) return;
    window.requestAnimationFrame(loop);
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    var lv = LEVELS[levelIndex];
    document.getElementById('hud-level').textContent = '第 ' + (levelIndex + 1) + ' 关 · ' + lv.name;
    document.getElementById('hud-pigs').textContent = String(state.pigs.length);
    document.getElementById('hud-score').textContent = String(state.score);

    var box = document.getElementById('hud-birds');
    var total = lv.birds;
    var html = '';
    for (var i = 0; i < total; i++) {
      html += '<i class="' + (i >= state.birdsLeft ? 'used' : '') + '"></i>';
    }
    box.innerHTML = html;
  }

  function showResult() {
    var lv = LEVELS[levelIndex];
    var got = 0;
    if (state.won) {
      got = state.birdsLeft >= 2 ? 3 : (state.birdsLeft >= 1 ? 2 : 1);
      stars[levelIndex] = Math.max(stars[levelIndex] || 0, got);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(stars)); } catch (e) {}
      ovTitle.textContent = '过关！';
      ovDesc.textContent = '得分 ' + state.score + ' · 剩 ' + state.birdsLeft + ' 只小鸟';
      document.getElementById('btn-next').hidden = levelIndex >= LEVELS.length - 1;
      document.getElementById('btn-retry').hidden = false;
    } else {
      got = 0;
      ovTitle.textContent = '猪还活着…';
      ovDesc.textContent = '小鸟用完了，再来一次吧';
      document.getElementById('btn-next').hidden = true;
      document.getElementById('btn-retry').hidden = false;
    }

    var spans = ovStars.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      spans[i].className = i < got ? 'on' : '';
    }
    ovStars.hidden = !state.won;
    overlay.hidden = false;
    renderLevels();
  }

  /* ---------------- 关卡按钮 ---------------- */
  function renderLevels() {
    var box = document.getElementById('levels');
    var html = '';
    for (var i = 0; i < LEVELS.length; i++) {
      var s = stars[i] || 0;
      html += '<button class="lv-btn' + (i === levelIndex ? ' on' : '') + '" data-lv="' + i + '" type="button">'
        + (i + 1) + '<small>' + (s ? '★★★'.slice(0, s) : '&nbsp;') + '</small></button>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.lv-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startLevel(parseInt(btn.getAttribute('data-lv'), 10));
      });
    });
  }

  /* ---------------- 输入 ---------------- */
  function onDown(e) {
    if (!state || state.phase !== 'aiming' || state.birdsLeft <= 0) return;
    var p = toWorld(e.clientX, e.clientY);
    /* 点在小鸟附近才开始拖 */
    if (Math.hypot(p.x - SLING.x, p.y - SLING.y) > 150) return;
    drag.active = true;
    drag.id = e.pointerId;
    drag.x = p.x;
    drag.y = p.y;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag.active || e.pointerId !== drag.id) return;
    var p = toWorld(e.clientX, e.clientY);
    var dx = p.x - SLING.x;
    var dy = p.y - SLING.y;
    var len = Math.hypot(dx, dy);
    if (len > E.MAX_DRAG) { dx = dx / len * E.MAX_DRAG; dy = dy / len * E.MAX_DRAG; }
    drag.x = SLING.x + dx;
    drag.y = SLING.y + dy;
    e.preventDefault();
  }

  function onUp(e) {
    if (!drag.active || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    drag.active = false;
    var dx = drag.x - SLING.x;
    var dy = drag.y - SLING.y;
    if (Math.hypot(dx, dy) > 12) {
      trail = [];
      E.launch(state, dx, dy);
      updateHud();
    }
    drag.x = SLING.x;
    drag.y = SLING.y;
    e.preventDefault();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------------- 关卡流程 ---------------- */
  function startLevel(i) {
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    state = E.create(Matter, LEVELS[levelIndex]);
    trail = [];
    finished = false;
    drag.active = false;
    drag.x = SLING.x;
    drag.y = SLING.y;
    overlay.hidden = true;
    renderLevels();
    updateHud();

    if (!running) {
      running = true;
      lastT = 0;
      window.requestAnimationFrame(loop);
    } else {
      lastT = 0;
    }
  }

  document.getElementById('btn-retry').addEventListener('click', function () { startLevel(levelIndex); });
  document.getElementById('btn-next').addEventListener('click', function () { startLevel(levelIndex + 1); });
  document.getElementById('btn-reset').addEventListener('click', function () { startLevel(levelIndex); });

  window.addEventListener('resize', resize);

  resize();
  startLevel(0);

  /* 调试用 */
  window.BirdsDebug = {
    state: function () { return state; },
    level: function () { return levelIndex; },
    info: function () {
      return {
        level: levelIndex,
        phase: state.phase,
        birdsLeft: state.birdsLeft,
        pigs: state.pigs.length,
        blocks: state.blocks.length,
        score: state.score,
        won: state.won,
        lost: state.lost
      };
    },
    launch: function (dx, dy) { trail = []; return E.launch(state, dx, dy); },
    restart: function (i) { startLevel(i === undefined ? levelIndex : i); }
  };
}());
