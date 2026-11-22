/* ==========================================================================
   flappy-engine.js —— 飞扬的小鸟：物理与规则（纯逻辑，不依赖 DOM）
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlappyEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 480;
  var H = 720;
  var GROUND_H = 96;

  var GRAVITY = 1750;      /* px/s² */
  var FLAP_VY = -545;      /* 点一下的上冲速度 */
  var PIPE_W = 78;
  var PIPE_GAP = 190;
  var PIPE_GAP_MIN = 150;
  var PIPE_SPACING = 285;  /* 两根管子之间的水平距离 */
  var BASE_SPEED = 172;
  var MAX_SPEED = 250;
  var BIRD_R = 16;
  var BIRD_X = 142;

  function create(opts) {
    opts = opts || {};
    return {
      w: W,
      h: H,
      groundY: H - GROUND_H,
      bird: { x: BIRD_X, y: H * 0.42, vy: 0, r: BIRD_R, rot: 0, wing: 0 },
      pipes: [],
      score: 0,
      phase: 'ready',       /* ready | playing | dead */
      t: 0,
      scroll: 0,
      speed: BASE_SPEED,
      gap: PIPE_GAP,
      deadT: 0,
      flaps: 0,
      events: [],
      seed: opts.seed || 1
    };
  }

  /* 可复现的随机（测试用），浏览器里也用同一套 */
  function rnd(state) {
    state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
    return state.seed / 4294967296;
  }

  function spawnPipe(state) {
    var margin = 90;
    var minY = margin + state.gap / 2;
    var maxY = state.groundY - margin - state.gap / 2;
    var center = minY + rnd(state) * Math.max(1, maxY - minY);
    state.pipes.push({
      x: state.w + PIPE_W,
      top: center - state.gap / 2,
      bottom: center + state.gap / 2,
      scored: false
    });
  }

  function flap(state) {
    if (state.phase === 'dead') return false;
    if (state.phase === 'ready') {
      state.phase = 'playing';
      state.pipes.length = 0;
      spawnPipe(state);
    }
    state.bird.vy = FLAP_VY;
    state.flaps += 1;
    state.bird.wing = 1;
    state.events.push({ t: 'flap' });
    return true;
  }

  function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    var nx = Math.max(rx, Math.min(cx, rx + rw));
    var ny = Math.max(ry, Math.min(cy, ry + rh));
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function update(state, dt) {
    if (dt > 0.1) dt = 0.1;          /* 切后台回来别一下跳太远 */
    state.t += dt;
    state.bird.wing = Math.max(0, state.bird.wing - dt * 5);

    if (state.phase === 'ready') {
      /* 待机时轻轻上下浮 */
      state.bird.y = state.h * 0.42 + Math.sin(state.t * 3) * 8;
      state.scroll = (state.scroll + 60 * dt) % 24;
      return state;
    }

    if (state.phase === 'dead') {
      state.deadT += dt;
      /* 掉到地上就不再动 */
      var b0 = state.bird;
      if (b0.y < state.groundY - b0.r) {
        b0.vy += GRAVITY * dt;
        b0.y += b0.vy * dt;
        b0.rot = Math.min(1.4, b0.rot + dt * 6);
        if (b0.y > state.groundY - b0.r) { b0.y = state.groundY - b0.r; b0.vy = 0; }
      }
      return state;
    }

    var bird = state.bird;
    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.3, bird.vy / 700));

    /* 难度随分数缓慢上升 */
    state.speed = Math.min(MAX_SPEED, BASE_SPEED + state.score * 2.2);
    state.gap = Math.max(PIPE_GAP_MIN, PIPE_GAP - state.score * 1.6);

    state.scroll = (state.scroll + state.speed * dt) % 24;

    /* 生成管子 */
    var last = state.pipes[state.pipes.length - 1];
    if (!last || last.x < state.w - PIPE_SPACING) spawnPipe(state);

    /* 移动 / 计分 / 回收 */
    for (var i = state.pipes.length - 1; i >= 0; i--) {
      var p = state.pipes[i];
      p.x -= state.speed * dt;
      if (!p.scored && p.x + PIPE_W < bird.x) {
        p.scored = true;
        state.score += 1;
        state.events.push({ t: 'score' });
      }
      if (p.x + PIPE_W < -40) state.pipes.splice(i, 1);
    }

    /* 撞天花板 */
    if (bird.y - bird.r < 0) { bird.y = bird.r; if (bird.vy < 0) bird.vy = 0; }
    /* 撞地 */
    if (bird.y + bird.r >= state.groundY) {
      bird.y = state.groundY - bird.r;
      die(state);
      return state;
    }

    /* 撞管子 */
    for (var j = 0; j < state.pipes.length; j++) {
      var q = state.pipes[j];
      if (q.x > bird.x + bird.r || q.x + PIPE_W < bird.x - bird.r) continue;
      var hit = circleHitsRect(bird.x, bird.y, bird.r, q.x, 0, PIPE_W, q.top)
             || circleHitsRect(bird.x, bird.y, bird.r, q.x, q.bottom, PIPE_W, state.groundY - q.bottom);
      if (hit) { die(state); return state; }
    }

    return state;
  }

  function die(state) {
    if (state.phase === 'dead') return;
    state.phase = 'dead';
    state.deadT = 0;
    state.events.push({ t: 'die' });
  }

  function reset(state) {
    var s = create({ seed: state.seed });
    s.score = 0;
    return s;
  }

  return {
    W: W, H: H, GROUND_H: GROUND_H,
    PIPE_W: PIPE_W, GRAVITY: GRAVITY, FLAP_VY: FLAP_VY,
    BIRD_R: BIRD_R, BIRD_X: BIRD_X,
    create: create,
    flap: flap,
    update: update,
    reset: reset
  };
}));
