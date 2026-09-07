// 阶段 3 前置探针 **P5 ③**：真实模型三次调用，看扁平版 `nomi_storyboard_write` 的**首调**
// 有没有命中正确的 operation；顺带用「带 / 不带这个工具」两次请求的 prompt_tokens 之差，
// 量出它在真实 tokenizer 下的 token 成本（① 的估计值只是字符启发式）。
//
// **不是测试文件**（没有 `.test.`），要用 Electron 跑：
//   pnpm exec tsc -p tests/agent-runtime/tsconfig.json
//   pnpm exec electron .tmp/agent-runtime-tests/tests/agent-runtime/stage3-probe-p5-real.electron.mjs
// 为什么必须是 Electron 进程：key 走 app 设置的读取路径（`chooseTextModel` →
// `decryptApiKeyRecord` → `safeStorage`），而 safeStorage 只在 Electron 主进程里活着。
// 身份要与写入密文的那个 app 一致（`app.setName`，同 `main.ts:116-119` 的理由）。
//
// key **不打印、不落盘、不进报告**；输出只有工具名 / operation / token 数。
// 单次预算：每个任务 ≤ 3 次请求（读画布 + 写分镜 + 兜底），外加 2 次量 token；DeepSeek V4 Flash 级别 ≈ 分毫。
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HookHandler, LaneSnapshot } from '@earendil-works/pi-agent-core';

import { canvasLaneToolSpecs, createCanvasLaneTools, type CanvasLanePort } from '../../electron/agentLane/laneCanvasTools.js';
import { composeLaneSystemPrompt } from '../../electron/agentLane/lanePromptSections.js';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import type { ApiKeyRecord } from '../../electron/catalog/secrets.js';
import type { NomiModelConfig } from '../../electron/harness/runtime/runtimePort.js';
import { PROBE_CONTEXT, openProbeLane, type ProbeCleanup } from './stage3ProbeHarness.mjs';

const VENDOR = process.env.NOMI_PROBE_VENDOR || 'apimart';
const MODEL = process.env.NOMI_PROBE_MODEL || 'deepseek-v4-flash';
const STORYBOARD_TOOL = 'nomi_storyboard_write';
const IDENTITY_PROMPT = [
  'You are Nomi, the assistant inside a local-first AI video workbench.',
  'The user is writing a short film. Use the tools to act on the storyboard and canvas; reply in the user\'s language.',
].join(' ');

const SCRIPT = '林夏站在黄昏的天台上，风把她的校服吹得鼓起来。她走到栏杆边，低头看了很久，然后深吸一口气，转身笑了。';

interface TaskSpec {
  id: string
  prompt: string
  expectedOperation: string
  /** 画布上已有的分镜节点：patch / arrange 两个任务需要它，模型会先读画布。 */
  canvasShots: number
}

const TASKS: readonly TaskSpec[] = [
  { id: 'propose', prompt: `把下面这段故事拆成 3 个镜头的图片分镜表，一个角色锚点。\n\n${SCRIPT}`, expectedOperation: 'propose_storyboard_plan', canvasShots: 0 },
  { id: 'patch', prompt: '画布上已经有一张 3 镜的分镜表。把第 2 镜和第 3 镜改成 4 秒的视频镜头，其它不动。', expectedOperation: 'patch_shots', canvasShots: 3 },
  { id: 'arrange', prompt: '把画布上现有的分镜镜头按故事顺序排到时间轴上。', expectedOperation: 'arrange_storyboard_to_timeline', canvasShots: 3 },
];

interface FirstCall { toolName: string; operation?: string; args: unknown }
interface TaskResult {
  id: string
  expectedOperation: string
  calls: FirstCall[]
  firstStoryboardCall?: FirstCall
  hit: boolean
  requests: number
  promptTokensFirstRequest?: number
  stopReasons: string[]
  error?: string
}

function canvasPort(shots: number): CanvasLanePort {
  const nodes = Array.from({ length: shots }, (_, index) => ({
    id: `node-shot-${index + 1}`, kind: 'keyframe', title: `镜 ${index + 1}`, prompt: `Shot ${index + 1} of the rooftop scene.`,
    status: 'idle', position: { x: index * 320, y: 0 }, locked: false, shotIndex: index + 1, hasResult: false,
  }));
  return {
    read: async () => ({ nodes, edges: [], groups: [], selectedNodeIds: [] }),
    write: async (input) => ({ applied: true, proposalId: 'probe-proposal', operation: input.operation, result: {}, reconciliation: { ok: true, deviationCount: 0 } } as never),
  };
}

/** 今天的 lane 没有看门狗（P3 ①），一次挂死的请求会让探针永远不结束：90s 没回就按停。 */
async function bounded<T>(promise: Promise<T>, stop: () => Promise<unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { void stop().catch(() => undefined); reject(new Error('probe request exceeded 90s')); }, 90_000);
  });
  try { return await Promise.race([promise, deadline]); } finally { if (timer) clearTimeout(timer); }
}

function cleanup(): ProbeCleanup & { run(): Promise<void> } {
  const fns: Array<() => void | Promise<void>> = [];
  return { after: (fn) => { fns.push(fn); }, run: async () => { for (const fn of fns.reverse()) await fn(); } };
}

interface CatalogFile {
  vendors: Array<{ key: string; baseUrlHint?: string; authType: string; providerKind?: string }>
  models: Array<{ vendorKey: string; modelKey: string; modelAlias?: string | null; kind: string; enabled: boolean }>
  apiKeysByVendor: Record<string, ApiKeyRecord>
}

/**
 * 同一条读取路径：`<userData>/model-catalog.json` → `apiKeysByVendor[vendor]` → `decryptApiKeyRecord`
 * （safeStorage）。不经 `chooseTextModel`：它的 import 图拖进一串不走 NodeNext 的目录文件，
 * 这个 tsconfig 编不过；这里只复述它选模型的那三行（同 vendor + 同 modelKey + kind text）。
 * baseURL 规则照 `vendorModelConnection.ts:resolveSdkBaseUrl`：裸 origin 补 `/v1`。
 */
async function resolveModel(): Promise<{ config: NomiModelConfig; label: string }> {
  const { decryptApiKeyRecord } = await import('../../electron/catalog/secrets.js');
  const catalog = JSON.parse(await readFile(join(app.getPath('userData'), 'model-catalog.json'), 'utf8')) as CatalogFile;
  const vendor = catalog.vendors.find((candidate) => candidate.key === VENDOR);
  const model = catalog.models.find((candidate) => candidate.vendorKey === VENDOR && candidate.modelKey === MODEL && candidate.kind === 'text' && candidate.enabled);
  if (!vendor || !model) throw new Error(`No enabled text model ${VENDOR}/${MODEL} in the app catalog`);
  const apiKey = decryptApiKeyRecord(catalog.apiKeysByVendor[VENDOR]);
  if (!apiKey) throw new Error(`The ${VENDOR} credential is present but this process cannot decrypt it (safeStorage identity mismatch?)`);
  const base = (vendor.baseUrlHint || '').trim().replace(/\/+$/, '');
  const url = new URL(base);
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  const kind = vendor.providerKind === 'anthropic' ? 'anthropic' : vendor.providerKind === 'openai-responses' ? 'openai-responses' : 'openai-compatible';
  const config: NomiModelConfig = { kind, providerId: vendor.key, modelId: (model.modelAlias || model.modelKey).trim(), baseURL: url.toString(), authType: 'api-key', apiKey, temperature: 0 };
  return { config, label: `${vendor.key}/${config.modelId} (${kind} @ ${config.baseURL})` };
}

async function runTask(config: NomiModelConfig, task: TaskSpec, tools: LaneToolDescriptor[]): Promise<TaskResult> {
  const scope = cleanup();
  const calls: FirstCall[] = [];
  let requests = 0;
  const beforeTool: HookHandler<'before_tool'> = async (event) => {
    const args = event.args as { operation?: string } | undefined;
    const call: FirstCall = { toolName: event.toolName, args: event.args, ...(args?.operation ? { operation: args.operation } : {}) };
    calls.push(call);
    // 读画布放行（模型按 guideline 先读是对的）；第一次碰到分镜写入就停——问题已经答了，
    // 不花第二轮的钱。任何第三次调用也停：本探针每任务最多 3 次请求。
    if (event.toolName === STORYBOARD_TOOL || calls.length >= 3) {
      return { block: { reason: 'Probe stop: the first storyboard call has been recorded.', terminate: true } };
    }
    return undefined;
  };
  try {
    const probe = await openProbeLane(scope, {
      projectDir: join(app.getPath('temp'), `nomi-p5-${task.id}-${Date.now()}`),
      systemPrompt: composeLaneSystemPrompt(IDENTITY_PROMPT, canvasLaneToolSpecs()),
      model: config, tools,
    }, { beforeTool });
    probe.harness.hooks.on('before_request', async () => { requests += 1; return undefined; });
    mark(`task ${task.id} prompt`);
    const result = await bounded(probe.lane.prompt(task.prompt, undefined, PROBE_CONTEXT), () => probe.lane.abort(PROBE_CONTEXT));
    const snapshot: LaneSnapshot = (await probe.lane.watch(PROBE_CONTEXT)).snapshot;
    const assistants = snapshot.transcript.flatMap((entry) => entry.type === 'message' && entry.message.role === 'assistant' ? [entry.message] : []);
    const firstStoryboardCall = calls.find((call) => call.toolName === STORYBOARD_TOOL);
    return {
      id: task.id, expectedOperation: task.expectedOperation, calls, requests,
      ...(firstStoryboardCall ? { firstStoryboardCall } : {}),
      hit: firstStoryboardCall?.operation === task.expectedOperation,
      ...(assistants[0] ? { promptTokensFirstRequest: assistants[0].usage.input + assistants[0].usage.cacheRead } : {}),
      stopReasons: assistants.map((message) => message.stopReason),
      ...(result.ok ? {} : { error: JSON.stringify(result.error) }),
    };
  } catch (error) {
    return { id: task.id, expectedOperation: task.expectedOperation, calls, requests, hit: false, stopReasons: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    await scope.run();
  }
}

/** 「回复 ok」一次，只取第一条助手消息的输入 token。带与不带分镜工具各跑一次，差 = 该工具的真实 token 成本。 */
async function measurePromptTokens(config: NomiModelConfig, tools: LaneToolDescriptor[]): Promise<number> {
  const scope = cleanup();
  try {
    const probe = await openProbeLane(scope, {
      projectDir: join(app.getPath('temp'), `nomi-p5-measure-${tools.length}-${Date.now()}`),
      systemPrompt: composeLaneSystemPrompt(IDENTITY_PROMPT, tools), model: config, tools,
    });
    await bounded(probe.lane.prompt('只回复 ok。', undefined, PROBE_CONTEXT), () => probe.lane.abort(PROBE_CONTEXT));
    const snapshot = (await probe.lane.watch(PROBE_CONTEXT)).snapshot;
    const first = snapshot.transcript.find((entry) => entry.type === 'message' && entry.message.role === 'assistant');
    if (!first || first.type !== 'message' || first.message.role !== 'assistant') throw new Error('no assistant message');
    return first.message.usage.input + first.message.usage.cacheRead;
  } finally {
    await scope.run();
  }
}

const mark = (stage: string) => process.stderr.write(`[p5-real] ${new Date().toISOString()} ${stage}\n`);
app.setName('nomi');
app.setPath('userData', join(app.getPath('appData'), 'nomi'));
// ⚠️ Electron 的 ESM 入口：`ready` 要等入口模块**求值完**才会发（官方 ESM 限制），
// 所以在顶层 `await app.whenReady()` 会与它互相等——第一版探针就这样挂了 240s 一字不出。
void app.whenReady().then(main);

async function main(): Promise<void> {
  mark('ready');
  const report: Record<string, unknown> = { vendor: VENDOR, model: MODEL, startedAt: new Date().toISOString() };
  try {
    const { config, label } = await resolveModel();
    report.resolved = label;
    mark(`resolved ${label}`);
    const withStoryboard = createCanvasLaneTools(canvasPort(3));
    const withoutStoryboard = withStoryboard.filter((tool) => tool.name !== STORYBOARD_TOOL);
    const promptWith = await measurePromptTokens(config, withStoryboard);
    mark(`measured with=${promptWith}`);
    const promptWithout = await measurePromptTokens(config, withoutStoryboard);
    mark(`measured without=${promptWithout}`);
    report.tokenCost = { promptTokensWithStoryboardTool: promptWith, promptTokensWithoutStoryboardTool: promptWithout, storyboardToolTokens: promptWith - promptWithout };
    const tasks: TaskResult[] = [];
    for (const task of TASKS) {
      tasks.push(await runTask(config, task, createCanvasLaneTools(canvasPort(task.canvasShots))));
      mark(`task ${task.id} done: ${JSON.stringify(tasks.at(-1))}`);
    }
    report.tasks = tasks;
    report.hits = `${tasks.filter((task) => task.hit).length}/${tasks.length}`;
  } catch (error) {
    report.fatal = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  report.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  app.exit(report.fatal ? 1 : 0);
}
