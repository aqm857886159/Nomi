// B1 bounded real-model sample. Only the provider is real; project/domain writes use isolated fixtures.
// Run compiled entry with Electron. Credentials are read exclusively from an encrypted app-settings copy.
import { app } from 'electron';
import { mkdir, mkdtemp, readFile, copyFile, chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createCanvasLaneTools } from '../../electron/agentLane/laneCanvasTools.js';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { createExtendedLaneTools } from '../../electron/agentLane/laneExtendedTools.js';
import { LANE_MODEL_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { createDocumentPort } from './laneFixture.mjs';
import type { NomiModelConfig } from '../../electron/shared/agentLane/laneModelConfig.js';
import type { ApiKeyRecord } from '../../electron/catalog/secrets.js';

const root = path.resolve('.tmp/b1-real');
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
  if (!vendor || !catalog.models.some(m => m.vendorKey === vendor.key && m.modelKey === 'deepseek-v4-flash' && m.enabled)) throw new Error('B1_MODEL_UNAVAILABLE');
  const { decryptApiKeyRecord } = await import('../../electron/catalog/secrets.js');
  const apiKey = decryptApiKeyRecord(catalog.apiKeysByVendor[vendor.key]);
  if (!apiKey) throw new Error('B1_CREDENTIAL_UNAVAILABLE');
  const pricing = JSON.parse(await readFile('/tmp/nomi-b1-pricing.json', 'utf8'));
  if (pricing.unit !== 'usd_per_million_tokens' || pricing.tier_count !== 1 || !(pricing.rates.input > 0) || !(pricing.rates.output > 0)) throw new Error('B1_PRICE_UNKNOWN');
  const model: NomiModelConfig = { kind: 'openai-compatible', providerId: vendor.key, modelId: 'deepseek-v4-flash',
    baseURL: vendor.baseUrlHint!.replace(/\/+$/, '') + (new URL(vendor.baseUrlHint!).pathname === '/' ? '/v1' : ''),
    authType: 'api-key', apiKey, maxOutputTokens: 2048,
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
  const requests: unknown[] = [];
  const guardedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== 'POST' || new URL(request.url).origin !== new URL(model.baseURL).origin) throw new Error('B1_ENDPOINT_REFUSED');
    const body = await request.clone().json();
    if (body.model !== model.modelId) throw new Error('B1_MODEL_REFUSED');
    body.max_tokens = Math.min(body.max_tokens ?? 2048, 2048);
    const inputBytes = Buffer.byteLength(JSON.stringify(body));
    const upperCny = (inputBytes * pricing.rates.input + body.max_tokens * pricing.rates.output) / 1e6 * 7;
    if (reservedCny + upperCny > 1) throw new Error('B1_BUDGET_BLOCKED');
    reservedCny += upperCny;
    requests.push({ inputBytes, maxOutputTokens: body.max_tokens, upperCny });
    await writeFile(budgetFile, JSON.stringify({ reservedCny, settledCny: settledBefore, requests }, null, 2), { mode: 0o600 });
    return fetch(input, { ...init, body: JSON.stringify(body), redirect: 'error' });
  };
  const document = createDocumentPort('文稿预算 ¥8。第 1 镜：黄昏天台，女孩放下相机。');
  const nodes = [{ id: 'gen-v2-image-opening', kind: 'image', title: '第 1 镜', prompt: '黄昏天台，女孩放下相机',
    status: 'idle', position: { x: 0, y: 0 }, hasResult: false }];
  const writes: string[] = [];
  const tools = [...createDocumentLaneTools(document), ...createCanvasLaneTools({
    read: async () => ({ nodes, edges: [], groups: [], selectedNodeIds: [] }),
    write: async args => { writes.push(args.operation); return { applied: true, proposalId: 'op-b1-fixture',
      operation: args.operation } as never; },
  }), ...createExtendedLaneTools({ execute: async call => ({ ok: true, result: (call.args as { operation?: string }).operation === 'context'
    ? { providerProfiles: [{ providerId: 'apimart', modelIds: ['gpt-image-2'] }], nextAction: 'create' }
    : { operationId: 'op-b1-draft', state: 'draft' } }) })];
  for (const spec of LANE_MODEL_TOOL_CATALOG) {
    if (!tools.some(tool => tool.name === spec.name)) tools.push(bindLaneTool(spec, async () => ({ ok: true, text: 'Timeline is empty.' })));
  }
  const lane = await openLane({ projectDir: await mkdtemp(path.join(root, 'project-')), tools, model, fetch: guardedFetch,
    native: { settingsRoot: settings, skills: [] },
    approval: { hasUserInterface: true, policy: () => ({ mode: 'request' }) },
    limits: { maxModelRequests: 8 },
    systemPrompt: '你是 Nomi 视频创作助手。根据真实工具结果回答，用户没让你改的不要改。当前宿主只能创建草稿，报价和生成由画布提交提供；不能假称已生成。',
  });
  const turns: unknown[] = [];
  let inserted = false;
  let steerPromise: Promise<unknown> | undefined;
  let before = 0;
  const unsub = lane.subscribe(projection => {
    // Real model must choose its first action. Insert the third user message while that action is in flight.
    if (before && !inserted && projection.parts.slice(before).some(p => p.kind === 'tool-call' || (p.kind === 'assistant-text' && p.streaming))) {
      inserted = true;
      steerPromise = lane.execute({ kind: 'prompt', text: '等等别动' });
    }
  });
  try {
    for (const text of ['画布上有什么', '第 1 镜试拍一下']) {
      const start = lane.projection().parts.length;
      if (turns.length) before = start;
      await lane.execute({ kind: 'prompt', text });
      await steerPromise;
      turns.push({ input: text, parts: lane.projection().parts.slice(start) });
    }
    const projection = lane.projection();
    const cost = projection.usage.cost;
    const totalSpentCny = cost.state === 'known' ? settledBefore + cost.value * 7 : undefined;
    if (totalSpentCny !== undefined) await writeFile(budgetFile, JSON.stringify({ reservedCny: totalSpentCny, settledCny: totalSpentCny, requests }, null, 2), { mode: 0o600 });
    const report = { totalSpentCny, model: model.modelId, turns, inserted, writes, reservedCny, requests: requests.length,
      groupSwitches: projection.parts.filter(p => p.kind === 'tool-call' && p.toolName === 'nomi_request_tools').length,
      idsInReply: projection.parts.some(p => p.kind === 'assistant-text' && /gen-v2-|op-/.test(p.text)), usage: projection.usage };
    await writeFile('docs/plan/agent-lane-b1-evidence/deepseek-sample.json', JSON.stringify(report, null, 2));
    if (!requests.length || !inserted) throw new Error('B1_SAMPLE_INCOMPLETE');
    console.log(JSON.stringify({ model: model.modelId, inserted, reservedCny, requests: requests.length, idsInReply: report.idsInReply }));
  } finally { unsub(); await lane.close(); }
}
void app.whenReady().then(main).then(() => app.exit(0), () => { console.error('B1_REAL_SAMPLE_FAILED; inspect isolated budget and transcript, no credential output'); app.exit(1); });
