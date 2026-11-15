/* ==========================================================================
   plotter.js —— 函数绘图器
   ========================================================================== */
(function () {
  'use strict';

  var Expr = window.Expr;
  if (!Expr) return;

  var canvas = document.getElementById('plot');
  var ctx = canvas.getContext('2d');
  var stage = document.getElementById('stage');
  var flist = document.getElementById('flist');
  var emptyHint = document.getElementById('empty');
  var rangeEl = document.getElementById('range');

  var COLORS = ['#2563eb', '#ef4444', '#16a34a', '#a855f7', '#f59e0b', '#0ea5e9'];
  var INITIAL = ['sin(x)', 'x^2/4'];

  var view = { cx: 0, cy: 0, spanX: 20 };
  var size = { w: 1, h: 1 };
  var funcs = [];
  var cursor = null;
  var drag = null;
  var rafId = 0;
  var uid = 0;

  /* ---------- 主题色 ---------- */
  function theme() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var s = cs.getPropertyValue(name).trim();
      return s || fallback;
    }
    return {
      minor: v('--grid-minor', 'rgba(0,0,0,.07)'),
      major: v('--grid-major', 'rgba(0,0,0,.14)'),
      axis: v('--axis', 'rgba(0,0,0,.45)'),
      text: v('--muted', '#64748b'),
      surface: v('--surface-solid', '#fff'),
      ink: v('--ink', '#0f172a')
    };
  }

  /* ---------- 坐标换算 ---------- */
  function scale() { return size.w / view.spanX; }
  function worldX(px) { return view.cx + (px - size.w / 2) / scale(); }
  function worldY(py) { return view.cy - (py - size.h / 2) / scale(); }
  function screenX(x) { return (x - view.cx) * scale() + size.w / 2; }
  function screenY(y) { return size.h / 2 - (y - view.cy) * scale(); }

  function niceStep(raw) {
    var exp = Math.floor(Math.log10(raw));
    var base = Math.pow(10, exp);
    var f = raw / base;
    var mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return mult * base;
  }

  function tickLabel(v, step) {
    var dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
    var s = v.toFixed(dec);
    if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
    return s;
  }

  function shortNum(v) {
    if (v === 0) return '0';
    if (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) return v.toExponential(1);
    return String(parseFloat(v.toFixed(2)));
  }

  /* ---------- 绘制 ---------- */
  function drawGrid(step) {
    var t = theme();
    var x0 = worldX(0), x1 = worldX(size.w);
    var y0 = worldY(size.h), y1 = worldY(0);
    var minor = step / 5;

    ctx.lineWidth = 1;
    ctx.strokeStyle = t.minor;
    ctx.beginPath();
    var guard = 0;
    for (var x = Math.ceil(x0 / minor) * minor; x <= x1 && guard < 4000; x += minor, guard++) {
      var px = Math.round(screenX(x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size.h);
    }
    for (var y = Math.ceil(y0 / minor) * minor; y <= y1 && guard < 8000; y += minor, guard++) {
      var py = Math.round(screenY(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(size.w, py);
    }
    ctx.stroke();

    ctx.strokeStyle = t.major;
    ctx.beginPath();
    guard = 0;
    for (var x2 = Math.ceil(x0 / step) * step; x2 <= x1 && guard < 2000; x2 += step, guard++) {
      var px2 = Math.round(screenX(x2)) + 0.5;
      ctx.moveTo(px2, 0);
      ctx.lineTo(px2, size.h);
    }
    for (var y2 = Math.ceil(y0 / step) * step; y2 <= y1 && guard < 2000; y2 += step, guard++) {
      var py2 = Math.round(screenY(y2)) + 0.5;
      ctx.moveTo(0, py2);
      ctx.lineTo(size.w, py2);
    }
    ctx.stroke();
  }

  function drawAxes(step) {
    var t = theme();
    var x0 = worldX(0), x1 = worldX(size.w);
    var y0 = worldY(size.h), y1 = worldY(0);

    var ax = screenX(0);
    var ay = screenY(0);
    var axisInsideX = ax >= 0 && ax <= size.w;
    var axisInsideY = ay >= 0 && ay <= size.h;

    ctx.strokeStyle = t.axis;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (axisInsideX) { ctx.moveTo(Math.round(ax) + 0.5, 0); ctx.lineTo(Math.round(ax) + 0.5, size.h); }
    if (axisInsideY) { ctx.moveTo(0, Math.round(ay) + 0.5); ctx.lineTo(size.w, Math.round(ay) + 0.5); }
    ctx.stroke();

    ctx.fillStyle = t.text;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

    var labelBaseY = Math.min(Math.max(ay, 6), size.h - 22) + 15;
    var labelBaseX = Math.min(Math.max(ax, 34), size.w - 8);
    var rightSide = ax >= 34;
    var guard = 0;

    for (var x = Math.ceil(x0 / step) * step; x <= x1 && guard < 2000; x += step, guard++) {
      if (Math.abs(x) < step * 1e-6) continue;
      var px = screenX(x);
      if (px < 18 || px > size.w - 18) continue;   /* 贴边的标签会被裁掉，干脆不画 */
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(tickLabel(x, step), px, labelBaseY);
    }

    guard = 0;
    for (var y = Math.ceil(y0 / step) * step; y <= y1 && guard < 2000; y += step, guard++) {
      if (Math.abs(y) < step * 1e-6) continue;
      var py = screenY(y);
      if (py < 10 || py > size.h - 10) continue;
      ctx.textAlign = rightSide ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tickLabel(y, step), rightSide ? labelBaseX - 7 : labelBaseX + 7, py);
    }

    if (axisInsideX && axisInsideY) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('0', ax - 6, ay + 5);
    }
  }

  function drawCurves() {
    for (var i = 0; i < funcs.length; i++) {
      var f = funcs[i];
      if (!f.compiled) continue;

      ctx.beginPath();
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      var started = false;
      var prevSy = 0;
      var jump = size.h * 4;

      for (var px = 0; px <= size.w; px += 1) {
        var y;
        try { y = f.compiled(worldX(px)); } catch (e) { y = NaN; }

        if (!isFinite(y)) { started = false; continue; }

        var sy = screenY(y);
        if (!started) {
          ctx.moveTo(px, sy);
          started = true;
        } else if (Math.abs(sy - prevSy) > jump) {
          ctx.moveTo(px, sy);
        } else {
          ctx.lineTo(px, sy);
        }
        prevSy = sy;
      }
      ctx.stroke();
    }
  }

  function drawCrosshair() {
    var t = theme();
    var px = cursor.x;
    var py = cursor.y;
    var wx = worldX(px);

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.axis;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 0.5, 0);
    ctx.lineTo(Math.round(px) + 0.5, size.h);
    ctx.moveTo(0, Math.round(py) + 0.5);
    ctx.lineTo(size.w, Math.round(py) + 0.5);
    ctx.stroke();
    ctx.restore();

    for (var i = 0; i < funcs.length; i++) {
      var f = funcs[i];
      if (!f.compiled) continue;
      var y = f.compiled(wx);
      if (!isFinite(y)) continue;
      var sy = screenY(y);
      if (sy < -20 || sy > size.h + 20) continue;
      ctx.beginPath();
      ctx.fillStyle = f.color;
      ctx.arc(screenX(wx), sy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = t.surface;
      ctx.lineWidth = 1.4;
      ctx.arc(screenX(wx), sy, 3.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    var label = 'x = ' + shortNum(wx) + '   y = ' + shortNum(worldY(py));
    ctx.font = '11.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    var tw = ctx.measureText(label).width;
    var bx = Math.min(px + 12, size.w - tw - 16);
    var by = Math.min(py + 14, size.h - 26);
    bx = Math.max(6, bx);
    by = Math.max(6, by);

    ctx.fillStyle = t.surface;
    ctx.globalAlpha = 0.92;
    roundRect(bx, by, tw + 12, 20, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.axis;
    ctx.lineWidth = 0.6;
    roundRect(bx, by, tw + 12, 20, 6);
    ctx.stroke();

    ctx.fillStyle = t.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 6, by + 10.5);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, size.w, size.h);

    var s = scale();
    if (!isFinite(s) || s <= 0) return;

    var step = niceStep(96 / s);
    if (!isFinite(step) || step <= 0) return;

    drawGrid(step);
    drawAxes(step);
    drawCurves();
    if (cursor) drawCrosshair();

    rangeEl.textContent =
      'x ∈ [' + shortNum(worldX(0)) + ', ' + shortNum(worldX(size.w)) + ']  ' +
      'y ∈ [' + shortNum(worldY(size.h)) + ', ' + shortNum(worldY(0)) + ']';
  }

  function scheduleDraw() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(function () {
      rafId = 0;
      draw();
    });
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    var rect = stage.getBoundingClientRect();
    size.w = Math.max(1, rect.width);
    size.h = Math.max(1, rect.height);
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleDraw();
  }

  /* ---------- 缩放 / 平移 ---------- */
  function clampSpan(v) { return Math.min(Math.max(v, 1e-6), 1e9); }

  function zoomAt(px, py, factor) {
    var wx = worldX(px);
    var wy = worldY(py);
    view.spanX = clampSpan(view.spanX * factor);
    var s2 = scale();
    view.cx = wx - (px - size.w / 2) / s2;
    view.cy = wy + (py - size.h / 2) / s2;
    scheduleDraw();
  }

  function resetView() {
    view.cx = 0;
    view.cy = 0;
    view.spanX = 20;
    scheduleDraw();
  }

  /* ---------- 函数列表 ---------- */
  function createFunc(expr) {
    var f = {
      id: ++uid,
      color: COLORS[funcs.length % COLORS.length],
      expr: expr || '',
      compiled: null
    };

    var item = document.createElement('div');
    item.className = 'fitem';

    var row = document.createElement('div');
    row.className = 'frow';

    var swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = f.color;

    var input = document.createElement('input');
    input.className = 'finput';
    input.type = 'text';
    input.value = f.expr;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '函数表达式');
    input.placeholder = '例如 sin(x)';

    var del = document.createElement('button');
    del.className = 'fdel';
    del.type = 'button';
    del.textContent = '×';
    del.title = '删除这条函数';

    var err = document.createElement('div');
    err.className = 'ferr';

    row.appendChild(swatch);
    row.appendChild(input);
    row.appendChild(del);
    item.appendChild(row);
    item.appendChild(err);
    flist.appendChild(item);

    f.el = item;
    f.input = input;
    f.errEl = err;

    input.addEventListener('input', function () {
      f.expr = input.value;
      refresh(f);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addFunc('');
      }
    });

    del.addEventListener('click', function () {
      var idx = funcs.indexOf(f);
      if (idx >= 0) funcs.splice(idx, 1);
      item.remove();
      if (!funcs.length) addFunc('');
      refreshAll();
    });

    funcs.push(f);
    return f;
  }

  function refresh(f) {
    var raw = f.expr.trim();
    if (!raw) {
      f.compiled = null;
      f.input.classList.remove('invalid');
      f.errEl.textContent = '';
    } else {
      var res = Expr.compile(f.expr);
      f.compiled = res.ok ? res.fn : null;
      f.input.classList.toggle('invalid', !res.ok);
      f.errEl.textContent = res.ok ? '' : res.error;
    }
    emptyHint.hidden = funcs.some(function (x) { return !!x.compiled; });
    scheduleDraw();
  }

  function refreshAll() {
    funcs.forEach(function (f) {
      f.swatchElUpdate = null;
    });
    funcs.forEach(refresh);
  }

  function addFunc(expr, focus) {
    var f = createFunc(expr || '');
    refresh(f);
    if (focus !== false) {
      f.input.focus();
      f.input.select();
    }
    return f;
  }

  /* ---------- 交互 ---------- */
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('.toolbar')) return;
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    stage.classList.add('dragging');
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件可能没有真实指针 */ }
  });

  stage.addEventListener('pointermove', function (e) {
    var rect = canvas.getBoundingClientRect();
    cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (drag) {
      var s = scale();
      view.cx = drag.cx - (e.clientX - drag.x) / s;
      view.cy = drag.cy + (e.clientY - drag.y) / s;
    }
    scheduleDraw();
  });

  function endDrag(e) {
    if (!drag) return;
    drag = null;
    stage.classList.remove('dragging');
    if (e && e.pointerId !== undefined) {
      try {
        if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
      } catch (err) { /* 忽略 */ }
    }
  }

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('pointerleave', function () {
    cursor = null;
    scheduleDraw();
  });

  stage.addEventListener('dblclick', resetView);

  document.querySelector('.toolbar').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'in') zoomAt(size.w / 2, size.h / 2, 0.8);
    else if (act === 'out') zoomAt(size.w / 2, size.h / 2, 1.25);
    else if (act === 'reset') resetView();
  });

  document.getElementById('btn-add').addEventListener('click', function () {
    addFunc('');
  });

  document.querySelector('.presets').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-expr]');
    if (!btn) return;
    var target = funcs.filter(function (f) { return !f.expr.trim(); })[0];
    if (target) {
      target.input.value = btn.dataset.expr;
      target.expr = btn.dataset.expr;
      refresh(target);
      target.input.focus();
    } else {
      addFunc(btn.dataset.expr);
    }
  });

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { scheduleDraw(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- 启动 ---------- */
  INITIAL.forEach(function (expr) { addFunc(expr, false); });
  resize();

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resize).observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }
}());
