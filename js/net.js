/* ==========================================================================
   net.js —— 联机层（PeerJS / WebRTC 数据通道）
   房间号就是 8 位数字，映射成 PeerJS 的 peer id：xqz-12345678
   ========================================================================== */
(function (root) {
  'use strict';

  var DEFAULT_PREFIX = 'xqz-';   /* 象棋用 xqz-，五子棋传 gom-，两边的房间号互不干扰 */

  var RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.miwifi.com:3478' }
    ]
  };

  function randomCode() {
    var s = '';
    for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  /**
   * create({ host, code, onStatus(name, data), onData(msg) })
   *   name: 'code' | 'connected' | 'peer-left' | 'error'
   */
  function create(opts) {
    opts = opts || {};
    var prefix = opts.prefix || DEFAULT_PREFIX;
    var PREFIX = prefix;
    var peer = null;
    var conn = null;
    var closed = false;
    var retries = 0;

    var room = {
      isHost: !!opts.host,
      code: opts.code || null,
      connected: false
    };

    function emit(name, data) {
      if (closed) return;
      if (typeof opts.onStatus === 'function') opts.onStatus(name, data || {});
    }

    function bind(c) {
      if (conn) { try { c.close(); } catch (e) {} return; }
      conn = c;
      c.on('open', function () {
        room.connected = true;
        emit('connected');
      });
      c.on('data', function (msg) {
        if (!closed && typeof opts.onData === 'function') opts.onData(msg);
      });
      c.on('close', function () {
        room.connected = false;
        emit('peer-left');
      });
      c.on('error', function (err) {
        emit('error', { code: 'conn', message: (err && err.message) || '连接出错' });
      });
    }

    function start(id) {
      try {
        peer = new root.Peer(id, { config: RTC_CONFIG, debug: 0 });
      } catch (err) {
        emit('error', { code: 'init', message: '联机组件初始化失败' });
        return;
      }

      peer.on('open', function () {
        if (closed) return;
        if (room.isHost) {
          emit('code', { code: room.code });
        } else {
          bind(peer.connect(PREFIX + room.code, { reliable: true }));
        }
      });

      peer.on('connection', function (c) {
        if (closed || !room.isHost) { try { c.close(); } catch (e) {} return; }
        bind(c);
      });

      peer.on('error', function (err) {
        var type = err && err.type;

        /* 房间号撞车了，换一个重试 */
        if (type === 'unavailable-id' && room.isHost && retries < 3) {
          retries++;
          room.code = randomCode();
          try { peer.destroy(); } catch (e) {}
          start(PREFIX + room.code);
          return;
        }
        if (type === 'peer-unavailable') {
          emit('error', { code: 'not-found', message: '没找到这个房间，检查一下数字是否正确' });
          return;
        }
        if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
          emit('error', { code: 'network', message: '连不上联机服务器，检查网络后再试' });
          return;
        }
        emit('error', { code: type || 'unknown', message: (err && err.message) || '联机出错了' });
      });

      peer.on('disconnected', function () {
        if (closed) return;
        try { peer.reconnect(); } catch (e) {}
      });
    }

    room.send = function (msg) {
      if (conn && conn.open) {
        try { conn.send(msg); } catch (e) {}
      }
    };

    room.close = function () {
      closed = true;
      try { if (conn) conn.close(); } catch (e) {}
      try { if (peer) peer.destroy(); } catch (e) {}
    };

    if (typeof root.Peer === 'undefined') {
      emit('error', { code: 'nolib', message: '联机组件没有加载成功' });
      return room;
    }

    if (room.isHost) {
      room.code = randomCode();
      start(PREFIX + room.code);
    } else {
      start(null);
    }

    return room;
  }

  root.Net = { create: create, randomCode: randomCode, DEFAULT_PREFIX: DEFAULT_PREFIX };
}(typeof self !== 'undefined' ? self : this));
