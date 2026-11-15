/* ==========================================================================
   engine-snake.js —— 贪吃蛇逻辑（无 DOM，可在 Node 里测试）
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakeEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  function sameVec(a, b) { return a.x === b.x && a.y === b.y; }

  function occupied(state, x, y) {
    for (var i = 0; i < state.snake.length; i++) {
      if (state.snake[i].x === x && state.snake[i].y === y) return true;
    }
    return false;
  }

  function spawnFood(state, rng) {
    var free = [];
    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        if (!occupied(state, x, y)) free.push({ x: x, y: y });
      }
    }
    if (!free.length) { state.food = null; return false; }
    state.food = free[Math.floor(rng() * free.length) % free.length];
    return true;
  }

  function create(opts) {
    opts = opts || {};
    var cols = opts.cols || 20;
    var rows = opts.rows || 20;
    var rng = opts.rng || Math.random;
    var cx = Math.floor(cols / 2);
    var cy = Math.floor(rows / 2);

    var state = {
      cols: cols,
      rows: rows,
      snake: [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }],
      dir: { x: 1, y: 0 },
      queue: [],
      food: null,
      score: 0,
      alive: true,
      won: false,
      rng: rng
    };
    spawnFood(state, rng);
    return state;
  }

  /* 记下转向；和当前方向相反的直接丢弃 */
  function setDir(state, name) {
    var d = DIRS[name];
    if (!d) return false;
    var last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (sameVec(d, last)) return false;
    if (last.x + d.x === 0 && last.y + d.y === 0) return false; /* 不能 180° 掉头 */
    if (state.queue.length >= 2) return false;
    state.queue.push(d);
    return true;
  }

  /**
   * 走一步。返回 { moved, ate, dead, won }
   */
  function step(state) {
    if (!state.alive || state.won) return { moved: false, ate: false, dead: false, won: state.won };

    if (state.queue.length) state.dir = state.queue.shift();

    var head = state.snake[0];
    var nx = head.x + state.dir.x;
    var ny = head.y + state.dir.y;

    if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) {
      state.alive = false;
      return { moved: false, ate: false, dead: true, won: false };
    }

    var willEat = !!state.food && state.food.x === nx && state.food.y === ny;

    /* 尾巴这一格如果没吃到食物会空出来，可以进去 */
    var limit = willEat ? state.snake.length : state.snake.length - 1;
    for (var i = 0; i < limit; i++) {
      if (state.snake[i].x === nx && state.snake[i].y === ny) {
        state.alive = false;
        return { moved: false, ate: false, dead: true, won: false };
      }
    }

    state.snake.unshift({ x: nx, y: ny });
    if (willEat) {
      state.score += 1;
      var spawned = spawnFood(state, state.rng);
      if (!spawned) {
        state.won = true;
        return { moved: true, ate: true, dead: false, won: true };
      }
    } else {
      state.snake.pop();
    }

    return { moved: true, ate: willEat, dead: false, won: false };
  }

  return {
    DIRS: DIRS,
    create: create,
    setDir: setDir,
    step: step,
    spawnFood: spawnFood,
    occupied: occupied
  };
}));
