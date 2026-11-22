/* ==========================================================================
   whiteboard.js —— 白板：渲染 / 输入 / 存档 / 导出
   ========================================================================== */
(function () {
  'use strict';

  var M = window.WBModel;
  if (!M) return;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('board-wrap');

  var COLORS = ['#111827', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#64748b'];
  var WIDTHS = [2, 4, 8, 16];
  var SAVE_KEY = 'wb.doc.v1';

  var doc = M.create();
  var tool = 'pen';
  var color = COLORS[0];
  var width = 4;
  var bg = 'none';

  var drawing = null;          /* 正在画的东西 */
  var erasePos = null;
  var pointerId = null;
  var textInput = null;
  var saveTimer = 0;

  /* ---------------- 初始化控件 ---------------- */
  (function buildSwatches() {
    var box = document.getElementById('swatches');
    COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw' + (i === 0 ? ' on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', '颜色 ' + c);
      b.addEventListener('click', function () {
        color = c;
        box.querySelectorAll('.sw').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        selectTool(tool === 'eraser' ? 'pen' : tool);
      });
      box.appendChild(b);
    });
  }());

  (function buildWidths() {
    var box = document.getElementById('widths');
    WIDTHS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wd' + (i === 1 ? ' on' : '');
      var dot = document.createElement('i');
      dot.style.width = Math.min(18, 4 + w) + 'px';
      dot.style.height = Math.min(18, 4 + w) + 'px';
      b.appendChild(dot);
      b.addEventListener('click', function () {
        width = w;
        box.querySelectorAll('.wd').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      box.appendChild(b);
    });
  }());

  function selectTool(t) {
    tool = t;
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tool') === t);
    });
    canvas.style.cursor = (t === 'text') ? 'text' : (t === 'eraser' ? 'cell' : 'crosshair');
  }

  document.querySelectorAll('[data-tool]').forEach(function (b) {
    b.addEventListener('click', function () { selectTool(b.getAttribute('data-tool')); });
  });

  document.querySelectorAll('[data-bg]').forEach(function (b) {
    b.addEventListener('click', function () {
      bg = b.getAttribute('data-bg');
      document.querySelectorAll('[data-bg]').forEach(function (x) { x.classList.toggle('on', x === b); });
      render();
      scheduleSave();
    });
  });

  /* ---------------- 画布 ---------------- */
  function resize() {
    var rect = wrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    render();
  }

  function toPage(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * doc.w,
      y: (e.clientY - rect.top) / rect.height * doc.h
    };
  }

  /* ---------------- 绘制 ---------------- */
  function drawBackground() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, doc.w, doc.h);

    if (bg === 'grid') {
      ctx.strokeStyle = 'rgba(120, 140, 170, .22)';
      ctx.lineWidth = 1;
      var step = 50;
      ctx.beginPath();
      for (var x = step; x < doc.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, doc.h); }
      for (var y = step; y < doc.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(doc.w, y); }
      ctx.stroke();
    } else if (bg === 'line') {
      ctx.strokeStyle = 'rgba(120, 140, 170, .35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var yy = 70; yy < doc.h; yy += 56) { ctx.moveTo(40, yy); ctx.lineTo(doc.w - 40, yy); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(239, 68, 68, .35)';
      ctx.beginPath();
      ctx.moveTo(96, 0);
      ctx.lineTo(96, doc.h);
      ctx.stroke();
    }
  }

  function strokePath(points) {
    if (!points.length) return;
    ctx.beginPath();
    if (points.length === 1) {
      ctx.arc(points[0].x, points[0].y, 0.6, 0, Math.PI * 2);
      return;
    }
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length - 1; i++) {
      var mx = (points[i].x + points[i + 1].x) / 2;
      var my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    var last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function drawElement(el) {
    ctx.save();
    if (el.type === 'pen' || el.type === 'highlighter') {
      ctx.strokeStyle = el.color;
      ctx.fillStyle = el.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (el.type === 'highlighter') {
        ctx.globalAlpha = 0.32;
        ctx.lineWidth = el.width * 3.2;
      } else {
        ctx.lineWidth = el.width;
      }
      strokePath(el.points);
      if (el.points.length === 1) {
        ctx.beginPath();
        ctx.arc(el.points[0].x, el.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.stroke();
      }
    } else if (el.type === 'text') {
      ctx.fillStyle = el.color;
      ctx.font = '600 ' + el.size + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(el.text, el.x, el.y);
    } else {
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      var x1 = el.x1, y1 = el.y1, x2 = el.x2, y2 = el.y2;

      if (el.type === 'line' || el.type === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (el.type === 'arrow') {
          var ang = Math.atan2(y2 - y1, x2 - x1);
          var head = Math.max(14, el.width * 3.4);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(ang - 0.42), y2 - head * Math.sin(ang - 0.42));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(ang + 0.42), y2 - head * Math.sin(ang + 0.42));
          ctx.stroke();
        }
      } else if (el.type === 'rect') {
        var l = Math.min(x1, x2), t = Math.min(y1, y2);
        ctx.strokeRect(l, t, Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (el.type === 'ellipse') {
        var cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function render() {
    var sx = canvas.width / doc.w;
    ctx.setTransform(sx, 0, 0, sx, 0, 0);
    drawBackground();

    M.elements(doc).forEach(drawElement);

    if (drawing) {
      if (drawing.type === 'pen' || drawing.type === 'highlighter') drawElement(drawing);
      else if (drawing.type === 'shape') drawElement(drawing.el);
    }

    if (erasePos) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120, 140, 170, .9)';
      ctx.fillStyle = 'rgba(120, 140, 170, .16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(erasePos.x, erasePos.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    document.getElementById('page-label').textContent = (doc.index + 1) + ' / ' + doc.pages.length;
  }

  /* ---------------- 存档 ---------------- */
  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      try { localStorage.setItem(SAVE_KEY, M.serialize(doc)); } catch (e) {}
    }, 400);
  }

  /* ---------------- 输入 ---------------- */
  canvas.addEventListener('pointerdown', function (e) {
    if (textInput) commitText();
    e.preventDefault();
    pointerId = e.pointerId;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
    var p = toPage(e);

    if (tool === 'eraser') {
      erasePos = p;
      M.eraseAt(doc, p.x, p.y, 16);
      render();
      return;
    }

    if (tool === 'text') {
      openTextInput(p);
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      drawing = {
        type: tool,
        color: color,
        width: width,
        points: [{ x: p.x, y: p.y }]
      };
      render();
      return;
    }

    drawing = {
      type: 'shape',
      el: {
        type: tool,
        color: color,
        width: width,
        x1: p.x, y1: p.y, x2: p.x, y2: p.y
      }
    };
  });

  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pointerId) return;
    var p = toPage(e);

    if (tool === 'eraser' && erasePos) {
      erasePos = p;
      M.eraseAt(doc, p.x, p.y, 16);
      render();
      return;
    }

    if (!drawing) return;

    if (drawing.type === 'pen' || drawing.type === 'highlighter') {
      var last = drawing.points[drawing.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.6) return;
      drawing.points.push({ x: p.x, y: p.y });
    } else if (drawing.type === 'shape') {
      drawing.el.x2 = p.x;
      drawing.el.y2 = p.y;
    }
    render();
  });

  function finish() {
    if (tool === 'eraser') {
      erasePos = null;
      pointerId = null;
      scheduleSave();
      render();
      return;
    }
    if (!drawing) { pointerId = null; return; }

    if (drawing.type === 'pen' || drawing.type === 'highlighter') {
      if (drawing.points.length >= 1) M.addElement(doc, drawing);
    } else if (drawing.type === 'shape') {
      var el = drawing.el;
      if (Math.abs(el.x2 - el.x1) > 6 || Math.abs(el.y2 - el.y1) > 6) M.addElement(doc, el);
    }
    drawing = null;
    pointerId = null;
    render();
    scheduleSave();
  }

  canvas.addEventListener('pointerup', function (e) { if (e.pointerId === pointerId) finish(); });
  canvas.addEventListener('pointercancel', function (e) { if (e.pointerId === pointerId) finish(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------------- 文字 ---------------- */
  function openTextInput(p) {
    if (textInput) commitText();
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width / doc.w;
    var input = document.createElement('input');
    input.className = 'text-input';
    input.type = 'text';
    input.placeholder = '输入文字，回车确认';
    input.style.left = (rect.left - wrap.getBoundingClientRect().left + p.x * sx) + 'px';
    input.style.top = (rect.top - wrap.getBoundingClientRect().top + (p.y - 26) * sx) + 'px';
    input.dataset.x = p.x;
    input.dataset.y = p.y;
    wrap.appendChild(input);
    textInput = input;
    input.focus();
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitText(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', function () { window.setTimeout(commitText, 120); });
  }

  function commitText() {
    if (!textInput) return;
    var input = textInput;
    textInput = null;
    var txt = (input.value || '').trim();
    if (txt) {
      M.addElement(doc, {
        type: 'text',
        color: color,
        size: 38,
        text: txt,
        x: parseFloat(input.dataset.x),
        y: parseFloat(input.dataset.y)
      });
      render();
      scheduleSave();
    }
    if (input.parentNode) input.parentNode.removeChild(input);
  }

  function cancelText() {
    if (!textInput) return;
    var input = textInput;
    textInput = null;
    if (input.parentNode) input.parentNode.removeChild(input);
  }

  /* ---------------- 按钮 ---------------- */
  document.getElementById('btn-undo').addEventListener('click', function () {
    if (M.undo(doc)) { render(); scheduleSave(); }
  });
  document.getElementById('btn-redo').addEventListener('click', function () {
    if (M.redo(doc)) { render(); scheduleSave(); }
  });
  document.getElementById('btn-clear').addEventListener('click', function () {
    if (M.clearPage(doc)) { render(); scheduleSave(); }
  });
  document.getElementById('btn-prev').addEventListener('click', function () {
    M.gotoPage(doc, doc.index - 1); render();
  });
  document.getElementById('btn-next').addEventListener('click', function () {
    M.gotoPage(doc, doc.index + 1); render();
  });
  document.getElementById('btn-addpage').addEventListener('click', function () {
    M.addPage(doc); render(); scheduleSave();
  });
  document.getElementById('btn-delpage').addEventListener('click', function () {
    M.delPage(doc); render(); scheduleSave();
  });

  document.getElementById('btn-export').addEventListener('click', function () {
    var out = document.createElement('canvas');
    out.width = doc.w;
    out.height = doc.h;
    var g = out.getContext('2d');
    var keep = ctx;
    ctx = g;
    drawBackground();
    M.elements(doc).forEach(drawElement);
    ctx = keep;

    var a = document.createElement('a');
    a.download = '白板-第' + (doc.index + 1) + '页.png';
    a.href = out.toDataURL('image/png');
    a.click();
  });

  document.getElementById('btn-full').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (wrap.requestFullscreen) wrap.requestFullscreen();
  });

  /* ---------------- 快捷键 ---------------- */
  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    var k = String(e.key).toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (M.undo(doc)) { render(); scheduleSave(); } return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); if (M.redo(doc)) { render(); scheduleSave(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'p') selectTool('pen');
    else if (k === 'e') selectTool('eraser');
    else if (k === 't') selectTool('text');
  });

  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', function () { window.setTimeout(resize, 60); });

  /* ---------------- 启动 ---------------- */
  (function boot() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) doc = M.load(raw);
    } catch (e) {}
    resize();
    render();
  }());

  /* 调试用 */
  window.WBDebug = {
    doc: function () { return doc; },
    info: function () {
      return {
        pages: doc.pages.length,
        index: doc.index,
        elements: M.elements(doc).length,
        tool: tool,
        bg: bg,
        history: doc.history.length
      };
    },
    tool: function (t) { selectTool(t); },
    color: function (c) { color = c; },
    width: function (w) { width = w; },
    undo: function () { return M.undo(doc); },
    redo: function () { return M.redo(doc); },
    clear: function () { return M.clearPage(doc); },
    toPage: function (x, y) {
      var rect = canvas.getBoundingClientRect();
      return { x: rect.left + x / doc.w * rect.width, y: rect.top + y / doc.h * rect.height };
    },
    inkPixels: function () {
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var n = 0;
      for (var i = 0; i < d.length; i += 4 * 3) {
        if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
      }
      return n;
    }
  };
}());
