// Agent lane · 工具结果的**上限**（核对表 G-04）。
//
// 这一条和它上面那两条（0o600、单持有者）是同一族：**失败时不报错**。一份被整份塞进
// 上下文的原稿不会抛异常——它只是把窗口吃光，让这一轮突然变笨、或者让下一次压缩在半路
// 失败。上游把它写成 MUST（`pi-coding-agent/docs/extensions.md:2172` *"Tools MUST truncate
// their output"*）并随包发了工具，所以这里要证的不是「我们发明了一个截断器」，
// 而是**用的是它那个、用的是它那两个数、而且说明书没有对模型撒谎**。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '@earendil-works/pi-agent-core';

import { createCanvasLaneTools, type CanvasLanePort } from '../../electron/agentLane/laneCanvasTools.js';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import { LANE_READ_TOOL_TIMEOUT_MS } from '../../electron/shared/agentLane/laneToolContract.js';
import {
  LANE_MODEL_OUTPUT_MAX_BYTES, LANE_MODEL_OUTPUT_MAX_LINES,
} from '../../electron/shared/agentLane/laneContracts.js';
import { createDocumentPort, createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

test('the lane’s limits are pi’s own two numbers, not a pair we picked', () => {
  // 中立契约层那两个常量是**镜像**：CJS 侧的工具说明书和 ESM 岛里的截断器都读它，
  // 而 `require()` 到不了 pi 的 ESM 包。镜像会漂，所以这里把它钉在上游那两个数上——
  // 上游哪天改了默认值，先红的是这条测试，不是某天被喂了 100KB 的模型。
  assert.equal(LANE_MODEL_OUTPUT_MAX_LINES, DEFAULT_MAX_LINES);
  assert.equal(LANE_MODEL_OUTPUT_MAX_BYTES, DEFAULT_MAX_BYTES);
});

test('a document tool’s description names the same cap the transport actually applies', () => {
  const [readFullText] = createDocumentLaneTools(createDocumentPort());
  // 这条测的是**说明书与执行同源**。原来这句话写的是 "with no truncation"——
  // 在截断落地的那一刻它就成了一句谎，而模型没有第二个渠道能发现这件事。
  assert.match(readFullText.description, new RegExp(`${LANE_MODEL_OUTPUT_MAX_LINES} lines`));
  assert.match(readFullText.description, new RegExp(`${LANE_MODEL_OUTPUT_MAX_BYTES / 1024}KB`));
  assert.doesNotMatch(readFullText.description, /no truncation/i);
});

/** 一个只负责吐出 `text` 的工具。截断是**传输层**的活，与哪个能力无关。 */
function echoTool(name: string, text: string): LaneToolDescriptor {
  return {
    contractId: 'document.read',
    name,
    description: `Returns a fixed body of text, used to prove the transport truncates what the model sees.`,
    promptSnippet: 'return a fixed body of text.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
    effect: 'read',
    execution: { timeoutMs: LANE_READ_TOOL_TIMEOUT_MS },
    schema: z.object({}).strict(),
    examples: [{ when: 'Call it with no arguments:', arguments: {} }],
    execute: async () => ({ ok: true, text, details: { source: name } }),
  };
}

test('the contract parse runs once, after pi\'s ajv, and a cross-field failure reaches the model as a next step', async (t) => {
  // 2026-09-07 合并评审实核：pi 的 ajv 只验扁平形状；扁平 schema 的 `transform`（union +
  // 跨字段约束）此前没有任何东西调用，`{operation:"connect_canvas_edges", edges:[]}` 一路绿到
  // 领域端口。这条测的是唯一出口（`laneTools.mts`）现在真的跑了那一次 parse。
  const writes: unknown[] = [];
  const port: CanvasLanePort = {
    read: async () => ({ nodes: [], edges: [], groups: [] }),
    write: async (input) => { writes.push(input); return { applied: true, proposalId: 'p1', operation: 'set_node_prompt' } as never; },
  };
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [
      { id: 'empty-edges', name: 'nomi_canvas_write', arguments: { operation: 'connect_canvas_edges', edges: [] } },
      { id: 'stray-field', name: 'nomi_canvas_write', arguments: { operation: 'set_node_prompt', nodeId: 'n1', prompt: 'x', summary: 'belongs to create' } },
      { id: 'valid', name: 'nomi_canvas_write', arguments: { operation: 'set_node_prompt', nodeId: 'n1', prompt: 'Closer.' } },
    ] },
    { type: 'text', text: 'Done.' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, tools: createCanvasLaneTools(port) });
  await lane.execute({ kind: 'prompt', text: 'Connect them.' });

  const results = lane.projection().parts.filter((part) => part.kind === 'tool-result');
  const empty = results.find((part) => part.toolCallId === 'empty-edges');
  const stray = results.find((part) => part.toolCallId === 'stray-field');
  const valid = results.find((part) => part.toolCallId === 'valid');
  assert.ok(empty && stray && valid, 'all three calls produced a result');
  assert.equal(empty.isError, true, 'an empty edge list must be an error result, not a green receipt');
  assert.match(empty.text, /at least one edge/);
  assert.match(empty.text, /edges: expected .*, received array/, 'the issue names the field and a type, not the value');
  assert.match(empty.text, /Next: /, 'a rejection without a next step makes the model resend the same call');
  assert.equal(stray.isError, true, 'a field from another operation is rejected, as the description promises');
  assert.match(stray.text, /no field named summary/);
  assert.doesNotMatch(stray.text, /belongs to create/, 'received values never go back to the model');
  // 阳性对照：合法调用照常到达领域端口，且只到达一次——两条被拒的一次都没到。
  assert.equal(valid.isError, false);
  assert.deepEqual(writes, [{ operation: 'set_node_prompt', nodeId: 'n1', prompt: 'Closer.' }]);

  // G-03 的后一半：两段真的到了供应商。此前 `composeLaneSystemPrompt` 零生产调用者。
  const first = fixture.http.requests[0]?.body as { messages?: { role: string; content: string }[] };
  const system = first.messages?.find((message) => message.role === 'system')?.content ?? '';
  assert.match(system, /^NOMI_LANE_SYSTEM/, 'the host identity prompt comes first');
  assert.match(system, /Available tools:\n- look_at_canvas: /);
  assert.match(system, /Guidelines:\n- Read the canvas before you change it/);
});

test('G-04 · an oversized tool result reaches the model truncated, with a next step it can act on', async (t) => {
  const huge = Array.from({ length: LANE_MODEL_OUTPUT_MAX_LINES + 1000 }, (_, i) => `line ${i + 1}`).join('\n');
  const small = 'The opening scene.\nA second line.';
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [
      { id: 'big', name: 'returns_a_manuscript', arguments: {} },
      { id: 'tiny', name: 'returns_two_lines', arguments: {} },
    ] },
    { type: 'text', text: 'Read both.' },
  ]);
  const lane = await fixture.openLane({
    ...fixture.options,
    tools: [echoTool('returns_a_manuscript', huge), echoTool('returns_two_lines', small)],
  });
  await lane.execute({ kind: 'prompt', text: 'Read them.' });

  const results = lane.projection().parts.filter((part) => part.kind === 'tool-result');
  const big = results.find((part) => part.toolCallId === 'big');
  const tiny = results.find((part) => part.toolCallId === 'tiny');

  assert.ok(big, 'the oversized call produced a result');
  assert.ok(big.text.length < huge.length, 'the model did not receive the whole thing');
  assert.match(big.text, /^line 1\n/, 'what it did receive is the head, in order, unaltered');
  assert.ok(!big.text.includes(`line ${LANE_MODEL_OUTPUT_MAX_LINES + 1}\n`), 'the tail past the cap is gone');
  // 三件事缺一不可：被截了 / 截掉多少 / 下一步做什么。少了第三件，模型知道自己看不全
  // 却无路可走，只能猜——那比不截断更糟。
  assert.match(big.text, new RegExp(`Truncated: showing the first ${LANE_MODEL_OUTPUT_MAX_LINES} of ${
    LANE_MODEL_OUTPUT_MAX_LINES + 1000} lines`));
  assert.match(big.text, /narrower scope/, 'the notice ends with something the model can do');

  // 阳性对照：没超限的结果**一个字节都不动**。少了它，一个「给每条结果都贴一句截断提示」
  // 或者「把所有输出砍到 100 行」的实现也能通过上面那一条。
  assert.ok(tiny, 'the small call produced a result');
  assert.equal(tiny.text, small);
});
