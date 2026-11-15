/* ==========================================================================
   sokoban-game.js —— 推箱子界面
   ========================================================================== */
(function () {
  'use strict';

  var S = window.SokobanEngine;
  if (!S) return;

  var $ = function (id) { return document.getElementById(id); };

  var stage = $('stage');
  var tiles = $('tiles');
  var actors = $('actors');
  var overlay = $('overlay');
  var ovTitle = $('ov-title');
  var ovDesc = $('ov-desc');
  var btnNext = $('btn-next');
  var btnReplay = $('btn-replay');
  var levelNo = $('level-no');
  var levelTotal = $('level-total');
  var movesEl = $('moves');
  var pushesEl = $('pushes');
  var btnPrev = $('btn-prev');
  var btnUndo = $('btn-undo');
  var btnReset = $('btn-reset');
  var btnNextLv = $('btn-next-lv');

  var LEVEL_KEY = 'xiaozhan.sokoban.level';

  var state = null;
  var boxEls = [];
  var playerEl = null;
  var solved = false;

  levelTotal.textContent = String(S.levelCount);

  function savedLevel() {
    var v = 0;
    try { v = parseInt(window.localStorage.getItem(LEVEL_KEY), 10) || 0; } catch (e) { v = 0; }
    if (v < 0 || v >= S.levelCount) v = 0;
    return v;
  }

  function place(el, r, c) {
    el.style.left = (c * 100 / state.cols) + '%';
    el.style.top = (r * 100 / state.rows) + '%';
    el.style.width = (100 / state.cols) + '%';
    el.style.height = (100 / state.rows) + '%';
  }

  function buildLevel(index) {
    state = S.load(index);
    solved = false;
    overlay.hidden = true;

    stage.style.aspectRatio = state.cols + ' / ' + state.rows;

    tiles.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        var cell = document.createElement('div');
        cell.className = 'tile ' + (state.walls[r][c] ? 'wall' : 'floor');
        place(cell, r, c);
        if (state.goals[r][c]) {
          var dot = document.createElement('div');
          dot.className = 'goal-dot';
          cell.appendChild(dot);
        }
        frag.appendChild(cell);
      }
    }
    tiles.appendChild(frag);

    actors.innerHTML = '';
    boxEls = [];
    for (var i = 0; i < state.boxes.length; i++) {
      var wrap = document.createElement('div');
      wrap.className = 'actor';
      var box = document.createElement('div');
      box.className = 'box';
      wrap.appendChild(box);
      actors.appendChild(wrap);
      boxEls.push(wrap);
    }

    playerEl = document.createElement('div');
    playerEl.className = 'actor';
    var face = document.createElement('div');
    face.className = 'player';
    playerEl.appendChild(face);
    actors.appendChild(playerEl);

    layout();
    updateHud();

    levelNo.textContent = String(index + 1);
    btnPrev.disabled = index === 0;
    btnNextLv.disabled = index >= S.levelCount - 1;

    try { window.localStorage.setItem(LEVEL_KEY, String(index)); } catch (e) { /* 忽略 */ }
  }

  function layout() {
    for (var i = 0; i < state.boxes.length; i++) {
      var b = state.boxes[i];
      place(boxEls[i], b.r, b.c);
      boxEls[i].firstChild.classList.toggle('on-goal', S.isGoal(state, b.r, b.c));
    }
    place(playerEl, state.player.r, state.player.c);
  }

  function updateHud() {
    movesEl.textContent = String(state.moves);
    pushesEl.textContent = String(state.pushes);
  }

  function tryMove(dir) {
    if (!state || solved) return;
    var res = S.move(state, dir);
    if (!res.moved) return;

    layout();
    updateHud();

    if (res.solved) {
      solved = true;
      window.setTimeout(showWin, 240);
    }
  }

  function showWin() {
    var last = state.index >= S.levelCount - 1;
    ovTitle.textContent = '过关！';
    ovDesc.textContent = last
      ? '全部 ' + S.levelCount + ' 关都通了！最后一关用了 ' + state.moves + ' 步'
      : '第 ' + (state.index + 1) + ' 关 · 用了 ' + state.moves + ' 步（推 ' + state.pushes + ' 次）';
    btnNext.hidden = false;
    btnNext.textContent = last ? '回到第一关' : '下一关';
    overlay.hidden = false;
  }

  function undo() {
    if (!state) return;
    if (S.undo(state)) {
      solved = false;
      overlay.hidden = true;
      layout();
      updateHud();
    }
  }

  function restart() {
    if (!state) return;
    S.reset(state);
    solved = false;
    overlay.hidden = true;
    layout();
    updateHud();
  }

  function goto(index) {
    var n = index;
    if (n < 0) n = 0;
    if (n >= S.levelCount) n = 0;
    buildLevel(n);
  }

  /* ---------------- 输入 ---------------- */
  var KEYS = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', k: 'up', j: 'down', h: 'left', l: 'right'
  };

  window.addEventListener('keydown', function (e) {
    var k = String(e.key).toLowerCase();

    if (k === 'z') { e.preventDefault(); undo(); return; }
    if (k === 'r') { e.preventDefault(); restart(); return; }

    var dir = KEYS[k];
    if (!dir) return;
    e.preventDefault();
    tryMove(dir);
  });

  var touchStart = null;

  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  stage.addEventListener('touchend', function (e) {
    if (!touchStart) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStart.x;
    var dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) tryMove(dx > 0 ? 'right' : 'left');
    else tryMove(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  stage.addEventListener('touchmove', function (e) {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  var pad = document.querySelector('.pad');
  if (pad) {
    pad.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-dir]');
      if (btn) tryMove(btn.dataset.dir);
    });
  }

  btnPrev.addEventListener('click', function () { goto(state.index - 1); });
  btnNextLv.addEventListener('click', function () { goto(state.index + 1); });
  btnUndo.addEventListener('click', undo);
  btnReset.addEventListener('click', restart);
  btnReplay.addEventListener('click', restart);
  btnNext.addEventListener('click', function () { goto(state.index + 1); });

  buildLevel(savedLevel());
}());
