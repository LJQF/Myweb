/* ==========================================================================
   whiteboard.js —— 白板：渲染 / 输入 / 缩略图 / 存档 / 导出
   界面按希沃白板的授课布局：顶部悬浮工具条 + 中间画布 + 右侧页面缩略图 + 底部翻页
   ========================================================================== */
(function () {
  'use strict';

  var M = window.WBModel;
  if (!M) return;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var desk = document.getElementById('desk');
  var slideArea = document.getElementById('slide-area');
  var thumbsBox = document.getElementById('thumbs');

  var COLORS = ['#111827', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#64748b'];
  var WIDTHS = [2, 4, 8, 16];
  var SAVE_KEY = 'wb.doc.v1';

  var doc = M.create();
  var tool = 'pen';
  var color = COLORS[0];
  var width = 4;
  var bg = 'none';

  var drawing = null;
  var erasePos = null;
  var pointerId = null;
  var textInput = null;
  var saveTimer = 0;
  var thumbCanvases = [];

  /* ================= 画布尺寸 ================= */
  function layout() {
    var aw = slideArea.clientWidth - 12;
    var ah = slideArea.clientHeight - 8;
    if (aw < 40 || ah < 40) return;
    var w = Math.min(aw, ah * 16 / 9);
    var h = w * 9 / 16;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = Math.round(w) + 'px';
    canvas.style.height = Math.round(h) + 'px';
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    render();
  }

  function toPage(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * doc.w,
      y: (e.clientY - rect.top) / rect.height * doc.h
    };
  }

  /* ================= 绘制（可指定 context） ================= */
  var GRID_STEP = 50;
  var LINE_STEP = 56;

  function drawBackdrop(g, w, h) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    if (bg === 'grid') {
      g.strokeStyle = 'rgba(120, 140, 170, .22)';
      g.lineWidth = Math.max(1, w / 1600);
      g.beginPath();
      for (var x = GRID_STEP; x < w; x += GRID_STEP) { g.moveTo(x, 0); g.lineTo(x, h); }
      for (var y = GRID_STEP; y < h; y += GRID_STEP) { g.moveTo(0, y); g.lineTo(w, y); }
      g.stroke();
    } else if (bg === 'line') {
      g.strokeStyle = 'rgba(120, 140, 170, .35)';
      g.lineWidth = Math.max(1, w / 1200);
      g.beginPath();
      for (var yy = 70; yy < h; yy += LINE_STEP) { g.moveTo(0, yy); g.lineTo(w, yy); }
      g.stroke();
      g.strokeStyle = 'rgba(239, 68, 68, .35)';
      g.beginPath();
      g.moveTo(w * 0.06, 0);
      g.lineTo(w * 0.06, h);
      g.stroke();
    }
  }

  function strokePath(g, points) {
    if (!points.length) return;
    g.beginPath();
    if (points.length === 1) {
      g.arc(points[0].x, points[0].y, 0.6, 0, Math.PI * 2);
      return;
    }
    g.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length - 1; i++) {
      var mx = (points[i].x + points[i + 1].x) / 2;
      var my = (points[i].y + points[i + 1].y) / 2;
      g.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    var last = points[points.length - 1];
    g.lineTo(last.x, last.y);
  }

  function drawEl(g, el) {
    g.save();
    if (el.type === 'pen' || el.type === 'highlighter') {
      g.strokeStyle = el.color;
      g.fillStyle = el.color;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (el.type === 'highlighter') {
        g.globalAlpha = 0.32;
        g.lineWidth = el.width * 3.2;
      } else {
        g.lineWidth = el.width;
      }
      strokePath(g, el.points);
      if (el.points.length === 1) {
        g.beginPath();
        g.arc(el.points[0].x, el.points[0].y, g.lineWidth / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.stroke();
      }
    } else if (el.type === 'text') {
      g.fillStyle = el.color;
      g.font = '600 ' + el.size + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      g.textBaseline = 'alphabetic';
      g.fillText(el.text, el.x, el.y);
    } else {
      g.strokeStyle = el.color;
      g.lineWidth = el.width;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      var x1 = el.x1, y1 = el.y1, x2 = el.x2, y2 = el.y2;
      if (el.type === 'line' || el.type === 'arrow') {
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        if (el.type === 'arrow') {
          var ang = Math.atan2(y2 - y1, x2 - x1);
          var head = Math.max(14, el.width * 3.4);
          g.beginPath();
          g.moveTo(x2, y2); g.lineTo(x2 - head * Math.cos(ang - 0.42), y2 - head * Math.sin(ang - 0.42));
          g.moveTo(x2, y2); g.lineTo(x2 - head * Math.cos(ang + 0.42), y2 - head * Math.sin(ang + 0.42));
          g.stroke();
        }
      } else if (el.type === 'rect') {
        g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (el.type === 'ellipse') {
        g.beginPath();
        g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.restore();
  }

  function render() {
    var s = canvas.width / doc.w;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawBackdrop(ctx, doc.w, doc.h);
    M.elements(doc).forEach(function (el) { drawEl(ctx, el); });

    if (drawing) {
      if (drawing.type === 'pen' || drawing.type === 'highlighter') drawEl(ctx, drawing);
      else if (drawing.type === 'shape') drawEl(ctx, drawing.el);
    }

    if (erasePos) {
      ctx.save();
      ctx.strokeStyle = 'rgba(60, 90, 130, .9)';
      ctx.fillStyle = 'rgba(60, 90, 130, .14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(erasePos.x, erasePos.y, 16, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    document.getElementById('page-label').textContent = (doc.index + 1) + ' / ' + doc.pages.length;
    updateThumbActive();
  }

  /* ================= 缩略图 ================= */
  function drawThumbInto(c, pageObj) {
    var g = c.getContext('2d');
    var s = c.width / doc.w;
    g.setTransform(s, 0, 0, s, 0, 0);
    var keepBg = bg;
    drawBackdrop(g, doc.w, doc.h);
    var list = pageObj.elements || [];
    for (var i = 0; i < list.length; i++) drawEl(g, list[i]);
    bg = keepBg;
  }

  function buildThumbs() {
    thumbsBox.innerHTML = '';
    thumbCanvases = [];
    doc.pages.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb' + (i === doc.index ? ' on' : '');
      b.dataset.page = String(i);

      var c = document.createElement('canvas');
      c.width = 236;
      c.height = 133;
      b.appendChild(c);

      var label = document.createElement('b');
      label.textContent = String(i + 1);
      b.appendChild(label);

      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'x';
      x.title = '删除这一页';
      x.textContent = '×';
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        M.gotoPage(doc, i);
        M.delPage(doc);
        buildThumbs();
        render();
        scheduleSave();
      });
      b.appendChild(x);

      b.addEventListener('click', function () {
        M.gotoPage(doc, i);
        render();
      });

      thumbsBox.appendChild(b);
      thumbCanvases[i] = c;
      drawThumbInto(c, p);
    });

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'thumb-add';
    add.textContent = '+ 新建页';
    add.addEventListener('click', function () {
      M.addPage(doc);
      buildThumbs();
      render();
      scheduleSave();
    });
    thumbsBox.appendChild(add);
    updateThumbActive();
  }

  function updateThumbActive() {
    var nodes = thumbsBox.querySelectorAll('.thumb');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('on', Number(nodes[i].dataset.page) === doc.index);
    }
  }

  function refreshThumb(i) {
    var c = thumbCanvases[i];
    if (!c) { buildThumbs(); return; }
    drawThumbInto(c, doc.pages[i]);
  }

  /* ================= 存档 ================= */
  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      try { localStorage.setItem(SAVE_KEY, M.serialize(doc)); } catch (e) {}
    }, 350);
  }

  /* ================= 工具切换 ================= */
  function selectTool(t) {
    tool = t;
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      var v = b.getAttribute('data-tool');
      var active = (v === t) ||
        (t === 'line' || t === 'arrow' || t === 'ellipse') && v === 'rect';
      b.classList.toggle('on', active);
    });
    canvas.style.cursor = t === 'text' ? 'text' : (t === 'eraser' ? 'cell' : 'crosshair');
    closeFlyouts();
  }

  document.querySelectorAll('[data-tool]').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var t = b.getAttribute('data-tool');
      /* 点“形状”这组时展开面板，同时切到矩形 */
      if (t === 'rect') {
        var grp = document.getElementById('grp-shape');
        var willOpen = !grp.classList.contains('open');
        selectTool(t);
        if (willOpen) grp.classList.add('open');
        return;
      }
      /* 点“笔”时展开颜色面板 */
      if (t === 'pen') {
        var gp = document.getElementById('grp-pen');
        var willOpen2 = !gp.classList.contains('open');
        selectTool(t);
        if (willOpen2) gp.classList.add('open');
        return;
      }
      selectTool(t);
    });
  });

  function closeFlyouts() {
    document.querySelectorAll('.grp.open').forEach(function (g) { g.classList.remove('open'); });
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.grp')) return;
    closeFlyouts();
  });

  /* 颜色 + 粗细面板 */
  (function buildPenFly() {
    var box = document.getElementById('fly-pen');
    var row1 = document.createElement('div');
    row1.className = 'fly-row';
    COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw' + (i === 0 ? ' on' : '');
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        color = c;
        row1.querySelectorAll('.sw').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      row1.appendChild(b);
    });
    box.appendChild(row1);

    var row2 = document.createElement('div');
    row2.className = 'fly-row';
    WIDTHS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wd' + (i === 1 ? ' on' : '');
      b.style.color = '#334155';
      var dot = document.createElement('i');
      dot.style.width = Math.min(18, 4 + w) + 'px';
      dot.style.height = Math.min(18, 4 + w) + 'px';
      b.appendChild(dot);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        width = w;
        row2.querySelectorAll('.wd').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      row2.appendChild(b);
    });
    box.appendChild(row2);
  }());

  /* 形状面板 */
  (function buildShapeFly() {
    var box = document.getElementById('fly-shape');
    var row = document.createElement('div');
    row.className = 'fly-row';
    [['line', '直线'], ['arrow', '箭头'], ['rect', '矩形'], ['ellipse', '圆形']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb';
      b.textContent = pair[1];
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectTool(pair[0]);
      });
      row.appendChild(b);
    });
    box.appendChild(row);
  }());

  /* 背景面板 */
  (function buildBgFly() {
    var box = document.getElementById('fly-bg');
    var row = document.createElement('div');
    row.className = 'fly-row';
    [['none', '空白'], ['grid', '方格'], ['line', '横线']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb' + (pair[0] === bg ? ' on' : '');
      b.textContent = pair[1];
      b.dataset.bg = pair[0];
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        bg = pair[0];
        box.querySelectorAll('[data-bg]').forEach(function (x) {
          x.classList.toggle('on', x.getAttribute('data-bg') === bg);
        });
        render();
        refreshThumb(doc.index);
        scheduleSave();
      });
      row.appendChild(b);
    });
    box.appendChild(row);
  }());

  document.getElementById('btn-bg').addEventListener('click', function (ev) {
    ev.stopPropagation();
    var g = document.getElementById('grp-bg');
    var open = !g.classList.contains('open');
    closeFlyouts();
    if (open) g.classList.add('open');
  });

  /* ================= 输入 ================= */
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
    if (tool === 'text') { openTextInput(p); return; }

    if (tool === 'pen' || tool === 'highlighter') {
      drawing = { type: tool, color: color, width: width, points: [{ x: p.x, y: p.y }] };
      render();
      return;
    }
    drawing = {
      type: 'shape',
      el: { type: tool, color: color, width: width, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
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
      refreshThumb(doc.index);
      render();
      scheduleSave();
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
    refreshThumb(doc.index);
    scheduleSave();
  }

  canvas.addEventListener('pointerup', function (e) { if (e.pointerId === pointerId) finish(); });
  canvas.addEventListener('pointercancel', function (e) { if (e.pointerId === pointerId) finish(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ================= 文字 ================= */
  function openTextInput(p) {
    if (textInput) commitText();
    var rect = canvas.getBoundingClientRect();
    var deskRect = desk.getBoundingClientRect();
    var input = document.createElement('input');
    input.className = 'text-input';
    input.type = 'text';
    input.placeholder = '输入文字，回车确认';
    var s = rect.width / doc.w;
    input.style.left = (rect.left - deskRect.left + p.x * s) + 'px';
    input.style.top = (rect.top - deskRect.top + (p.y - 26) * s) + 'px';
    input.dataset.x = p.x;
    input.dataset.y = p.y;
    desk.appendChild(input);
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
        type: 'text', color: color, size: 38, text: txt,
        x: parseFloat(input.dataset.x), y: parseFloat(input.dataset.y)
      });
      render();
      refreshThumb(doc.index);
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

  /* ================= 按钮 ================= */
  document.getElementById('btn-undo').addEventListener('click', function () {
    if (M.undo(doc)) { render(); refreshThumb(doc.index); scheduleSave(); }
  });
  document.getElementById('btn-redo').addEventListener('click', function () {
    if (M.redo(doc)) { render(); refreshThumb(doc.index); scheduleSave(); }
  });
  document.getElementById('btn-clear').addEventListener('click', function () {
    if (M.clearPage(doc)) { render(); refreshThumb(doc.index); scheduleSave(); }
  });
  document.getElementById('btn-prev').addEventListener('click', function () {
    M.gotoPage(doc, doc.index - 1); render();
  });
  document.getElementById('btn-next').addEventListener('click', function () {
    M.gotoPage(doc, doc.index + 1); render();
  });

  document.getElementById('btn-export').addEventListener('click', function () {
    var out = document.createElement('canvas');
    out.width = doc.w;
    out.height = doc.h;
    var g = out.getContext('2d');
    drawBackdrop(g, doc.w, doc.h);
    M.elements(doc).forEach(function (el) { drawEl(g, el); });
    var a = document.createElement('a');
    a.download = '白板-第' + (doc.index + 1) + '页.png';
    a.href = out.toDataURL('image/png');
    a.click();
  });

  document.getElementById('btn-full').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (desk.requestFullscreen) desk.requestFullscreen();
  });

  /* ================= 快捷键 ================= */
  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    var k = String(e.key).toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey ? M.redo(doc) : M.undo(doc)) { render(); refreshThumb(doc.index); scheduleSave(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      if (M.redo(doc)) { render(); refreshThumb(doc.index); scheduleSave(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'p') selectTool('pen');
    else if (k === 'e') selectTool('eraser');
    else if (k === 't') selectTool('text');
    else if (k === '[' || k === 'arrowleft') M.gotoPage(doc, doc.index - 1), render();
    else if (k === ']' || k === 'arrowright') M.gotoPage(doc, doc.index + 1), render();
  });

  window.addEventListener('resize', function () { layout(); });
  document.addEventListener('fullscreenchange', function () { window.setTimeout(layout, 80); });

  /* ================= 启动 ================= */
  (function boot() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) doc = M.load(raw);
    } catch (e) {}
    buildThumbs();
    layout();
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
        history: doc.history.length,
        thumbs: document.querySelectorAll('.thumb').length
      };
    },
    tool: function (t) { selectTool(t); },
    color: function (c) { color = c; },
    width: function (w) { width = w; },
    undo: function () { return M.undo(doc); },
    redo: function () { return M.redo(doc); },
    clear: function () {
      var r = M.clearPage(doc);
      render(); refreshThumb(doc.index);
      return r;
    },
    toPage: function (x, y) {
      var rect = canvas.getBoundingClientRect();
      return { x: rect.left + x / doc.w * rect.width, y: rect.top + y / doc.h * rect.height };
    },
    inkPixels: function () {
      var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var n = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
      }
      return n;
    }
  };
}());
