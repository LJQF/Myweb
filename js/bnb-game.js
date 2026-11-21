/* ==========================================================================
   bnb-game.js —— 泡泡堂：渲染 / 输入 / 单人 AI / 联机

   联机采用「各自管好自己」的方式（对方不管我的死活，我也只管自己的）：
     · 我在本地跑一整套游戏逻辑，我的角色一按就走，零延迟
     · 对手的角色完全由他发来的坐标驱动，我只负责画出来
     · 水泡互相广播，双方各自演算爆炸；箱子里的道具用格子哈希生成，两边必然一致
     · 我被炸死由我自己判定，然后广播「我死了」；对方死了我收到通知
   ========================================================================== */
(function () {
  'use strict';

  var B = window.BnBEngine;
  if (!B) return;

  var COLS = 13;
  var ROWS = 11;
  var PREFIX = 'bnb-';
  var POS_HB_MS = 700;       /* 位置心跳，防止丢包后对手卡住 */
  var COLOR = ['#3b82f6', '#ef4444'];
  var NAME = ['你', '对手'];

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('board-wrap');
  var overlay = document.getElementById('overlay');
  var ovTitle = document.getElementById('ov-title');
  var ovDesc = document.getElementById('ov-desc');

  var mode = 'lobby';        /* lobby | solo | host | guest */
  var game = null;
  var myIndex = 0;
  var running = false;
  var lastT = 0;
  var acc = 0;
  var tick = 0;

  var room = null;
  var lastSentPos = '';
  var lastHeartbeat = 0;
  var sentDead = false;
  var netIn = { count: 0, last: '' };

  /* 输入 */
  var pressed = { up: false, down: false, left: false, right: false };
  var order = [];
  var dirDownAt = { up: 0, down: 0, left: 0, right: 0 };
  var REPEAT_DELAY_MS = 420;   /* 按住多久之后才开始连走 */

  function $(id) { return document.getElementById(id); }
  function isPeer() { return mode === 'host' || mode === 'guest'; }

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

  /* ---------------- 画布 ---------------- */
  function resizeCanvas() {
    var rect = wrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(canvas.width / COLS, 0, 0, canvas.height / ROWS, 0, 0);
  }

  /* ---------------- 绘制 ---------------- */
  var ANIM_MS = 150;
  var anim = {};

  function visualPos(p, now) {
    var a = anim[p.id];
    if (!a) {
      anim[p.id] = { r: p.r, c: p.c, fromR: p.r, fromC: p.c, t0: -1 };
      return { r: p.r, c: p.c };
    }
    if (a.r !== p.r || a.c !== p.c) {
      a.fromR = a.r; a.fromC = a.c;
      a.r = p.r; a.c = p.c;
      a.t0 = now;
    }
    if (a.t0 < 0) return { r: a.r, c: a.c };
    var t = (now - a.t0) / ANIM_MS;
    if (t >= 1) { a.t0 = -1; return { r: a.r, c: a.c }; }
    var e = 1 - Math.pow(1 - t, 3);
    return {
      r: a.fromR + (a.r - a.fromR) * e,
      c: a.fromC + (a.c - a.fromC) * e
    };
  }

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

    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        ctx.fillStyle = ((r + c) % 2 === 0) ? '#3f7a4a' : '#376e43';
        ctx.fillRect(c, r, 1, 1);
      }
    }

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

    st.players.forEach(function (p, idx) {
      if (!p.alive) return;
      var vis = visualPos(p, now);
      var x = vis.c + 0.5;
      var y = vis.r + 0.5;

      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath();
      ctx.ellipse(x, y + 0.3, 0.3, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = COLOR[idx] || '#3b82f6';
      roundRect(x - 0.3, y - 0.34, 0.6, 0.64, 0.26);
      ctx.fill();

      var ex = p.dir === 'left' ? -0.06 : p.dir === 'right' ? 0.06 : 0;
      var ey = p.dir === 'up' ? -0.06 : p.dir === 'down' ? 0.06 : 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x - 0.11 + ex, y - 0.06 + ey, 0.075, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 0.11 + ex, y - 0.06 + ey, 0.075, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath(); ctx.arc(x - 0.11 + ex * 1.8, y - 0.06 + ey * 1.8, 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 0.11 + ex * 1.8, y - 0.06 + ey * 1.8, 0.04, 0, Math.PI * 2); ctx.fill();

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
    if (!game) return;
    drawBoard(game, now);
  }

  /* ---------------- 输入 ---------------- */
  var KEYMAP = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right'
  };

  function activeDir() {
    for (var i = order.length - 1; i >= 0; i--) {
      if (pressed[order[i]]) return order[i];
    }
    return null;
  }

  /* 按键状态每次变化时立刻投递一次；按住的话由主循环每帧补投 */
  function applyInput() {
    if (!running || !game) return;
    var me = game.players[myIndex];
    if (!me) return;
    var dir = activeDir();
    me.moveDir = dir;
    if (dir) me.queuedDir = dir;
  }

  function sampleInput() {
    if (!running || !game) return;
    var me = game.players[myIndex];
    if (!me || !me.alive) return;

    var dir = activeDir();
    if (!dir) return;
    if (!dirDownAt[dir]) return;

    /* 刚按下去的这一下只走一格；持续按住超过 REPEAT_DELAY_MS 才开始连走 */
    if (Date.now() - dirDownAt[dir] < REPEAT_DELAY_MS) return;
    me.queuedDir = dir;
  }

  function pushDir(dir) {
    if (!pressed[dir]) {
      pressed[dir] = true;
      order.push(dir);
      dirDownAt[dir] = Date.now();
    }
    applyInput();
  }

  function releaseDir(dir) {
    pressed[dir] = false;
    dirDownAt[dir] = 0;
    var i = order.indexOf(dir);
    if (i >= 0) order.splice(i, 1);
    applyInput();
  }

  function pushBomb() {
    if (!running || !game) return;
    var me = game.players[myIndex];
    if (me) me.bombQueued = true;
  }

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = String(e.key).toLowerCase();
    if (k === ' ') { e.preventDefault(); pushBomb(); return; }
    var dir = KEYMAP[k];
    if (!dir) return;
    e.preventDefault();
    if (e.repeat) return;
    pushDir(dir);
  });

  window.addEventListener('keyup', function (e) {
    var dir = KEYMAP[String(e.key).toLowerCase()];
    if (!dir) return;
    releaseDir(dir);
  });

  window.addEventListener('blur', function () {
    ['up', 'down', 'left', 'right'].forEach(function (d) { releaseDir(d); });
  });

  (function bindPad() {
    var pad = document.querySelector('.pad');
    if (!pad) return;
    pad.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      if (btn.dataset.act === 'bomb') { pushBomb(); return; }
      if (btn.dataset.dir) pushDir(btn.dataset.dir);
    });
    function up(e) {
      var btn = e.target.closest('button');
      if (btn && btn.dataset.dir) releaseDir(btn.dataset.dir);
    }
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('pointerleave', up);
  }());

  /* ---------------- 单人 AI ---------------- */
  var ai = { timer: 0 };

  function blastCells(st, bomb) {
    var cells = [bomb.r + ',' + bomb.c];
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var d = 0; d < 4; d++) {
      for (var k = 1; k <= bomb.power; k++) {
        var r = bomb.r + dirs[d][0] * k;
        var c = bomb.c + dirs[d][1] * k;
        if (r < 0 || c < 0 || r >= st.rows || c >= st.cols) break;
        if (st.tiles[r][c] === B.WALL) break;
        cells.push(r + ',' + c);
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
    if (ai.timer > 0) return;
    ai.timer = 0.1;

    var danger = dangerSet(st);
    var dirs = ['up', 'down', 'left', 'right'];
    var options = [];
    for (var i = 0; i < dirs.length; i++) {
      var d = B.DIRS[dirs[i]];
      var nr = p.r + d.dr, nc = p.c + d.dc;
      if (B.isSolid(st, nr, nc)) continue;
      options.push({ dir: dirs[i], r: nr, c: nc, k: nr + ',' + nc });
    }
    if (!options.length) { p.moveDir = null; return; }

    if (danger[p.r + ',' + p.c]) {
      var safe = options.filter(function (o) { return !danger[o.k]; });
      if (!safe.length) safe = options;
      var bestFlee = safe[0], bestFleeD = -1;
      for (var f = 0; f < safe.length; f++) {
        var md = 99;
        for (var bi = 0; bi < st.bombs.length; bi++) {
          var bd = Math.abs(safe[f].r - st.bombs[bi].r) + Math.abs(safe[f].c - st.bombs[bi].c);
          if (bd < md) md = bd;
        }
        if (md > bestFleeD) { bestFleeD = md; bestFlee = safe[f]; }
      }
      p.moveDir = bestFlee.dir;
      p.queuedDir = bestFlee.dir;
      return;
    }

    var crateNext = options.filter(function (o) { return st.tiles[o.r][o.c] === B.CRATE; });
    if (crateNext.length && st.bombs.length === 0) {
      var danger2 = {};
      Object.keys(danger).forEach(function (k2) { danger2[k2] = true; });
      blastCells(st, { r: p.r, c: p.c, power: p.power }).forEach(function (k3) { danger2[k3] = true; });
      var escapes = options.filter(function (o) { return !danger2[o.k]; });
      if (escapes.length) {
        p.bombQueued = true;
        var escDir = escapes[Math.floor(Math.random() * escapes.length)].dir;
        p.moveDir = escDir;
        p.queuedDir = escDir;
        return;
      }
    }

    var opp = st.players[0];
    var bestCrate = null, bestD = 1e9;
    for (var r = 1; r < st.rows - 1; r++) {
      for (var c = 1; c < st.cols - 1; c++) {
        if (st.tiles[r][c] !== B.CRATE) continue;
        var dd = Math.abs(r - p.r) + Math.abs(c - p.c);
        if (dd < bestD) { bestD = dd; bestCrate = { r: r, c: c }; }
      }
    }
    var oppD = Math.abs(opp.r - p.r) + Math.abs(opp.c - p.c);
    var goal = (bestCrate && bestD <= oppD) ? bestCrate : { r: opp.r, c: opp.c };

    var best = options[0], bestScore = -1e9;
    for (var j = 0; j < options.length; j++) {
      var o = options[j];
      if (danger[o.k]) continue;
      var dist = Math.abs(o.r - goal.r) + Math.abs(o.c - goal.c);
      var score = -dist + Math.random() * 0.4;
      if (o.dir === p.moveDir) score += 0.5;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    p.moveDir = best.dir;
    p.queuedDir = best.dir;
  }

  /* ---------------- 联机同步 ---------------- */
  function sendPos(force) {
    if (!room || !game) return;
    var me = game.players[myIndex];
    if (!me) return;
    var sig = me.r + ',' + me.c + ',' + me.dir + ',' + (me.alive ? 1 : 0);
    var now = Date.now();
    if (!force && sig === lastSentPos && now - lastHeartbeat < POS_HB_MS) return;
    lastSentPos = sig;
    if (force) lastHeartbeat = now;
    else if (now - lastHeartbeat > POS_HB_MS) lastHeartbeat = now;
    room.send({ t: 'pos', r: me.r, c: me.c, dir: me.dir });
  }

  function sendNewBombs() {
    if (!room || !game) return;
    for (var i = 0; i < game.bombs.length; i++) {
      var b = game.bombs[i];
      if (b.owner !== myIndex || b.sent) continue;
      b.sent = true;
      room.send({ t: 'bomb', r: b.r, c: b.c, power: b.power });
    }
  }

  /* ---------------- 主循环 ---------------- */
  function stepGame(dt) {
    if (mode !== 'solo') sampleInput(); else updateAI(game, dt);

    B.step(game, dt);

    if (isPeer()) {
      sendNewBombs();
      sendPos(false);

      var me = game.players[myIndex];
      if (me && !me.alive && !sentDead) {
        sentDead = true;
        if (room) room.send({ t: 'dead' });
        running = false;
        finish(1 - myIndex);
        return;
      }
    }

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

    acc += dt;
    var guard = 0;
    while (acc >= 1 / 60 && guard++ < 6) {
      acc -= 1 / 60;
      stepGame(1 / 60);
      if (!running) break;
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
  function showGame() {
    showView('game');
    overlay.hidden = true;
    $('dot-a').style.background = COLOR[0];
    $('dot-b').style.background = COLOR[1];
    $('name-a').textContent = (myIndex === 0) ? '你' : '对手';
    $('name-b').textContent = (myIndex === 0) ? (mode === 'solo' ? '电脑' : '对手') : '你';
    $('hud-mid').textContent = COLS + ' × ' + ROWS;
    resizeCanvas();
  }

  function newGame(tilesStr, seed, peer) {
    var g = B.create({
      cols: COLS, rows: ROWS, seed: seed || Math.floor(Math.random() * 1e9),
      names: peer ? ['房主', '加入者'] : ['你', '电脑'],
      peerMode: !!peer
    });
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

  function startSolo() {
    closeRoom();
    mode = 'solo';
    myIndex = 0;
    game = newGame(null, null, false);
    resetSync();
    showGame();
    startLoop();
  }

  function startPeer(tilesStr, seed, asHost) {
    mode = asHost ? 'host' : 'guest';
    myIndex = asHost ? 0 : 1;
    game = newGame(tilesStr, seed, true);
    game.players[1 - myIndex].immune = true;   /* 对手的死活由他自己判定 */
    resetSync();
    showGame();
    startLoop();
  }

  function resetSync() {
    lastSentPos = '';
    lastHeartbeat = 0;
    sentDead = false;
    anim = {};
    order.length = 0;
    pressed.up = pressed.down = pressed.left = pressed.right = false;
    dirDownAt.up = dirDownAt.down = dirDownAt.left = dirDownAt.right = 0;
  }

  /* ---------------- 联机消息 ---------------- */
  function closeRoom() {
    if (room) { room.close(); room = null; }
  }

  function onNetData(msg) {
    if (!msg || !msg.t) return;
    netIn.count++;
    netIn.last = msg.t;

    if (msg.t === 'start' && mode === 'guest') {
      startPeer(msg.tiles, msg.seed, false);
      return;
    }

    if (!game) return;
    var other = game.players[1 - myIndex];

    if (msg.t === 'pos' && other) {
      other.r = msg.r;
      other.c = msg.c;
      other.dir = msg.dir || other.dir;
      return;
    }

    if (msg.t === 'bomb') {
      game.bombs.push({
        r: msg.r, c: msg.c, owner: 1 - myIndex, timer: B.FUSE,
        power: msg.power || 2, sent: true
      });
      return;
    }

    if (msg.t === 'dead') {
      if (other) { other.alive = false; other.moveDir = null; }
      if (running) { running = false; finish(myIndex); }
      return;
    }

    if (msg.t === 'again' && mode === 'host') {
      var g = newGame(null, Math.floor(Math.random() * 1e9), true);
      if (room) room.send({ t: 'start', tiles: encodeTiles(g), seed: g.seed });
      mode = 'host';
      myIndex = 0;
      game = g;
      game.players[1].immune = true;
      resetSync();
      showGame();
      startLoop();
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
    if (!isPeer()) return;
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
          var g = newGame(null, Math.floor(Math.random() * 1e9), true);
          room.send({ t: 'start', tiles: encodeTiles(g), seed: g.seed });
          startPeer(encodeTiles(g), g.seed, true);
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
    if (room) room.send({ t: 'bye' });
    closeRoom();
    mode = 'lobby';
    game = null;
    resetSync();
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
    else if (mode === 'host') {
      var g = newGame(null, Math.floor(Math.random() * 1e9), true);
      if (room) room.send({ t: 'start', tiles: encodeTiles(g), seed: g.seed });
      myIndex = 0;
      game = g;
      game.players[1].immune = true;
      resetSync();
      showGame();
      startLoop();
    } else if (mode === 'guest') {
      if (room) room.send({ t: 'again' });
      toast('等房主再开一局…');
    }
  });

  window.addEventListener('resize', function () { if (!$('view-game').hidden) resizeCanvas(); });

  /* 调试用：只读快照，方便自动化测试 */
  window.BnBDebug = {
    snapshot: function () { return game ? B.snapshot(game) : null; },
    mode: function () { return mode; },
    net: function () { return netIn; },
    running: function () { return running; },
    ticks: function () { return tick; },
    me: function () { return myIndex; },
    players: function () {
      if (!game) return null;
      return game.players.map(function (p) {
        return {
          r: p.r, c: p.c, dir: p.dir, alive: p.alive,
          moveDir: p.moveDir, immune: p.immune
        };
      });
    }
  };

  showView('lobby');
}());
