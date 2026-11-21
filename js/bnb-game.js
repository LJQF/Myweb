/* ==========================================================================
   bnb-game.js —— 泡泡堂：渲染 / 输入 / 单人 AI / 联机（房主权威）
   ========================================================================== */
(function () {
  'use strict';

  var B = window.BnBEngine;
  if (!B) return;

  var COLS = 13;
  var ROWS = 11;
  var PREFIX = 'bnb-';
  var SNAP_MS = 66;          /* 房主每 66ms 发一次快照 ≈ 15Hz */
  var COLOR = ['#3b82f6', '#ef4444'];
  var NAME = ['你', '对手'];

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('board-wrap');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovDesc = document.getElementById('ov-desc');

  var mode = 'lobby';        /* lobby | solo | host | guest */
  var game = null;           /* 单人/房主：真实模拟状态 */
  var view = null;           /* 客人：本地渲染状态 */
  var myIndex = 0;
  var running = false;
  var lastT = 0;
  var acc = 0;
  var tick = 0;

  var room = null;
  var snapTimer = 0;
  var inputTimer = 0;

  var keys = { up: false, down: false, left: false, right: false };
  var touch = { up: false, down: false, left: false, right: false };

  var pred = { on: false, x: 0, y: 0, dir: 'down' };
  var netPrev = null;        /* 上一帧快照的玩家位置，用于插值 */
  var netT = 0;

  /* ---------------- 公用 ---------------- */
  function $(id) { return document.getElementById(id); }

  function showView(name) {
    $('view-lobby').hidden = name !== 'lobby';
    $('view-code').hidden = name !== 'code';
    $('view-join').hidden = name !== 'join';
    $('view-game').hidden = name !== 'game';
  }

  var toastTimer = 0;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.hidden = true; }, 2200);
  }

  function key(r, c) { return r + ',' + c; }

  /* ---------------- 画布尺寸 ---------------- */
  function resizeCanvas() {
    var rect = wrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    var sx = canvas.width / COLS;
    var sy = canvas.height / ROWS;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
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

  function drawBoard(st, now) {
    var r, c;

    /* 草地 */
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        ctx.fillStyle = ((r + c) % 2 === 0) ? '#3f7a4a' : '#376e43';
        ctx.fillRect(c, r, 1, 1);
      }
    }

    /* 砖块 */
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var t = st.tiles[r][c];
        if (t === B.WALL) {
          ctx.fillStyle = '#4b5563';
          roundRect(c + 0.04, r + 0.04, 0.92, 0.92, 0.14);
          ctx.fill();
          ctx.fillStyle = '#6b7280';
          roundRect(c + 0.12, r + 0.1, 0.76, 0.3, 0.1);
          ctx.fill();
        } else if (t === B.CRATE) {
          ctx.fillStyle = '#a16207';
          roundRect(c + 0.06, r + 0.06, 0.88, 0.88, 0.12);
          ctx.fill();
          ctx.strokeStyle = 'rgba(120,53,15,.75)';
          ctx.lineWidth = 0.06;
          ctx.beginPath();
          ctx.moveTo(c + 0.12, r + 0.5); ctx.lineTo(c + 0.88, r + 0.5);
          ctx.moveTo(c + 0.5, r + 0.12); ctx.lineTo(c + 0.5, r + 0.88);
          ctx.stroke();
        }
      }
    }

    /* 道具 */
    (st.items || []).forEach(function (it) {
      var cx = it.c + 0.5, cy = it.r + 0.5;
      ctx.save();
      ctx.translate(cx, cy + Math.sin(now / 300 + it.c) * 0.05);
      if (it.type === 'power') {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.moveTo(0, -0.28); ctx.lineTo(0.24, 0.2); ctx.lineTo(-0.24, 0.2);
        ctx.closePath(); ctx.fill();
      } else if (it.type === 'bomb') {
        ctx.fillStyle = '#0ea5e9';
        ctx.beginPath(); ctx.arc(0, 0, 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(-0.11, -0.035, 0.22, 0.07);
        ctx.fillRect(-0.035, -0.11, 0.07, 0.22);
      } else {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.moveTo(0.06, -0.26); ctx.lineTo(-0.16, 0.04);
        ctx.lineTo(-0.01, 0.04); ctx.lineTo(-0.07, 0.27);
        ctx.lineTo(0.17, -0.05); ctx.lineTo(0.02, -0.05);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    });

    /* 水泡 */
    (st.bombs || []).forEach(function (b) {
      var cx = b.c + 0.5;
      var cy = b.r + 0.5;
      var wob = Math.sin(now / 90) * 0.05;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.36 + wob, 0.34 - wob, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-0.1, -0.12, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fill();
      ctx.restore();
    });

    /* 水柱 */
    (st.blasts || []).forEach(function (x) {
      var cx = x.c + 0.5, cy = x.r + 0.5;
      var t = Math.min(1, Math.max(0, 1 - (x.ttl || 0) / B.BLAST_TTL));
      var rad = 0.28 + t * 0.22;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,.95)');
      g.addColorStop(0.55, 'rgba(125,211,252,.85)');
      g.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    });

    /* 玩家 */
    st.players.forEach(function (p, idx) {
      if (!p.alive) return;
      var x = p.x, y = p.y;

      /* 影子 */
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath();
      ctx.ellipse(x, y + 0.3, 0.3, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      /* 身体 */
      ctx.fillStyle = COLOR[idx] || '#3b82f6';
      roundRect(x - 0.3, y - 0.34, 0.6, 0.64, 0.26);
      ctx.fill();

      /* 眼睛 */
      var ex = p.dir === 'left' ? -0.06 : p.dir === 'right' ? 0.06 : 0;
      var ey = p.dir === 'up' ? -0.06 : p.dir === 'down' ? 0.06 : 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x - 0.11 + ex, y - 0.06 + ey, 0.075, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 0.11 + ex, y - 0.06 + ey, 0.075, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath(); ctx.arc(x - 0.11 + ex * 1.8, y - 0.06 + ey * 1.8, 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 0.11 + ex * 1.8, y - 0.06 + ey * 1.8, 0.04, 0, Math.PI * 2); ctx.fill();

      /* 我是谁 */
      if (p.id === myIndex && mode !== 'solo') {
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.arc(x, y, 0.42, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  function render(now) {
    var st = (mode === 'guest') ? view : game;
    if (!st) return;

    if (mode === 'guest' && netPrev) {
      /* 在两次快照之间做插值，顺便用本地预测覆盖自己 */
      var alpha = Math.min(1, netT / (SNAP_MS / 1000));
      var saved = [];
      st.players.forEach(function (p, i) {
        saved.push({ x: p.x, y: p.y, dir: p.dir });
        var prev = netPrev[i];
        if (prev) {
          p.x = prev.x + (p.x - prev.x) * alpha;
          p.y = prev.y + (p.y - prev.y) * alpha;
        }
      });
      if (pred.on && st.players[myIndex]) {
        st.players[myIndex].x = pred.x;
        st.players[myIndex].y = pred.y;
        st.players[myIndex].dir = pred.dir;
      }
      drawBoard(st, now);
      st.players.forEach(function (p, i) {
        p.x = saved[i].x; p.y = saved[i].y; p.dir = saved[i].dir;
      });
    } else {
      drawBoard(st, now);
    }
  }

  /* ---------------- 输入 ---------------- */
  function currentDirs() {
    return {
      up: keys.up || touch.up,
      down: keys.down || touch.down,
      left: keys.left || touch.left,
      right: keys.right || touch.right
    };
  }

  function dirVector(d) {
    return {
      dx: (d.right ? 1 : 0) - (d.left ? 1 : 0),
      dy: (d.down ? 1 : 0) - (d.up ? 1 : 0)
    };
  }

  function pushBomb() {
    if (!running) return;
    if (mode === 'solo' || mode === 'host') {
      if (game && game.players[myIndex]) game.players[myIndex].bombQueued = true;
    } else if (mode === 'guest' && room) {
      room.send({ t: 'bomb' });
    }
  }

  var KEYMAP = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right'
  };

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = String(e.key).toLowerCase();

    if (k === ' ') { e.preventDefault(); pushBomb(); return; }

    var dir = KEYMAP[k];
    if (!dir) return;
    e.preventDefault();
    keys[dir] = true;
    if (mode === 'guest' && running) sendGuestInput();
  });

  window.addEventListener('keyup', function (e) {
    var dir = KEYMAP[String(e.key).toLowerCase()];
    if (!dir) return;
    keys[dir] = false;
    if (mode === 'guest' && running) sendGuestInput();
  });

  /* 手机方向键 */
  (function bindPad() {
    var pad = document.querySelector('.pad');
    if (!pad) return;
    function setDir(el, val) {
      var d = el.getAttribute('data-dir');
      if (!d) return;
      touch[d] = val;
      if (mode === 'guest' && running) sendGuestInput();
    }
    pad.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      if (btn.dataset.act === 'bomb') { pushBomb(); return; }
      setDir(btn, true);
    });
    pad.addEventListener('pointerup', function (e) {
      var btn = e.target.closest('button');
      if (btn) setDir(btn, false);
    });
    pad.addEventListener('pointercancel', function (e) {
      var btn = e.target.closest('button');
      if (btn) setDir(btn, false);
    });
    pad.addEventListener('pointerleave', function (e) {
      var btn = e.target.closest('button');
      if (btn) setDir(btn, false);
    });
  }());

  /* ---------------- 单人 AI ---------------- */
  var ai = { timer: 0, dir: null };

  function blastCells(st, bomb) {
    var cells = [key(bomb.r, bomb.c)];
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var d = 0; d < 4; d++) {
      for (var k = 1; k <= bomb.power; k++) {
        var r = bomb.r + dirs[d][0] * k;
        var c = bomb.c + dirs[d][1] * k;
        if (r < 0 || c < 0 || r >= st.rows || c >= st.cols) break;
        if (st.tiles[r][c] === B.WALL) break;
        cells.push(key(r, c));
        if (st.tiles[r][c] === B.CRATE) break;
      }
    }
    return cells;
  }

  function dangerSet(st) {
    var set = {};
    st.bombs.forEach(function (b) {
      blastCells(st, b).forEach(function (k) { set[k] = true; });
    });
    return set;
  }

  function updateAI(st, dt) {
    var p = st.players[1];
    if (!p || !p.alive) return;

    ai.timer -= dt;
    if (ai.timer > 0) {
      p.input.dx = ai.dir ? ai.dir[0] : 0;
      p.input.dy = ai.dir ? ai.dir[1] : 0;
      return;
    }
    ai.timer = 0.1;

    var tr = Math.floor(p.y), tc = Math.floor(p.x);
    var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    var options = [];
    for (var i = 0; i < 4; i++) {
      var nr = tr + dirs[i][1], nc = tc + dirs[i][0];
      if (B.isSolid(st, nr, nc)) continue;
      options.push({ dc: dirs[i][0], dr: dirs[i][1], k: key(nr, nc), r: nr, c: nc });
    }
    if (!options.length) {
      ai.dir = null;
      p.input.dx = 0; p.input.dy = 0;
      return;
    }

    function move(dir) {
      ai.dir = dir;
      p.input.dx = dir ? dir[0] : 0;
      p.input.dy = dir ? dir[1] : 0;
    }

    var danger = dangerSet(st);

    /* 1. 站在危险区：往离水泡最远的安全格跑 */
    if (danger[key(tr, tc)]) {
      var safe = options.filter(function (o) { return !danger[o.k]; });
      if (!safe.length) safe = options;
      var bestFlee = safe[0];
      var bestFleeD = -1;
      for (var f = 0; f < safe.length; f++) {
        var md = 99;
        for (var bi = 0; bi < st.bombs.length; bi++) {
          var bd = Math.abs(safe[f].r - st.bombs[bi].r) + Math.abs(safe[f].c - st.bombs[bi].c);
          if (bd < md) md = bd;
        }
        if (md > bestFleeD) { bestFleeD = md; bestFlee = safe[f]; }
      }
      move([bestFlee.dc, bestFlee.dr]);
      return;
    }

    /* 2. 贴着箱子：先确认炸完以后有路跑，再放 */
    var crateNext = options.filter(function (o) { return st.tiles[o.r][o.c] === B.CRATE; });
    if (crateNext.length && st.bombs.length === 0) {
      var danger2 = {};
      Object.keys(danger).forEach(function (k) { danger2[k] = true; });
      blastCells(st, { r: tr, c: tc, power: p.power }).forEach(function (k) { danger2[k] = true; });

      var escapes = options.filter(function (o) { return !danger2[o.k]; });
      if (escapes.length) {
        p.bombQueued = true;
        var away = escapes[Math.floor(Math.random() * escapes.length)];
        move([away.dc, away.dr]);
        return;
      }
    }

    /* 3. 朝最近的箱子或对手走 */
    var opp = st.players[0];
    var goalR = Math.floor(opp.y), goalC = Math.floor(opp.x);
    var bestCrate = null, bestD = 1e9;
    for (var r = 1; r < st.rows - 1; r++) {
      for (var c = 1; c < st.cols - 1; c++) {
        if (st.tiles[r][c] !== B.CRATE) continue;
        var d = Math.abs(r - tr) + Math.abs(c - tc);
        if (d < bestD) { bestD = d; bestCrate = { r: r, c: c }; }
      }
    }
    var oppD = Math.abs(goalR - tr) + Math.abs(goalC - tc);
    var goal = (bestCrate && bestD <= oppD) ? bestCrate : { r: goalR, c: goalC };

    var best = options[0];
    var bestScore = -1e9;
    for (var j = 0; j < options.length; j++) {
      var o = options[j];
      if (danger[o.k]) continue;
      var dist = Math.abs(o.r - goal.r) + Math.abs(o.c - goal.c);
      var score = -dist + Math.random() * 0.4;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    move([best.dc, best.dr]);
  }

  /* ---------------- 主循环 ---------------- */
  function stepGame(dt) {
    var d = currentDirs();
    var v = dirVector(d);
    var me = game.players[myIndex];
    if (me) {
      me.input.dx = v.dx;
      me.input.dy = v.dy;
    }

    if (mode === 'solo') updateAI(game, dt);

    B.step(game, dt);

    if (game.over && running) {
      running = false;
      finish(game.winner);
    }
  }

  function loop(now) {
    tick++;
    if (!running) { render(now); return; }

    if (!lastT) lastT = now;
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (mode === 'solo' || mode === 'host') {
      acc += dt;
      var guard = 0;
      while (acc >= 1 / 60 && guard++ < 6) {
        acc -= 1 / 60;
        stepGame(1 / 60);
        if (!running) break;
      }
      if (mode === 'host' && running) hostTick(dt);
    } else if (mode === 'guest') {
      netT += dt;
      guestPredict(dt);
    }

    render(now);
    if (running) window.requestAnimationFrame(loop);
  }

  function startLoop() {
    running = true;
    lastT = 0;
    acc = 0;
    window.requestAnimationFrame(loop);
  }

  /* ---------------- 结束 ---------------- */
  function finish(winner) {
    running = false;
    ovTitle.textContent = (winner === myIndex) ? '你赢了 🎉' : (winner < 0 ? '平局' : '你输了');
    ovDesc.textContent = winner === myIndex
      ? '对手被水柱冲走了'
      : (winner < 0 ? '两个人都没了' : '被水柱冲走了，再来一局？');
    overlay.hidden = false;
  }

  /* ---------------- 开局 ---------------- */
  function buildGame(tilesStr, seed) {
    var g = B.create({ cols: COLS, rows: ROWS, seed: seed, names: NAME });
    if (tilesStr) {
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          g.tiles[r][c] = Number(tilesStr.charAt(r * COLS + c)) || 0;
        }
      }
    }
    return g;
  }

  function encodeTiles(g) {
    var s = '';
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) s += g.tiles[r][c];
    return s;
  }

  function showGame() {
    showView('game');
    overlay.hidden = true;
    $('dot-a').style.background = COLOR[0];
    $('dot-b').style.background = COLOR[1];
    $('name-a').textContent = (mode === 'solo' || myIndex === 0) ? '你' : '对手';
    $('name-b').textContent = (mode === 'solo') ? '电脑' : (myIndex === 1 ? '你' : '对手');
    $('hud-mid').textContent = COLS + ' × ' + ROWS;
    resizeCanvas();
  }

  function startSolo() {
    closeRoom();
    mode = 'solo';
    myIndex = 0;
    game = B.create({ cols: COLS, rows: ROWS, names: ['你', '电脑'] });
    showGame();
    startLoop();
  }

  /* ---------------- 联机 ---------------- */
  function closeRoom() {
    window.clearInterval(snapTimer);
    window.clearInterval(inputTimer);
    snapTimer = 0;
    inputTimer = 0;
    if (room) { room.close(); room = null; }
  }

  function hostStartMatch() {
    myIndex = 0;
    game = B.create({ cols: COLS, rows: ROWS, names: ['房主', '加入者'] });
    mode = 'host';
    showGame();
    startLoop();

    room.send({ t: 'start', tiles: encodeTiles(game), seed: game.seed });

    window.clearInterval(snapTimer);
    snapTimer = window.setInterval(function () {
      if (!room || !game) return;
      room.send(B.snapshot(game));
    }, SNAP_MS);
  }

  function hostTick() {
    /* 输入由 onData 实时更新，这里不用做事 */
  }

  function guestPredict(dt) {
    if (!pred.on || !view) return;

    var d = currentDirs();
    var v = dirVector(d);
    if (!v.dx && !v.dy) return;

    var speed = (view.players[myIndex] && view.players[myIndex].speed) || 3.4;
    var dist = speed * dt;
    var nx = pred.x + v.dx * dist;
    var ny = pred.y + v.dy * dist;

    if (v.dx) pred.dir = v.dx > 0 ? 'right' : 'left';
    else if (v.dy) pred.dir = v.dy > 0 ? 'down' : 'up';

    if (!B.blocked(view, nx, pred.y)) pred.x = nx;
    if (!B.blocked(view, pred.x, ny)) pred.y = ny;
  }

  function sendGuestInput() {
    if (!room || mode !== 'guest' || !running) return;
    var v = dirVector(currentDirs());
    room.send({ t: 'in', dx: v.dx, dy: v.dy });
  }

  var netIn = { count: 0, last: '' };

  function onNetData(msg) {
    if (!msg || !msg.t) return;
    netIn.count++;
    netIn.last = msg.t;

    if (msg.t === 'start' && mode === 'guest') {
      myIndex = 1;
      view = buildGame(msg.tiles, msg.seed);
      pred.on = true;
      pred.x = view.players[1].x;
      pred.y = view.players[1].y;
      netPrev = null;
      showGame();
      startLoop();
      sendGuestInput();
      return;
    }

    if (msg.t === 'st' && mode === 'guest' && view) {
      netPrev = view.players.map(function (p) { return { x: p.x, y: p.y }; });
      B.restore(view, msg);
      netT = 0;

      var me = view.players[myIndex];
      if (me) {
        if (!me.alive) { pred.on = false; }
        else if (!pred.on) { pred.on = true; pred.x = me.x; pred.y = me.y; }
        else {
          var dx = me.x - pred.x;
          var dy = me.y - pred.y;
          if (Math.abs(dx) + Math.abs(dy) > 1.2) { pred.x = me.x; pred.y = me.y; }
          else { pred.x += dx * 0.25; pred.y += dy * 0.25; }
        }
      }

      if (view.over && running) {
        running = false;
        finish(view.winner);
      }
      return;
    }

    if (msg.t === 'in' && mode === 'host' && game && game.players[1]) {
      game.players[1].input.dx = msg.dx || 0;
      game.players[1].input.dy = msg.dy || 0;
      return;
    }

    if (msg.t === 'bomb' && mode === 'host' && game && game.players[1]) {
      game.players[1].bombQueued = true;
      return;
    }

    if (msg.t === 'again' && mode === 'host') {
      hostStartMatch();
      return;
    }

    if (msg.t === 'bye') {
      if (running) {
        running = false;
        ovTitle.textContent = '对手离开了';
        ovDesc.textContent = '回到大厅重新开一局吧';
        overlay.hidden = false;
      }
    }
  }

  function onPeerLeft() {
    if (mode !== 'host' && mode !== 'guest') return;
    running = false;
    ovTitle.textContent = '对手断开了';
    ovDesc.textContent = '可以回到大厅重新开一局';
    overlay.hidden = false;
  }

  /* ---------------- 大厅交互 ---------------- */
  $('btn-solo').addEventListener('click', startSolo);

  $('btn-host').addEventListener('click', function () {
    showView('code');
    $('room-code').textContent = '--------';
    $('host-status').textContent = '正在生成房间号…';

    room = window.Net.create({
      host: true,
      prefix: PREFIX,
      onStatus: function (name, data) {
        if (name === 'code') {
          $('room-code').textContent = data.code;
          $('host-status').textContent = '等待对手加入…';
        } else if (name === 'connected') {
          hostStartMatch();
        } else if (name === 'error') {
          $('host-status').textContent = data.message;
        } else if (name === 'peer-left') {
          onPeerLeft();
        }
      },
      onData: onNetData
    });
  });

  $('btn-join').addEventListener('click', function () {
    showView('join');
    $('join-error').textContent = '';
    $('join-input').value = '';
    $('join-input').disabled = false;
    $('join-input').focus();
  });

  function doJoin() {
    var code = ($('join-input').value || '').replace(/\D/g, '');
    if (code.length !== 8) {
      $('join-error').textContent = '请输入完整的 8 位数字';
      return;
    }
    $('join-error').textContent = '';
    $('join-input').disabled = true;
    closeRoom();
    mode = 'guest';

    room = window.Net.create({
      host: false,
      code: code,
      prefix: PREFIX,
      onStatus: function (name, data) {
        if (name === 'connected') {
          $('join-error').textContent = '已连接，等房主开局…';
        } else if (name === 'error') {
          $('join-error').textContent = data.message;
          $('join-input').disabled = false;
          mode = 'lobby';
          closeRoom();
        } else if (name === 'peer-left') {
          onPeerLeft();
        }
      },
      onData: onNetData
    });
  }

  $('btn-do-join').addEventListener('click', doJoin);
  $('join-input').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 8);
  });
  $('join-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doJoin();
  });

  $('btn-copy').addEventListener('click', function () {
    var code = $('room-code').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { toast('已复制：' + code); },
        function () { toast('复制失败，请手动选择'); });
    } else {
      toast('复制失败，请手动选择');
    }
  });

  function backToLobby() {
    running = false;
    closeRoom();
    mode = 'lobby';
    game = null;
    view = null;
    pred.on = false;
    overlay.hidden = true;
    showView('lobby');
  }

  $('btn-cancel-host').addEventListener('click', backToLobby);
  $('btn-cancel-join').addEventListener('click', backToLobby);
  $('btn-leave').addEventListener('click', backToLobby);
  $('btn-back').addEventListener('click', backToLobby);

  $('btn-again').addEventListener('click', function () {
    overlay.hidden = true;
    if (mode === 'solo') startSolo();
    else if (mode === 'host') { if (room) room.send({ t: 'again' }); hostStartMatch(); }
    else if (mode === 'guest') {
      if (room) room.send({ t: 'again' });
      toast('等房主再开一局…');
    }
  });

  window.addEventListener('resize', function () { if (!$('view-game').hidden) resizeCanvas(); });

  /* 调试用：只读快照，方便自动化测试 */
  window.BnBDebug = {
    snapshot: function () {
      var st = (mode === 'guest') ? view : game;
      return st ? B.snapshot(st) : null;
    },
    mode: function () { return mode; },
    net: function () { return netIn; },
    running: function () { return running; },
    pred: function () { return { on: pred.on, x: Number(pred.x.toFixed(2)), y: Number(pred.y.toFixed(2)) }; },
    ticks: function () { return tick; },
    players: function () {
      var st = (mode === 'guest') ? view : game;
      if (!st) return null;
      return st.players.map(function (p) {
        return { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)), dx: p.input.dx, dy: p.input.dy, alive: p.alive };
      });
    }
  };

  /* 启动 */
  showView('lobby');
}());
