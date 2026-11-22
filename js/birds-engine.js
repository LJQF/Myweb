/* ==========================================================================
   birds-engine.js —— 愤怒的小鸟：物理与规则（纯逻辑，不依赖 DOM）
   依赖 Matter.js（浏览器里是 window.Matter，Node 里 require 进来）
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BirdsEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WIDTH = 1600;
  var HEIGHT = 900;
  var GROUND_Y = 820;
  var SLING = { x: 210, y: 636 };
  var MAX_DRAG = 140;
  var BIRD_R = 22;
  var LAUNCH_POWER = 0.155;      /* 拖拽距离 → 初速度 */

  var MAT = {
    wood:  { density: 0.0024, friction: 0.62, restitution: 0.03, hp: 52,  toughness: 1.0 },
    stone: { density: 0.0075, friction: 0.78, restitution: 0.02, hp: 90,  toughness: 0.50 },
    ice:   { density: 0.0014, friction: 0.20, restitution: 0.14, hp: 24,  toughness: 1.7 },
    pig:   { density: 0.0016, friction: 0.55, restitution: 0.10, hp: 16,  toughness: 1.35 }
  };

  var DMG_K = 0.12;

  function create(Matter, level) {
    var Engine = Matter.Engine, World = Matter.World, Bodies = Matter.Bodies;

    var engine = Engine.create({
      positionIterations: 8,
      velocityIterations: 6,
      constraintIterations: 2
    });
    engine.gravity.y = 1;
    engine.gravity.scale = 0.0011;

    var world = engine.world;
    var state = {
      Matter: Matter,
      engine: engine,
      world: world,
      level: level,
      phase: 'aiming',          /* aiming | flying | over */
      birdsLeft: level.birds,
      score: 0,
      blocks: [],
      pigs: [],
      bird: null,
      birdTimer: 0,
      aim: { active: false, x: SLING.x, y: SLING.y },
      particles: [],
      events: [],
      won: false,
      lost: false,
      pigsTotal: level.pigs.length
    };

    /* 地面 */
    var ground = Bodies.rectangle(WIDTH / 2, GROUND_Y + 400, WIDTH * 4, 800, {
      isStatic: true, friction: 0.9, restitution: 0.02, label: 'ground'
    });
    World.add(world, ground);
    state.ground = ground;

    /* 箱子 */
    level.blocks.forEach(function (b) {
      var m = MAT[b.mat] || MAT.wood;
      var body = Bodies.rectangle(b.x, b.y, b.w, b.h, {
        density: m.density,
        friction: m.friction,
        frictionStatic: 1.1,
        restitution: m.restitution,
        angle: (b.angle || 0) * Math.PI / 180,
        label: 'block'
      });
      body.game = {
        kind: 'block', mat: b.mat, hp: m.hp * (b.hpScale || 1),
        maxHp: m.hp * (b.hpScale || 1), w: b.w, h: b.h
      };
      state.blocks.push(body);
      World.add(world, body);
    });

    /* 猪 */
    level.pigs.forEach(function (p) {
      var m = MAT.pig;
      var r = p.r || 26;
      var body = Bodies.circle(p.x, p.y, r, {
        density: m.density, friction: m.friction, restitution: m.restitution, label: 'pig'
      });
      body.game = { kind: 'pig', hp: m.hp * (p.hpScale || 1), maxHp: m.hp * (p.hpScale || 1), r: r };
      state.pigs.push(body);
      World.add(world, body);
    });

    hookCollisions(state);
    return state;
  }

  /* ---------------- 伤害 ---------------- */
  function damage(state, body, amount) {
    var g = body.game;
    if (!g || g.dead) return;
    g.hp -= amount;
    if (g.hp <= 0) kill(state, body);
  }

  function kill(state, body) {
    var g = body.game;
    if (!g || g.dead) return;
    g.dead = true;

    var pos = { x: body.position.x, y: body.position.y };
    state.Matter.World.remove(state.world, body);

    if (g.kind === 'pig') {
      state.score += 500;
      state.events.push({ t: 'pig', x: pos.x, y: pos.y });
      state.pigs = state.pigs.filter(function (b) { return b !== body; });
    } else {
      state.score += Math.round(g.maxHp * 2.2);
      state.events.push({ t: 'block', x: pos.x, y: pos.y, mat: g.mat, w: g.w, h: g.h });
      state.blocks = state.blocks.filter(function (b) { return b !== body; });
    }
    burst(state, pos, g.kind === 'pig' ? '#7ec850' : (MAT[g.mat] || MAT.wood).color, g.kind === 'pig' ? 14 : 10);
  }

  function burst(state, pos, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 1.5 + Math.random() * 4;
      state.particles.push({
        x: pos.x, y: pos.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        life: 1, color: color, size: 3 + Math.random() * 5
      });
    }
  }

  function hookCollisions(state) {
    var Matter = state.Matter;
    Matter.Events.on(state.engine, 'collisionStart', function (ev) {
      for (var i = 0; i < ev.pairs.length; i++) {
        var pair = ev.pairs[i];
        var a = pair.bodyA, b = pair.bodyB;
        if (!a.game && !b.game) continue;

        var n = (pair.collision && pair.collision.normal) || { x: 0, y: 1 };
        var dvx = a.velocity.x - b.velocity.x;
        var dvy = a.velocity.y - b.velocity.y;
        var rel = Math.abs(dvx * n.x + dvy * n.y);
        if (rel < 0.8) continue;

        var m = Math.min(a.mass, b.mass);
        var energy = 0.5 * m * rel * rel;

        if (a.game) damage(state, a, energy * DMG_K * (MAT[a.game.mat] ? MAT[a.game.mat].toughness : 1));
        if (b.game) damage(state, b, energy * DMG_K * (MAT[b.game.mat] ? MAT[b.game.mat].toughness : 1));
      }
    });
  }

  /* ---------------- 发射 ---------------- */
  function launch(state, dx, dy) {
    if (state.phase !== 'aiming' || state.birdsLeft <= 0) return null;

    var Matter = state.Matter;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > MAX_DRAG) { dx = dx / len * MAX_DRAG; dy = dy / len * MAX_DRAG; }

    var bird = Matter.Bodies.circle(SLING.x, SLING.y, BIRD_R, {
      density: 0.0075,
      friction: 0.4,
      restitution: 0.25,
      label: 'bird'
    });
    bird.game = { kind: 'bird' };
    Matter.World.add(state.world, bird);

    Matter.Body.setVelocity(bird, {
      x: -dx * LAUNCH_POWER,
      y: -dy * LAUNCH_POWER
    });

    state.bird = bird;
    state.birdsLeft -= 1;
    state.phase = 'flying';
    state.birdTimer = 0;
    state.events.push({ t: 'launch' });
    return bird;
  }

  /* ---------------- 每帧推进 ---------------- */
  function update(state, dtMs) {
    var Matter = state.Matter;

    Matter.Engine.update(state.engine, Math.min(dtMs, 50));

    /* 粒子 */
    for (var i = state.particles.length - 1; i >= 0; i--) {
      var p = state.particles[i];
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.022;
      if (p.life <= 0) state.particles.splice(i, 1);
    }

    if (state.phase === 'flying' && state.bird) {
      state.birdTimer += dtMs;
      var b = state.bird;
      var speed = Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y);
      var outOfBounds = b.position.x > WIDTH + 200 || b.position.x < -200 || b.position.y > HEIGHT + 400;

      if (outOfBounds || (state.birdTimer > 900 && speed < 0.9) || state.birdTimer > 9000) {
        Matter.World.remove(state.world, b);
        state.bird = null;
        state.phase = 'aiming';
        state.events.push({ t: 'settle' });
        checkEnd(state);
      }
    }
    return state;
  }

  function checkEnd(state) {
    if (state.pigs.length === 0) {
      state.won = true;
      state.phase = 'over';
      return true;
    }
    if (state.birdsLeft <= 0) {
      state.lost = true;
      state.phase = 'over';
      return true;
    }
    return false;
  }

  function alivePigs(state) { return state.pigs.length; }

  return {
    WIDTH: WIDTH, HEIGHT: HEIGHT, GROUND_Y: GROUND_Y, SLING: SLING,
    MAX_DRAG: MAX_DRAG, BIRD_R: BIRD_R, MAT: MAT,
    create: create,
    launch: launch,
    update: update,
    checkEnd: checkEnd,
    alivePigs: alivePigs
  };
}));
