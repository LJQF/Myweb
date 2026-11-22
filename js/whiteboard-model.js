/* ==========================================================================
   whiteboard-model.js —— 白板的数据模型（纯逻辑，不依赖 DOM）
   页面 = 元素数组；元素分笔迹 / 图形 / 文字三类
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_HISTORY = 60;
  var PAGE_W = 1600;
  var PAGE_H = 900;

  function create() {
    return {
      w: PAGE_W,
      h: PAGE_H,
      pages: [{ elements: [] }],
      index: 0,
      history: [],
      future: [],
      seq: 1
    };
  }

  function page(doc) { return doc.pages[doc.index]; }
  function elements(doc) { return page(doc).elements; }

  function snapshot(doc) {
    doc.history.push({ index: doc.index, elements: elements(doc).slice() });
    if (doc.history.length > MAX_HISTORY) doc.history.shift();
    doc.future.length = 0;
  }

  function addElement(doc, el) {
    if (!el) return null;
    snapshot(doc);
    el.id = doc.seq++;
    elements(doc).push(el);
    return el;
  }

  function undo(doc) {
    if (!doc.history.length) return false;
    doc.future.push({ index: doc.index, elements: elements(doc).slice() });
    var s = doc.history.pop();
    doc.index = Math.min(s.index, doc.pages.length - 1);
    doc.pages[doc.index].elements = s.elements;
    return true;
  }

  function redo(doc) {
    if (!doc.future.length) return false;
    doc.history.push({ index: doc.index, elements: elements(doc).slice() });
    var s = doc.future.pop();
    doc.index = Math.min(s.index, doc.pages.length - 1);
    doc.pages[doc.index].elements = s.elements;
    return true;
  }

  function clearPage(doc) {
    if (!elements(doc).length) return false;
    snapshot(doc);
    doc.pages[doc.index].elements = [];
    return true;
  }

  function addPage(doc) {
    doc.pages.splice(doc.index + 1, 0, { elements: [] });
    doc.index += 1;
    doc.history.length = 0;
    doc.future.length = 0;
    return doc.index;
  }

  function delPage(doc) {
    if (doc.pages.length <= 1) {
      clearPage(doc);
      return doc.index;
    }
    doc.pages.splice(doc.index, 1);
    doc.index = Math.min(doc.index, doc.pages.length - 1);
    doc.history.length = 0;
    doc.future.length = 0;
    return doc.index;
  }

  function gotoPage(doc, i) {
    doc.index = Math.max(0, Math.min(doc.pages.length - 1, i));
    doc.history.length = 0;
    doc.future.length = 0;
    return doc.index;
  }

  /* ---------------- 命中测试（橡皮） ---------------- */
  function bboxOf(el) {
    if (el.type === 'pen' || el.type === 'highlighter') {
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (var i = 0; i < el.points.length; i++) {
        var p = el.points[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      var pad = el.width / 2 + 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    if (el.type === 'text') {
      return { x: el.x, y: el.y - el.size, w: Math.max(40, (el.text || '').length * el.size * 0.62), h: el.size * 1.35 };
    }
    var x1 = Math.min(el.x1, el.x2), y1 = Math.min(el.y1, el.y2);
    var x2 = Math.max(el.x1, el.x2), y2 = Math.max(el.y1, el.y2);
    var pad2 = el.width / 2 + 2;
    return { x: x1 - pad2, y: y1 - pad2, w: x2 - x1 + pad2 * 2, h: y2 - y1 + pad2 * 2 };
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + dx * t, cy = ay + dy * t;
    return Math.hypot(px - cx, py - cy);
  }

  function hitElement(el, x, y, r) {
    if (el.type === 'pen' || el.type === 'highlighter') {
      var rr = r + el.width / 2;
      for (var i = 1; i < el.points.length; i++) {
        var a = el.points[i - 1], b = el.points[i];
        if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= rr) return true;
      }
      if (el.points.length === 1) {
        var p0 = el.points[0];
        return Math.hypot(x - p0.x, y - p0.y) <= rr;
      }
      return false;
    }
    if (el.type === 'text') {
      var bb = bboxOf(el);
      return x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h;
    }
    /* 图形：按边线判断（矩形/椭圆/直线/箭头） */
    var pad = r + el.width / 2;
    if (el.type === 'line' || el.type === 'arrow') {
      return distToSeg(x, y, el.x1, el.y1, el.x2, el.y2) <= pad;
    }
    if (el.type === 'rect') {
      var l = Math.min(el.x1, el.x2), t = Math.min(el.y1, el.y2);
      var w = Math.abs(el.x2 - el.x1), h = Math.abs(el.y2 - el.y1);
      return distToSeg(x, y, l, t, l + w, t) <= pad
          || distToSeg(x, y, l + w, t, l + w, t + h) <= pad
          || distToSeg(x, y, l + w, t + h, l, t + h) <= pad
          || distToSeg(x, y, l, t + h, l, t) <= pad;
    }
    if (el.type === 'ellipse') {
      var cx = (el.x1 + el.x2) / 2, cy = (el.y1 + el.y2) / 2;
      var rx = Math.abs(el.x2 - el.x1) / 2, ry = Math.abs(el.y2 - el.y1) / 2;
      if (rx < 1 || ry < 1) return false;
      var nx = (x - cx) / (rx + pad), ny = (y - cy) / (ry + pad);
      return Math.abs(nx * nx + ny * ny - 1) < 0.35;
    }
    return false;
  }

  /* 擦掉圆形范围内的元素，返回擦掉的数量 */
  function eraseAt(doc, x, y, r) {
    var list = elements(doc);
    var keep = [];
    var removed = 0;
    for (var i = 0; i < list.length; i++) {
      if (hitElement(list[i], x, y, r)) removed++;
      else keep.push(list[i]);
    }
    if (removed) {
      snapshot(doc);
      doc.pages[doc.index].elements = keep;
    }
    return removed;
  }

  /* ---------------- 存档 ---------------- */
  function serialize(doc) {
    return JSON.stringify({
      v: 1,
      w: doc.w,
      h: doc.h,
      index: doc.index,
      seq: doc.seq,
      pages: doc.pages.map(function (p) { return { elements: p.elements }; })
    });
  }

  function load(json) {
    try {
      var o = typeof json === 'string' ? JSON.parse(json) : json;
      if (!o || !o.pages || !o.pages.length) return create();
      return {
        w: o.w || PAGE_W,
        h: o.h || PAGE_H,
        pages: o.pages.map(function (p) { return { elements: (p.elements || []).slice() }; }),
        index: Math.max(0, Math.min(o.pages.length - 1, o.index || 0)),
        history: [],
        future: [],
        seq: o.seq || 1
      };
    } catch (e) {
      return create();
    }
  }

  return {
    PAGE_W: PAGE_W, PAGE_H: PAGE_H,
    create: create,
    page: page,
    elements: elements,
    addElement: addElement,
    undo: undo,
    redo: redo,
    clearPage: clearPage,
    addPage: addPage,
    delPage: delPage,
    gotoPage: gotoPage,
    eraseAt: eraseAt,
    hitElement: hitElement,
    bboxOf: bboxOf,
    serialize: serialize,
    load: load
  };
}));
