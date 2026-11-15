/* ==========================================================================
   gomoku-ui.js —— 五子棋界面 + 联机
   ========================================================================== */
(function () {
  'use strict';

  var G = window.GomokuEngine;
  if (!G) return;

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    lobby: $('view-lobby'),
    codeView: $('view-code'),
    joinView: $('view-join'),
    game: $('view-game'),
    roomCode: $('room-code'),
    hostStatus: $('host-status'),
    joinInput: $('join-input'),
    joinError: $('join-error'),
    board: $('board'),
    grid: $('grid'),
    lines: $('lines'),
    stones: $('stones'),
    ghost: $('ghost'),
    turnDot: $('turn-dot'),
    turnLabel: $('turn-label'),
    sideLabel: $('side-label'),
    result: $('result'),
    resultTitle: $('result-title'),
    resultDesc: $('result-desc'),
    toast: $('toast')
  };

  var NS = 'http://www.w3.org/2000/svg';
  var SPAN = 14;          /* 15 路棋盘，格间距离 */
  var PREFIX = 'gom-';    /* 和象棋的房间号分开，避免串台 */

  var state = null;
  var mode = 'none';      /* 'online' | 'local' */
  var mySide = 0;         /* 1 黑 2 白 */
  var over = false;
  var room = null;
  var joinTimer = 0;
  var toastTimer = 0;
  var hbTimer = 0;
  var lastSeen = 0;

  /* ---------------- 小工具 ---------------- */
  function showView(name) {
    els.lobby.hidden = name !== 'lobby';
    els.codeView.hidden = name !== 'code';
    els.joinView.hidden = name !== 'join';
    els.game.hidden = name !== 'game';
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { els.toast.hidden = true; }, 2300);
  }

  function isOnline() { return mode === 'online'; }
  function canI() { return !over && (!isOnline() || mySide === state.turn); }

  /* ---------------- 棋盘 ---------------- */
  function drawLines() {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('stroke', 'rgba(92,64,24,.72)');
    g.setAttribute('stroke-width', '0.045');

    for (var i = 0; i <= SPAN; i++) {
      var h = document.createElementNS(NS, 'line');
      h.setAttribute('x1', '0'); h.setAttribute('y1', String(i));
      h.setAttribute('x2', String(SPAN)); h.setAttribute('y2', String(i));
      g.appendChild(h);

      var v = document.createElementNS(NS, 'line');
      v.setAttribute('x1', String(i)); v.setAttribute('y1', '0');
      v.setAttribute('x2', String(i)); v.setAttribute('y2', String(SPAN));
      g.appendChild(v);
    }
    els.lines.appendChild(g);

    [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]].forEach(function (p) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(p[0]));
      c.setAttribute('cy', String(p[1]));
      c.setAttribute('r', '0.12');
      c.setAttribute('fill', 'rgba(92,64,24,.8)');
      els.lines.appendChild(c);
    });
  }

  var winLineEl = null;

  function clearWinLine() {
    if (winLineEl && winLineEl.parentNode) winLineEl.parentNode.removeChild(winLineEl);
    winLineEl = null;
  }

  function showWinLine(line) {
    clearWinLine();
    if (!line || line.length < 2) return;
    var a = line[0];
    var b = line[line.length - 1];
    var el = document.createElementNS(NS, 'line');
    el.setAttribute('x1', String(a.c));
    el.setAttribute('y1', String(a.r));
    el.setAttribute('x2', String(b.c));
    el.setAttribute('y2', String(b.r));
    el.setAttribute('stroke', 'rgba(245,158,11,.95)');
    el.setAttribute('stroke-width', '0.17');
    el.setAttribute('stroke-linecap', 'round');
    els.lines.appendChild(el);
    winLineEl = el;
  }

  function inLine(line, r, c) {
    if (!line) return false;
    for (var i = 0; i < line.length; i++) {
      if (line[i].r === r && line[i].c === c) return true;
    }
    return false;
  }

  function render() {
    var frag = document.createDocumentFragment();
    for (var r = 0; r <= SPAN; r++) {
      for (var c = 0; c <= SPAN; c++) {
        var v = state.cells[r][c];
        if (!v) continue;

        var el = document.createElement('div');
        el.className = 'stone ' + (v === 1 ? 'b' : 'w');
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        if (state.last && state.last.r === r && state.last.c === c) {
          el.classList.add('last', 'drop');
        }
        if (inLine(state.winLine, r, c)) el.classList.add('win');
        el.style.left = (c * 100 / SPAN) + '%';
        el.style.top = (r * 100 / SPAN) + '%';
        frag.appendChild(el);
      }
    }

    els.stones.innerHTML = '';
    els.stones.appendChild(frag);

    if (state.winLine) showWinLine(state.winLine);
    else clearWinLine();

    renderStatus();
  }

  function renderStatus() {
    var myTurn = canI();
    els.turnLabel.textContent = over
      ? '对局结束'
      : (state.turn === 1 ? '黑方落子' : '白方落子') + (isOnline() ? (myTurn ? '（你）' : '（对手）') : '');

    els.turnDot.className = 'dot' + (state.turn === 2 ? ' white' : '') + (over ? ' over' : '');
    els.sideLabel.textContent = isOnline() ? (mySide === 1 ? '你执黑' : '你执白') : '本地双人';
    els.board.classList.toggle('locked', !myTurn && !over);
  }

  /* ---------------- 落子 ---------------- */
  function cellFromEvent(e) {
    var rect = els.grid.getBoundingClientRect();
    var c = Math.round((e.clientX - rect.left) / rect.width * SPAN);
    var r = Math.round((e.clientY - rect.top) / rect.height * SPAN);
    if (r < 0 || r > SPAN || c < 0 || c > SPAN) return null;
    return { r: r, c: c };
  }

  function placeAt(r, c, broadcast) {
    if (over) return false;
    var res = G.place(state, r, c);
    if (!res.ok) return false;

    render();

    if (res.win) finish(res.win);
    else if (res.draw) finish(0);

    if (broadcast && isOnline() && room) room.send({ t: 'mv', r: r, c: c });
    return true;
  }

  function onBoardClick(e) {
    if (!canI()) return;
    var pos = cellFromEvent(e);
    if (!pos) return;
    placeAt(pos.r, pos.c, true);
  }

  els.board.addEventListener('click', onBoardClick);

  els.board.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' || !canI()) { els.ghost.hidden = true; return; }
    var pos = cellFromEvent(e);
    if (!pos || state.cells[pos.r][pos.c] !== 0) { els.ghost.hidden = true; return; }
    els.ghost.hidden = false;
    els.ghost.className = 'ghost ' + (state.turn === 1 ? 'b' : 'w');
    els.ghost.style.left = (pos.c * 100 / SPAN) + '%';
    els.ghost.style.top = (pos.r * 100 / SPAN) + '%';
  });

  els.board.addEventListener('pointerleave', function () { els.ghost.hidden = true; });

  /* ---------------- 结束 ---------------- */
  function finish(winner) {
    over = true;
    els.ghost.hidden = true;

    var title, desc;
    if (!winner) {
      title = '平局';
      desc = '棋盘下满了，谁都没连成五颗';
    } else if (isOnline()) {
      title = winner === mySide ? '你赢了 🎉' : '你输了';
      desc = winner === 1 ? '黑方连成五颗' : '白方连成五颗';
    } else {
      title = (winner === 1 ? '黑方' : '白方') + '胜';
      desc = '连成五颗';
    }

    els.resultTitle.textContent = title;
    els.resultDesc.textContent = desc;
    els.result.hidden = false;
    renderStatus();
  }

  function resetBoard() {
    G.reset(state);
    over = false;
    els.result.hidden = true;
    els.ghost.hidden = true;
    render();
  }

  /* ---------------- 联机 ---------------- */
  function onNetData(msg) {
    if (!msg || !msg.t) return;

    lastSeen = Date.now();
    if (msg.t === 'ping') { if (room) room.send({ t: 'pong' }); return; }
    if (msg.t === 'pong') return;

    if (msg.t === 'mv') {
      if (!placeAt(msg.r, msg.c, false)) toast('收到一步不合法的落子，已忽略');
      return;
    }
    if (msg.t === 'resign') {
      if (!over) finish(mySide);
      return;
    }
    if (msg.t === 'restart') {
      resetBoard();
      toast('对手重新开始了一局');
    }
  }

  /* 心跳：对面直接关页面时能很快发现 */
  function stopHeartbeat() {
    if (hbTimer) { window.clearInterval(hbTimer); hbTimer = 0; }
  }

  function startHeartbeat() {
    stopHeartbeat();
    lastSeen = Date.now();
    hbTimer = window.setInterval(function () {
      if (!room) return;
      room.send({ t: 'ping' });
      if (Date.now() - lastSeen > 11000) {
        stopHeartbeat();
        onPeerLeft();
      }
    }, 3000);
  }

  function onPeerLeft() {
    stopHeartbeat();
    if (over) return;
    over = true;
    els.resultTitle.textContent = '对手断开了';
    els.resultDesc.textContent = '可以回到大厅重新开一局';
    els.result.hidden = false;
    renderStatus();
  }

  function closeRoom() {
    window.clearTimeout(joinTimer);
    stopHeartbeat();
    if (room) { room.close(); room = null; }
  }

  function startOnline(side) {
    window.clearTimeout(joinTimer);
    startHeartbeat();
    mode = 'online';
    mySide = side;
    state = G.create(15);
    over = false;
    els.result.hidden = true;
    showView('game');
    render();
    toast(side === 1 ? '你执黑，先落子' : '你执白，等黑方落子');
  }

  function startLocal() {
    closeRoom();
    mode = 'local';
    mySide = 0;
    state = G.create(15);
    over = false;
    els.result.hidden = true;
    showView('game');
    render();
    toast('本地双人：黑棋先走');
  }

  function backToLobby() {
    closeRoom();
    mode = 'none';
    mySide = 0;
    over = false;
    showView('lobby');
  }

  /* ---------------- 大厅交互 ---------------- */
  $('btn-host').addEventListener('click', function () {
    showView('code');
    els.roomCode.textContent = '--------';
    els.hostStatus.textContent = '正在生成房间号…';

    room = window.Net.create({
      host: true,
      prefix: PREFIX,
      onStatus: function (name, data) {
        if (name === 'code') {
          els.roomCode.textContent = data.code;
          els.hostStatus.textContent = '等待对手加入…';
        } else if (name === 'connected') {
          startOnline(1);
        } else if (name === 'error') {
          els.hostStatus.textContent = data.message;
        } else if (name === 'peer-left') {
          onPeerLeft();
        }
      },
      onData: onNetData
    });
  });

  $('btn-join').addEventListener('click', function () {
    showView('join');
    els.joinError.textContent = '';
    els.joinInput.value = '';
    els.joinInput.disabled = false;
    els.joinInput.focus();
  });

  function doJoin() {
    var code = (els.joinInput.value || '').replace(/\D/g, '');
    if (code.length !== 8) {
      els.joinError.textContent = '请输入完整的 8 位数字';
      return;
    }

    els.joinError.textContent = '';
    els.joinInput.disabled = true;
    closeRoom();

    room = window.Net.create({
      host: false,
      code: code,
      prefix: PREFIX,
      onStatus: function (name, data) {
        if (name === 'connected') {
          startOnline(2);
        } else if (name === 'error') {
          els.joinError.textContent = data.message;
          els.joinInput.disabled = false;
          closeRoom();
        } else if (name === 'peer-left') {
          onPeerLeft();
        }
      },
      onData: onNetData
    });

    window.clearTimeout(joinTimer);
    joinTimer = window.setTimeout(function () {
      if (!room || !room.connected) {
        els.joinError.textContent = '连接超时了，确认两边网络后重试';
        els.joinInput.disabled = false;
        closeRoom();
      }
    }, 25000);
  }

  $('btn-do-join').addEventListener('click', doJoin);
  els.joinInput.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 8);
  });
  els.joinInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doJoin();
  });

  $('btn-cancel-host').addEventListener('click', backToLobby);
  $('btn-cancel-join').addEventListener('click', backToLobby);
  $('btn-local').addEventListener('click', startLocal);

  $('btn-copy').addEventListener('click', function () {
    var code = els.roomCode.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { toast('已复制：' + code); },
        function () { toast('复制失败，请手动选择数字'); });
    } else {
      toast('复制失败，请手动选择数字');
    }
  });

  /* ---------------- 对局按钮 ---------------- */
  $('btn-resign').addEventListener('click', function () {
    if (over) return;
    if (isOnline()) {
      if (room) room.send({ t: 'resign' });
      over = true;
      els.resultTitle.textContent = '你认输了';
      els.resultDesc.textContent = '对手赢得这一局';
      els.result.hidden = false;
      renderStatus();
    } else {
      finish(state.turn === 1 ? 2 : 1);
    }
  });

  $('btn-again').addEventListener('click', function () {
    if (isOnline() && room) room.send({ t: 'restart' });
    resetBoard();
    toast('新的一局，黑棋先走');
  });

  $('btn-leave').addEventListener('click', backToLobby);
  $('btn-back-menu').addEventListener('click', backToLobby);

  /* ---------------- 启动 ---------------- */
  drawLines();
  state = G.create(15);
  render();
  showView('lobby');
}());
