/* ==========================================================================
   shooter-engine.js —— 打飞机：逻辑（纯数据，不依赖 DOM）
   竖版射击：玩家在下方自动开火，敌人从上方来
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShooterEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 480;
  var H = 720;

  var PLAYER_R = 13;
  var PLAYER_SPEED = 330;
  var PLAYER_Y = H - 96;

  var BULLET_SPEED = 720;
  var BULLET_R = 4;
  var FIRE_CD = 0.15;

  var ENEMY_BULLET_SPEED = 250;
  var INVULN_TIME = 1.6;

  var TYPES = {
    scout:  { hp: 1, r: 14, speed: 155, score: 100, fire: 0, zig: 0 },
    dart:   { hp: 2, r: 12, speed: 215, score: 150, fire: 0, zig: 90 },
    gunner: { hp: 3, r: 19, speed: 92,  score: 260, fire: 1.35, zig: 0 }
  };

  function create(opts) {
    opts = opts || {};
    return {
      w: W,
      h: H,
      seed: opts.seed || 12345,
      player: { x: W / 2, y: PLAYER_Y, r: PLAYER_R, power: 1, inv: 0, alive: true },
      bullets: [],
      enemies: [],
      ebullets: [],
      drops: [],
      particles: [],
      stars: makeStars(opts.seed || 12345),
      score: 0,
      lives: opts.lives || 3,
      phase: 'playing',        /* playing | over */
      t: 0,
      fireCd: 0,
      spawnCd: 0.6,
      kills: 0,
      events: []
    };
  }

  function makeStars(seed) {
    var s = seed >>> 0, out = [];
    for (var i = 0; i < 46; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      var x = (s % 480);
      s = (s * 1664525 + 1013904223) >>> 0;
      var y = (s % 720);
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push({ x: x, y: y, z: 0.4 + (s % 100) / 160 });
    }
    return out;
  }

  function rnd(state) {
    state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
    return state.seed / 4294967296;
  }

  /* ---------------- 输入 ---------------- */
  function move(state, dx, dy, dt) {
    var p = state.player;
    if (!p.alive) return;
    p.x += dx * PLAYER_SPEED * dt;
    p.y += dy * PLAYER_SPEED * dt;
    clampPlayer(state);
  }

  function setPos(state, x, y) {
    var p = state.player;
    if (!p.alive) return;
    p.x = x;
    p.y = y;
    clampPlayer(state);
  }

  function clampPlayer(state) {
    var p = state.player;
    p.x = Math.max(p.r + 4, Math.min(state.w - p.r - 4, p.x));
    p.y = Math.max(state.h * 0.34, Math.min(state.h - p.r - 8, p.y));
  }

  /* ---------------- 射击 ---------------- */
  function fire(state) {
    var p = state.player;
    var shots = [{ dx: 0, dy: -1 }];
    if (p.power >= 2) {
      shots.push({ dx: -0.16, dy: -0.99 });
      shots.push({ dx: 0.16, dy: -0.99 });
    }
    if (p.power >= 3) {
      shots.push({ dx: -0.34, dy: -0.94 });
      shots.push({ dx: 0.34, dy: -0.94 });
    }
    shots.forEach(function (s) {
      state.bullets.push({
        x: p.x + s.dx * 12,
        y: p.y - 16,
        vx: s.dx * BULLET_SPEED,
        vy: s.dy * BULLET_SPEED,
        r: BULLET_R
      });
    });
    state.events.push({ t: 'shoot' });
  }

  /* ---------------- 敌机 ---------------- */
  function spawnEnemy(state) {
    var roll = rnd(state);
    var type = 'scout';
    if (state.score > 900 && roll > 0.62) type = 'gunner';
    else if (state.score > 350 && roll > 0.34) type = 'dart';
    else if (roll > 0.82) type = 'dart';

    var cfg = TYPES[type];
    var x = 44 + rnd(state) * (state.w - 88);
    state.enemies.push({
      type: type,
      x: x,
      y: -40,
      r: cfg.r,
      hp: cfg.hp,
      maxHp: cfg.hp,
      speed: cfg.speed + Math.min(90, state.score / 60),
      score: cfg.score,
      fire: cfg.fire,
      fireCd: cfg.fire ? 0.9 + rnd(state) * 0.8 : 0,
      zig: cfg.zig,
      phase: rnd(state) * Math.PI * 2,
      hit: 0
    });
  }

  function burst(state, x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = rnd(state) * Math.PI * 2;
      var sp = 40 + rnd(state) * 190;
      state.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.55 + rnd(state) * 0.4,
        max: 1,
        color: color,
        size: 2 + rnd(state) * 3
      });
    }
  }

  function hurtPlayer(state) {
    var p = state.player;
    if (p.inv > 0 || state.phase !== 'playing') return;
    state.lives -= 1;
    burst(state, p.x, p.y, '#ff6b6b', 22);
    state.events.push({ t: 'hit' });
    if (state.lives <= 0) {
      state.lives = 0;
      p.alive = false;
      state.phase = 'over';
      state.events.push({ t: 'over' });
      return;
    }
    p.inv = INVULN_TIME;
    state.ebullets.length = 0;      /* 被打中后清屏，给玩家喘息 */
    p.x = state.w / 2;
  }

  /* ---------------- 主循环 ---------------- */
  function update(state, dt) {
    if (state.phase !== 'playing') {
      state.t += dt;
      decayParticles(state, dt);
      return state;
    }
    if (dt > 0.05) dt = 0.05;
    state.t += dt;

    var p = state.player;
    if (p.inv > 0) p.inv -= dt;

    /* 自动开火 */
    state.fireCd -= dt;
    if (state.fireCd <= 0) {
      fire(state);
      state.fireCd = FIRE_CD;
    }

    /* 我方子弹 */
    for (var i = state.bullets.length - 1; i >= 0; i--) {
      var b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.x < -20 || b.x > state.w + 20) state.bullets.splice(i, 1);
    }

    /* 敌机 */
    for (var j = state.enemies.length - 1; j >= 0; j--) {
      var e = state.enemies[j];
      if (!e) break;
      e.y += e.speed * dt;
      if (e.zig) {
        e.phase += dt * 2.4;
        e.x += Math.cos(e.phase) * e.zig * dt;
        e.x = Math.max(e.r, Math.min(state.w - e.r, e.x));
      }
      if (e.hit > 0) e.hit -= dt;

      if (e.fire) {
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 0 && e.y < state.h * 0.75) {
          e.fireCd = e.fire;
          var ang = Math.atan2(p.y - e.y, p.x - e.x);
          state.ebullets.push({
            x: e.x, y: e.y + e.r,
            vx: Math.cos(ang) * ENEMY_BULLET_SPEED * 0.6,
            vy: Math.sin(ang) * ENEMY_BULLET_SPEED * 0.6,
            r: 6
          });
        }
      }

      if (e.y - e.r > state.h + 30) {
        state.enemies.splice(j, 1);
        continue;
      }

      /* 撞机 */
      if (p.alive && dist(e.x, e.y, p.x, p.y) < e.r + p.r) {
        burst(state, e.x, e.y, '#ffd166', 16);
        state.enemies.splice(j, 1);
        hurtPlayer(state);
      }
    }

    /* 敌方子弹 */
    for (var k = state.ebullets.length - 1; k >= 0; k--) {
      var eb = state.ebullets[k];
      if (!eb) break;                 /* 被打中时列表会被清空 */
      eb.x += eb.vx * dt;
      eb.y += eb.vy * dt;
      if (eb.y > state.h + 20 || eb.y < -30 || eb.x < -30 || eb.x > state.w + 30) {
        state.ebullets.splice(k, 1);
        continue;
      }
      if (p.alive && dist(eb.x, eb.y, p.x, p.y) < eb.r + p.r) {
        state.ebullets.splice(k, 1);
        hurtPlayer(state);
        break;                        /* hurtPlayer 会清空子弹列表 */
      }
    }

    /* 我方子弹打敌机 */
    for (var m = state.bullets.length - 1; m >= 0; m--) {
      var bb = state.bullets[m];
      for (var n = state.enemies.length - 1; n >= 0; n--) {
        var en = state.enemies[n];
        if (dist(bb.x, bb.y, en.x, en.y) > en.r + bb.r) continue;

        state.bullets.splice(m, 1);
        en.hp -= 1;
        en.hit = 0.09;
        if (en.hp > 0) break;

        burst(state, en.x, en.y, en.type === 'gunner' ? '#9ae6b4' : '#ffd166', en.type === 'gunner' ? 20 : 12);
        state.score += en.score;
        state.kills += 1;
        state.events.push({ t: 'kill', x: en.x, y: en.y });

        /* 掉落 */
        var roll = rnd(state);
        if (roll < 0.10) {
          state.drops.push({ x: en.x, y: en.y, r: 12, vy: 95, kind: 'power' });
        } else if (roll < 0.115) {
          state.drops.push({ x: en.x, y: en.y, r: 12, vy: 85, kind: 'life' });
        }
        state.enemies.splice(n, 1);
        break;
      }
    }

    /* 掉落物 */
    for (var q = state.drops.length - 1; q >= 0; q--) {
      var d = state.drops[q];
      d.y += d.vy * dt;
      if (d.y > state.h + 30) { state.drops.splice(q, 1); continue; }
      if (p.alive && dist(d.x, d.y, p.x, p.y) < d.r + p.r + 6) {
        state.drops.splice(q, 1);
        if (d.kind === 'power') {
          p.power = Math.min(3, p.power + 1);
          state.events.push({ t: 'power' });
        } else {
          state.lives += 1;
          state.events.push({ t: 'life' });
        }
      }
    }

    /* 生成 */
    state.spawnCd -= dt;
    if (state.spawnCd <= 0) {
      spawnEnemy(state);
      var base = 0.64 - Math.min(0.36, state.score / 4600);
      state.spawnCd = base * (0.75 + rnd(state) * 0.5);
    }

    decayParticles(state, dt);

    /* 星星滚动 */
    for (var s2 = 0; s2 < state.stars.length; s2++) {
      var st = state.stars[s2];
      st.y += st.z * 90 * dt;
      if (st.y > state.h) { st.y = -4; st.x = rnd(state) * state.w; }
    }

    state.events.length = Math.min(state.events.length, 40);
    return state;
  }

  function decayParticles(state, dt) {
    for (var i = state.particles.length - 1; i >= 0; i--) {
      var pt = state.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      pt.life -= dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  return {
    W: W, H: H, PLAYER_Y: PLAYER_Y, TYPES: TYPES,
    create: create,
    update: update,
    move: move,
    setPos: setPos,
    fire: fire,
    dist: dist
  };
}));
