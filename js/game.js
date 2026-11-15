/* ==========================================================================
   game.js —— 2048 的界面层
   ========================================================================== */
(function () {
  'use strict';

  var E = window.Engine2048;
  if (!E) return;

  var boardEl = document.getElementById('board');
  var gridBg = document.getElementById('grid-bg');
  var tilesEl = document.getElementById('tiles');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var overlay = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlay-title');
  var overlayDesc = document.getElementById('overlay-desc');
  var btnRetry = document.getElementById('btn-retry');
  var btnKeep = document.getElementById('btn-keep');

  var BEST_KEY = 'xiaozhan.2048.best';

  var state = { grid: null, score: 0, won: false, over: false, busy: false };
  var els = new Map();
  var history = [];
  var metrics = { pad: 12, gap: 10, cell: 84 };
  var best = 0;

  try {
    best = parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
  } catch (err) {
    best = 0;
  }

  /* ---------------- 基础工具 ---------------- */

  function eachTile(grid, cb) {
    for (var r = 0; r < E.SIZE; r++) {
      for (var c = 0; c < E.SIZE; c++) {
        if (grid[r][c]) cb(grid[r][c], r, c);
      }
    }
  }

  function pos(r, c) {
    return {
      x: metrics.pad + c * (metrics.cell + metrics.gap),
      y: metrics.pad + r * (metrics.cell + metrics.gap)
    };
  }

  function fontSizeFor(value) {
    var digits = String(value).length;
    var ratio = digits <= 2 ? 0.42 : digits === 3 ? 0.35 : digits === 4 ? 0.29 : 0.24;
    return Math.max(11, Math.round(metrics.cell * ratio));
  }

  function measure() {
    var w = boardEl.clientWidth || 360;
    var pad = Math.round(w * 0.028);
    var gap = Math.round(w * 0.024);
    var cell = (w - pad * 2 - gap * 3) / 4;
    metrics = { pad: pad, gap: gap, cell: cell };
    boardEl.style.setProperty('--pad', pad + 'px');
    boardEl.style.setProperty('--gap', gap + 'px');
    boardEl.style.setProperty('--cell', cell + 'px');
  }

  function placeEl(el, r, c, animate) {
    var p = pos(r, c);
    if (!animate) el.style.transition = 'none';
    el.style.transform = 'translate3d(' + p.x + 'px, ' + p.y + 'px, 0)';
    if (!animate) {
      void el.offsetWidth;
      el.style.transition = '';
    }
  }

  function createTileEl(tile, r, c, animKind) {
    var el = document.createElement('div');
    el.className = 'tile';
    el.dataset.id = String(tile.id);
    el.dataset.v = tile.value > 2048 ? 'super' : String(tile.value);
    el.style.fontSize = fontSizeFor(tile.value) + 'px';

    var inner = document.createElement('div');
    inner.className = 'tile-inner';
    inner.textContent = String(tile.value);
    el.appendChild(inner);

    placeEl(el, r, c, false);
    tilesEl.appendChild(el);
    if (animKind) inner.classList.add(animKind);
    els.set(tile.id, el);
    return el;
  }

  function buildGridBg() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < E.SIZE * E.SIZE; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      frag.appendChild(cell);
    }
    gridBg.appendChild(frag);
  }

  /* ---------------- 渲染 ---------------- */

  function renderAll(withAppear) {
    tilesEl.innerHTML = '';
    els.clear();
    eachTile(state.grid, function (tile, r, c) {
      createTileEl(tile, r, c, withAppear ? 'appear' : null);
    });
  }

  function repositionAll() {
    eachTile(state.grid, function (tile, r, c) {
      var el = els.get(tile.id);
      if (!el) return;
      el.style.fontSize = fontSizeFor(tile.value) + 'px';
      placeEl(el, r, c, false);
    });
  }

  function animateMove(result, done) {
    var doomed = [];
    var pending = [];

    eachTile(result.grid, function (tile, r, c) {
      if (tile.sources && tile.sources.length > 1) {
        tile.sources.forEach(function (sid) {
          var srcEl = els.get(sid);
          if (srcEl) {
            placeEl(srcEl, r, c, true);
            doomed.push(srcEl);
          }
          els.delete(sid);
        });
        pending.push({ tile: tile, r: r, c: c });
      } else {
        var el = els.get(tile.id);
        if (el) placeEl(el, r, c, true);
        else createTileEl(tile, r, c, null);
      }
    });

    window.setTimeout(function () {
      doomed.forEach(function (el) { el.remove(); });
      pending.forEach(function (p) { createTileEl(p.tile, p.r, p.c, 'pop'); });
      if (done) done();
    }, 110);
  }

  /* ---------------- 分数 ---------------- */

  function updateScore() {
    scoreEl.textContent = String(state.score);
    scoreEl.classList.remove('bump');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('bump');

    if (state.score > best) {
      best = state.score;
      bestEl.textContent = String(best);
      try { window.localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* 忽略 */ }
    }
  }

  /* ---------------- 遮罩 ---------------- */

  function showOverlay(title, desc, mode) {
    overlayTitle.textContent = title;
    overlayDesc.textContent = desc;
    btnKeep.hidden = mode !== 'keep';
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  /* ---------------- 游戏流程 ---------------- */

  function newGame() {
    state = { grid: E.newGame().grid, score: 0, won: false, over: false, busy: false };
    history = [];
    hideOverlay();
    renderAll(true);
    scoreEl.textContent = '0';
    bestEl.textContent = String(best);
  }

  function snapshot() {
    return {
      grid: state.grid.map(function (row) {
        return row.map(function (t) { return t ? { id: t.id, value: t.value } : null; });
      }),
      score: state.score
    };
  }

  function shake() {
    boardEl.classList.remove('shake');
    void boardEl.offsetWidth;
    boardEl.classList.add('shake');
    window.setTimeout(function () { boardEl.classList.remove('shake'); }, 260);
  }

  function turn(dir) {
    if (state.busy || state.over) return;

    var result = E.move(state.grid, dir);
    if (!result.moved) {
      shake();
      return;
    }

    history.push(snapshot());
    if (history.length > 30) history.shift();

    state.grid = result.grid;
    state.score += result.gained;
    state.busy = true;
    updateScore();

    animateMove(result, function () {
      var spawned = E.spawn(state.grid);
      if (spawned) createTileEl(spawned.tile, spawned.r, spawned.c, 'appear');
      state.busy = false;
      checkState();
    });
  }

  function checkState() {
    if (E.maxTile(state.grid) >= 2048 && !state.won) {
      state.won = true;
      showOverlay('你赢了 🎉', '已经合出 2048，可以继续挑战更大的数字', 'keep');
      return;
    }
    if (!E.canMove(state.grid)) {
      state.over = true;
      showOverlay('游戏结束', '没有可以移动的方块了', 'retry');
    }
  }

  function undo() {
    if (!history.length || state.busy) return;
    var snap = history.pop();
    state.grid = snap.grid;
    state.score = snap.score;
    state.over = false;
    hideOverlay();
    renderAll(false);
    scoreEl.textContent = String(state.score);
  }

  /* ---------------- 输入 ---------------- */

  var KEYS = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    k: 'up', j: 'down', h: 'left', l: 'right'
  };

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var dir = KEYS[String(e.key).toLowerCase()];
    if (!dir) return;
    e.preventDefault();
    turn(dir);
  });

  var touchStart = null;

  boardEl.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  boardEl.addEventListener('touchend', function (e) {
    if (!touchStart) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
    else turn(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  boardEl.addEventListener('touchmove', function (e) {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  document.getElementById('btn-new').addEventListener('click', newGame);
  document.getElementById('btn-undo').addEventListener('click', undo);
  btnRetry.addEventListener('click', newGame);
  btnKeep.addEventListener('click', hideOverlay);

  /* ---------------- 启动 ---------------- */

  buildGridBg();
  measure();
  newGame();

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () {
      var before = metrics.cell;
      measure();
      if (Math.abs(before - metrics.cell) > 0.1) {
        boardEl.classList.add('no-anim');
        repositionAll();
        window.requestAnimationFrame(function () { boardEl.classList.remove('no-anim'); });
      }
    }).observe(boardEl);
  } else {
    window.addEventListener('resize', function () {
      measure();
      repositionAll();
    });
  }
}());
