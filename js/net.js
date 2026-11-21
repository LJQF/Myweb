/* ==========================================================================
   net.js —— 联机层（服务器中转版）

   不再用 WebRTC 点对点，改成两台电脑都连到公共 MQTT 服务器，
   由服务器转发消息。好处是跨网络（不同局域网、手机热点）也能连上。

   房间号仍然是 8 位数字，映射成主题：
       xiaozhan/<游戏前缀>/<8位数字>

   对外接口和之前的 P2P 版本完全一样：
       Net.create({ host, code, prefix, onStatus, onData })
       room.send(msg) / room.close() / room.connected / room.code
   ========================================================================== */
(function (root) {
  'use strict';

  var DEFAULT_PREFIX = 'xqz-';
  var BASE_TOPIC = 'xiaozhan/';

  /* 公共 MQTT 服务器（浏览器走 WSS）。房主固定第一个，连不上才换；
     加入方依次尝试，因为不知道房主落在哪一台。 */
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];

  var HEARTBEAT_MS = 4000;     /* 自己多久发一次心跳 */
  var PEER_TIMEOUT_MS = 14000; /* 多久收不到对方消息就认为掉线 */
  var GUEST_WAIT_MS = 7000;    /* 加入方在每台服务器上等多久 */
  var JOIN_RETRY_MS = 2500;    /* 加入方每隔多久重发一次 join */

  function randomDigits(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  function randomId() {
    return 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function sanitize(s) {
    return String(s || '').replace(/[^a-zA-Z0-9]/g, '') || 'xqz';
  }

  function create(opts) {
    opts = opts || {};

    var room = {
      isHost: !!opts.host,
      code: opts.code || null,
      connected: false
    };

    var prefix = sanitize(opts.prefix || DEFAULT_PREFIX);
    var myId = randomId();
    var topic = null;
    var client = null;
    var brokerIdx = 0;
    var closed = false;
    var announced = false;

    var lastPeer = 0;
    var hbTimer = 0;
    var watchTimer = 0;
    var joinTimer = 0;
    var waitTimer = 0;

    function status(name, data) {
      if (closed) return;
      if (typeof opts.onStatus === 'function') opts.onStatus(name, data || {});
    }

    function emitData(msg) {
      if (closed) return;
      if (typeof opts.onData === 'function') opts.onData(msg);
    }

    function publish(payload) {
      if (!client || !client.connected) return;
      payload.cli = myId;
      try {
        client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false });
      } catch (e) { /* 忽略 */ }
    }

    function markConnected() {
      if (room.connected) return;
      room.connected = true;
      stopJoinLoop();
      startTimers();
      status('connected');
    }

    /* ---------------- 收消息 ---------------- */
    function onMessage(t, payload) {
      if (closed || t !== topic) return;

      var msg;
      try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
      if (!msg || msg.cli === myId) return;   /* 自己发的，忽略 */

      lastPeer = Date.now();

      if (msg.t === 'join') {
        if (room.isHost) {
          markConnected();
          publish({ t: 'hello' });
        }
        return;
      }

      if (msg.t === 'hello') {
        if (!room.isHost) markConnected();
        return;
      }

      if (msg.t === 'bye') {
        if (room.connected) status('peer-left');
        return;
      }

      if (!room.connected) markConnected();
      emitData(msg);
    }

    /* ---------------- 心跳 / 掉线检测 ---------------- */
    function startTimers() {
      hbTimer = root.setInterval(function () {
        publish({ t: 'ping' });
      }, HEARTBEAT_MS);

      watchTimer = root.setInterval(function () {
        if (!room.connected) return;
        if (Date.now() - lastPeer > PEER_TIMEOUT_MS) {
          room.connected = false;
          status('peer-left');
        }
      }, 2000);
    }

    function stopTimers() {
      if (hbTimer) { root.clearInterval(hbTimer); hbTimer = 0; }
      if (watchTimer) { root.clearInterval(watchTimer); watchTimer = 0; }
    }

    /* 加入方：隔一会儿再喊一声，防止房主还没订阅好 */
    function stopJoinLoop() {
      if (joinTimer) { root.clearInterval(joinTimer); joinTimer = 0; }
      if (waitTimer) { root.clearTimeout(waitTimer); waitTimer = 0; }
    }

    function startJoinLoop() {
      publish({ t: 'join' });

      joinTimer = root.setInterval(function () {
        if (room.connected || closed) { stopJoinLoop(); return; }
        publish({ t: 'join' });
      }, JOIN_RETRY_MS);

      waitTimer = root.setTimeout(function () {
        if (closed || room.connected) return;
        endClient();
        brokerIdx++;
        if (brokerIdx >= BROKERS.length) {
          status('error', { code: 'not-found', message: '没找到这个房间（房主那台可能没开，或者数字不对）' });
          return;
        }
        openBroker();
      }, GUEST_WAIT_MS);
    }

    /* ---------------- 连接服务器 ---------------- */
    function endClient() {
      if (!client) return;
      var c = client;
      client = null;
      try { c.removeAllListeners(); } catch (e) { }
      try { c.end(true); } catch (e) { }
    }

    function openBroker() {
      if (closed) return;
      if (typeof root.mqtt === 'undefined') {
        status('error', { code: 'nolib', message: '联机组件没有加载成功' });
        return;
      }

      var url = BROKERS[brokerIdx];
      var c;
      try {
        c = root.mqtt.connect(url, {
          clientId: 'xz' + myId,
          connectTimeout: 9000,
          reconnectPeriod: 0,
          clean: true,
          keepalive: 30
        });
      } catch (e) {
        status('error', { code: 'init', message: '联机组件初始化失败' });
        return;
      }

      client = c;
      var settled = false;

      c.on('connect', function () {
        if (closed) return;
        settled = true;

        c.subscribe(topic, { qos: 1 }, function (err) {
          if (closed) return;
          if (err) {
            status('error', { code: 'sub', message: '订阅房间失败' });
            return;
          }

          if (room.isHost) {
            status('code', { code: room.code });
          } else {
            startJoinLoop();
          }
        });
      });

      c.on('message', onMessage);


      c.on('close', function () {
        if (closed || !settled) return;
        if (room.connected) {
          room.connected = false;
          status('peer-left');
        }
      });

      /* 连不上这台就换下一台 */
      function failBroker() {
        if (closed) return;
        endClient();
        brokerIdx++;
        if (brokerIdx >= BROKERS.length) {
          status('error', { code: 'network', message: '连不上联机服务器，检查网络后再试' });
          return;
        }
        openBroker();
      }

      c.on('error', function (err) {
        if (closed || settled) return;
        failBroker();
      });
    }

    /* ---------------- 对外 ---------------- */
    room.send = function (msg) {
      if (!msg) return;
      publish(msg);
    };

    room.close = function () {
      if (closed) return;
      try { publish({ t: 'bye' }); } catch (e) { }
      closed = true;
      stopTimers();
      stopJoinLoop();
      endClient();
    };

    room.ping = function () {
      publish({ t: 'ping' });
    };

    /* 生成房间号 / 建主题 */
    if (room.isHost) {
      room.code = randomDigits(8);
    }
    if (!room.code) {
      status('error', { code: 'nocode', message: '缺少房间号' });
      return room;
    }
    topic = BASE_TOPIC + prefix + '/' + room.code;

    openBroker();

    return room;
  }

  root.Net = {
    create: create,
    randomCode: function () { return randomDigits(8); },
    DEFAULT_PREFIX: DEFAULT_PREFIX,
    BROKERS: BROKERS,
    BASE_TOPIC: BASE_TOPIC
  };
}(typeof self !== 'undefined' ? self : this));
