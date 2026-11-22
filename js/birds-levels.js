/* ==========================================================================
   birds-levels.js —— 关卡数据
   坐标单位：像素；地面顶部 y = 820；小鸟弹弓在 x ≈ 210
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BirdsLevels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GROUND = 820;

  /* 从地面往上堆：posts = 两根立柱，slab = 一块横板 */
  function stack(cx, width, rows) {
    var blocks = [];
    var y = GROUND;
    rows.forEach(function (row) {
      if (row.type === 'slab') {
        var h = row.h || 26;
        blocks.push({ x: cx, y: y - h / 2, w: row.w || width, h: h, mat: row.mat || 'wood' });
        y -= h;
      } else {
        var ph = row.h || 110;
        var dx = (row.w || width) / 2 - 13;
        if (row.wide) { blocks.push({ x: cx, y: y - ph / 2, w: row.wide, h: ph, mat: row.mat || 'wood' }); }
        else {
          blocks.push({ x: cx - dx, y: y - ph / 2, w: 26, h: ph, mat: row.mat || 'wood' });
          blocks.push({ x: cx + dx, y: y - ph / 2, w: 26, h: ph, mat: row.mat || 'wood' });
        }
        y -= ph;
      }
    });
    return { blocks: blocks, top: y };
  }

  function pig(x, y, r) { return { x: x, y: y, r: r || 26 }; }

  /* ---------------- 第 1 关：简单小屋 ---------------- */
  var t1 = stack(1060, 150, [
    { type: 'posts', h: 110 },
    { type: 'slab', w: 170 }
  ]);

  /* ---------------- 第 2 关：双子塔 ---------------- */
  function twin(cx, mat) {
    var t = stack(cx, 140, [
      { type: 'posts', h: 110, mat: mat },
      { type: 'slab', w: 160, mat: mat }
    ]);
    return { blocks: t.blocks, top: t.top };
  }
  var t2a = twin(980, 'wood');
  var t2b = twin(1240, 'wood');

  /* ---------------- 第 3 关：石堡 ---------------- */
  var t3 = stack(1120, 190, [
    { type: 'posts', h: 120, mat: 'stone' },
    { type: 'slab', w: 210, mat: 'stone' },
    { type: 'posts', h: 90, mat: 'stone' },
    { type: 'slab', w: 170, mat: 'wood' }
  ]);

  /* ---------------- 第 4 关：冰塔 ---------------- */
  var t4 = stack(1080, 150, [
    { type: 'posts', h: 100, mat: 'ice' },
    { type: 'slab', w: 160, mat: 'ice' },
    { type: 'posts', h: 100, mat: 'ice' },
    { type: 'slab', w: 150, mat: 'wood' }
  ]);

  /* ---------------- 第 5 关：高塔 ---------------- */
  var t5a = stack(1020, 140, [
    { type: 'posts', h: 105, mat: 'wood' },
    { type: 'slab', w: 160, mat: 'wood' },
    { type: 'posts', h: 100, mat: 'ice' },
    { type: 'slab', w: 140, mat: 'wood' }
  ]);
  var t5b = stack(1210, 140, [
    { type: 'posts', h: 105, mat: 'wood' },
    { type: 'slab', w: 160, mat: 'wood' },
    { type: 'posts', h: 100, mat: 'ice' },
    { type: 'slab', w: 140, mat: 'wood' }
  ]);

  /* ---------------- 第 6 关：要塞 ---------------- */
  var t6a = stack(960, 140, [
    { type: 'posts', h: 110, mat: 'stone' },
    { type: 'slab', w: 160, mat: 'stone' }
  ]);
  var t6b = stack(1280, 140, [
    { type: 'posts', h: 110, mat: 'stone' },
    { type: 'slab', w: 160, mat: 'stone' }
  ]);

  var LEVELS = [
    {
      name: '小木屋',
      birds: 3,
      blocks: t1.blocks,
      pigs: [pig(1060, GROUND - 26), pig(1060, t1.top - 26)]
    },
    {
      name: '双子塔',
      birds: 3,
      blocks: t2a.blocks.concat(t2b.blocks),
      pigs: [
        pig(980, GROUND - 26), pig(980, t2a.top - 26),
        pig(1240, GROUND - 26), pig(1240, t2b.top - 26)
      ]
    },
    {
      name: '石堡',
      birds: 4,
      blocks: t3.blocks,
      pigs: [
        pig(1120, GROUND - 26),
        pig(1080, t3.top - 26),
        pig(1160, t3.top - 26)
      ]
    },
    {
      name: '冰塔',
      birds: 3,
      blocks: t4.blocks,
      pigs: [
        pig(1080, GROUND - 26),
        pig(1080, 820 - 100 - 26 - 26),
        pig(1080, t4.top - 26)
      ]
    },
    {
      name: '高塔',
      birds: 4,
      blocks: t5a.blocks.concat(t5b.blocks),
      pigs: [
        pig(1020, GROUND - 26), pig(1020, t5a.top - 26),
        pig(1210, GROUND - 26), pig(1210, t5b.top - 26),
        pig(1115, GROUND - 26)
      ]
    },
    {
      name: '要塞',
      birds: 4,
      blocks: t6a.blocks.concat(t6b.blocks),
      pigs: [
        pig(960, GROUND - 26), pig(960, t6a.top - 26),
        pig(1280, GROUND - 26), pig(1280, t6b.top - 26),
        pig(1120, GROUND - 26)
      ]
    }
  ];

  return { LEVELS: LEVELS, GROUND: GROUND };
}));
