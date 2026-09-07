// 阶段 3 前置探针（方案 §4.3）的**裸 lane 夹具**。
//
// `openLane`（`laneHost.mts`）故意只露 `prompt` / `abort` 两条命令——那是产品面。探针要问的
// 是 pi 自己的行为：`steer` / `abort` 带回什么、`resume` 对停在预检里的调用做什么、
// `appendMessage` 会不会拒收乱序的 toolResult。这些都在 `AgentLane` 上，产品面**不该**露它们。
//
// 所以这里把 `laneHost.mts` 的装配步骤原样复述一遍（同一个 session repo、同一个 provider、
// 同一个 `createLaneTools`），只是把 `lane` 与 `harness` 本体交出来。它**不是**第二个宿主：
// 不投影、不存转录、不做闸——探针自己在 `before_tool` 上挂它要问的东西。
import { AgentHarness, type AgentLane, type HookHandler } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/pi-agent-core/harness/context';
import { createModels, type Provider } from '@earendil-works/pi-ai';

import { createNomiProvider } from '../../electron/harness/runtime/pi/model.mjs';
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import type { OpenLaneOptions } from '../../electron/agentLane/laneRuntimePort.js';
import { LANE_SYSTEM_PROMPT } from './laneFixture.mjs';

export const PROBE_CONTEXT: Context = BACKGROUND_CONTEXT;

/**
 * `node:test` 的 `t.after` 就够了；把参数收窄到这一个方法，是为了 P5③ 那个**不在测试
 * runner 里跑**的真实模型探针（Electron 进程，要 safeStorage 才解得开 app 设置里的 key）
 * 也能复用同一套装配，而不是再抄一份 `AgentHarness.create`。
 */
export interface ProbeCleanup {
  after(fn: () => void | Promise<void>): void
}

export interface ProbeLane {
  harness: AgentHarness<undefined>
  lane: AgentLane
  sessionId: string
  /** 正常关闭：关 harness、交还 repo 持有权。P1③ 的「崩溃」臂**故意不调它**。 */
  close(): Promise<void>
}

export interface ProbeLaneOptions {
  /** 复用一条落盘会话（P1③ 重开、P2 迁移后重开走这里）。 */
  sessionId?: string
  /** 在 `createNomiProvider` 的产物外面再包一层（P3② 用它挂看门狗）。 */
  wrapProvider?(provider: Provider): Provider
  beforeTool?: HookHandler<'before_tool'>
}

export async function openProbeLane(
  t: ProbeCleanup, options: Omit<OpenLaneOptions, 'gate'>, probe: ProbeLaneOptions = {},
): Promise<ProbeLane> {
  const { session, sessionId, release } = await openLaneSession(
    { projectDir: options.projectDir, ...(probe.sessionId ? { sessionId: probe.sessionId } : {}) }, PROBE_CONTEXT,
  );
  const { provider, model, credentials } = await createNomiProvider(options.model);
  const models = createModels({ credentials });
  models.setProvider(probe.wrapProvider ? probe.wrapProvider(provider) : provider);
  const tools = createLaneTools(options.tools);
  const { harness } = await AgentHarness.create<undefined>({
    session, models, model, systemPrompt: options.systemPrompt || LANE_SYSTEM_PROMPT, tools,
    activeToolNames: tools.map((tool) => tool.name),
    toolExecution: 'sequential',
  }, PROBE_CONTEXT);
  const lane = await harness.lane(options.laneName ?? 'main', PROBE_CONTEXT);
  if (probe.beforeTool) harness.hooks.on('before_tool', probe.beforeTool);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    await harness.close(PROBE_CONTEXT);
    await release(PROBE_CONTEXT);
  })();
  t.after(() => close());
  return { harness, lane, sessionId, close };
}

/** 一个外部可 resolve 的 promise：探针用它把「钩子进来了」这件事交给测试主体，不用墙钟等。 */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** `AbortSignal` → 一个在 abort 时**拒绝**的 promise（拒绝理由 = `signal.reason`）。 */
export function rejectOnAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** `AbortSignal` → 一个在 abort 时**兑现**的 promise。 */
export function resolveOnAbort(signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!signal) return;
    if (signal.aborted) { resolve(); return; }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
