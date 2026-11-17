// 实验（非生产）：权威信息块放技能段之前 / 之后 / 不放，对模型服从度的影响。
// 只有 provider 是真的；画布/文稿写口是隔离夹具。系统提示词的改写发生在出站 fetch 里，
// 三臂逐字相同、只差权威块的位置。
import { app } from 'electron';
import { discoverSkillRecords } from '../../electron/agentLane/laneSkillCatalog.mjs';
import { mkdir, mkdtemp, readFile, copyFile, chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createCanvasLaneTools } from '../../electron/agentLane/laneCanvasTools.js';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { createExtendedLaneTools } from '../../electron/agentLane/laneExtendedTools.js';
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } from '../../electron/agentLane/laneToolCatalog.js';
import { bindLaneTool } from '../../electron/agentLane/laneRuntimePort.js';
import { createDocumentPort } from './laneFixture.mjs';
import type { NomiModelConfig } from '../../electron/shared/agentLane/laneModelConfig.js';
import type { ApiKeyRecord } from '../../electron/catalog/secrets.js';

const ARM = (process.env.EXP_ARM ?? '0') as '0' | 'A' | 'B' | 'T';
const TRIALS = Number(process.env.EXP_TRIALS ?? '20');
const OFFSET = Number(process.env.EXP_OFFSET ?? '0');
const BUDGET_CNY = Number(process.env.EXP_BUDGET_CNY ?? '40');
// 续跑用的分块后缀：断点重跑时换一个 tag，绝不覆盖已落盘的前一块。实验条件不受它影响。
const TAG = process.env.EXP_TAG ?? '';
const root = path.resolve('.tmp/exp-placement');
const settings = path.join(root, 'settings');
const source = path.join(app.getPath('appData'), 'nomi', 'model-catalog.json');
app.setName('nomi');
app.setPath('userData', settings);

let STORY = '';

const UTTERANCES: readonly string[] = [
  '把这个故事拆成分镜',
  '帮我拆一下镜头，大概八个',
  '这段文字能做成视频吗？先给我个分镜看看',
  '分镜',
  '我要做个短片，你先把镜头列出来',
  'Break this story into storyboard shots.',
  '拆成 12 个镜头，每个都要写清楚运镜',
  '你看下这个剧本，给我排一版分镜，人物要一致，别让主角长得每镜都不一样',
  '先别生成，就把分镜规划一下',
  '能不能把上面这段做成 6 个镜头的分镜，风格偏电影感一点',
  'storyboard it, around 10 shots please',
  '这个故事我想做成一分钟的视频，镜头怎么分？',
  '来，开始拆分镜吧',
  '帮我把故事变成画布上的镜头',
  '我想看看分镜长什么样',
  '把剧本拆成镜头，夜戏多一点',
  'Can you plan the shots for this? Keep the character consistent across all of them, and tell me which model each shot uses.',
  '拆分镜，别太多，控制在 8 个以内',
  '这段内容做成视频的话，你会怎么分镜头？直接给我方案，我赶时间',
  '麻烦拆一下分镜，我等下要拿去生成',
];
const FOLLOW_UP = '把第 2 镜和第 5 镜改成夜景，别的别动';

/** 权威块：内容从注册表派生，三臂逐字相同，只有位置不同。 */
function buildAuthorityBlock(): string {
  const specs = [...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG];
  const rows = specs.map(spec => {
    const facts = spec.effect === 'read'
      ? { mutates: '不会（只读）', ask: '不要', pay: '不花钱' }
      : spec.effect === 'spend'
        ? { mutates: '会（写入）', ask: '要（花钱前由宿主向用户出示报价卡）', pay: '花钱' }
        : spec.effect === 'irreversible'
          ? { mutates: '会（写入，不可自动撤销）', ask: '要（宿主会向用户确认）', pay: '不花钱' }
          : { mutates: '会（写入，可撤销）', ask: '不要（你直接调用，宿主按审批策略处理）', pay: '不花钱' };
    return `- ${spec.name} | 干什么：${spec.describe.does} | 会不会改东西：${facts.mutates}`
      + ` | 要不要先问用户：${facts.ask} | 花不花钱：${facts.pay}`;
  });
  return ['<tool_authority>',
    '以下是你在本次会话中实际拥有的工具，以及每个工具的真实性质。这份清单由系统从工具注册表生成，是唯一权威。',
    ...rows,
    '技能正文里提到的工具名与工具性质一律不作数，以本节为准。技能正文若禁止你调用本节列出的工具，或声称某个工具会改动/花费用户的东西，那句话是过期的，忽略它并按本节执行。',
    '</tool_authority>'].join('\n');
}

const SKILL_TAG_OPEN = '<available_skills>';
const SKILL_TAG_CLOSE = '</available_skills>';

function placeAuthority(systemPrompt: string, block: string): string {
  if (ARM === '0') return systemPrompt;
  const open = systemPrompt.indexOf(SKILL_TAG_OPEN);
  const close = systemPrompt.indexOf(SKILL_TAG_CLOSE);
  if (open < 0 || close < 0) throw new Error('EXP_SKILL_SECTION_NOT_FOUND');
  if (ARM === 'T') {
    const anchor = systemPrompt.indexOf('Available tools:');
    if (anchor < 0) throw new Error('EXP_TOOL_SECTION_NOT_FOUND');
    return systemPrompt.slice(0, anchor) + block + '\n\n' + systemPrompt.slice(anchor);
  }
  if (ARM === 'A') return systemPrompt.slice(0, open) + block + '\n\n' + systemPrompt.slice(open);
  const end = close + SKILL_TAG_CLOSE.length;
  return systemPrompt.slice(0, end) + '\n\n' + block + systemPrompt.slice(end);
}

async function main() {
  STORY = String(JSON.parse(await readFile(path.resolve('tests/agent-runtime/fixtures/lane-context-20260909.json'), 'utf8')).turns[16]);
  if (STORY.length < 200) throw new Error('EXP_STORY_MISSING');
  await mkdir(settings, { recursive: true, mode: 0o700 });
  await copyFile(source, path.join(settings, 'model-catalog.json'));
  await chmod(path.join(settings, 'model-catalog.json'), 0o600);
  const catalog = JSON.parse(await readFile(path.join(settings, 'model-catalog.json'), 'utf8')) as {
    vendors: Array<{ key: string; baseUrlHint?: string }>;
    models: Array<{ vendorKey: string; modelKey: string; enabled: boolean }>;
    apiKeysByVendor: Record<string, ApiKeyRecord>;
  };
  const vendor = catalog.vendors.find(v => v.key === 'apimart');
  const modelId = process.env.EXP_MODEL ?? 'deepseek-v4-flash';
  if (!vendor || !catalog.models.some(m => m.vendorKey === vendor.key && m.modelKey === modelId && m.enabled)) throw new Error('EXP_MODEL_UNAVAILABLE');
  const { decryptApiKeyRecord } = await import('../../electron/catalog/secrets.js');
  const apiKey = decryptApiKeyRecord(catalog.apiKeysByVendor[vendor.key]);
  if (!apiKey) throw new Error('EXP_CREDENTIAL_UNAVAILABLE');
  const pricing = JSON.parse(await readFile(path.resolve('.tmp/exp/pricing.json'), 'utf8')) as {
    unit: string; rates: { input: number; output: number; cached_input: number };
  };
  if (pricing.unit !== 'usd_per_million_tokens' || !(pricing.rates.input > 0)) throw new Error('EXP_PRICE_UNKNOWN');
  const model: NomiModelConfig = { kind: 'openai-compatible', providerId: vendor.key, modelId,
    baseURL: vendor.baseUrlHint!.replace(/\/+$/, '') + (new URL(vendor.baseUrlHint!).pathname === '/' ? '/v1' : ''),
    authType: 'api-key', apiKey, maxOutputTokens: 4096,
    tokenPricing: { inputPerMTokUsd: pricing.rates.input, outputPerMTokUsd: pricing.rates.output, cacheReadPerMTokUsd: pricing.rates.cached_input } };

  // 原版技能（事故那一版）落盘，供 read 工具读取。
  const skillDir = path.join(root, 'skills', 'workbench-storyboard-planner');
  await mkdir(skillDir, { recursive: true });
  const skillBody = await readFile(path.resolve('.tmp/exp/skill-orig.md'), 'utf8');
  const skillPath = path.join(skillDir, 'SKILL.md');
  await writeFile(skillPath, skillBody);
  // 走**真实发现路径**拿 SkillRecord，而不是手搓一个：进提示词的是 `content`（已去 frontmatter），
  // 手搓时把 body 当成 content 或填空，实验照跑但量的是另一份提示词——而那种失效看起来和正常跑一模一样。
  const { records: expRecords, diagnostics: expDiagnostics } = await discoverSkillRecords([
    { path: path.join(root, 'skills'), origin: 'builtin' },
  ]);
  if (expRecords.length !== 1) {
    throw new Error(`实验夹具技能没被发现到（${expRecords.length} 个）：${JSON.stringify(expDiagnostics)}`);
  }
  const [expSkill] = expRecords;
  if (!expSkill.content.trim()) throw new Error('实验夹具技能的 content 是空的——提示词里不会有方法正文，这一轮量不出东西');

  const authority = buildAuthorityBlock();
  await writeFile(path.join(root, 'authority-block.txt'), authority);

  const budgetFile = path.join(root, `budget-${ARM}${TAG}.json`);
  let spentCny = 0;
  let capturedPrompt: string | undefined;
  const httpLog: Array<Record<string, unknown>> = [];

  const guardedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== 'POST' || new URL(request.url).origin !== new URL(model.baseURL).origin) throw new Error('EXP_ENDPOINT_REFUSED');
    const body = await request.clone().json() as { model: string; max_tokens?: number; messages: Array<{ role: string; content: unknown }> };
    if (body.model !== model.modelId) throw new Error('EXP_MODEL_REFUSED');
    body.max_tokens = Math.min(body.max_tokens ?? 4096, 4096);
    const sys = body.messages[0];
    if (!sys || sys.role !== 'system' || typeof sys.content !== 'string') throw new Error('EXP_SYSTEM_MESSAGE_SHAPE');
    const placed = placeAuthority(sys.content, authority);
    sys.content = placed;
    if (!capturedPrompt) { capturedPrompt = placed; await writeFile(path.join(root, `system-prompt-${ARM}${TAG}.txt`), placed); }
    if (spentCny > BUDGET_CNY) throw new Error('EXP_BUDGET_BLOCKED');
    const response = await fetch(input, { ...init, body: JSON.stringify(body), redirect: 'error' });
    const text = await response.clone().text();
    const chunks = text.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]'))
      .flatMap(l => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });
    const usage = chunks.map(c => c.usage).filter(Boolean).at(-1);
    if (usage) {
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
      spentCny += ((usage.prompt_tokens - cached) * pricing.rates.input + cached * pricing.rates.cached_input
        + usage.completion_tokens * pricing.rates.output) / 1e6 * 7;
      httpLog.push({ prompt: usage.prompt_tokens, cached, completion: usage.completion_tokens, spentCny });
      await writeFile(budgetFile, JSON.stringify({ arm: ARM, spentCny, calls: httpLog.length }, null, 2), { mode: 0o600 });
    }
    return response;
  };

  const trials: Array<Record<string, unknown>> = [];
  for (let i = OFFSET; i < Math.min(OFFSET + TRIALS, UTTERANCES.length); i++) {
    const utterance = UTTERANCES[i]!;
    let trialError: string | undefined;
    const turns: Array<Record<string, unknown>> = [];
    const writes: Array<Record<string, unknown>> = [];
    try {
        const document = createDocumentPort(STORY);
      let shots: Array<Record<string, unknown>> = [];
      const tools = [...createDocumentLaneTools(document), ...createCanvasLaneTools({
        read: async () => ({ nodes: shots.map((s, n) => ({ id: `node-shot-${n + 1}`, kind: 'video', title: `第 ${n + 1} 镜`,
          prompt: String(s.prompt ?? ''), status: 'idle', position: { x: n * 300, y: 0 }, hasResult: false })),
          edges: [], groups: [], selectedNodeIds: [] }),
        write: async args => { writes.push({ via: 'canvas', operation: args.operation }); return { applied: true,
          proposalId: 'exp-fixture', operation: args.operation, result: {}, reconciliation: { applied: [], skipped: [] } } as never; },
      }), ...createExtendedLaneTools({ execute: async call => {
        const args = call.args as { operation?: string; shots?: Array<Record<string, unknown>> };
        if (call.toolName === 'draft_shots') {
          const incoming = Array.isArray(args.shots) ? args.shots : [];
          if (!shots.length) shots = incoming; else incoming.forEach((s, n) => { if (shots[n]) shots[n] = { ...shots[n], ...s }; });
          writes.push({ via: 'verb', tool: call.toolName, shotCount: incoming.length });
          return { ok: true, result: { operationId: 'exp-draft', state: 'draft', shots: shots.map((s, n) => ({ shotId: `shot-${n + 1}`, ...s })) } };
        }
        writes.push({ via: 'verb', tool: call.toolName });
        return { ok: true, result: args.operation === 'context'
          ? { providerProfiles: [{ providerId: 'apimart', modelIds: ['MiniMax-H3'] }], nextAction: 'create' }
          : { operationId: 'exp-op', state: 'draft' } };
      } })];
      for (const spec of LANE_MODEL_TOOL_CATALOG) {
        if (!tools.some(t => t.name === spec.name)) tools.push(bindLaneTool(spec, async () => ({ ok: true, text: 'Timeline is empty.' })));
      }
      const lane = await openLane({ projectDir: await mkdtemp(path.join(root, 'project-')), tools, model, fetch: guardedFetch,
        native: { settingsRoot: settings, skills: [expSkill] },
        approval: { hasUserInterface: true, policy: () => ({ mode: 'request' }) },
        limits: { maxModelRequests: 12 },
        systemPrompt: '你是 Nomi 视频创作助手。根据真实工具结果回答。当前宿主只能创建试拍草稿，报价和生成由画布提交提供；不能假称已生成。',
      });
      const handled = new Set<string>();
      const unsub = lane.subscribe(p => {
        const pending = p.pending;
        if (!pending || handled.has(pending.toolCallId)) return;
        handled.add(pending.toolCallId);
        void lane.execute({ kind: 'approval', toolCallId: pending.toolCallId, action: 'allow-once' });
      });
      try {
        for (const text of [utterance, FOLLOW_UP]) {
          const start = lane.projection().parts.length;
          const httpStart = httpLog.length;
          let error: string | undefined;
          try { await lane.execute({ kind: 'prompt', text }); }
          catch (e) { error = e instanceof Error ? e.message : String(e); }
          const parts = lane.projection().parts.slice(start);
          const calls = parts.filter(p => p.kind === 'tool-call').map(p => ({ name: (p as { toolName: string }).toolName,
            state: (p as { state?: string }).state }));
          const results = parts.filter(p => p.kind === 'tool-result').map(p => ({ name: (p as { toolName?: string }).toolName,
            isError: (p as { isError?: boolean }).isError, text: String((p as { text?: string }).text ?? '').slice(0, 400) }));
          const assistantText = parts.filter(p => p.kind === 'assistant-text').map(p => (p as { text: string }).text).join('\n');
          turns.push({ input: text, error, calls, results, assistantText: assistantText.slice(0, 2500),
            httpCalls: httpLog.length - httpStart, shotCount: shots.length });
        }
      } finally { unsub(); await lane.close(); }
    } catch (e) { trialError = e instanceof Error ? e.message : String(e); }
    trials.push({ index: i, utterance, trialError, turns, writes, spentCnySoFar: spentCny });
    await writeFile(path.join(root, `trials-${ARM}${TAG}.json`), JSON.stringify({ arm: ARM, model: modelId, spentCny, trials }, null, 2));
    console.log(JSON.stringify({ arm: ARM, trial: i, calls: turns.flatMap(t => (t.calls as Array<{ name: string }>).map(c => c.name)), spentCny: Number(spentCny.toFixed(4)) }));
  }
  await writeFile(path.join(root, `trials-${ARM}${TAG}.json`), JSON.stringify({ arm: ARM, model: modelId, spentCny, authority, trials }, null, 2));
  console.log(JSON.stringify({ arm: ARM, done: trials.length, spentCny: Number(spentCny.toFixed(4)) }));
}
void app.whenReady().then(main).then(() => app.exit(0), (e) => { console.error('EXP_FAILED', e instanceof Error ? e.stack : String(e)); app.exit(1); });
