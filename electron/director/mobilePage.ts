// 导演台手机虚拟相机页（手机桥的页面契约）：横屏、左摇杆位移、右侧升降 / 焦距滑块、陀螺仪转向、复位横滚、开始 / 停止录制。
// 页面文案由桌面端随 start 载荷注入（渲染层 i18n），这里不写任何可见文字；WebSocket 发 32 字节 Float32 小端包
// [moveX, moveZ, elevation, dPitch, dYaw, dRoll, focalLengthMm, resetPose]，30Hz，陀螺仪增量在两包之间累加。
// 陀螺仪要安全上下文（HTTPS）+ iOS 需 requestPermission；页面自带说明位供桌面端文案填充。
// 配对（2026-09-11 安全加固）：URL 的 ?k= 是**一次性配对码**，连上后服务回一条 paired 换出会话令牌，
// 存 sessionStorage，之后重连一律走 ?s=，所以断线不用重新扫码；证书指纹从 location.hash 的 #fp= 读
// （fragment 不上线 = 从桌面走二维码过来的带外声明），显示出来供人眼与浏览器证书详情比对。

export type MobilePageText = Record<string, string>

const PAGE_CSS = `
*{box-sizing:border-box;margin:0;padding:0;-webkit-user-select:none;user-select:none;touch-action:none}
html,body{height:100%;background:#0f1115;color:#e8e8ec;font:14px/1.4 system-ui,sans-serif;overflow:hidden}
#app{display:flex;height:100%;flex-direction:column}
header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #26292f;font-size:13px}
header .dot{width:8px;height:8px;border-radius:50%;background:#6b7280}
header .dot.on{background:#22c55e}
.monitor{flex:1;min-height:70px;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden}#preview{width:100%;height:100%;object-fit:contain}main{flex:0 0 210px;display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px;min-height:0}
.pad{position:relative;border-radius:16px;background:#171a20;border:1px solid #26292f;display:flex;align-items:center;justify-content:center}
.stick{width:120px;height:120px;border-radius:50%;background:#1f232b;border:1px solid #2f343d;position:relative}
.knob{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:#3b82f6;box-shadow:0 2px 10px rgba(0,0,0,.4)}
.right{display:flex;flex-direction:column;gap:10px;padding:12px;min-height:0;overflow-y:auto}
.row{display:flex;align-items:center;gap:10px}
.row label{width:64px;font-size:12px;color:#9ca3af}
input[type=range]{flex:1;height:32px;accent-color:#3b82f6}
button{padding:10px 12px;border-radius:10px;border:1px solid #2f343d;background:#1f232b;color:#e8e8ec;font-size:14px}
button.primary{background:#3b82f6;border-color:#3b82f6}
button.rec{background:#dc2626;border-color:#dc2626}
button:disabled{opacity:.5}
.hint{font-size:12px;color:#9ca3af}
.fp{display:none;font-size:12px;color:#9ca3af}
.fp.on{display:block}
.fp code{display:block;margin-top:2px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8e8ec;word-break:break-all}
.fp.bad #fpHint{color:#f87171}
.vert{writing-mode:vertical-lr;direction:rtl;height:120px}
@media (orientation:portrait){main{grid-template-columns:1fr;grid-template-rows:1fr auto}}
`

const PAGE_JS = `
(function(){
  var T = window.__NOMI_MOBILE_TEXT__ || {};
  var $ = function(id){ return document.getElementById(id) };
  var q = new URLSearchParams(location.search);
  var pairingCode = q.get('k') || '';
  var SESSION_KEY = 'nomi:director:mobile:session';
  var session = '';
  try { session = sessionStorage.getItem(SESSION_KEY) || '' } catch (e) { session = '' }
  var expectedFp = '';
  try { expectedFp = (new URLSearchParams(String(location.hash || '').replace(/^#/, ''))).get('fp') || '' } catch (e) { expectedFp = '' }
  var status = $('status'), dot = $('dot');
  var ws = null, connected = false, previewUrl = null, disposed = false, reconnectTimer = null;
  var preview = $('preview');
  function clearPreview(){ preview.hidden = true; preview.removeAttribute('src'); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null }
  preview.onload = function(){ if (!disposed && connected && previewUrl && preview.currentSrc === previewUrl && preview.naturalWidth > 0) preview.hidden = false };
  preview.onerror = clearPreview;
  var stick = { x: 0, z: 0 };
  var elevation = 0, focal = 0, resetFlag = 0;
  var gyro = { dPitch: 0, dYaw: 0, dRoll: 0 };
  var last = null;
  function setStatus(text, on){ status.textContent = text; dot.className = on ? 'dot on' : 'dot' }
  // 设备名：品类 + 浏览器（UA 原串又长又难看，桌面端设备列表只需要认得出是哪台）
  function deviceName(){
    var ua = navigator.userAgent;
    var kind = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Device';
    var browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
    return kind + ' · ' + browser;
  }
  function connect(){
    if (disposed) return;
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    // 会话令牌优先：配对码用一次就废，重连靠它
    var usedSession = !!session;
    var query = usedSession ? 's=' + encodeURIComponent(session) : 'k=' + encodeURIComponent(pairingCode);
    ws = new WebSocket(proto + location.host + '/ws?' + query);
    var socket = ws, paired = false;
    ws.binaryType = 'blob';
    ws.onopen = function(){ if (disposed || ws !== socket) return; connected = true; setStatus(T.connected || 'connected', true); ws.send(JSON.stringify({ type: 'hello', role: 'phone', name: deviceName() })) };
    ws.onclose = function(){
      if (disposed || ws !== socket) return;
      connected = false; clearPreview(); recBtn.disabled = true;
      // 令牌是上一次服务留下的旧的（服务重启会清空会话）→ 退回用二维码里的配对码再试一次
      if (!paired && usedSession && pairingCode) { session = ''; try { sessionStorage.removeItem(SESSION_KEY) } catch (e) {} }
      setStatus(T.disconnected || 'disconnected', false); reconnectTimer = setTimeout(connect, 1500);
    };
    ws.onmessage = function(ev){
      if (disposed || !connected || ws !== socket) return;
      if (ev.data instanceof Blob) {
        var previous = previewUrl; previewUrl = URL.createObjectURL(ev.data); preview.src = previewUrl;
        if (previous) URL.revokeObjectURL(previous);
        return;
      }
      try {
        var m = JSON.parse(ev.data);
        if (m && m.type === 'paired') {
          paired = true;
          if (typeof m.s === 'string' && m.s) { session = m.s; try { sessionStorage.setItem(SESSION_KEY, m.s) } catch (e) {} }
          markFingerprint(typeof m.fp === 'string' ? m.fp : '');
        }
        else if (m && m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: m.t }));
        else if (m && m.type === 'state' && typeof m.recording === 'boolean') {
          recording = m.recording; recBtn.disabled = false;
          recBtn.textContent = recording ? T.stopRecording : T.startRecording;
          recBtn.className = recording ? 'rec' : 'primary';
        }
      } catch (e) {}
    };
  }
  // 证书指纹：显示的是二维码带过来的那串（带外），供人眼与浏览器证书详情比对；
  // 服务自己报的那串只用来做一次「二维码是不是旧的」一致性检查，不当安全保证。
  var fpBox = $('fp'), fpValue = $('fpValue');
  function groupFp(hex){ return (String(hex).replace(/[^0-9a-fA-F]/g, '').match(/../g) || []).join(':').toUpperCase() }
  function markFingerprint(serverFp){
    if (!expectedFp) return;
    var mine = groupFp(expectedFp), theirs = groupFp(serverFp);
    if (theirs && theirs !== mine) { fpBox.className = 'fp on bad'; if (T.fingerprintMismatch) $('fpHint').textContent = T.fingerprintMismatch }
  }
  if (expectedFp) { fpValue.textContent = groupFp(expectedFp); fpBox.className = 'fp on' }
  // 摇杆
  var pad = $('stick'), knob = $('knob'), active = null;
  function setKnob(dx, dy){ var r = 48; var len = Math.hypot(dx, dy); if (len > r) { dx = dx / len * r; dy = dy / len * r } knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; stick.x = dx / r; stick.z = -dy / r }
  pad.addEventListener('pointerdown', function(e){ active = e.pointerId; pad.setPointerCapture(e.pointerId); var b = pad.getBoundingClientRect(); setKnob(e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2) });
  pad.addEventListener('pointermove', function(e){ if (e.pointerId !== active) return; var b = pad.getBoundingClientRect(); setKnob(e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2) });
  function release(e){ if (e.pointerId !== active) return; active = null; setKnob(0, 0) }
  pad.addEventListener('pointerup', release); pad.addEventListener('pointercancel', release);
  // 升降 / 焦距
  var lift = $('lift'); lift.addEventListener('input', function(){ elevation = Number(lift.value) / 100 }); lift.addEventListener('change', function(){ lift.value = 0; elevation = 0 });
  var focalInput = $('focal'), focalLabel = $('focalLabel');
  focalInput.addEventListener('input', function(){ focal = Number(focalInput.value); focalLabel.textContent = focal + 'mm' });
  // 陀螺仪
  var gyroBtn = $('gyro'), gyroOn = false;
  function onOrient(e){
    if (e.alpha == null) return;
    var angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    var yaw = e.alpha, pitch = e.beta, roll = e.gamma;
    if (angle === 90) { pitch = -e.gamma; roll = e.beta } else if (angle === -90 || angle === 270) { pitch = e.gamma; roll = -e.beta }
    if (last) {
      var dy = yaw - last.yaw; if (dy > 180) dy -= 360; if (dy < -180) dy += 360;
      gyro.dYaw += -dy; gyro.dPitch += (pitch - last.pitch); gyro.dRoll += (roll - last.roll);
    }
    last = { yaw: yaw, pitch: pitch, roll: roll };
  }
  gyroBtn.addEventListener('click', function(){
    var start = function(){ window.addEventListener('deviceorientation', onOrient); gyroOn = true; gyroBtn.disabled = true; gyroBtn.textContent = T.gyroOn || 'gyro on' };
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function(state){ if (state === 'granted') start(); else setStatus(T.gyroDenied || 'gyro denied', connected) }).catch(function(){ setStatus(T.gyroDenied || 'gyro denied', connected) });
    } else start();
  });
  $('resetRoll').addEventListener('click', function(){ resetFlag = 1 });
  var recBtn = $('record'), recording = false;
  recBtn.disabled = true;
  recBtn.addEventListener('click', function(){ if (!connected) return; recBtn.disabled = true; ws.send(JSON.stringify({ type: 'record', action: recording ? 'stop' : 'start' })) });
  // 30Hz 发包
  var buf = new ArrayBuffer(32), view = new DataView(buf);
  var packetTimer = setInterval(function(){
    if (!connected || !ws || ws.readyState !== 1) return;
    var v = [stick.x, stick.z, elevation, gyro.dPitch, gyro.dYaw, gyro.dRoll, focal, resetFlag];
    for (var i = 0; i < 8; i++) view.setFloat32(i * 4, v[i], true);
    ws.send(buf);
    gyro.dPitch = 0; gyro.dYaw = 0; gyro.dRoll = 0; resetFlag = 0; focal = 0;
  }, 1000 / 30);
  var fill = function(id, key){ var el = $(id); if (el && T[key]) el.textContent = T[key] };
  fill('title', 'title'); fill('liftLabel', 'lift'); fill('focalTitle', 'focal'); fill('gyro', 'gyroOff'); fill('resetRoll', 'resetRoll'); fill('record', 'startRecording'); fill('hint', 'hint');
  fill('fpLabel', 'fingerprint'); fill('fpHint', 'fingerprintHint');
  setStatus(T.connecting || 'connecting', false);
  window.addEventListener('pagehide', function(){ disposed = true; connected = false; clearInterval(packetTimer); clearTimeout(reconnectTimer); window.removeEventListener('deviceorientation', onOrient); clearPreview(); if (ws) { ws.onclose = null; ws.close() } });
  connect();
})();
`

export function renderMobilePage(text: MobilePageText): string {
  const json = JSON.stringify(text).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><link rel="icon" href="data:,"><title>Nomi</title><style>${PAGE_CSS}</style></head><body><div id="app"><header><span id="dot" class="dot"></span><strong id="title"></strong><span id="status"></span></header><section class="monitor"><img id="preview" alt="" hidden></section><main><div class="pad"><div id="stick" class="stick"><div id="knob" class="knob"></div></div></div><div class="right"><div class="row"><label id="liftLabel"></label><input id="lift" type="range" min="-100" max="100" value="0"></div><div class="row"><label id="focalTitle"></label><input id="focal" type="range" min="12" max="300" value="35"><span id="focalLabel">35mm</span></div><div class="row"><button id="gyro"></button><button id="resetRoll"></button><button id="record" class="primary"></button></div><p id="hint" class="hint"></p><div id="fp" class="fp"><strong id="fpLabel"></strong><code id="fpValue"></code><span id="fpHint"></span></div></div></main></div><script>window.__NOMI_MOBILE_TEXT__=${json}</script><script>${PAGE_JS}</script></body></html>`
}
