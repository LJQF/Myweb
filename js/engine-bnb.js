/* ==========================================================================
   engine-bnb.js —— 泡泡堂（BNB）游戏逻辑，纯数据，不依赖 DOM

   移动模型：格子制
     玩家永远站在某一格的正中（r, c），按键 = 走一格，没有中间过渡。
     cooldown 控制连续按键（按住）时的节奏。
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BnBEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EMPTY = 0;
  var WALL = 1;
  var CRATE = 2;

  var FUSE = 2600;          /* 水泡多久爆炸（毫秒） */
  var BLAST_TTL = 420;      /* 水柱存在时间 */
  var STEP_MS = 230;        /* 默认走一格的时间 */
  var STEP_MS_MIN = 120;    /* 吃了速度道具最快多少 */
  var STEP_BLOCKED_MS = 100; /* 撞墙后多久再试 */

  var MAX_POWER = 6;
  var MAX_BOMBS = 5;

  var DIRS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };

  /* 格子哈希：同样的格子 + 同样的种子 → 同样的结果，保证双方一致 */
  function hashCell(r, c, seed) {
    var h = (r * 73856093) ^ (c * 19349663) ^ (seed * 83492791);
    h = h >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177) >>> 0;
    return (h % 100000) / 100000;
  }

  function makeRng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return (s % 100000) / 100000;
    };
  }

  function buildMap(cols, rows, rng, spawns) {
    var tiles = [];
    var r, c;
    for (r = 0; r < rows; r++) {
      var row = [];
      for (c = 0; c < cols; c++) {
        var border = (r === 0 || c === 0 || r === rows - 1 || c === cols - 1);
        var pillar = (r % 2 === 0 && c % 2 === 0);
        row.push(border || pillar ? WALL : EMPTY);
      }
      tiles.push(row);
    }

    var safe = {};
    spawns.forEach(function (sp) {
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) safe[(sp.r + dr) + ',' + (sp.c + dc)] = true;
      }
    });

    for (r = 1; r < rows - 1; r++) {
      for (c = 1; c < cols - 1; c++) {
        if (tiles[r][c] !== EMPTY) continue;
        if (safe[r + ',' + c]) continue;
        if (rng() < 0.62) tiles[r][c] = CRATE;
      }
    }
    return tiles;
  }

  function create(opts) {
    opts = opts || {};
    var cols = opts.cols || 13;
    var rows = opts.rows || 11;
    var seed = opts.seed || Math.floor(Math.random() * 1e9);

    var spawns = opts.spawns || [
      { r: 1, c: 1 },
      { r: rows - 2, c: cols - 2 }
    ];

    var tiles = opts.tiles || buildMap(cols, rows, makeRng(seed), spawns);

    var players = [];
    var names = opts.names || ['玩家1', '玩家2'];
    for (var i = 0; i < Math.min(2, spawns.length); i++) {
      players.push({
        id: i,
        name: names[i] || ('玩家' + (i + 1)),
        r: spawns[i].r,
        c: spawns[i].c,
        dir: i === 0 ? 'down' : 'up',
        alive: true,
        maxBombs: 1,
        power: 2,
        stepMs: STEP_MS,
        cooldown: 0,
        immune: false,
        moveDir: null,
        queuedDir: null,
        bombQueued: false
      });
    }

    return {
      cols: cols,
      rows: rows,
      seed: seed,
      spawns: spawns,
      tiles: tiles,
      players: players,
      bombs: [],
      blasts: [],
      items: [],
      time: 0,
      over: false,
      winner: -1,
      peerMode: !!opts.peerMode,
      events: []
    };
  }

  function isSolid(state, r, c) {
    if (r < 0 || c < 0 || r >= state.rows || c >= state.cols) return true;
    var t = state.tiles[r][c];
    return t === WALL || t === CRATE;
  }

  function bombAt(state, r, c) {
    for (var i = 0; i < state.bombs.length; i++) {
      if (state.bombs[i].r === r && state.bombs[i].c === c) return state.bombs[i];
    }
    return null;
  }

  /* 走一格（dir 为 'up'/'down'/'left'/'right'），返回是否真的走了 */
  function tryStep(state, p, dir) {
    var d = DIRS[dir];
    if (!d) return false;
    p.dir = dir;
    var nr = p.r + d.dr;
    var nc = p.c + d.dc;
    if (isSolid(state, nr, nc)) return false;
    p.r = nr;
    p.c = nc;
    return true;
  }

  function placeBomb(state, p) {
    if (!p.alive) return false;
    if (isSolid(state, p.r, p.c)) return false;
    if (bombAt(state, p.r, p.c)) return false;

    var mine = 0;
    for (var i = 0; i < state.bombs.length; i++) {
      if (state.bombs[i].owner === p.id) mine++;
    }
    if (mine >= p.maxBombs) return false;

    state.bombs.push({ r: p.r, c: p.c, owner: p.id, timer: FUSE, power: p.power });
    return true;
  }

  function detonate(state, bomb) {
    var idx = state.bombs.indexOf(bomb);
    if (idx < 0) return;
    state.bombs.splice(idx, 1);

    var cells = [{ r: bomb.r, c: bomb.c }];
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (var d = 0; d < dirs.length; d++) {
      for (var k = 1; k <= bomb.power; k++) {
        var r = bomb.r + dirs[d][0] * k;
        var c = bomb.c + dirs[d][1] * k;
        if (r < 0 || c < 0 || r >= state.rows || c >= state.cols) break;

        var t = state.tiles[r][c];
        if (t === WALL) break;
        if (t === CRATE) {
          state.tiles[r][c] = EMPTY;
          cells.push({ r: r, c: c });
          if (hashCell(r, c, state.seed) < 0.34) {
            var types = ['bomb', 'power', 'speed'];
            state.items.push({
              r: r, c: c, type: types[Math.floor(hashCell(c, r, state.seed + 7) * 3) % 3]
            });
          }
          break;
        }
        cells.push({ r: r, c: c });
      }
    }

    cells.forEach(function (cell) {
      state.blasts.push({ r: cell.r, c: cell.c, ttl: BLAST_TTL });
    });

    var chained = [];
    for (var i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      for (var j = 0; j < cells.length; j++) {
        if (cells[j].r === b.r && cells[j].c === b.c) { chained.push(b); break; }
      }
    }
    chained.forEach(function (b2) { detonate(state, b2); });
  }

  function inBlast(state, p) {
    for (var i = 0; i < state.blasts.length; i++) {
      if (state.blasts[i].r === p.r && state.blasts[i].c === p.c) return true;
    }
    return false;
  }

  function pickupItems(state, p) {
    for (var i = state.items.length - 1; i >= 0; i--) {
      var it = state.items[i];
      if (it.r !== p.r || it.c !== p.c) continue;
      if (it.type === 'bomb') p.maxBombs = Math.min(MAX_BOMBS, p.maxBombs + 1);
      else if (it.type === 'power') p.power = Math.min(MAX_POWER, p.power + 1);
      else if (it.type === 'speed') p.stepMs = Math.max(STEP_MS_MIN, Math.round(p.stepMs * 0.72));
      state.items.splice(i, 1);
      state.events.push({ t: 'pick', player: p.id, type: it.type });
    }
  }

  function aliveCount(state) {
    var n = 0;
    for (var i = 0; i < state.players.length; i++) if (state.players[i].alive) n++;
    return n;
  }

  function step(state, dt) {
    if (state.over) return;

    state.time += dt;
    state.events.length = 0;
    var ms = dt * 1000;

    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (!p.alive) continue;

      if (p.cooldown > 0) p.cooldown -= ms;

      if (p.bombQueued) {
        p.bombQueued = false;
        placeBomb(state, p);
        p.cooldown = Math.max(p.cooldown, 60);   /* 放完稍微顿一下，手感更清楚 */
      }

      /* 只认「走一格」的请求（queuedDir）。
         请求一直挂着，等冷却结束就执行；执行/撞墙后清掉。
         人按住键时由界面每帧重新投递，AI 每次决策重新投递。 */
      if (p.cooldown <= 0 && p.queuedDir) {
        var dir = p.queuedDir;
        p.queuedDir = null;
        if (tryStep(state, p, dir)) p.cooldown = p.stepMs;
        else p.cooldown = STEP_BLOCKED_MS;
      }
    }

    /* 水泡计时 */
    var due = [];
    for (var bi = 0; bi < state.bombs.length; bi++) {
      state.bombs[bi].timer -= ms;
      if (state.bombs[bi].timer <= 0) due.push(state.bombs[bi]);
    }
    due.forEach(function (bd) { detonate(state, bd); });

    /* 水柱消失 */
    for (var k = state.blasts.length - 1; k >= 0; k--) {
      state.blasts[k].ttl -= ms;
      if (state.blasts[k].ttl <= 0) state.blasts.splice(k, 1);
    }

    /* 死亡 / 捡道具 */
    for (var j = 0; j < state.players.length; j++) {
      var pl = state.players[j];
      if (!pl.alive) continue;
      if (pl.immune) { pickupItems(state, pl); continue; }
      if (inBlast(state, pl)) {
        pl.alive = false;
        pl.moveDir = null;
        state.events.push({ t: 'die', player: pl.id });
      } else {
        pickupItems(state, pl);
      }
    }

    if (!state.peerMode && aliveCount(state) <= 1 && !state.over) {
      state.over = true;
      for (var w = 0; w < state.players.length; w++) {
        if (state.players[w].alive) { state.winner = w; break; }
      }
    }
  }

  /* ---------------- 联机快照 ---------------- */
  function encodeTiles(state) {
    var s = '';
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) s += state.tiles[r][c];
    }
    return s;
  }

  function decodeTiles(state, str) {
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        state.tiles[r][c] = Number(str.charAt(r * state.cols + c)) || 0;
      }
    }
  }

  function snapshot(state) {
    return {
      t: 'st',
      rs: Number(state.time.toFixed(2)),
      m: encodeTiles(state),
      p: state.players.map(function (p) {
        return [p.r, p.c, p.dir, p.alive ? 1 : 0, p.maxBombs, p.power, p.stepMs];
      }),
      b: state.bombs.map(function (b) { return [b.r, b.c, Math.round(b.timer)]; }),
      f: state.blasts.map(function (b) { return [b.r, b.c]; }),
      i: state.items.map(function (it) { return [it.r, it.c, it.type]; }),
      o: state.over ? 1 : 0,
      w: state.winner
    };
  }

  function restore(state, snap) {
    decodeTiles(state, snap.m);
    for (var i = 0; i < state.players.length && i < snap.p.length; i++) {
      var s = snap.p[i];
      var p = state.players[i];
      p.r = s[0]; p.c = s[1]; p.dir = s[2]; p.alive = !!s[3];
      p.maxBombs = s[4]; p.power = s[5]; p.stepMs = s[6];
    }
    state.bombs = snap.b.map(function (b) { return { r: b[0], c: b[1], timer: b[2], owner: -1, power: 2 }; });
    state.blasts = snap.f.map(function (b) { return { r: b[0], c: b[1], ttl: BLAST_TTL }; });
    state.items = snap.i.map(function (it) { return { r: it[0], c: it[1], type: it[2] }; });
    state.time = snap.rs;
    state.over = !!snap.o;
    state.winner = snap.w;
    return state;
  }

  return {
    EMPTY: EMPTY, WALL: WALL, CRATE: CRATE,
    FUSE: FUSE, BLAST_TTL: BLAST_TTL,
    STEP_MS: STEP_MS, DIRS: DIRS,
    create: create,
    step: step,
    isSolid: isSolid,
    tryStep: tryStep,
    placeBomb: placeBomb,
    snapshot: snapshot,
    restore: restore,
    aliveCount: aliveCount
  };
}));
