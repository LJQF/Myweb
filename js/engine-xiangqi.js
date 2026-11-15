/* ==========================================================================
   engine-xiangqi.js —— 中国象棋规则引擎（无 DOM，可在 Node 里测试）
   棋盘 10 行 × 9 列，row 0 在上（黑方底线），row 9 在下（红方底线）
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xiangqi = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROWS = 10;
  var COLS = 9;

  /* 红黑两边的棋子叫法不同 */
  var NAMES = {
    r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
    b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' }
  };

  function cell(t, s) { return { t: t, s: s }; }

  function emptyBoard() {
    var b = [], r, c;
    for (r = 0; r < ROWS; r++) {
      var row = [];
      for (c = 0; c < COLS; c++) row.push(null);
      b.push(row);
    }
    return b;
  }

  function initialBoard() {
    var b = emptyBoard();
    var back = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
    var c, i;
    for (c = 0; c < COLS; c++) {
      b[0][c] = cell(back[c], 'b');
      b[9][c] = cell(back[c], 'r');
    }
    b[2][1] = cell('C', 'b'); b[2][7] = cell('C', 'b');
    b[7][1] = cell('C', 'r'); b[7][7] = cell('C', 'r');
    for (i = 0; i < 5; i++) {
      b[3][i * 2] = cell('P', 'b');
      b[6][i * 2] = cell('P', 'r');
    }
    return b;
  }

  function cloneBoard(b) {
    return b.map(function (row) { return row.slice(); });
  }

  function inside(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  function other(s) { return s === 'r' ? 'b' : 'r'; }
  function inPalace(r, c, s) {
    if (c < 3 || c > 5) return false;
    return s === 'r' ? r >= 7 : r <= 2;
  }
  function acrossRiver(r, s) { return s === 'r' ? r <= 4 : r >= 5; }

  var ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var HORSE = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];

  /* ---------- 单个棋子的走法 ---------- */
  function movesOf(board, r, c, out) {
    var p = board[r][c];
    if (!p) return;
    var side = p.s;
    var i, nr, nc, q, dr, dc, rr, cc;

    function add(tr, tc) {
      if (!inside(tr, tc)) return;
      var target = board[tr][tc];
      if (target && target.s === side) return;
      out.push({ from: { r: r, c: c }, to: { r: tr, c: tc } });
    }

    if (p.t === 'R') {
      for (i = 0; i < 4; i++) {
        dr = ORTHO[i][0]; dc = ORTHO[i][1];
        rr = r + dr; cc = c + dc;
        while (inside(rr, cc)) {
          q = board[rr][cc];
          if (!q) {
            out.push({ from: { r: r, c: c }, to: { r: rr, c: cc } });
          } else {
            if (q.s !== side) out.push({ from: { r: r, c: c }, to: { r: rr, c: cc } });
            break;
          }
          rr += dr; cc += dc;
        }
      }
      return;
    }

    if (p.t === 'C') {
      for (i = 0; i < 4; i++) {
        dr = ORTHO[i][0]; dc = ORTHO[i][1];
        rr = r + dr; cc = c + dc;
        /* 不吃子时和车一样走空格 */
        while (inside(rr, cc) && !board[rr][cc]) {
          out.push({ from: { r: r, c: c }, to: { r: rr, c: cc } });
          rr += dr; cc += dc;
        }
        /* 越过炮架，打第一个碰到的棋子 */
        rr += dr; cc += dc;
        while (inside(rr, cc)) {
          q = board[rr][cc];
          if (q) {
            if (q.s !== side) out.push({ from: { r: r, c: c }, to: { r: rr, c: cc } });
            break;
          }
          rr += dr; cc += dc;
        }
      }
      return;
    }

    if (p.t === 'N') {
      for (i = 0; i < HORSE.length; i++) {
        var hr = HORSE[i][0], hc = HORSE[i][1];
        nr = r + hr; nc = c + hc;
        if (!inside(nr, nc)) continue;
        /* 蹩马腿：正前方那格必须空 */
        var legR = r + (Math.abs(hr) === 2 ? hr / 2 : 0);
        var legC = c + (Math.abs(hc) === 2 ? hc / 2 : 0);
        if (board[legR][legC]) continue;
        add(nr, nc);
      }
      return;
    }

    if (p.t === 'B') {
      for (i = 0; i < DIAG.length; i++) {
        nr = r + DIAG[i][0] * 2;
        nc = c + DIAG[i][1] * 2;
        if (!inside(nr, nc)) continue;
        if (board[r + DIAG[i][0]][c + DIAG[i][1]]) continue; /* 塞象眼 */
        if (acrossRiver(nr, side)) continue;                   /* 象不过河 */
        add(nr, nc);
      }
      return;
    }

    if (p.t === 'A') {
      for (i = 0; i < DIAG.length; i++) {
        nr = r + DIAG[i][0];
        nc = c + DIAG[i][1];
        if (!inside(nr, nc)) continue;
        if (!inPalace(nr, nc, side)) continue;
        add(nr, nc);
      }
      return;
    }

    if (p.t === 'K') {
      for (i = 0; i < 4; i++) {
        nr = r + ORTHO[i][0];
        nc = c + ORTHO[i][1];
        if (!inside(nr, nc)) continue;
        if (!inPalace(nr, nc, side)) continue;
        add(nr, nc);
      }
      return;
    }

    if (p.t === 'P') {
      var fwd = side === 'r' ? -1 : 1;
      add(r + fwd, c);
      if (acrossRiver(r, side)) {
        add(r, c - 1);
        add(r, c + 1);
      }
      return;
    }
  }

  function pseudoMoves(board, side) {
    var out = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = board[r][c];
        if (p && p.s === side) movesOf(board, r, c, out);
      }
    }
    return out;
  }

  function findGeneral(board, side) {
    var r, c, p;
    for (r = 0; r < ROWS; r++) {
      for (c = 3; c <= 5; c++) {
        p = board[r][c];
        if (p && p.t === 'K' && p.s === side) return { r: r, c: c };
      }
    }
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        p = board[r][c];
        if (p && p.t === 'K' && p.s === side) return { r: r, c: c };
      }
    }
    return null;
  }

  /* 白脸将：两将同列且中间无子 */
  function generalsFacing(board) {
    var a = findGeneral(board, 'r');
    var b = findGeneral(board, 'b');
    if (!a || !b || a.c !== b.c) return false;
    var lo = Math.min(a.r, b.r);
    var hi = Math.max(a.r, b.r);
    for (var r = lo + 1; r < hi; r++) {
      if (board[r][a.c]) return false;
    }
    return true;
  }

  function attacked(board, r, c, bySide) {
    var moves = pseudoMoves(board, bySide);
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].to.r === r && moves[i].to.c === c) return true;
    }
    return false;
  }

  function inCheck(board, side) {
    var g = findGeneral(board, side);
    if (!g) return true;
    if (attacked(board, g.r, g.c, other(side))) return true;
    return generalsFacing(board);
  }

  function applyMove(board, from, to) {
    var nb = board.map(function (row) { return row.slice(); });
    nb[to.r][to.c] = nb[from.r][from.c];
    nb[from.r][from.c] = null;
    return nb;
  }

  function sameSquare(a, b) { return a.r === b.r && a.c === b.c; }

  function legalMoves(board, side) {
    var all = pseudoMoves(board, side);
    var res = [];
    for (var i = 0; i < all.length; i++) {
      var nb = applyMove(board, all[i].from, all[i].to);
      if (inCheck(nb, side)) continue;
      if (generalsFacing(nb)) continue;
      res.push(all[i]);
    }
    return res;
  }

  function movesFrom(board, side, from) {
    return legalMoves(board, side).filter(function (m) { return sameSquare(m.from, from); });
  }

  function findMove(board, side, from, to) {
    var all = legalMoves(board, side);
    for (var i = 0; i < all.length; i++) {
      if (sameSquare(all[i].from, from) && sameSquare(all[i].to, to)) return all[i];
    }
    return null;
  }

  /**
   * 走一步棋。返回 { ok, board, captured, checked, over, winner }
   * over/winner 是走完之后对手的状态
   */
  function play(board, side, from, to) {
    var move = findMove(board, side, from, to);
    if (!move) return { ok: false, reason: 'illegal' };

    var nb = applyMove(board, from, to);
    var captured = board[to.r][to.c] || null;
    var opp = other(side);

    var oppMoves = legalMoves(nb, opp);
    var checked = inCheck(nb, opp);
    var over = oppMoves.length === 0;

    return {
      ok: true,
      board: nb,
      move: move,
      captured: captured,
      checked: checked,
      over: over,
      winner: over ? side : null,
      moves: oppMoves
    };
  }

  function countPieces(board, side) {
    var n = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (board[r][c] && board[r][c].s === side) n++;
      }
    }
    return n;
  }

  function nameOf(piece) {
    return piece ? NAMES[piece.s][piece.t] : '';
  }

  return {
    ROWS: ROWS,
    COLS: COLS,
    NAMES: NAMES,
    cell: cell,
    emptyBoard: emptyBoard,
    initialBoard: initialBoard,
    cloneBoard: cloneBoard,
    inside: inside,
    other: other,
    inPalace: inPalace,
    acrossRiver: acrossRiver,
    movesOf: movesOf,
    pseudoMoves: pseudoMoves,
    legalMoves: legalMoves,
    movesFrom: movesFrom,
    findMove: findMove,
    findGeneral: findGeneral,
    generalsFacing: generalsFacing,
    attacked: attacked,
    inCheck: inCheck,
    applyMove: applyMove,
    play: play,
    countPieces: countPieces,
    nameOf: nameOf
  };
}));
