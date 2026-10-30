const fs = module.require('node:fs');
const path = module.require('node:path');
const vm = module.require('node:vm');
const { EventEmitter } = module.require('node:events');
const assert = module.require('node:assert/strict');
const test = module.require('node:test');

// Execute the existing standalone script with only local transport/process doubles.
// No real server, CLI, project/source write, inference, login or quota is used.
// The existing temporary owner may allocate and clean an isolated CLI workspace.
function fixture(defer = false) {
  const calls = [], writes = [], terminations = [];
  const fakeFs = { ...fs, writeFileSync: (...args) => writes.push(args),
    mkdtempSync: () => path.join(process.cwd(), '.tmp', 'bridge-process-double'), rmSync: () => {} };
  const childProcess = { spawn: (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} }; child.pid = 42;
    child.kill = () => { terminations.push(child.pid); return true; };
    if (!defer) queueMicrotask(() => child.emit('error', new Error('selected-cli-unavailable')));
    return child;
  } };
  const fakeHttp = { createServer: handler => ({ handler, listen() {} }) };
  const sandbox = { module: { exports: {}, require: name => name === 'node:http' ? fakeHttp : name === 'node:child_process' ? childProcess : name === 'node:fs' ? fakeFs : module.require(name) }, __dirname: path.resolve('scripts'),
    require: name => name === 'node:http' ? fakeHttp : name === 'node:child_process' ? childProcess : name === 'node:fs' ? fakeFs : module.require(name),
    process: { execPath: process.execPath, env: { ...process.env }, platform: process.platform },
    console: { log() {}, error() {} }, setTimeout, clearTimeout, AbortController,
  };
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.resolve('scripts/local-cli-bridge.cjs'), 'utf8');
  vm.runInContext(source + '\nmodule.exports={buildCliPrompt,executeCliModel,parseResponseForToolCalls,handler:server.handler};', context, { filename: path.resolve('scripts/local-cli-bridge.cjs'), importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  vm.runInContext('loadCliProcessTree = async () => ({ killProcessTree: child => child.kill("SIGKILL") })', context);
  return { ...sandbox.module.exports, calls, writes, terminations, setExecute(fn) { sandbox.fixtureExecute = fn; vm.runInContext('executeCliModel = fixtureExecute', context); } };
}

async function request(f, body, url = '/v1/chat/completions') {
  return new Promise((resolve,reject) => {
    const req = new EventEmitter(); req.method = body ? 'POST' : 'GET'; req.url = url;
    const chunks = [], headers = {};
    const res = { writableEnded: false, on() {}, setHeader(k,v) { headers[k] = v; },
      writeHead(status) { this.status = status; }, write(chunk) { chunks.push(chunk); },
      end(chunk = '') { chunks.push(chunk); this.writableEnded = true; resolve({ status: this.status, text: chunks.join(''), headers }); } };
    f.handler(req, res);
    if (body) { req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); Promise.resolve(req.listeners('end')[0]()).catch(reject); }
  });
}

test('preserves Gujarati/Hindi chat language and authoritative generation instructions', () => {
  const f = fixture();
  const system = 'Generation prompts may be English. Conversation must follow the user language. Exception (no exception to the exception): preserve this dictionary.';
  const prompt = f.buildCliPrompt([{ role: 'system', content: system }, { role: 'user', content: 'મને ગુજરાતી અને हिंदी में जवाब चाहिए।' }], []);
  assert.ok(prompt.includes(system));
  assert.ok(prompt.includes('મને ગુજરાતી અને हिंदी में जवाब चाहिए।'));
  assert.doesNotMatch(prompt, /strictly and entirely in ENGLISH|100% in English|natural language in English/);
});

for (const model of ['codex-cli', 'claude-code', 'antigravity-cli']) {
  test('never substitutes another provider after ' + model + ' fails', async () => {
    const f = fixture();
    await assert.rejects(f.executeCliModel(model, [{ role: 'user', content: 'hello' }], [], new AbortController().signal), /selected-cli-unavailable|claude_not_found/);
    assert.ok(f.calls.length <= 1, 'a selected CLI failure must not invoke another CLI');
    if (model === 'claude-code' && f.calls.length) assert.ok(f.calls[0].args.includes('--model'), 'preserve the selected Claude model');
  });
}

test('rejects an unknown model instead of defaulting to Codex', async () => {
  const f = fixture();
  await assert.rejects(f.executeCliModel('unknown-route', [], [], new AbortController().signal), /bridge_model_unknown/);
  assert.equal(f.calls.length, 0);
});

test('rejects non-text input before invoking any CLI', async () => {
  const f = fixture();
  await assert.rejects(f.executeCliModel('codex-cli', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'nomi-local://image.png' } }] }], [], new AbortController().signal), /bridge_unsupported_content/);
  assert.equal(f.calls.length, 0);
});

test('discovery retains all route identities and declares only text input', async () => {
  const f = fixture(); const response = await request(f, null, '/v1/models');
  const models = JSON.parse(response.text).data;
  assert.deepEqual(models.map(model => model.id), ['antigravity-cli', 'codex-cli', 'claude-code']);
  for (const model of models) assert.deepEqual(model.architecture.input_modalities, ['text']);
});

for (const stream of [false, true]) {
  test('does not fabricate usage or retain raw prompts/replies for ' + (stream ? 'SSE' : 'JSON'), async () => {
    const f = fixture(); f.setExecute(async () => 'नमस्ते');
    const response = await request(f, { model: 'codex-cli', messages: [{ role: 'user', content: 'नमस्ते' }], stream });
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /"usage"|prompt_tokens|completion_tokens|total_tokens/);
    assert.equal(f.writes.length, 0);
  });
}

for (const model of ['codex-cli','claude-code','antigravity-cli']) {
  test('pre-aborted '+model+' never starts a CLI', async () => {
    const f=fixture();const ac=new AbortController();ac.abort();
    await assert.rejects(f.executeCliModel(model,[],[],ac.signal),/abort/i);
    assert.equal(f.calls.length,0);
  });
}

test('invalid request JSON is rejected without invoking any CLI',async()=>{
 const f=fixture();const response=await request(f,'{broken');assert.equal(response.status,400);assert.match(response.text,/bridge_invalid_json/);assert.equal(f.calls.length,0);
});
for(const model of ['codex-cli','claude-code','antigravity-cli']) {
 test('running '+model+' observes request cancellation',async()=>{
  const f=fixture(true),ac=new AbortController();const pending=f.executeCliModel(model,[],[],ac.signal).then(()=> 'resolved',e=>String(e));
  await new Promise(resolve=>setImmediate(resolve));ac.abort();
  const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('unsettled'),250))]);
  assert.match(result,/bridge_aborted/);
  assert.deepEqual(f.terminations,[42],"cancellation must use the existing shared tree owner");
 });
}

for(const body of ['null','[]','"string"','42','false']) {
 test('non-object JSON '+body+' is rejected before dispatch',async()=>{
  const f=fixture();const response=await request(f,body);assert.equal(response.status,400);assert.match(response.text,/bridge_invalid_body/);assert.equal(f.calls.length,0);
 });
}
