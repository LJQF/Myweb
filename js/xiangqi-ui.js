/* ==========================================================================
   xiangqi-ui.js —— 棋盘渲染、交互、房间界面
   ========================================================================== */
(function () {
  'use strict';

  var X = window.Xiangqi;
  if (!X) return;

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
    lines: $('lines'),
    marks: $('marks'),
    pieces: $('pieces'),
    turnDot: $('turn-dot'),
    turnLabel: $('turn-label'),
    sideLabel: $('side-label'),
    result: $('result'),
    resultTitle: $('result-title'),
    resultDesc: $('result-desc'),
    toast: $('toast')
  };

  var state = {
    board: X.initialBoard(),
    side: 'r',
    mode: 'none',     /* 'online' | 'local' */
    mySide: null,
    selected: null,
    legal: [],
    last: null,
    justMoved: null,
    over: false
  };

  var room = null;
  var joinTimer = 0;
  var toastTimer = 0;
  var hbTimer = 0;
  var lastSeen = 0;

  /* 心跳：对面直接关标签页时，WebRTC 可能很久才报断线，用 ping/pong 兜底 */
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

  function isOnline() { return state.mode === 'online'; }

  function canIMove() {
    if (state.over) return false;
    if (!isOnline()) return true;
    return state.mySide === state.side;
  }

  /* ---------------- 棋盘线 ---------------- */
  function drawLines() {
    var parts = [];
    var i, x;

    for (i = 0; i < 10; i++) {
      parts.push('<line x1="0.5" y1="' + (0.5 + i) + '" x2="8.5" y2="' + (0.5 + i) + '"/>');
    }
    for (i = 0; i < 9; i++) {
      x = 0.5 + i;
      if (i === 0 || i === 8) {
        parts.push('<line x1="' + x + '" y1="0.5" x2="' + x + '" y2="9.5"/>');
      } else {
        parts.push('<line x1="' + x + '" y1="0.5" x2="' + x + '" y2="4.5"/>');
        parts.push('<line x1="' + x + '" y1="5.5" x2="' + x + '" y2="9.5"/>');
      }
    }
    /* 九宫斜线 */
    parts.push('<line x1="3.5" y1="0.5" x2="5.5" y2="2.5"/>');
    parts.push('<line x1="5.5" y1="0.5" x2="3.5" y2="2.5"/>');
    parts.push('<line x1="3.5" y1="7.5" x2="5.5" y2="9.5"/>');
    parts.push('<line x1="5.5" y1="7.5" x2="3.5" y2="9.5"/>');

    els.lines.innerHTML =
      '<g stroke="rgba(92,64,24,.72)" stroke-width="0.018" stroke-linecap="round" fill="none">' + parts.join('') + '</g>' +
      '<rect x="0.5" y="0.5" width="8" height="9" fill="none" stroke="rgba(92,64,24,.85)" stroke-width="0.032"/>' +
      '<text x="2.4" y="5.05" text-anchor="middle" dominant-baseline="middle" font-size="0.4" font-family="serif" fill="rgba(92,64,24,.42)">楚 河</text>' +
      '<text x="6.6" y="5.05" text-anchor="middle" dominant-baseline="middle" font-size="0.4" font-family="serif" fill="rgba(92,64,24,.42)">汉 界</text>';
  }

  function measure() {
    var w = els.board.clientWidth || 480;
    els.board.style.setProperty('--cell', (w / 9) + 'px');
  }

  /* ---------------- 渲染 ---------------- */
  function renderPieces() {
    var frag = document.createDocumentFragment();
    var r, c, p, el, disc;

    for (r = 0; r < X.ROWS; r++) {
      for (c = 0; c < X.COLS; c++) {
        p = state.board[r][c];
        if (!p) continue;

        el = document.createElement('div');
        el.className = 'piece ' + (p.s === 'r' ? 'red' : 'black');
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.style.left = (c * 100 / X.COLS) + '%';
        el.style.top = (r * 100 / X.ROWS) + '%';

        if (state.selected && state.selected.r === r && state.selected.c === c) el.classList.add('sel');
        if (state.justMoved && state.justMoved.r === r && state.justMoved.c === c) el.classList.add('moved');

        disc = document.createElement('div');
        disc.className = 'disc';
        disc.textContent = X.nameOf(p);
        el.appendChild(disc);
        frag.appendChild(el);
      }
    }

    els.pieces.innerHTML = '';
    els.pieces.appendChild(frag);
    state.justMoved = null;
  }

  function addMark(pos, cls) {
    var el = document.createElement('div');
    el.className = 'mark ' + cls;
    el.style.left = (pos.c * 100 / X.COLS) + '%';
    el.style.top = (pos.r * 100 / X.ROWS) + '%';
    els.marks.appendChild(el);
  }

  function renderMarks() {
    els.marks.innerHTML = '';
    if (state.last) {
      addMark(state.last.from, 'last');
      addMark(state.last.to, 'last');
    }
    state.legal.forEach(function (m) {
      addMark(m.to, state.board[m.to.r][m.to.c] ? 'cap' : 'dot');
    });
  }

  function renderStatus() {
    var online = isOnline();
    var myTurn = canIMove();

    if (state.over) {
      els.turnLabel.textContent = '对局结束';
      els.turnDot.className = 'dot over';
    } else {
      els.turnLabel.textContent = (state.side === 'r' ? '红方走棋' : '黑方走棋') +
        (online ? (myTurn ? '（你）' : '（对手）') : '');
      els.turnDot.className = 'dot' + (state.side === 'b' ? ' black' : '');
    }

    els.sideLabel.textContent = online ? (state.mySide === 'r' ? '你执红' : '你执黑') : '本地双人';
    els.board.classList.toggle('locked', !myTurn);
  }

  function render() {
    renderPieces();
    renderMarks();
    renderStatus();
  }

  /* ---------------- 走子 ---------------- */
  function applyResult(res, from, to, silent) {
    state.board = res.board;
    state.last = { from: from, to: to };
    state.selected = null;
    state.legal = [];
    state.justMoved = to;
    state.side = X.other(state.side);
    state.over = res.over;

    render();
    if (res.over) finish(res.winner);
    else if (res.checked && !silent) toast('将军！');
  }

  function doMove(from, to) {
    var res = X.play(state.board, state.side, from, to);
    if (!res.ok) {
      toast('这步棋走不了');
      return;
    }
    applyResult(res, from, to);
    if (isOnline()) room.send({ t: 'mv', f: [from.r, from.c], to: [to.r, to.c] });
  }

  function onCell(r, c) {
    if (!canIMove()) return;

    if (state.selected) {
      var hit = state.legal.filter(function (m) { return m.to.r === r && m.to.c === c; })[0];
      if (hit) { doMove(state.selected, { r: r, c: c }); return; }
    }

    var piece = state.board[r][c];
    if (piece && piece.s === state.side) {
      state.selected = { r: r, c: c };
      state.legal = X.movesFrom(state.board, state.side, { r: r, c: c });
    } else {
      state.selected = null;
      state.legal = [];
    }
    render();
  }

  function cellFromEvent(e) {
    var rect = els.board.getBoundingClientRect();
    var c = Math.floor((e.clientX - rect.left) / rect.width * X.COLS);
    var r = Math.floor((e.clientY - rect.top) / rect.height * X.ROWS);
    if (r < 0 || r >= X.ROWS || c < 0 || c >= X.COLS) return null;
    return { r: r, c: c };
  }

  els.board.addEventListener('click', function (e) {
    var pos = cellFromEvent(e);
    if (pos) onCell(pos.r, pos.c);
  });

  /* ---------------- 结束 ---------------- */
  function showResult(title, desc) {
    els.resultTitle.textContent = title;
    els.resultDesc.textContent = desc;
    els.result.hidden = false;
    state.over = true;
    renderStatus();
  }

  function finish(winner) {
    state.over = true;
    if (isOnline()) {
      showResult(winner === state.mySide ? '你赢了 🎉' : '你输了',
        winner === 'r' ? '红方获胜' : '黑方获胜');
    } else {
      showResult((winner === 'r' ? '红方' : '黑方') + '胜', '对手已被将死或没有棋可走');
    }
  }

  function resetBoard() {
    state.board = X.initialBoard();
    state.side = 'r';
    state.selected = null;
    state.legal = [];
    state.last = null;
    state.justMoved = null;
    state.over = false;
    els.result.hidden = true;
    render();
  }

  /* ---------------- 联机消息 ---------------- */
  function onNetData(msg) {
    if (!msg || !msg.t) return;

    lastSeen = Date.now();
    if (msg.t === 'ping') { if (room) room.send({ t: 'pong' }); return; }
    if (msg.t === 'pong') return;

    if (msg.t === 'mv') {
      var from = { r: msg.f[0], c: msg.f[1] };
      var to = { r: msg.to[0], c: msg.to[1] };
      var res = X.play(state.board, state.side, from, to);
      if (res.ok) applyResult(res, from, to, true);
      else toast('收到一步不合法的棋，已忽略');
      return;
    }

    if (msg.t === 'resign') {
      if (!state.over) {
        state.over = true;
        showResult('对手认输了', '你赢了这一局');
      }
      return;
    }

    if (msg.t === 'restart') {
      resetBoard();
      toast('对手重新开始了一局');
    }
  }

  function onPeerLeft() {
    stopHeartbeat();
    if (state.over) return;
    state.over = true;
    showResult('对手断开了', '可以回到大厅重新开一局');
  }

  /* ---------------- 大厅交互 ---------------- */
  function closeRoom() {
    window.clearTimeout(joinTimer);
    stopHeartbeat();
    if (room) { room.close(); room = null; }
  }

  function startOnline(mySide) {
    window.clearTimeout(joinTimer);
    startHeartbeat();
    state.mode = 'online';
    state.mySide = mySide;
    resetBoard();
    showView('game');
    measure();
    render();
    toast(mySide === 'r' ? '你执红，先走' : '你执黑，等红方先走');
  }

  function startLocal() {
    closeRoom();
    state.mode = 'local';
    state.mySide = null;
    resetBoard();
    showView('game');
    measure();
    render();
    toast('本地双人：红方先走');
  }

  function backToLobby() {
    closeRoom();
    state.mode = 'none';
    state.mySide = null;
    showView('lobby');
  }

  $('btn-host').addEventListener('click', function () {
    showView('code');
    els.roomCode.textContent = '--------';
    els.hostStatus.textContent = '正在生成房间号…';

    room = window.Net.create({
      host: true,
      onStatus: function (name, data) {
        if (name === 'code') {
          els.roomCode.textContent = data.code;
          els.hostStatus.textContent = '等待对手加入…';
        } else if (name === 'connected') {
          startOnline('r');
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
      onStatus: function (name, data) {
        if (name === 'connected') {
          startOnline('b');
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
    var done = function () { toast('已复制：' + code); };
    var fail = function () { toast('复制失败，请手动长按选择数字'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, fail);
    } else {
      fail();
    }
  });

  /* ---------------- 对局按钮 ---------------- */
  $('btn-resign').addEventListener('click', function () {
    if (state.over) return;
    if (isOnline()) {
      room.send({ t: 'resign' });
      state.over = true;
      showResult('你认输了', '对手赢得这一局');
    } else {
      state.over = true;
      showResult((state.side === 'r' ? '黑方' : '红方') + '胜', '对方认输');
    }
  });

  $('btn-leave').addEventListener('click', backToLobby);
  $('btn-back-menu').addEventListener('click', backToLobby);

  $('btn-again').addEventListener('click', function () {
    if (isOnline()) {
      if (room) room.send({ t: 'restart' });
      resetBoard();
      toast('新的一局，红方先走');
    } else {
      resetBoard();
      toast('新的一局，红方先走');
    }
  });

  /* ---------------- 启动 ---------------- */
  drawLines();
  measure();
  render();

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(measure).observe(els.board);
  } else {
    window.addEventListener('resize', measure);
  }
}());
