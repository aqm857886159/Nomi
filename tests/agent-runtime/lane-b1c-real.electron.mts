// B1c bounded real-model sample. Only the provider is real; project/domain writes use isolated fixtures.
// Run compiled entry with Electron. Credentials are read exclusively from an encrypted app-settings copy.
import { app } from 'electron';
import { mkdir, mkdtemp, readFile, copyFile, chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { createDocumentPort } from './laneFixture.mjs';
import type { NomiModelConfig } from '../../electron/shared/agentLane/laneModelConfig.js';
import type { ApiKeyRecord } from '../../electron/catalog/secrets.js';

const root = path.resolve('.tmp/b1c-real');
const settings = path.join(root, 'settings');
const source = path.join(app.getPath('appData'), 'nomi', 'model-catalog.json');
app.setName('nomi');
app.setPath('userData', settings);

async function main() {
  await mkdir(settings, { recursive: true, mode: 0o700 });
  await copyFile(source, path.join(settings, 'model-catalog.json'));
  await chmod(path.join(settings, 'model-catalog.json'), 0o600);
  const catalog = JSON.parse(await readFile(path.join(settings, 'model-catalog.json'), 'utf8')) as {
    vendors: Array<{ key: string; baseUrlHint?: string }>;
    models: Array<{ vendorKey: string; modelKey: string; enabled: boolean }>;
    apiKeysByVendor: Record<string, ApiKeyRecord>;
  };
  const vendor = catalog.vendors.find(v => v.key === 'apimart');
  if (!vendor || !catalog.models.some(m => m.vendorKey === vendor.key && m.modelKey === 'deepseek-v4-flash' && m.enabled)) throw new Error('B1C_MODEL_UNAVAILABLE');
  const { decryptApiKeyRecord } = await import('../../electron/catalog/secrets.js');
  const apiKey = decryptApiKeyRecord(catalog.apiKeysByVendor[vendor.key]);
  if (!apiKey) throw new Error('B1C_CREDENTIAL_UNAVAILABLE');
  const pricing = JSON.parse(await readFile('/tmp/nomi-b1-pricing.json', 'utf8'));
  if (pricing.unit !== 'usd_per_million_tokens' || pricing.tier_count !== 1 || !(pricing.rates.input > 0) || !(pricing.rates.output > 0)) throw new Error('B1C_PRICE_UNKNOWN');
  const model: NomiModelConfig = { kind: 'openai-compatible', providerId: vendor.key, modelId: 'deepseek-v4-flash',
    baseURL: vendor.baseUrlHint!.replace(/\/+$/, '') + (new URL(vendor.baseUrlHint!).pathname === '/' ? '/v1' : ''),
    authType: 'api-key', apiKey, maxOutputTokens: 1024,
    tokenPricing: { inputPerMTokUsd: pricing.rates.input, outputPerMTokUsd: pricing.rates.output,
      cacheReadPerMTokUsd: pricing.rates.cached_input },
  };
  const budgetFile = path.join(root, 'budget.json');
  const previous = await readFile(budgetFile, 'utf8').then(JSON.parse, (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return { reservedCny: 0, settledCny: 0 };
  });
  const settledBefore = previous.settledCny ?? previous.reservedCny;
  let reservedCny = previous.reservedCny;
  const requests: Array<Record<string, unknown>> = [];
  let prefix: string | undefined;
  let settleResponse: Promise<void> = Promise.resolve();
  const guardedFetch: typeof fetch = async (input, init) => {
    await settleResponse;
    const request = new Request(input, init);
    if (request.method !== 'POST' || new URL(request.url).origin !== new URL(model.baseURL).origin) throw new Error('B1C_ENDPOINT_REFUSED');
    const body = await request.clone().json();
    if (body.model !== model.modelId) throw new Error('B1C_MODEL_REFUSED');
    body.max_tokens = Math.min(body.max_tokens ?? 1024, 1024);
    const inputBytes = Buffer.byteLength(JSON.stringify(body));
    const upperCny = (inputBytes * pricing.rates.input + body.max_tokens * pricing.rates.output) / 1e6 * 7;
    if (reservedCny + upperCny > 1) throw new Error('B1C_BUDGET_BLOCKED');
    reservedCny += upperCny;
    const nextPrefix = JSON.stringify({ tools: body.tools, system: body.messages.filter((message: { role: string }) => message.role === 'system') });
    const previousMessage = body.messages.at(-1);
    const afterSwitch = previousMessage?.role === 'tool' && String(previousMessage.content).includes('Selected timeline');
    const record: Record<string, unknown> = { inputBytes, maxOutputTokens: body.max_tokens, upperCny,
      prefixStable: prefix === undefined || prefix === nextPrefix, afterSwitch };
    prefix ??= nextPrefix;
    requests.push(record);
    await writeFile(budgetFile, JSON.stringify({ reservedCny, settledCny: settledBefore, requests }, null, 2), { mode: 0o600 });
    const response = await fetch(input, { ...init, body: JSON.stringify(body), redirect: 'error' });
    settleResponse = response.clone().text().then(async text => {
      const chunks = text.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
        .flatMap(line => { try { return [JSON.parse(line.slice(6))]; } catch { return []; } });
      const usage = chunks.map(chunk => chunk.usage).filter(Boolean).at(-1);
      if (!usage) return;
      const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
      Object.assign(record, { inputTokens: usage.prompt_tokens, cacheRead: cached, outputTokens: usage.completion_tokens });
      const previousRecord = requests.at(-2);
      record.newInputTokens = usage.prompt_tokens - Number(previousRecord?.inputTokens ?? 0);
      const spent = ((usage.prompt_tokens - cached) * pricing.rates.input + cached * pricing.rates.cached_input
        + usage.completion_tokens * pricing.rates.output) / 1e6 * 7;
      reservedCny = reservedCny - upperCny + spent;
      await writeFile(budgetFile, JSON.stringify({ reservedCny, settledCny: reservedCny, requests }, null, 2), { mode: 0o600 });
    });
    return response;
  };
  const document = createDocumentPort('B1c 缓存验收文稿：海边日出，一位旅人走向灯塔。');
  const tools = createDocumentLaneTools(document);
  for (const spec of [...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG]) {
    if (!tools.some(tool => tool.name === spec.name)) tools.push(bindLaneTool(spec, async () => {
      if (spec.name !== 'read_timeline') throw new Error('B1C_UNEXPECTED_DOMAIN_TOOL');
      return { ok: true, text: 'Timeline revision fixture-r1; no clips.' };
    }));
  }
  const lane = await openLane({ projectDir: await mkdtemp(path.join(root, 'project-')), tools, model, fetch: guardedFetch,
    native: { settingsRoot: settings, skills: [] }, limits: { maxModelRequests: 4 },
    systemPrompt: '你是 Nomi 创作助手。按用户要求调用工具，再用一句话回答。所有对象都在隔离测试项目。',
  });
  const turns: unknown[] = [];
  try {
    for (const text of ['调用 read_script 读文稿，告诉我地点。',
      '先调用 nomi_request_tools，group=timeline；收到结果后调用 read_timeline，告诉我有没有片段。',
      '再次调用 read_script，告诉我人物要去哪里。']) {
      const start = lane.projection().parts.length;
      const requestStart = requests.length;
      const result = await lane.execute({ kind: 'prompt', text });
      await settleResponse;
      turns.push({ text, result, requestStart, requestEnd: requests.length, parts: lane.projection().parts.slice(start) });
    }
    const typedTurns = turns as Array<{ parts: Array<{ kind: string; toolName?: string; isError?: boolean; text?: string }> }>;
    const toolResults = typedTurns.flatMap(turn => turn.parts.filter(part => part.kind === 'tool-result'));
    const expectedTools = [['read_script'], ['nomi_request_tools', 'read_timeline'], ['read_script']];
    const answers = [/海边/, /没有|无|空/, /灯塔/];
    const successfulTurns = typedTurns.filter((turn, index) => {
      const calls = turn.parts.filter(part => part.kind === 'tool-call').map(part => part.toolName);
      return JSON.stringify(calls) === JSON.stringify(expectedTools[index])
        && !turn.parts.some(part => part.kind === 'tool-result' && part.isError)
        && answers[index]!.test(turn.parts.filter(part => part.kind === 'assistant-text').map(part => part.text).join(''));
    }).length;
    const metrics = { toolCorrect: toolResults.filter(part => !part.isError).length, toolTotal: toolResults.length,
      successfulTurns, totalTurns: turns.length, afterSwitch: requests.filter(record => record.afterSwitch),
      allPrefixesStable: requests.every(record => record.prefixStable) };
    await writeFile('docs/plan/agent-lane-b1c-evidence/deepseek-sample.json', JSON.stringify({
      model: model.modelId, provider: model.providerId, metrics, turns, requests, totalSpentCny: reservedCny,
      limitation: 'Real model with isolated document/timeline domain; no paid media generation.',
    }, null, 2));
    console.log(JSON.stringify({ model: model.modelId, metrics, requests: requests.length, totalSpentCny: reservedCny }));
    if (successfulTurns !== 3 || !metrics.allPrefixesStable || !metrics.afterSwitch.some(record => Number(record.cacheRead) > 0)) throw new Error('B1C_ACCEPTANCE_FAILED');
  } finally { await lane.close(); }
}

void app.whenReady().then(main).then(() => app.exit(0), () => { console.error('B1C_REAL_SAMPLE_FAILED; inspect isolated budget and transcript, no credential output'); app.exit(1); });
