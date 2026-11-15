/* ==========================================================================
   engine-gomoku.js —— 五子棋逻辑（无 DOM，可在 Node 里测试）
   1 = 黑（先手），2 = 白，0 = 空
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GomokuEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BLACK = 1;
  var WHITE = 2;
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function create(size) {
    var n = size || 15;
    var cells = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(0);
      cells.push(row);
    }
    return {
      size: n,
      cells: cells,
      turn: BLACK,
      winner: 0,
      winLine: null,
      over: false,
      moves: 0,
      last: null
    };
  }

  function inside(state, r, c) {
    return r >= 0 && r < state.size && c >= 0 && c < state.size;
  }

  /* 经过 (r,c) 的这条线上，同色连成多少个 */
  function lineThrough(state, r, c, dr, dc) {
    var s = state.cells[r][c];
    var line = [{ r: r, c: c }];
    var rr = r - dr, cc = c - dc;
    while (inside(state, rr, cc) && state.cells[rr][cc] === s) {
      line.unshift({ r: rr, c: cc });
      rr -= dr; cc -= dc;
    }
    rr = r + dr; cc = c + dc;
    while (inside(state, rr, cc) && state.cells[rr][cc] === s) {
      line.push({ r: rr, c: cc });
      rr += dr; cc += dc;
    }
    return line;
  }

  function findWin(state, r, c) {
    for (var i = 0; i < DIRS.length; i++) {
      var line = lineThrough(state, r, c, DIRS[i][0], DIRS[i][1]);
      if (line.length >= 5) return line;
    }
    return null;
  }

  /**
   * 落子。返回 { ok, win(0/1/2), line, draw }
   */
  function place(state, r, c) {
    if (state.over) return { ok: false, reason: 'over' };
    if (!inside(state, r, c)) return { ok: false, reason: 'out' };
    if (state.cells[r][c] !== 0) return { ok: false, reason: 'taken' };

    var side = state.turn;
    state.cells[r][c] = side;
    state.moves += 1;
    state.last = { r: r, c: c, side: side };

    var line = findWin(state, r, c);
    if (line) {
      state.winner = side;
      state.winLine = line;
      state.over = true;
      return { ok: true, win: side, line: line, draw: false };
    }

    if (state.moves >= state.size * state.size) {
      state.over = true;
      state.winner = 0;
      return { ok: true, win: 0, line: null, draw: true };
    }

    state.turn = side === BLACK ? WHITE : BLACK;
    return { ok: true, win: 0, line: null, draw: false };
  }

  function reset(state) {
    var fresh = create(state.size);
    state.cells = fresh.cells;
    state.turn = fresh.turn;
    state.winner = fresh.winner;
    state.winLine = fresh.winLine;
    state.over = fresh.over;
    state.moves = fresh.moves;
    state.last = fresh.last;
    return state;
  }

  function isFull(state) {
    for (var r = 0; r < state.size; r++) {
      for (var c = 0; c < state.size; c++) {
        if (state.cells[r][c] === 0) return false;
      }
    }
    return true;
  }

  return {
    BLACK: BLACK,
    WHITE: WHITE,
    DIRS: DIRS,
    create: create,
    place: place,
    reset: reset,
    isFull: isFull,
    inside: inside,
    findWin: findWin,
    lineThrough: lineThrough
  };
}));
