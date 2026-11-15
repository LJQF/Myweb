/* ==========================================================================
   engine2048.js —— 2048 的纯逻辑层（不依赖 DOM，可在 Node 里直接测试）
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine2048 = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 4;
  var nextId = 1;

  function createGrid() {
    var grid = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(null);
      grid.push(row);
    }
    return grid;
  }

  function makeTile(value) {
    return { id: nextId++, value: value };
  }

  function cloneGrid(grid) {
    return grid.map(function (row) {
      return row.map(function (t) {
        if (!t) return null;
        return { id: t.id, value: t.value };
      });
    });
  }

  function emptyCells(grid) {
    var out = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!grid[r][c]) out.push({ r: r, c: c });
      }
    }
    return out;
  }

  /* 在随机空格放一个新方块（2 的概率 90%，4 的概率 10%） */
  function spawn(grid, rng) {
    var random = rng || Math.random;
    var cells = emptyCells(grid);
    if (!cells.length) return null;
    var spot = cells[Math.floor(random() * cells.length) % cells.length];
    var tile = makeTile(random() < 0.9 ? 2 : 4);
    grid[spot.r][spot.c] = tile;
    return { r: spot.r, c: spot.c, tile: tile };
  }

  function newGame(rng) {
    var grid = createGrid();
    spawn(grid, rng);
    spawn(grid, rng);
    return { grid: grid, score: 0, won: false, over: false };
  }

  /* 每一行/列上，从移动方向的那一端开始数格子 */
  function lines(dir) {
    var out = [];
    var i, k;
    if (dir === 'left') {
      for (i = 0; i < SIZE; i++) {
        out.push([{ r: i, c: 0 }, { r: i, c: 1 }, { r: i, c: 2 }, { r: i, c: 3 }]);
      }
    } else if (dir === 'right') {
      for (i = 0; i < SIZE; i++) {
        out.push([{ r: i, c: 3 }, { r: i, c: 2 }, { r: i, c: 1 }, { r: i, c: 0 }]);
      }
    } else if (dir === 'up') {
      for (i = 0; i < SIZE; i++) {
        out.push([{ r: 0, c: i }, { r: 1, c: i }, { r: 2, c: i }, { r: 3, c: i }]);
      }
    } else if (dir === 'down') {
      for (i = 0; i < SIZE; i++) {
        out.push([{ r: 3, c: i }, { r: 2, c: i }, { r: 1, c: i }, { r: 0, c: i }]);
      }
    } else {
      throw new Error('unknown direction: ' + dir);
    }
    return out;
  }

  /**
   * 执行一次移动。
   * 返回 { grid, moved, gained }
   * 新 grid 里的每个方块：{ id, value, from:{r,c}, sources:[id...], merged:boolean }
   *   from    —— 动画起点（它原来所在的格子）
   *   sources —— 合成前的方块 id（用于让旧方块滑过去再消失）
   */
  function move(grid, dir) {
    var newGrid = createGrid();
    var groups = lines(dir);
    var moved = false;
    var gained = 0;

    for (var g = 0; g < groups.length; g++) {
      var cells = groups[g];
      var stack = [];

      for (var k = 0; k < cells.length; k++) {
        var cell = cells[k];
        var tile = grid[cell.r][cell.c];
        if (tile) stack.push({ tile: tile, r: cell.r, c: cell.c });
      }

      var out = [];
      var i = 0;
      while (i < stack.length) {
        var a = stack[i];
        var b = stack[i + 1];

        if (b && b.tile.value === a.tile.value) {
          var merged = makeTile(a.tile.value * 2);
          merged.from = { r: b.r, c: b.c };
          merged.sources = [a.tile.id, b.tile.id];
          merged.merged = true;
          out.push(merged);
          gained += merged.value;
          i += 2;
        } else {
          out.push({
            id: a.tile.id,
            value: a.tile.value,
            from: { r: a.r, c: a.c },
            sources: [a.tile.id],
            merged: false
          });
          i += 1;
        }
      }

      for (var d = 0; d < out.length; d++) {
        var dest = cells[d];
        var t = out[d];
        newGrid[dest.r][dest.c] = t;
        if (!t.from || t.from.r !== dest.r || t.from.c !== dest.c) moved = true;
      }
    }

    if (gained > 0) moved = true;
    return { grid: newGrid, moved: moved, gained: gained };
  }

  function canMove(grid) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var t = grid[r][c];
        if (!t) return true;
        if (c + 1 < SIZE && grid[r][c + 1] && grid[r][c + 1].value === t.value) return true;
        if (r + 1 < SIZE && grid[r + 1][c] && grid[r + 1][c].value === t.value) return true;
      }
    }
    return false;
  }

  function maxTile(grid) {
    var max = 0;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (grid[r][c] && grid[r][c].value > max) max = grid[r][c].value;
      }
    }
    return max;
  }

  return {
    SIZE: SIZE,
    createGrid: createGrid,
    makeTile: makeTile,
    cloneGrid: cloneGrid,
    emptyCells: emptyCells,
    spawn: spawn,
    newGame: newGame,
    move: move,
    canMove: canMove,
    maxTile: maxTile
  };
}));
