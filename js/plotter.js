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
  var activeInput = null;
  var pendingCaret = null;
  var funcVersion = 0;

  /* 数值分析：每个函数的极值、零点，供吸附和数值表使用 */
  var analysis = { items: [], points: [], sig: '' };
  var snap = null;
  var tableTimer = 0;
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
    var px = snap ? snap.sx : cursor.x;
    var py = snap ? snap.sy : cursor.y;
    var wx = snap ? snap.p.x : worldX(px);
    var i, f, y, sy;

    /* 十字虚线 */
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

    /* 每条曲线在这个 x 上的点，同时收集读数 */
    var rows = [];
    for (i = 0; i < funcs.length; i++) {
      f = funcs[i];
      if (!f.compiled) continue;

      var name = (f.expr || '').trim();
      if (name.length > 18) name = name.slice(0, 17) + '…';

      y = f.compiled(wx);
      rows.push({ color: f.color, text: name + ' = ' + (isFinite(y) ? shortNum(y) : '—') });
      if (!isFinite(y)) continue;

      sy = screenY(y);
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

    /* 吸附高亮圈 */
    if (snap) {
      ctx.beginPath();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.2;
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* 读数面板：只给 x 和各函数在此时的 y */
    var kind = snap ? (snap.p.type === 'root' ? '零点' : (snap.p.type === 'max' ? '极大值' : '极小值')) : '';
    var head = (kind ? kind + '  ' : '') + 'x = ' + shortNum(wx);

    ctx.font = '11.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    var lineH = 16;
    var padX = 9;
    var padY = 8;
    var headW = ctx.measureText(head).width;
    var rowW = 0;
    for (i = 0; i < rows.length; i++) {
      rowW = Math.max(rowW, 16 + ctx.measureText(rows[i].text).width);
    }

    var boxW = Math.max(headW, rowW) + padX * 2;
    var boxH = 24 + rows.length * lineH + padY - 4;
    var bx = px + 14;
    var by = py + 14;
    if (bx + boxW > size.w - 6) bx = px - boxW - 14;
    if (by + boxH > size.h - 6) by = py - boxH - 14;
    bx = Math.max(6, bx);
    by = Math.max(6, by);

    ctx.fillStyle = t.surface;
    ctx.globalAlpha = 0.95;
    roundRect(bx, by, boxW, boxH, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.axis;
    ctx.lineWidth = 0.6;
    roundRect(bx, by, boxW, boxH, 7);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.ink;
    ctx.fillText(head, bx + padX, by + 13);

    var ty = by + 24 + lineH / 2 - 2;
    for (i = 0; i < rows.length; i++) {
      ctx.beginPath();
      ctx.fillStyle = rows[i].color;
      ctx.arc(bx + padX + 4, ty, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.ink;
      ctx.fillText(rows[i].text, bx + padX + 14, ty);
      ty += lineH;
    }
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

    syncAnalysis();

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

    input.addEventListener('focus', function () { activeInput = input; });

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
    funcVersion += 1;
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

  /* ---------------- 数值分析：零点 / 极值 / 最值 ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function fmtCell(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    if (v === 0) return '0';
    var a = Math.abs(v);
    if (a >= 1e5 || a < 1e-4) return v.toExponential(1);
    return String(parseFloat(v.toFixed(3)));
  }

  /* 二分法找零点 */
  function bisectZero(fn, a, b) {
    var fa = fn(a);
    var fb = fn(b);
    if (!isFinite(fa) || !isFinite(fb)) return NaN;
    for (var i = 0; i < 30; i++) {
      var m = (a + b) / 2;
      var fm = fn(m);
      if (!isFinite(fm)) return NaN;
      if ((fa > 0) !== (fm > 0)) { b = m; } else { a = m; fa = fm; }
    }
    return (a + b) / 2;
  }

  /* 三分法找区间内的极大 / 极小 */
  function ternaryExtremum(fn, a, b, mode) {
    for (var i = 0; i < 30; i++) {
      var m1 = a + (b - a) / 3;
      var m2 = b - (b - a) / 3;
      var f1 = fn(m1);
      var f2 = fn(m2);
      if (!isFinite(f1) || !isFinite(f2)) return (a + b) / 2;
      if (mode === 'max' ? f1 < f2 : f1 > f2) a = m1; else b = m2;
    }
    return (a + b) / 2;
  }

  function analyzeFunc(fn, x0, x1) {
    var N = 300;
    var dx = (x1 - x0) / N;
    var ys = new Array(N + 1);
    var min = Infinity;
    var max = -Infinity;
    var i, x, y;

    for (i = 0; i <= N; i++) {
      x = x0 + dx * i;
      y = fn(x);
      ys[i] = y;
      if (isFinite(y)) {
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }

    var pts = [];

    /* 零点 */
    for (i = 1; i <= N; i++) {
      var a = ys[i - 1];
      var b = ys[i];
      if (!isFinite(a) || !isFinite(b)) continue;
      if (a === 0) { pts.push({ type: 'root', x: x0 + dx * (i - 1), y: 0 }); continue; }
      if (b === 0) { pts.push({ type: 'root', x: x0 + dx * i, y: 0 }); continue; }
      if ((a > 0) !== (b > 0)) {
        var r = bisectZero(fn, x0 + dx * (i - 1), x0 + dx * i);
        if (isFinite(r)) pts.push({ type: 'root', x: r, y: 0 });
      }
    }

    /* 极值 */
    for (i = 1; i < N; i++) {
      var p = ys[i - 1], q = ys[i], rr = ys[i + 1];
      if (!isFinite(p) || !isFinite(q) || !isFinite(rr)) continue;
      if (q > p && q > rr) {
        var mx = ternaryExtremum(fn, x0 + dx * (i - 1), x0 + dx * (i + 1), 'max');
        if (isFinite(mx)) pts.push({ type: 'max', x: mx, y: fn(mx) });
      } else if (q < p && q < rr) {
        var mn = ternaryExtremum(fn, x0 + dx * (i - 1), x0 + dx * (i + 1), 'min');
        if (isFinite(mn)) pts.push({ type: 'min', x: mn, y: fn(mn) });
      }
    }

    pts.sort(function (a2, b2) { return a2.x - b2.x; });
    var out = [];
    for (i = 0; i < pts.length; i++) {
      if (out.length && Math.abs(pts[i].x - out[out.length - 1].x) < dx * 0.5) continue;
      out.push(pts[i]);
    }
    if (out.length > 30) out = out.slice(0, 30);

    return { min: min, max: max, points: out };
  }

  function syncAnalysis() {
    var sig = view.cx.toFixed(3) + '|' + view.spanX.toFixed(4) + '|' + size.w + '|' + funcVersion;
    if (sig === analysis.sig) return;
    analysis.sig = sig;

    var x0 = worldX(0);
    var x1 = worldX(size.w);
    var items = [];
    var points = [];

    funcs.forEach(function (f) {
      if (!f.compiled) { items.push(null); return; }
      var info = analyzeFunc(f.compiled, x0, x1);
      items.push(info);
      info.points.forEach(function (p) {
        points.push({ x: p.x, y: p.y, type: p.type, color: f.color });
      });
    });

    analysis.items = items;
    analysis.points = points;

    scheduleTable();
  }

  function scheduleTable() {
    if (tableTimer) return;
    tableTimer = window.setTimeout(function () {
      tableTimer = 0;
      renderTable();
    }, 110);
  }

  /* 数值表：只显示每个函数在当前视野内的最大值 / 最小值 */
  function renderTable() {
    var table = document.getElementById('vtable');
    if (!table) return;

    var head = '<thead><tr><th>函数</th><th>最大值</th><th>最小值</th></tr></thead>';
    var body = '<tbody>';

    funcs.forEach(function (f) {
      if (!f.compiled) return;

      /* 全局最值只在表达式变化时算一次 */
      if (!f.extremes || f.extremeKey !== f.expr) {
        f.extremes = window.PlotExtremes ? window.PlotExtremes.compute(f.compiled) : null;
        f.extremeKey = f.expr;
      }

      var name = (f.expr || '').trim() || '函数';
      if (name.length > 16) name = name.slice(0, 15) + '…';

      var ext = f.extremes;
      var maxText = '—';
      var minText = '—';
      if (ext) {
        maxText = ext.maxInf ? '+∞' : (isFinite(ext.max) ? fmtCell(ext.max) : '—');
        minText = ext.minInf ? '−∞' : (isFinite(ext.min) ? fmtCell(ext.min) : '—');
      }

      body += '<tr>';
      body += '<td><span class="dot" style="background:' + f.color + '"></span>' + escapeHtml(name) + '</td>';
      body += '<td>' + maxText + '</td>';
      body += '<td>' + minText + '</td>';
      body += '</tr>';
    });

    body += '</tbody>';
    table.innerHTML = head + body;

    var hint = document.getElementById('values-hint');
    if (hint) hint.textContent = '整个定义域';
  }

  /* 吸附：找离鼠标最近的特殊点 */
  function findSnap(px, py) {
    var best = null;
    var bestD = 18;
    for (var i = 0; i < analysis.points.length; i++) {
      var p = analysis.points[i];
      var sx = screenX(p.x);
      var sy = screenY(p.y);
      var d = Math.sqrt((sx - px) * (sx - px) + (sy - py) * (sy - py));
      if (d < bestD) { bestD = d; best = { p: p, sx: sx, sy: sy }; }
    }
    return best;
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
    snap = findSnap(cursor.x, cursor.y);

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
    snap = null;
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

  /* ---------- 数学键盘 ---------- */
  function targetInput() {
    if (activeInput && document.body.contains(activeInput)) return activeInput;
    if (!funcs.length) addFunc('', false);
    if (!funcs.length) return null;
    activeInput = funcs[0].input;
    return activeInput;
  }

  function caretIn(el) {
    if (pendingCaret && pendingCaret.el === el) {
      return { start: pendingCaret.start, end: pendingCaret.end };
    }
    var end = el.value.length;
    return { start: end, end: end };
  }

  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    window.setTimeout(function () { el.classList.remove('flash'); }, 540);
  }

  function insertKey(text) {
    if (text === undefined || text === null) return;
    var el = targetInput();
    if (!el) return;

    var pos = caretIn(el);
    var val = el.value;

    el.value = val.slice(0, pos.start) + text + val.slice(pos.end);
    var next = pos.start + text.length;
    el.focus();
    el.setSelectionRange(next, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    pendingCaret = { el: el, start: next, end: next };
    flash(el);
  }

  function backspaceKey() {
    var el = targetInput();
    if (!el) return;

    var pos = caretIn(el);
    var s = pos.start;
    var e = pos.end;
    if (s === e) {
      if (s <= 0) return;
      s -= 1;
    }
    el.value = el.value.slice(0, s) + el.value.slice(e);
    el.focus();
    el.setSelectionRange(s, s);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    pendingCaret = { el: el, start: s, end: s };
    flash(el);
  }

  var kbdEl = document.getElementById('kbd');
  if (kbdEl) {
    /* 按下时先记住光标位置，松开后按钮会抢走焦点 */
    kbdEl.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('button');
      var el = targetInput();
      if (btn && el && document.activeElement === el) {
        pendingCaret = { el: el, start: el.selectionStart || 0, end: el.selectionEnd || 0 };
      } else {
        pendingCaret = null;
      }
    });
    kbdEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'back') backspaceKey();
      else insertKey(btn.dataset.ins);
    });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { scheduleDraw(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- 启动 ---------- */
  INITIAL.forEach(function (expr) { addFunc(expr, false); });
  if (funcs.length) activeInput = funcs[0].input;
  resize();

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resize).observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }
}());
