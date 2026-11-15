/* ==========================================================================
   engine-sokoban.js —— 推箱子逻辑 + 关卡（无 DOM，可在 Node 里测试）
   地图字符： # 墙   空格 地板   . 目标   $ 箱子   * 箱子在目标上
              @ 玩家  + 玩家在目标上
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SokobanEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };

  var LEVELS = [
    /* 1 —— 往下推一格 */
    '#######\n' +
    '#     #\n' +
    '#  $  #\n' +
    '#  .  #\n' +
    '#  @  #\n' +
    '#######',

    /* 2 —— 必须先绕到上面 */
    '#########\n' +
    '#       #\n' +
    '#  $    #\n' +
    '#  #    #\n' +
    '#  .    #\n' +
    '#   @   #\n' +
    '#########',

    /* 3 —— 两个箱子 */
    '#########\n' +
    '#       #\n' +
    '# $   $ #\n' +
    '# .   . #\n' +
    '#   @   #\n' +
    '#########',

    /* 4 —— 绕墙推 */
    '#########\n' +
    '#       #\n' +
    '#  ###  #\n' +
    '#  $ .  #\n' +
    '#  #    #\n' +
    '#  @    #\n' +
    '#########',

    /* 5 —— 要绕一大圈 */
    '#########\n' +
    '#   #   #\n' +
    '# $ # . #\n' +
    '#       #\n' +
    '#   @   #\n' +
    '#########',

    /* 6 —— 并排两个 */
    '##########\n' +
    '#        #\n' +
    '#  $  $  #\n' +
    '#        #\n' +
    '#  .  .  #\n' +
    '#    @   #\n' +
    '##########',

    /* 7 —— 三个箱子 */
    '###########\n' +
    '#         #\n' +
    '#  $ $ $  #\n' +
    '#         #\n' +
    '#  . . .  #\n' +
    '#    @    #\n' +
    '###########',

    /* 8 —— 窄道 */
    '#########\n' +
    '#       #\n' +
    '#  ###  #\n' +
    '#  $.#  #\n' +
    '#  ###  #\n' +
    '#  @    #\n' +
    '#########'
  ];

  function parse(map) {
    var lines = String(map).replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();

    var rows = lines.length;
    var cols = 0;
    var r, c;
    for (r = 0; r < rows; r++) cols = Math.max(cols, lines[r].length);

    var walls = [];
    var goals = [];
    var boxes = [];
    var player = null;

    for (r = 0; r < rows; r++) {
      var wRow = [];
      var gRow = [];
      for (c = 0; c < cols; c++) {
        var ch = lines[r][c] || ' ';
        var isWall = ch === '#';
        var isGoal = ch === '.' || ch === '*' || ch === '+';
        wRow.push(isWall);
        gRow.push(isGoal);
        if (ch === '$' || ch === '*') boxes.push({ r: r, c: c });
        if (ch === '@' || ch === '+') player = { r: r, c: c };
      }
      walls.push(wRow);
      goals.push(gRow);
    }

    return { rows: rows, cols: cols, walls: walls, goals: goals, boxes: boxes, player: player };
  }

  function load(levelIndex) {
    var data = parse(LEVELS[levelIndex]);
    return {
      index: levelIndex,
      rows: data.rows,
      cols: data.cols,
      walls: data.walls,
      goals: data.goals,
      boxes: data.boxes,
      player: data.player,
      moves: 0,
      pushes: 0,
      history: []
    };
  }

  function inside(state, r, c) {
    return r >= 0 && r < state.rows && c >= 0 && c < state.cols;
  }

  function isWall(state, r, c) {
    if (!inside(state, r, c)) return true;
    return state.walls[r][c];
  }

  function isGoal(state, r, c) {
    return inside(state, r, c) && state.goals[r][c];
  }

  function boxAt(state, r, c) {
    for (var i = 0; i < state.boxes.length; i++) {
      if (state.boxes[i].r === r && state.boxes[i].c === c) return i;
    }
    return -1;
  }

  function snapshot(state) {
    return {
      boxes: state.boxes.map(function (b) { return { r: b.r, c: b.c }; }),
      player: { r: state.player.r, c: state.player.c },
      moves: state.moves,
      pushes: state.pushes
    };
  }

  function restore(state, snap) {
    state.boxes = snap.boxes.map(function (b) { return { r: b.r, c: b.c }; });
    state.player = { r: snap.player.r, c: snap.player.c };
    state.moves = snap.moves;
    state.pushes = snap.pushes;
  }

  /**
   * 走一步。返回 { moved, pushed, solved }
   */
  function move(state, dirName) {
    var d = DIRS[dirName];
    if (!d) return { moved: false, pushed: false, solved: false };

    var nr = state.player.r + d.dr;
    var nc = state.player.c + d.dc;
    if (isWall(state, nr, nc)) return { moved: false, pushed: false, solved: false };

    var bi = boxAt(state, nr, nc);

    if (bi >= 0) {
      var br = nr + d.dr;
      var bc = nc + d.dc;
      if (isWall(state, br, bc) || boxAt(state, br, bc) >= 0) {
        return { moved: false, pushed: false, solved: false };
      }
      state.history.push(snapshot(state));
      if (state.history.length > 400) state.history.shift();

      state.boxes[bi] = { r: br, c: bc };
      state.player = { r: nr, c: nc };
      state.moves += 1;
      state.pushes += 1;
      return { moved: true, pushed: true, solved: isSolved(state) };
    }

    state.history.push(snapshot(state));
    if (state.history.length > 400) state.history.shift();

    state.player = { r: nr, c: nc };
    state.moves += 1;
    return { moved: true, pushed: false, solved: isSolved(state) };
  }

  function undo(state) {
    if (!state.history.length) return false;
    restore(state, state.history.pop());
    return true;
  }

  function isSolved(state) {
    for (var i = 0; i < state.boxes.length; i++) {
      if (!isGoal(state, state.boxes[i].r, state.boxes[i].c)) return false;
    }
    return state.boxes.length > 0;
  }

  function reset(state) {
    var fresh = load(state.index);
    state.boxes = fresh.boxes;
    state.player = fresh.player;
    state.moves = 0;
    state.pushes = 0;
    state.history = [];
    return state;
  }

  return {
    DIRS: DIRS,
    LEVELS: LEVELS,
    levelCount: LEVELS.length,
    parse: parse,
    load: load,
    move: move,
    undo: undo,
    reset: reset,
    isSolved: isSolved,
    isGoal: isGoal,
    isWall: isWall,
    boxAt: boxAt,
    inside: inside
  };
}));
