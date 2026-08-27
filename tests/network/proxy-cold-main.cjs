// A real Electron main process, not ELECTRON_RUN_AS_NODE. All endpoints and
// credentials are synthetic; no request can reach a paid provider.
const assert = require('node:assert/strict');
const { app, session } = require('electron');
const { createServer } = require('node:http');
const { connect, createServer: createTcpServer } = require('node:net');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const buildRoot = process.argv[process.argv.indexOf('--network-build-root') + 1];
assert.ok(path.isAbsolute(buildRoot), 'pass an isolated compiled Electron directory');
assert.equal(process.versions.electron !== undefined, true);
assert.notEqual(process.env.ELECTRON_RUN_AS_NODE, '1');
const scratch = mkdtempSync(path.join(tmpdir(), 'nomi-network-route-'));
app.setPath('userData', scratch);
app.setName('Nomi Local Network Regression');
app.disableHardwareAcceleration();
const watchdog = setTimeout(() => { console.error('NETWORK_REGRESSION_TIMEOUT'); app.exit(2); }, 45000);

async function listening(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

app.whenReady().then(async () => {
  const observed = [];
  const sockets = new Set();
  const routeBySourcePort = new Map();
  const heldResponses = new Map();
  const origin = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    observed.push({ route: routeBySourcePort.get(req.socket.remotePort) || 'direct',
      path: req.url, method: req.method, body, headers: req.headers });
    if (req.url === '/held-stream') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('before-');
      heldResponses.set(req.url, res);
    } else if (/\/(chat\/completions|responses|messages)$/.test(req.url)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Synthetic local unauthorized response' } }));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, body }));
    }
  });
  origin.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    observed.push({ route: routeBySourcePort.get(req.socket.remotePort) || 'direct', path: req.url, method: 'WS' });
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  const originPort = await listening(origin);
  async function makeProxy(label) {
    const server = createServer();
    server.on('connect', (req, downstream, head) => {
      assert.equal(req.url, `network-route.invalid:${originPort}`);
      const upstream = connect(originPort, '127.0.0.1', () => {
        routeBySourcePort.set(upstream.localPort, label);
        downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(downstream).pipe(upstream);
      });
      for (const socket of [downstream, upstream]) {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.on('close', () => sockets.delete(socket));
      }
    });
    const port = await listening(server);
    return { server, url: `http://127.0.0.1:${port}` };
  }
  const proxyA = await makeProxy('proxy-a');
  const proxyB = await makeProxy('proxy-b');
  // Minimal local SOCKS5 fixture. Production still uses the mature socks package.
  const socks = createTcpServer((downstream) => {
    sockets.add(downstream);
    downstream.on('error', () => {});
    let stage = 'greeting';
    let buffer = Buffer.alloc(0);
    const receive = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        assert.equal(buffer[0], 5);
        buffer = buffer.subarray(2 + buffer[1]);
        downstream.write(Buffer.from([5, 0]));
        stage = 'connect';
      }
      if (stage !== 'connect' || buffer.length < 5) return;
      assert.equal(buffer[3], 3, 'remote hostname must be resolved by the SOCKS proxy');
      const length = buffer[4];
      if (buffer.length < length + 7) return;
      assert.equal(buffer.subarray(5, 5 + length).toString(), 'network-route.invalid');
      assert.equal(buffer.readUInt16BE(5 + length), originPort);
      buffer = buffer.subarray(length + 7);
      stage = 'tunnel';
      downstream.removeListener('data', receive);
      const upstream = connect(originPort, '127.0.0.1', () => {
        routeBySourcePort.set(upstream.localPort, 'socks');
        downstream.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, originPort >> 8, originPort & 255]));
        if (buffer.length) upstream.write(buffer);
        upstream.pipe(downstream).pipe(upstream);
      });
      sockets.add(upstream);
      upstream.on('error', () => {});
    };
    downstream.on('data', receive);
  });
  const socksPort = await listening(socks);
  const system = require(path.join(buildRoot, 'systemProxy.js'));
  const vendor = require(path.join(buildRoot, 'vendor/vendorBaseFallback.js'));
  const target = `http://network-route.invalid:${originPort}`;
  const directTarget = `http://127.0.0.1:${originPort}`;
  try {
    // No global fetch has executed yet. Loading pi here reproduces the real
    // undici8 global-dispatcher initialization, not a simulated SDK mutation.
    await system.applySystemProxy(session.defaultSession, { mode: 'custom', customUrl: proxyA.url });
    await import(pathToFileURL(path.join(buildRoot, 'harness/runtime/pi/session.mjs')).href);
    const response = await vendor.fetchVendorWithBaseFallback(`${target}/vendor`, {
      method: 'POST', body: '{"literal":"first request"}', signal: AbortSignal.timeout(5000),
      headers: { Authorization: 'Bearer synthetic-literal-key' },
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(observed.at(-1).route, 'proxy-a', 'cold pi import must not redirect vendor traffic');
    assert.equal(observed.at(-1).body, '{"literal":"first request"}');
    assert.equal(observed.at(-1).headers.authorization, 'Bearer synthetic-literal-key');
    console.log('PASS cold-import-before-first-fetch');

    const { appFetch } = require(path.join(buildRoot, 'appFetch.js'));
    const streaming = await appFetch(`${target}/held-stream`);
    assert.equal(observed.at(-1).route, 'proxy-a');
    await system.applySystemProxy(session.defaultSession, { mode: 'custom', customUrl: proxyB.url });
    heldResponses.get('/held-stream').end('after');
    assert.equal(await streaming.text(), 'before-after', 'graceful route retirement must not abort an in-flight stream');
    console.log('PASS hot-switch-preserves-inflight-response');
    const multipart = new FormData();
    multipart.append('file', new Blob(['literal multipart bytes']), 'fixture.txt');
    await (await appFetch(`${target}/upload`, { method: 'POST', body: multipart })).arrayBuffer();
    assert.equal(observed.at(-1).route, 'proxy-b');
    assert.match(observed.at(-1).body, /literal multipart bytes/);
    assert.match(observed.at(-1).headers['content-type'], /multipart\/form-data; boundary=/);
    await (await appFetch(`${directTarget}/private`)).arrayBuffer();
    assert.equal(observed.at(-1).route, 'direct');
    console.log('PASS current-route-hot-switch-multipart-private-bypass');

    const { probeOutbound } = require(path.join(buildRoot, 'proxyProbe.js'));
    assert.equal((await probeOutbound([`${target}/probe`])).ok, true);
    assert.equal(observed.at(-1).route, 'proxy-b');
    const { hardenedFetch } = require(path.join(buildRoot, 'hardenedFetch.js'));
    assert.equal((await hardenedFetch(`${target}/download`)).status, 200);
    assert.equal(observed.at(-1).route, 'proxy-b');
    console.log('PASS probe-and-hardened-download-share-current-route');

    const { WebSocket } = require('undici');
    const websocket = new WebSocket(`${target.replace('http:', 'ws:')}/websocket`, { dispatcher: await system.getAppDispatcher() });
    await once(websocket, 'open');
    assert.equal(observed.at(-1).route, 'proxy-b');
    websocket.close();
    console.log('PASS websocket-handshake-shares-app-route');

    const { buildAiSdkModel } = require(path.join(buildRoot, 'ai/buildAiSdkModel.js'));
    const { generateText } = require('ai');
    for (const kind of ['openai-compatible', 'openai-responses', 'anthropic']) {
      const model = buildAiSdkModel({ kind, baseURL: `${target}/v1`, apiKey: 'synthetic-literal-key', modelId: 'fixture-model' });
      await assert.rejects(generateText({ model, prompt: 'Local route check.', maxRetries: 0 }), (error) => error.statusCode === 401);
      assert.equal(observed.at(-1).route, 'proxy-b');
      const authHeader = kind === 'anthropic' ? 'x-api-key' : 'authorization';
      assert.equal(observed.at(-1).headers[authHeader], kind === 'anthropic' ? 'synthetic-literal-key' : 'Bearer synthetic-literal-key');
    }
    console.log('PASS existing-ai4-protocols-share-app-route');

    const { runAgentTurn } = require(path.join(buildRoot, 'harness/runtime/pi/nativeLoader.cjs'));
    const cwd = path.join(scratch, 'work');
    const agentDir = path.join(scratch, 'agent');
    mkdirSync(cwd); mkdirSync(agentDir);
    const result = await runAgentTurn({ cwd, agentDir, tempRoot: scratch, systemPrompt: 'Local transport test.',
      model: { kind: 'openai-compatible', providerId: 'network-fixture', modelId: 'fixture-model',
        baseURL: `${target}/v1`, authType: 'api-key', apiKey: 'synthetic-literal-key' },
      user: { durableText: 'No paid calls.' }, tools: [], capability: { singleShot: true, maxSteps: 1 },
      compaction: { enabled: false } },
    { fetch: appFetch, emit() {}, awaitToolConfirmation: async () => ({ ok: true }) });
    assert.equal(result.error?.status, 401);
    assert.equal(observed.at(-1).route, 'proxy-b');
    assert.equal(observed.at(-1).headers.authorization, 'Bearer synthetic-literal-key');
    console.log('PASS real-native-pi-fetch-injection');

    await system.applySystemProxy(session.defaultSession, { mode: 'custom', customUrl: `socks5://127.0.0.1:${socksPort}` });
    await (await appFetch(`${target}/socks`)).arrayBuffer();
    assert.equal(observed.at(-1).route, 'socks');
    await (await appFetch(`${directTarget}/socks-private`)).arrayBuffer();
    assert.equal(observed.at(-1).route, 'direct');
    console.log('PASS socks-remote-dns-and-private-bypass');

    await system.applySystemProxy(session.defaultSession, { mode: 'off', customUrl: '' });
    await (await appFetch(`${directTarget}/off`)).arrayBuffer();
    assert.equal(observed.at(-1).route, 'direct');
    await assert.rejects(appFetch(`${target}/off-invalid`, { signal: AbortSignal.timeout(5000) }), /fetch failed/);
    console.log('PASS off-is-owned-direct-not-a-stale-proxy');
    console.log('NETWORK_REGRESSION_OK', JSON.stringify({ electron: process.versions.electron,
      node: process.versions.node, undici: process.versions.undici, requests: observed.length, scratch }));
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const server of [origin, proxyA.server, proxyB.server, socks]) server.close();
  }
  clearTimeout(watchdog);
  app.exit(0);
}).catch((error) => {
  console.error('NETWORK_REGRESSION_FAILED', error.message, error.cause?.code || '');
  clearTimeout(watchdog);
  app.exit(1);
});
