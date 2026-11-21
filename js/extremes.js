/* ==========================================================================
   全局最值分析（不依赖视野）

   返回 { max, min, maxInf, minInf }
     maxInf / minInf 为 true 时表示该方向发散到无穷
   ========================================================================== */
(function (root) {
  'use strict';

  var BIG = 1e12;      /* 认为"炸了"的量级 */
  var NEAR_R = 50;     /* 中段均匀采样范围 [-50, 50] */
  var NEAR_N = 4000;   /* 中段采样点数 */

  /* 单个方向（x→+∞ 或 x→−∞）上，|f| 是否持续增大 */
  function farDiverges(fn, sign) {
    var abs = [];
    var signValue = 0;
    var sawInf = 0;

    for (var e = 2; e <= 9; e++) {
      var bestAbs = 0;
      for (var t = 1; t <= 4; t++) {
        var x = sign * t * Math.pow(10, e);
        var y = fn(x);
        if (y === Infinity) { sawInf = 1; continue; }
        if (y === -Infinity) { sawInf = -1; continue; }
        if (!isFinite(y)) continue;
        var a = Math.abs(y);
        if (a > bestAbs) { bestAbs = a; signValue = y > 0 ? 1 : -1; }
      }
      abs.push(bestAbs);
    }

    if (sawInf === 1) return 1;
    if (sawInf === -1) return -1;

    /* 要求：总体上 |f| 在增长，且最后比开头大 5 倍以上 */
    var grows = 0;
    var pairs = 0;
    for (var i = 1; i < abs.length; i++) {
      if (abs[i - 1] <= 0 || abs[i] <= 0) continue;
      pairs++;
      if (abs[i] > abs[i - 1] * 1.05) grows++;
    }
    var first = 0, last = 0;
    for (var j = 0; j < abs.length; j++) {
      if (abs[j] > 0) { first = abs[j]; break; }
    }
    for (var k = abs.length - 1; k >= 0; k--) {
      if (abs[k] > 0) { last = abs[k]; break; }
    }

    if (pairs >= 4 && grows >= pairs * 0.7 && last > first * 3 && last > 20) {
      return signValue;
    }
    return 0;
  }

  /* x→0+ / x→0− 方向 */
  function zeroDiverges(fn, sign) {
    var abs = [];
    var signValue = 0;

    for (var e = -1; e >= -9; e--) {
      var bestAbs = 0;
      for (var t = 1; t <= 4; t++) {
        var x = sign * t * Math.pow(10, e);
        var y = fn(x);
        if (!isFinite(y)) continue;
        var a = Math.abs(y);
        if (a > bestAbs) { bestAbs = a; signValue = y > 0 ? 1 : -1; }
      }
      abs.push(bestAbs);
    }

    var grows = 0;
    var pairs = 0;
    for (var i = 1; i < abs.length; i++) {
      if (abs[i - 1] <= 0 || abs[i] <= 0) continue;
      pairs++;
      if (abs[i] > abs[i - 1] * 1.05) grows++;
    }
    var first = 0, last = 0;
    for (var j = 0; j < abs.length; j++) {
      if (abs[j] > 0) { first = abs[j]; break; }
    }
    for (var k = abs.length - 1; k >= 0; k--) {
      if (abs[k] > 0) { last = abs[k]; break; }
    }

    if (pairs >= 4 && grows >= pairs * 0.7 && last > first * 3 && last > 20) {
      return signValue;
    }
    return 0;
  }

  function compute(fn) {
    var maxV = -Infinity;
    var minV = Infinity;
    var maxInf = false;
    var minInf = false;
    var i;

    /* ---- 1. 中段均匀采样 ---- */
    var xs = new Array(NEAR_N + 1);
    var ys = new Array(NEAR_N + 1);
    for (i = 0; i <= NEAR_N; i++) {
      var x = -NEAR_R + (2 * NEAR_R) * i / NEAR_N;
      var y = fn(x);
      xs[i] = x;
      ys[i] = y;
      if (y === Infinity) { maxInf = true; }
      else if (y === -Infinity) { minInf = true; }
      else if (isFinite(y)) {
        if (y > maxV) maxV = y;
        if (y < minV) minV = y;
      }
    }

    /* ---- 2. 多尺度采样（很小的 x 和很大的 x） ---- */
    for (var k = -9; k <= 9; k++) {
      var base = Math.pow(10, k);
      for (var m = 1; m <= 9; m++) {
        var v = m * base;
        var y1 = fn(v);
        if (y1 === Infinity) maxInf = true;
        else if (y1 === -Infinity) minInf = true;
        else if (isFinite(y1)) { if (y1 > maxV) maxV = y1; if (y1 < minV) minV = y1; }
        var y2 = fn(-v);
        if (y2 === Infinity) maxInf = true;
        else if (y2 === -Infinity) minInf = true;
        else if (isFinite(y2)) { if (y2 > maxV) maxV = y2; if (y2 < minV) minV = y2; }
      }
    }

    /* ---- 3. 变号处的极点（tan、1/x 这类） ---- */
    var poleFound = false;
    for (i = 1; i <= NEAR_N; i++) {
      var a = ys[i - 1];
      var b = ys[i];
      if (!isFinite(a) || !isFinite(b)) continue;
      if (a * b >= 0) continue;
      if (Math.abs(a) + Math.abs(b) < 20) continue;   /* 普通零点，跳过 */

      var lo = xs[i - 1];
      var hi = xs[i];
      var flo = a;
      var blew = false;
      for (var it = 0; it < 60; it++) {
        var mid = (lo + hi) / 2;
        var fm = fn(mid);
        if (!isFinite(fm) || Math.abs(fm) > BIG) { blew = true; break; }
        if (fm * flo > 0) { lo = mid; flo = fm; }
        else { hi = mid; }
      }
      if (blew) { poleFound = true; break; }
    }
    if (poleFound) { maxInf = true; minInf = true; }

    /* ---- 4. 无变号的尖峰（1/x²、(x-5)⁻² 这类） ---- */
    if (!maxInf || !minInf) {
      for (i = 1; i < NEAR_N; i++) {
        var y0 = ys[i];
        if (!isFinite(y0) || Math.abs(y0) < 1000) continue;
        var isPeak = y0 > ys[i - 1] && y0 > ys[i + 1];
        var isValley = y0 < ys[i - 1] && y0 < ys[i + 1];
        if (!isPeak && !isValley) continue;

        var lo2 = xs[i - 1];
        var hi2 = xs[i + 1];
        var best = y0;
        for (var t2 = 1; t2 < 200; t2++) {
          var xx = lo2 + (hi2 - lo2) * t2 / 200;
          var yy = fn(xx);
          if (isFinite(yy) && Math.abs(yy) > Math.abs(best)) best = yy;
        }
        if (Math.abs(best) > Math.abs(y0) * 10) {
          if (best > 0) maxInf = true; else minInf = true;
        }
      }
    }

    /* ---- 5. 无穷远处 ---- */
    var farRight = farDiverges(fn, 1);
    var farLeft = farDiverges(fn, -1);
    if (farRight > 0 || farLeft > 0) maxInf = true;
    if (farRight < 0 || farLeft < 0) minInf = true;

    /* ---- 6. 零点附近 ---- */
    var zeroRight = zeroDiverges(fn, 1);
    var zeroLeft = zeroDiverges(fn, -1);
    if (zeroRight > 0 || zeroLeft > 0) maxInf = true;
    if (zeroRight < 0 || zeroLeft < 0) minInf = true;

    return {
      max: maxV,
      min: minV,
      maxInf: maxInf,
      minInf: minInf
    };
  }

  root.PlotExtremes = { compute: compute };
}(typeof self !== 'undefined' ? self : this));
