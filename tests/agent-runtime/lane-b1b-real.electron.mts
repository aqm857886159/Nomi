// B1b bounded real-model sample. Only the provider is real; project/domain writes use isolated fixtures.
// Run compiled entry with Electron. Credentials are read exclusively from an encrypted app-settings copy.
import { app } from 'electron';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, copyFile, chmod, writeFile, readdir } from 'node:fs/promises';
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

const root = path.resolve('.tmp/b1b-real');
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
  if (!vendor || !catalog.models.some(m => m.vendorKey === vendor.key && m.modelKey === 'deepseek-v4-flash' && m.enabled)) throw new Error('B1B_MODEL_UNAVAILABLE');
  const { decryptApiKeyRecord } = await import('../../electron/catalog/secrets.js');
  const apiKey = decryptApiKeyRecord(catalog.apiKeysByVendor[vendor.key]);
  if (!apiKey) throw new Error('B1B_CREDENTIAL_UNAVAILABLE');
  const pricing = JSON.parse(await readFile('/tmp/nomi-b1-pricing.json', 'utf8'));
  if (pricing.unit !== 'usd_per_million_tokens' || pricing.tier_count !== 1 || !(pricing.rates.input > 0) || !(pricing.rates.output > 0)) throw new Error('B1B_PRICE_UNKNOWN');
  const model: NomiModelConfig = { kind: 'openai-compatible', providerId: vendor.key, modelId: 'deepseek-v4-flash',
    baseURL: vendor.baseUrlHint!.replace(/\/+$/, '') + (new URL(vendor.baseUrlHint!).pathname === '/' ? '/v1' : ''),
    authType: 'api-key', apiKey, maxOutputTokens: 6144,
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
  let settleResponse: Promise<void> = Promise.resolve();
  const guardedFetch: typeof fetch = async (input, init) => {
    await settleResponse;
    const request = new Request(input, init);
    if (request.method !== 'POST' || new URL(request.url).origin !== new URL(model.baseURL).origin) throw new Error('B1B_ENDPOINT_REFUSED');
    const body = await request.clone().json();
    if (body.model !== model.modelId) throw new Error('B1B_MODEL_REFUSED');
    body.max_tokens = Math.min(body.max_tokens ?? 6144, 6144);
    const inputBytes = Buffer.byteLength(JSON.stringify(body));
    const upperCny = (inputBytes * pricing.rates.input + body.max_tokens * pricing.rates.output) / 1e6 * 7;
    if (reservedCny + upperCny > 1) throw new Error('B1B_BUDGET_BLOCKED');
    reservedCny += upperCny;
    requests.push({ inputBytes, maxOutputTokens: body.max_tokens, upperCny });
    await writeFile(budgetFile, JSON.stringify({ reservedCny, settledCny: settledBefore, requests }, null, 2), { mode: 0o600 });
    const response = await fetch(input, { ...init, body: JSON.stringify(body), redirect: 'error' });
    settleResponse = response.clone().text().then(async text => {
      const chunks = text.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
        .flatMap(line => { try { return [JSON.parse(line.slice(6))]; } catch { return []; } });
      const usage = chunks.map(chunk => chunk.usage).filter(Boolean).at(-1);
      if (!usage) return;
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
      const spent = ((usage.prompt_tokens - cached) * pricing.rates.input + cached * pricing.rates.cached_input
        + usage.completion_tokens * pricing.rates.output) / 1e6 * 7;
      reservedCny = reservedCny - upperCny + spent;
      await writeFile(budgetFile, JSON.stringify({ reservedCny, settledCny: reservedCny, requests }, null, 2), { mode: 0o600 });
    });
    return response;
  };
  const recorded = JSON.parse(await readFile(path.resolve('tests/agent-runtime/fixtures/lane-context-20260909.json'), 'utf8'));
  const document = createDocumentPort(recorded.turns[16] + '\n验收创作约束：拆成八镜视频分镜，使用 MiniMax-H3，resolution=768P；只提方案与试拍草稿，不提交付费媒体。');
  let shots: Array<Record<string, unknown>> = [];
  const plans: Array<Array<Record<string, unknown>>> = [];
  const tools = [...createDocumentLaneTools(document), ...createCanvasLaneTools({
    read: async () => ({ nodes: shots.map((shot, index) => ({ id: `node-shot-${index + 1}`, kind: 'video',
      title: `第 ${index + 1} 镜`, prompt: String(shot.prompt ?? ''), status: 'idle', position: { x: index * 300, y: 0 },
      hasResult: false })), edges: [], groups: [], selectedNodeIds: [] }),
    write: async args => {
      if (args.operation !== 'propose_storyboard_plan') throw new Error('B1B_ONLY_STORYBOARD_WRITES');
      shots = args.shots as Array<Record<string, unknown>>;
      plans.push(structuredClone(shots));
      return { applied: true, proposalId: 'fixture-plan', operation: args.operation, result: {},
        reconciliation: { applied: [], skipped: [] } } as never;
    },
  }), ...createExtendedLaneTools({ execute: async call => ({ ok: true, result: (call.args as { operation?: string }).operation === 'context'
    ? { providerProfiles: [{ providerId: 'apimart', modelIds: ['MiniMax-H3'] }], nextAction: 'create' }
    : { operationId: 'fixture-generation-draft', state: 'draft', note: 'Only a draft; no paid generation was submitted.' } }) })];
  for (const spec of LANE_MODEL_TOOL_CATALOG) {
    if (!tools.some(tool => tool.name === spec.name)) tools.push(bindLaneTool(spec, async () => ({ ok: true, text: 'Timeline is empty.' })));
  }
  const skillPath = path.resolve('skills/workbench-storyboard-planner/SKILL.md');
  const skillBody = await readFile(skillPath, 'utf8');
  const context = { approvalPolicy: { mode: 'request' as const },
    availableModels: recorded.models, model: { vendorKey: model.providerId, modelKey: model.modelId } };
  const require = createRequire(import.meta.url);
  const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild');
  const desktopBundle = path.join(root, 'desktop-input.cjs');
  buildSync({ entryPoints: [path.resolve('electron/agentLane/laneDesktopInput.ts')], outfile: desktopBundle,
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const { createDesktopLaneInput } = require(desktopBundle);
  process.env.NOMI_SETTINGS_DIR = settings;
  process.env.NOMI_PROJECTS_DIR = path.join(root, 'projects');
  const input = createDesktopLaneInput({ projectId: 'b1b-real', capture: () => context, activate: () => {}, prepare: async (captured: LaneComposerContext) => captured,
    model: () => ({ model: { modelKey: model.modelId, vendorKey: model.providerId, kind: 'text' } as never, kind: model.kind }) });
  const projectDir = await mkdtemp(path.join(root, 'project-'));
  const lane = await openLane({ projectDir, tools, model, fetch: guardedFetch, input,
    native: { settingsRoot: settings, skills: [{ name: 'workbench-storyboard-planner', directoryName: 'workbench-storyboard-planner',
      filePath: skillPath, packageDir: path.dirname(skillPath), description: '将故事规划成有序分镜方案供用户审阅，保持角色、场景、风格和用户约束一致；不直接落画布或生成。',
      body: skillBody, content: skillBody, manifest: null, origin: 'builtin', audience: 'internal', packageVersion: 'nomi-skill-v1', contentHash: 'b1b-fixture', requiresCodingTools: false }] },
    approval: { hasUserInterface: true, policy: () => context.approvalPolicy }, limits: { maxModelRequests: 8 },
    systemPrompt: '你是 Nomi 视频创作助手。根据真实工具结果回答。当前宿主只能创建试拍草稿，报价和生成由画布提交提供；不能假称已生成。',
  });
  const handled = new Set<string>();
  const unsubscribe = lane.subscribe(projection => {
    const pending = projection.pending;
    if (!pending || handled.has(pending.toolCallId)) return;
    handled.add(pending.toolCallId);
    void lane.execute({ kind: 'approval', toolCallId: pending.toolCallId, action: 'allow-once' });
  });
  const turns: Array<Record<string, unknown>> = [];
  try {
    for (const text of ['把这份文稿拆成分镜', '第 1 镜试拍一下', '重新拆一遍']) {
      const start = lane.projection().parts.length;
      const requestStart = requests.length;
      const result = await lane.execute({ kind: 'prompt', text });
      await settleResponse;
      const parts = lane.projection().parts.slice(start);
      turns.push({ input: text, result, parts, requestStart, requestEnd: requests.length,
        loadedSkill: parts.some(p => p.kind === 'tool-result' && JSON.stringify(p).includes('"skill"')),
        shotCount: shots.length, correctTiers: shots.filter(s => s.modelKey === 'MiniMax-H3'
          && (s.params as Record<string, unknown> | undefined)?.resolution === '768P').length });
      const cost = lane.projection().usage.cost;
      if (cost.state === 'known') reservedCny = settledBefore + cost.value * 7;
      await writeFile(budgetFile, JSON.stringify({ reservedCny, settledCny: reservedCny, requests }, null, 2), { mode: 0o600 });
    }
    const sessionRoot = path.join(projectDir, '.nomi', 'agent-sessions');
    const files = await readdir(sessionRoot, { recursive: true });
    const rows = (await Promise.all(files.filter(file => file.endsWith('.jsonl')).map(file => readFile(path.join(sessionRoot, file), 'utf8'))))
      .flatMap(text => text.trim().split('\n').flatMap(line => { const row = JSON.parse(line); return Array.isArray(row) ? row : [row]; }));
    const usageById = new Map(rows.filter(row => row.kind === 'usage').map(row => [row.entryId, row.usage]));
    let turnIndex = -1;
    let previousTotal = 0;
    let previousInput = 0;
    let firstCall = false;
    for (const row of rows) {
      if (row.message?.role === 'nomi.input') { turnIndex += 1; firstCall = true; }
      if (turnIndex < 0) continue;
      const usage = usageById.get(row.id);
      if (usage) {
        const total = usage.input + usage.cacheRead + usage.cacheWrite;
        if (firstCall) { turns[turnIndex]!.newInputTokens = total - previousInput;
          turns[turnIndex]!.netNewContextTokens = total - previousTotal; firstCall = false; }
        previousInput = total;
        previousTotal = total + usage.output;
      }
      if (row.message?.role === 'toolResult' && row.message.details?.skill && !row.message.isError) turns[turnIndex]!.loadedSkill = true;
    }
    const report = { model: model.modelId, totalSpentCny: reservedCny, turns, plans, requests, usage: lane.projection().usage,
      limitation: 'Real DeepSeek with isolated domain fixture; storyboard writes validated by production tools. Paid generation is draft-only, same B1/B4 boundary. No media request.' };
    await writeFile('docs/plan/agent-lane-b1b-evidence/deepseek-sample.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ model: model.modelId, totalSpentCny: reservedCny, requests: requests.length, plans: plans.map(p => p.length) }));
  } finally { unsubscribe(); await lane.close(); }
}
void app.whenReady().then(main).then(() => app.exit(0), () => { console.error('B1B_REAL_SAMPLE_FAILED; inspect isolated budget and transcript, no credential output'); app.exit(1); });
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
