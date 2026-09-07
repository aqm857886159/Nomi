// 阶段 3 前置探针 **P2（轻量）**（方案 §4.3）：旧对话（`agent-thread-context-v1.json`）能不能
// 逐条回填进 pi 的 lane 转录——§2.1 第一档「`appendMessage` + `appendCustomEntry` 逐条回填」
// 押的就是这件事。只出结论，不做迁移。
//
// 两个问题，各一条断言：
//   ① 逐条 `appendMessage` / `appendCustomEntry` → close → 重开 + watch：段数与顺序 = 源文件。
//   ② toolCall / toolResult **成对追加**会不会被 pi 的顺序校验拒收；回填之后再跑一轮，
//      供应商收到的历史里 toolResult 是否紧跟 toolCall（这才是模型侧「上下文连贯」的判据）。
//
// 源文件**不是手写的**：先用今天的生产写入路径（`createAgentContextService.run`）真跑一轮
// 落一份 v1 文件，再从那份文件读回来。手写一份「像 v1 的 JSON」只能证明我写的假数据和我写的
// 断言一致。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import type { AgentMessage, Entry } from '@earendil-works/pi-agent-core';

import type { AgentContextBinding, AgentContextScope } from '../../electron/harness/context/contextBinding.js';
import { createAgentContextService } from '../../electron/harness/context/contextService.js';
import { createAgentContextStore } from '../../electron/harness/context/contextStore.js';
import { runAgentTurn, snapshotCodec } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { importSnapshot } from '../../electron/harness/runtime/pi/snapshot.mjs';
import { createProjectAgentContextBinding } from '../../electron/shared/contracts/projectAgentContextBinding.js';
import { createRuntimeFixture } from './httpFixture.mjs';
import { createLaneFixture } from './laneFixture.mjs';
import { PROBE_CONTEXT, openProbeLane } from './stage3ProbeHarness.mjs';

const LEGACY_TOOL_RESULT = 'LEGACY_SHOT_RESULT_FROM_THE_OLD_RUNTIME';
const binding: AgentContextBinding = createProjectAgentContextBinding(
  { projectId: 'project-1', immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8', projectGeneration: 3 },
  'thread-creation',
);
const persistent: AgentContextScope = { kind: 'persistent', binding };

/** 一条转录段的身份：类型 + 角色/自定义类型 + 它自己的一句话。刻意不含 id/seq——否则断言在自证。 */
function shapeOfLegacy(entry: { type: string; message?: { role: string; content: unknown; toolCallId?: string }; customType?: string; summary?: string }): string {
  if (entry.type === 'message' && entry.message) {
    const message = entry.message;
    return `message:${message.role}:${message.toolCallId ?? ''}:${textOf(message.content)}`;
  }
  return `custom:nomi.legacy.${entry.type}:${entry.customType ?? ''}`;
}

function shapeOfLane(entry: Entry): string {
  if (entry.type === 'message') {
    const message = entry.message as { role: string; content: unknown; toolCallId?: string };
    return `message:${message.role}:${message.toolCallId ?? ''}:${textOf(message.content)}`;
  }
  if (entry.type === 'custom') return `custom:${entry.customType}:${(entry.data as { customType?: string } | undefined)?.customType ?? ''}`;
  return `${entry.type}`;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (part?.type === 'text') return part.text;
    if (part?.type === 'toolCall') return `toolCall(${part.name}#${part.id})`;
    return `[${part?.type}]`;
  }).join('|');
}

/** 用**今天的生产写入路径**落一份真实的 v1 文件，再把它的 pi 条目读回来。 */
async function writeLegacyContext(t: Parameters<typeof createRuntimeFixture>[0]) {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'legacy-read', name: 'read_shot', arguments: {} }] },
    { type: 'text', text: 'The shot is recorded.' },
  ]);
  request.tools = [{ name: 'read_shot', description: 'Read the current shot once.', schema: z.object({}) }];
  const file = join(request.cwd, '.nomi', 'agent-thread-context-v1.json');
  const store = createAgentContextStore({ resolveFile: () => file });
  const service = createAgentContextService({ store, codec: snapshotCodec, runAgentTurn });
  const hooks = { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true as const, result: LEGACY_TOOL_RESULT }) };
  const finished = await service.run(persistent, () => ({ ...request, user: { durableText: 'Read the shot for me.' } }), hooks);
  assert.equal(finished.status, 'finished');
  assert.equal(http.requests.length, 2, 'the legacy runtime spent two requests: tool call + closing text');
  const stored = store.read(binding);
  assert.ok(stored?.snapshot, 'the v1 file holds a native snapshot');
  const manager = await importSnapshot(stored.snapshot, request);
  return { entries: manager.getEntries() as Array<{ type: string; message?: { role: string; content: unknown; toolCallId?: string }; customType?: string; summary?: string }>, request };
}

test('P2 ① · a real v1 file replays entry by entry into a lane and survives close → reopen in the same order', async (t) => {
  const legacy = await writeLegacyContext(t);
  const source = legacy.entries.map(shapeOfLegacy);
  assert.ok(source.some((line) => line.startsWith('message:toolResult:legacy-read')), 'the source really contains a tool pair');

  const laneFixture = await createLaneFixture(t, [{ type: 'text', text: 'Continuing from the old conversation.' }]);
  const first = await openProbeLane(t, laneFixture.options);
  for (const entry of legacy.entries) {
    if (entry.type === 'message' && entry.message) {
      await first.lane.appendMessage(entry.message as AgentMessage, PROBE_CONTEXT);
      continue;
    }
    // 非消息条目（model_change / compaction / custom_message …）：P2 轻量只验「能落、顺序在」，
    // 迁移时各自怎么改写（§2.1 三档）不在这里裁。
    await first.lane.appendCustomEntry(`nomi.legacy.${entry.type}`, entry.customType ? { customType: entry.customType } : undefined, PROBE_CONTEXT);
  }
  const { sessionId } = first;
  await first.close();

  const reopened = await openProbeLane(t, laneFixture.options, { sessionId });
  const watch = await reopened.lane.watch(PROBE_CONTEXT);
  t.after(() => watch.unsubscribe());
  const replayed = watch.snapshot.transcript.map(shapeOfLane);
  assert.deepEqual(replayed, source, 'segment count and order after reopen equal the v1 source');
  console.log(`[P2] replayed ${replayed.length} entries: ${replayed.map((line) => line.split(':').slice(0, 2).join(':')).join(' → ')}`);

  // ② 回填之后再跑一轮：供应商收到的历史里 toolResult 紧跟它的 toolCall。
  const run = await reopened.lane.prompt('Continue.', undefined, PROBE_CONTEXT);
  assert.ok(run.ok, `the continued turn settles: ${run.ok ? '' : JSON.stringify(run.error)}`);
  const wire = laneFixture.http.requests[0]?.body as { messages: Array<{ role: string; content?: unknown; tool_calls?: Array<{ id: string }>; tool_call_id?: string }> };
  const callIndex = wire.messages.findIndex((message) => message.role === 'assistant' && message.tool_calls?.some((call) => call.id === 'legacy-read'));
  assert.ok(callIndex >= 0, 'the legacy tool call reached the provider');
  const next = wire.messages[callIndex + 1];
  assert.equal(next?.role, 'tool', 'the tool result follows its call immediately on the wire');
  assert.equal(next?.tool_call_id, 'legacy-read');
  assert.match(JSON.stringify(next?.content), new RegExp(LEGACY_TOOL_RESULT), 'the old result text is what the model reads');
});

test('P2 ② positive control · pi does NOT validate tool pairing on append: a result appended before its call is stored in that order', async (t) => {
  // 如果这条也「按顺序」通过，上面那条断言就什么都没证明。这里故意把 toolResult 排在
  // toolCall 前面：pi 若拒收，`appendMessage` 会抛/返错；实跑它**照单全收**——顺序校验
  // 不存在，成对与否是迁移脚本自己的责任。
  const laneFixture = await createLaneFixture(t, [{ type: 'text', text: 'Unreachable.' }]);
  const probe = await openProbeLane(t, laneFixture.options);
  const timestamp = 1_700_000_000_000;
  const result: AgentMessage = { role: 'toolResult', toolCallId: 'orphan', toolName: 'read_shot', content: [{ type: 'text', text: 'early' }], isError: false, timestamp };
  const call: AgentMessage = {
    role: 'assistant', content: [{ type: 'toolCall', id: 'orphan', name: 'read_shot', arguments: {} }],
    api: 'openai-completions', provider: 'nomi-lane', model: 'chosen-model', stopReason: 'toolUse', timestamp,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  await assert.doesNotReject(() => probe.lane.appendMessage(result, PROBE_CONTEXT), 'a toolResult with no preceding call is accepted');
  await assert.doesNotReject(() => probe.lane.appendMessage(call, PROBE_CONTEXT));
  const entries = (await probe.lane.watch(PROBE_CONTEXT)).snapshot.transcript.map(shapeOfLane);
  assert.deepEqual(entries.map((line) => line.split(':')[1]), ['toolResult', 'assistant'], 'stored exactly as appended, wrong order and all');
});
