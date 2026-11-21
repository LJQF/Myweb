/* ==========================================================================
   engine-bnb.js —— 泡泡堂（BNB）游戏逻辑，纯数据，不依赖 DOM
   坐标：tile 为单位，(x, y) 表示列/行；格子中心 = (c + 0.5, r + 0.5)
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BnBEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EMPTY = 0;
  var WALL = 1;
  var CRATE = 2;

  var FUSE = 2600;        /* 水泡多久爆炸（毫秒） */
  var BLAST_TTL = 420;    /* 水柱存在时间 */
  var RADIUS = 0.32;      /* 玩家碰撞半径（tile） */
  var BASE_SPEED = 3.4;   /* tile/秒 */
  var MAX_POWER = 6;
  var MAX_BOMBS = 5;
  var MAX_SPEED = 5.4;
  var WIN_SCORE = 1;

  /* 确定性随机数（同一个种子结果一样，方便联机） */
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

    /* 出生点周围留空 */
    var safe = {};
    spawns.forEach(function (sp) {
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          safe[(sp.r + dr) + ',' + (sp.c + dc)] = true;
        }
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

    var spawns = [
      { r: 1, c: 1 },
      { r: rows - 2, c: cols - 2 }
    ];
    if (opts.spawns) spawns = opts.spawns;

    var tiles = opts.tiles || buildMap(cols, rows, makeRng(seed), spawns);

    var players = [];
    var names = opts.names || ['玩家1', '玩家2'];
    for (var i = 0; i < Math.min(2, spawns.length); i++) {
      players.push({
        id: i,
        name: names[i] || ('玩家' + (i + 1)),
        x: spawns[i].c + 0.5,
        y: spawns[i].r + 0.5,
        dir: i === 0 ? 'down' : 'up',
        alive: true,
        maxBombs: 1,
        power: 2,
        speed: BASE_SPEED,
        input: { dx: 0, dy: 0 },
        bombQueued: false,
        hitAt: 0,
        anim: 0
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
      blasts: [],      /* {r, c, ttl} */
      items: [],       /* {r, c, type} */
      time: 0,
      over: false,
      winner: -1,
      events: []
    };
  }

  function isSolid(state, r, c) {
    if (r < 0 || c < 0 || r >= state.rows || c >= state.cols) return true;
    var t = state.tiles[r][c];
    return t === WALL || t === CRATE;
  }

  function tileAt(state, x, y) {
    return { r: Math.floor(y), c: Math.floor(x) };
  }

  /* 圆形近似的 AABB 碰撞：四个角 + 四边中点 */
  function blocked(state, x, y) {
    var pts = [
      [x - RADIUS, y - RADIUS], [x + RADIUS, y - RADIUS],
      [x - RADIUS, y + RADIUS], [x + RADIUS, y + RADIUS],
      [x, y - RADIUS], [x, y + RADIUS],
      [x - RADIUS, y], [x + RADIUS, y]
    ];
    for (var i = 0; i < pts.length; i++) {
      var r = Math.floor(pts[i][1]);
      var c = Math.floor(pts[i][0]);
      if (isSolid(state, r, c)) return true;
    }
    return false;
  }

  function movePlayer(state, p, dt) {
    if (!p.alive) return;

    var ix = p.input.dx;
    var iy = p.input.dy;
    if (ix && iy) { var norm = Math.SQRT1_2; ix *= norm; iy *= norm; }

    if (ix) p.dir = ix > 0 ? 'right' : 'left';
    else if (iy) p.dir = iy > 0 ? 'down' : 'up';

    var dist = p.speed * dt;
    if (ix) {
      var nx = p.x + ix * dist;
      if (!blocked(state, nx, p.y)) p.x = nx;
    }
    if (iy) {
      var ny = p.y + iy * dist;
      if (!blocked(state, p.x, ny)) p.y = ny;
    }

    if (ix || iy) p.anim += dt * 6;
  }

  function bombAt(state, r, c) {
    for (var i = 0; i < state.bombs.length; i++) {
      if (state.bombs[i].r === r && state.bombs[i].c === c) return state.bombs[i];
    }
    return null;
  }

  function placeBomb(state, p) {
    if (!p.alive) return false;
    var t = tileAt(state, p.x, p.y);
    if (isSolid(state, t.r, t.c)) return false;
    if (bombAt(state, t.r, t.c)) return false;

    var mine = 0;
    for (var i = 0; i < state.bombs.length; i++) {
      if (state.bombs[i].owner === p.id) mine++;
    }
    if (mine >= p.maxBombs) return false;

    state.bombs.push({
      r: t.r, c: t.c, owner: p.id, timer: FUSE, power: p.power
    });
    return true;
  }

  function detonate(state, bomb) {
    var idx = state.bombs.indexOf(bomb);
    if (idx < 0) return;                 /* 连锁时可能已经被炸掉了 */
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
          /* 箱子里的道具 */
          if (Math.random() < 0.34) {
            var types = ['bomb', 'power', 'speed'];
            state.items.push({
              r: r, c: c, type: types[Math.floor(Math.random() * types.length)]
            });
          }
          break;
        }
        cells.push({ r: r, c: c });
      }
    }

    /* 水柱 */
    cells.forEach(function (cell) {
      state.blasts.push({ r: cell.r, c: cell.c, ttl: BLAST_TTL });
    });

    /* 引爆范围内的其他水泡（连爆） */
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
    var t = tileAt(state, p.x, p.y);
    for (var i = 0; i < state.blasts.length; i++) {
      if (state.blasts[i].r === t.r && state.blasts[i].c === t.c) return true;
    }
    return false;
  }

  function pickupItems(state, p) {
    var t = tileAt(state, p.x, p.y);
    for (var i = state.items.length - 1; i >= 0; i--) {
      var it = state.items[i];
      if (it.r !== t.r || it.c !== t.c) continue;
      if (it.type === 'bomb') p.maxBombs = Math.min(MAX_BOMBS, p.maxBombs + 1);
      else if (it.type === 'power') p.power = Math.min(MAX_POWER, p.power + 1);
      else if (it.type === 'speed') p.speed = Math.min(MAX_SPEED, p.speed + 0.55);
      state.items.splice(i, 1);
      state.events.push({ t: 'pick', player: p.id, type: it.type });
    }
  }

  function aliveCount(state) {
    var n = 0;
    for (var i = 0; i < state.players.length; i++) if (state.players[i].alive) n++;
    return n;
  }

  /* 推进一帧，dt 单位秒 */
  function step(state, dt) {
    if (state.over) return;

    state.time += dt;
    state.events.length = 0;

    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (p.bombQueued) {
        p.bombQueued = false;
        placeBomb(state, p);
      }
      movePlayer(state, p, dt);
    }

    /* 水泡计时（先收集再统一引爆，避免边遍历边改数组） */
    var due = [];
    for (var bi = 0; bi < state.bombs.length; bi++) {
      state.bombs[bi].timer -= dt * 1000;
      if (state.bombs[bi].timer <= 0) due.push(state.bombs[bi]);
    }
    due.forEach(function (bd) { detonate(state, bd); });

    /* 水柱消失 */
    for (var k = state.blasts.length - 1; k >= 0; k--) {
      state.blasts[k].ttl -= dt * 1000;
      if (state.blasts[k].ttl <= 0) state.blasts.splice(k, 1);
    }

    /* 判定死亡 / 捡道具 */
    for (var j = 0; j < state.players.length; j++) {
      var pl = state.players[j];
      if (!pl.alive) continue;
      if (inBlast(state, pl)) {
        pl.alive = false;
        pl.hitAt = state.time;
        state.events.push({ t: 'die', player: pl.id });
      } else {
        pickupItems(state, pl);
      }
    }

    if (aliveCount(state) <= 1 && !state.over) {
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
        return [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), p.dir,
          p.alive ? 1 : 0, p.maxBombs, p.power, Number(p.speed.toFixed(2))];
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
      p.x = s[0]; p.y = s[1]; p.dir = s[2]; p.alive = !!s[3];
      p.maxBombs = s[4]; p.power = s[5]; p.speed = s[6];
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
    FUSE: FUSE, BLAST_TTL: BLAST_TTL, RADIUS: RADIUS,
    create: create,
    step: step,
    blocked: blocked,
    placeBomb: placeBomb,
    snapshot: snapshot,
    restore: restore,
    aliveCount: aliveCount,
    isSolid: isSolid
  };
}));
