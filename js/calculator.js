/* ==========================================================================
   calculator.js —— 计算器（复用 expr.js 的解析器）
   ========================================================================== */
(function () {
  'use strict';

  var Expr = window.Expr;
  if (!Expr) return;

  var input = document.getElementById('expr');
  var preview = document.getElementById('preview');
  var histEl = document.getElementById('history');
  var histEmpty = document.getElementById('hist-empty');
  var keypad = document.getElementById('keypad');
  var chips = document.getElementById('chips');

  var history = [];
  var HIST_MAX = 30;

  /* ---------------- 数字格式化 ---------------- */
  function fmt(v) {
    if (!isFinite(v)) return v > 0 ? '∞' : '−∞';
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e12 || a < 1e-6)) {
      return v.toExponential(6).replace(/\.?0+e/, 'e');
    }
    var s = parseFloat(v.toPrecision(12));
    return s.toLocaleString('en-US', { maximumFractionDigits: 10 });
  }

  /* 写回输入框要用能再解析回来的纯数字 */
  function raw(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    return String(parseFloat(v.toPrecision(12)));
  }

  /* ---------------- 预览 ---------------- */
  function updatePreview() {
    var src = input.value.trim();
    preview.classList.remove('error');

    if (!src) { preview.textContent = ''; return; }

    var r = Expr.compile(src);
    if (!r.ok) { preview.textContent = ''; return; }

    var v = r.fn(0);
    preview.textContent = isFinite(v) ? '= ' + fmt(v) : '';
  }

  /* ---------------- 输入 ---------------- */
  function insert(text) {
    if (text === undefined) return;
    var s = input.selectionStart || 0;
    var e = input.selectionEnd || 0;
    var val = input.value;

    input.value = val.slice(0, s) + text + val.slice(e);
    var pos = s + text.length;
    input.focus();
    input.setSelectionRange(pos, pos);
    updatePreview();
  }

  function backspace() {
    var s = input.selectionStart || 0;
    var e = input.selectionEnd || 0;

    if (s === e) {
      if (s <= 0) return;
      s -= 1;
    }
    input.value = input.value.slice(0, s) + input.value.slice(e);
    input.focus();
    input.setSelectionRange(s, s);
    updatePreview();
  }

  function clearAll() {
    input.value = '';
    input.focus();
    updatePreview();
  }

  /* ---------------- 求值 ---------------- */
  function evaluate() {
    var src = input.value.trim();
    if (!src) return;

    var r = Expr.compile(src);
    if (!r.ok) {
      preview.classList.add('error');
      preview.textContent = r.error;
      return;
    }

    var v = r.fn(0);
    if (typeof v !== 'number' || !isFinite(v)) {
      preview.classList.add('error');
      preview.textContent = '这个式子算不出有限的结果';
      return;
    }

    addHistory(src, v);

    input.value = raw(v);
    input.setSelectionRange(input.value.length, input.value.length);
    updatePreview();
  }

  /* ---------------- 历史 ---------------- */
  function addHistory(src, v) {
    history.unshift({ expr: src, value: v });
    if (history.length > HIST_MAX) history.pop();
    renderHistory();
  }

  function renderHistory() {
    histEl.innerHTML = '';
    histEmpty.hidden = history.length > 0;

    history.forEach(function (h) {
      var li = document.createElement('li');

      var expr = document.createElement('span');
      expr.className = 'h-expr';
      expr.textContent = h.expr;

      var val = document.createElement('span');
      val.className = 'h-val';
      val.textContent = '= ' + fmt(h.value);

      li.appendChild(expr);
      li.appendChild(val);
      li.title = '点一下放回输入框';

      li.addEventListener('click', function () {
        input.value = h.expr;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        updatePreview();
      });

      histEl.appendChild(li);
    });
  }

  /* ---------------- 按钮 ---------------- */
  function bindPad(el) {
    if (!el) return;
    /* 别让按钮把输入框的焦点抢走，否则光标位置会丢 */
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) e.preventDefault();
    });
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;

      var act = btn.dataset.act;
      if (act === 'clear') { clearAll(); return; }
      if (act === 'back') { backspace(); return; }
      if (act === 'equals') { evaluate(); return; }
      insert(btn.dataset.ins);
    });
  }

  bindPad(keypad);
  bindPad(chips);

  input.addEventListener('input', updatePreview);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); evaluate(); }
    else if (e.key === 'Escape') { e.preventDefault(); clearAll(); }
  });

  document.getElementById('clear-hist').addEventListener('click', function () {
    history = [];
    renderHistory();
  });

  /* 点显示屏也跟着聚焦 */
  document.querySelector('.display').addEventListener('click', function () { input.focus(); });

  /* 页面打开就能直接敲 */
  updatePreview();
  renderHistory();
  input.focus();
}());
