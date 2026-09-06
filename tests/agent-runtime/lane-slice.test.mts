// 阶段 1 垂直切片的主门：**G3 冷重启后顺序与 pi 转录逐项一致**。
//
// 为什么这条门是「修不出来、只能重做」的那一条：今天面板的顺序来自渲染层的排序
// （`agentPanelV4Projection.sortedItems()`）+ 一张易失的待决工具登记表，而登记表冷重启
// 就空了。这里证的是新通路里顺序**根本不需要被算出来**——它落在盘上，关掉进程、重开、
// 从盘上读回来，段与段的相对位置一个字都不变。
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { laneSessionsRoot } from '../../electron/agentLane/laneSession.mjs';
import type { LanePart } from '../../electron/shared/agentLane/laneContracts.js';
import { LANE_APPROVAL_NOTE_TYPE } from '../../electron/shared/agentLane/laneContracts.js';
import { createLaneFixture } from './laneFixture.mjs';

/** 段的身份 = 「这是哪一种段 + 它是谁」。**刻意不含 sequence**——否则断言就是在自证。 */
function shape(part: LanePart): string {
  switch (part.kind) {
    case 'user': return `user:${part.text}`;
    case 'assistant-text': return `text:${part.text}`;
    case 'thinking': return `thinking:${part.text}`;
    case 'tool-call': return `call:${part.toolName}:${part.toolCallId}`;
    case 'tool-result': return `result:${part.toolName}:${part.toolCallId}:${part.isError}`;
    case 'host-note': return `note:${part.noteType}`;
  }
}

const READ_THEN_WRITE = [
  { type: 'tool' as const, calls: [{ id: 'call-read', name: 'read_full_text', arguments: {} }] },
  { type: 'tool' as const, calls: [{ id: 'call-write', name: 'append_to_end', arguments: { content: '\n\nAnd then the door opened.' } }] },
  { type: 'text' as const, text: 'I read the document and appended one paragraph.' },
];

test('G3 · a cold restart replays the same ordered parts the live lane produced', async (t) => {
  const fixture = await createLaneFixture(t, [...READ_THEN_WRITE]);
  const live = await openLane(fixture.options);
  await live.execute({ kind: 'prompt', text: 'Append one paragraph to the document.' });
  const before = live.projection();
  const { sessionId } = live;
  await live.close();

  // 关掉之后盘上必须**真的有东西**。少了这条断言，一个从不落盘的实现也能让下面全绿——
  // 因为它每次都从零开始，而「空 == 空」永远成立。
  const slugs = await readdir(laneSessionsRoot(fixture.projectDir));
  assert.equal(slugs.length, 1, 'one project keeps exactly one session slug directory');
  const files = await readdir(join(laneSessionsRoot(fixture.projectDir), slugs[0]));
  assert.equal(files.length, 1, 'one lane keeps exactly one jsonl session file');

  const reopened = await openLane({ ...fixture.options, sessionId });
  t.after(() => reopened.close());
  const after = reopened.projection();

  assert.deepEqual(after.parts.map(shape), before.parts.map(shape),
    'the reopened lane replays the same parts, in the same order, with the same identities');
  assert.deepEqual(after.parts.map((part) => part.sequence), before.parts.map((part) => part.sequence),
    'sequence is derived from the transcript walk, so it survives the restart unchanged');
  assert.deepEqual(after.parts.map((part) => part.sequence), after.parts.map((_, index) => index),
    'sequence is dense and starts at 0 — a downstream layer can trust it as an index');
});

test('G3 · the projected order is the transcript order, not the wall-clock order', async (t) => {
  const fixture = await createLaneFixture(t, [...READ_THEN_WRITE]);
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Append one paragraph to the document.' });
  const parts = lane.projection().parts;

  assert.deepEqual(parts.map(shape), [
    'user:Append one paragraph to the document.',
    'call:read_full_text:call-read',
    'result:read_full_text:call-read:false',
    'call:append_to_end:call-write',
    'result:append_to_end:call-write:false',
    'text:I read the document and appended one paragraph.',
  ]);
  // `entrySeq` 单调不减，是「我们走的是转录本身，不是自己攒的一个数组」的凭据。
  const entrySeqs = parts.map((part) => part.entrySeq);
  assert.deepEqual([...entrySeqs].sort((a, b) => a - b), entrySeqs);
  // 工具真的跑了。少了这条，一个把工具调用画出来但从不执行的实现也能通过上面全部断言。
  assert.match(fixture.document.text(), /And then the door opened\.$/);
});

test('the tool call and its result carry the same id, so the panel joins them without a second truth', async (t) => {
  const fixture = await createLaneFixture(t, [...READ_THEN_WRITE]);
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Append one paragraph to the document.' });
  const parts = lane.projection().parts;
  const calls = parts.filter((part) => part.kind === 'tool-call');
  const results = parts.filter((part) => part.kind === 'tool-result');
  assert.deepEqual(results.map((part) => part.toolCallId), calls.map((part) => part.toolCallId));
  for (const call of calls) {
    const result = results.find((candidate) => candidate.toolCallId === call.toolCallId);
    assert.ok(result && result.sequence > call.sequence, 'a result never precedes its own call');
  }
});

test('a blocked tool never runs, and its reason reaches the model verbatim as the tool result', async (t) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'call-blocked', name: 'append_to_end', arguments: { content: 'unapproved' } }] },
    { type: 'text', text: 'Understood, I will not append that.' },
  ], (request) => request.toolName === 'append_to_end'
    ? { allow: false, reason: 'This document is read-only right now; ask the user to unlock it before appending.' }
    : { allow: true });
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  const documentBefore = fixture.document.text();
  await lane.execute({ kind: 'prompt', text: 'Append something.' });

  assert.equal(fixture.document.text(), documentBefore, 'a blocked tool does not reach the domain port');
  const parts = lane.projection().parts;
  const result = parts.find((part) => part.kind === 'tool-result');
  assert.ok(result && result.isError, 'the blocked call settles as an errored tool result');
  assert.equal(result.text, 'This document is read-only right now; ask the user to unlock it before appending.',
    'the block reason is what the model reads — not an error code, and not a paraphrase');

  // 宿主的审批记录骑在**同一条**转录上，排在被拒的那次调用之前（岔路 2 = B）。
  const note = parts.find((part) => part.kind === 'host-note');
  assert.ok(note && note.noteType === LANE_APPROVAL_NOTE_TYPE);
  assert.deepEqual(note.data, { toolCallId: 'call-blocked', toolName: 'append_to_end',
    decision: 'denied', reason: 'This document is read-only right now; ask the user to unlock it before appending.' });

  // 而且它**不复制**工具正文：note 里只有 id 与那一句理由，没有第二份结果。
  const wire = fixture.http.requests.at(-1)?.body as { messages?: Array<{ role: string; content: unknown }> };
  const rendered = JSON.stringify(wire?.messages ?? []);
  assert.equal(rendered.split('This document is read-only right now').length - 1, 1,
    'the reason appears once in the next request — a projected custom entry would say it twice');
});

test('the running tool is marked running while it is in flight, and settles when the result lands', async (t) => {
  let release: (() => void) | undefined;
  const inFlight = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'call-slow', name: 'read_full_text', arguments: {} }] },
    { type: 'deferred', beforeReply: async () => { await inFlight; return { type: 'text', text: 'Done.' }; } },
  ]);
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());

  const seenRunning: boolean[] = [];
  lane.subscribe((projection) => {
    const call = projection.parts.find((part) => part.kind === 'tool-call');
    if (call) seenRunning.push(call.running);
  });
  const turn = lane.execute({ kind: 'prompt', text: 'Read it.' });
  release?.();
  await turn;

  assert.ok(seenRunning.includes(true), 'the panel saw the tool as running at least once');
  const settled = lane.projection().parts.find((part) => part.kind === 'tool-call');
  assert.equal(settled?.running, false, 'a settled tool is no longer running');
});

test('reopening a session id that is not on disk fails loudly instead of silently starting a new one', async (t) => {
  const fixture = await createLaneFixture(t, []);
  await assert.rejects(() => openLane({ ...fixture.options, sessionId: 'nope-not-a-session' }),
    /not on disk/, 'a missing history is an error, not an empty panel that looks normal');
});

// —— 跨层契约：真 pi 转录 → 一份落盘的投影夹具 → 渲染层的 v4 积木 ——
//
// 新旧两条通路的接缝是 `LaneProjection`。它的两侧住在两套不同的编译世界里
// （主进程是 NodeNext 的 ESM 岛，渲染层是 vite/vitest），所以没有一条测试能一口气
// 从 pi 跑到 v4 组件。硬把它们塞进同一个 runner 只会得到一份互相 mock 的假闭环。
//
// 于是把接缝**物化**成一份夹具：这条测试证明「真 pi 产出的投影长这样」，
// `src/workbench/ai/lane/laneViewModel.fixture.test.ts` 证明「长这样的投影投出那些积木」。
// 两条测试共用同一个文件，谁先漂谁先红——比一个互相 mock 的端到端强。
test('the live projection matches the checked-in fixture the renderer layer is tested against', async (t) => {
  const fixture = await createLaneFixture(t, [...READ_THEN_WRITE]);
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Append one paragraph to the document.' });

  // 从仓库根解析，不从 `import.meta.url`：编译产物住在 `.tmp/` 下，夹具 JSON 不跟着搬。
  const expected = JSON.parse(await readFile(
    join(process.cwd(), 'tests/agent-runtime/__fixtures__/lane-projection.json'), 'utf8')) as unknown;
  assert.deepEqual(JSON.parse(JSON.stringify(lane.projection())), expected,
    'regenerate tests/agent-runtime/__fixtures__/lane-projection.json when the wire shape changes on purpose');
});
