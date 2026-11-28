import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLaneFixture } from './laneFixture.mjs';
import { openLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { isLaneInputMessage } from '../../electron/shared/agentLane/laneInputMessage.js';
import { prepareLaneSkillContext } from '../../electron/agentLane/laneInputPreparation.js';
import type { LaneComposerContext } from '../../electron/shared/agentLane/laneDesktopContracts.js';
import type { SkillRecord } from '../../electron/skills/skillStore.js';
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs';
import { openLaneWorkspace } from '../../electron/agentLane/laneWorkspace.mjs';
import { openLaneHistoryPage } from '../../electron/agentLane/laneHistoryPage.mjs';

test('C23 a real history page completing after lane selection publishes only the new conversation', async t => {
  const f = await createLaneFixture(t, []);
  const opened = await openLaneSession({ projectDir: f.projectDir });
  for (let i = 0; i < 90; i++) await opened.session.appendMessage({ role: 'user', content: `OLD_MAIN_${i}`, timestamp: i });
  await opened.release();
  let entered!: () => void;
  let release!: () => void;
  const pageEntered = new Promise<void>(resolve => { entered = resolve; });
  const delivery = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const workspace = await openLaneWorkspace(f.options, async options => {
    const real = await openLaneHistory(options);
    return { ...real, execute: async (command, executionOptions) => {
      const result = await real.execute(command, executionOptions);
      if (command.kind === 'history-older') { entered(); await delivery; }
      return result;
    } };
  });
  t.after(() => workspace.close());
  await workspace.execute({ kind: 'lane-create', laneName: 'research' });
  await workspace.execute({ kind: 'lane-select', laneName: 'main' });
  const original = workspace.projection();
  const sessionId = original.lanes.find(lane => lane.laneName === 'main')!.sessionId;
  assert.equal(original.active.parts.length, 80, 'positive control: this is an actually paged native history');
  const loading = workspace.execute({ kind: 'history-older', before: original.active.history!.before! },
    { expectedConversation: { laneName: 'main', sessionId } });
  await pageEntered;
  assert.equal(workspace.projection().active.parts.length, 90, 'real page read completed; only its command delivery remains held');
  await workspace.execute({ kind: 'lane-select', laneName: 'research' });
  const selected = workspace.projection().active;
  const published: string[] = [];
  const unsubscribe = workspace.subscribe(value => published.push(value.active.lane));
  t.after(unsubscribe);
  release();
  await loading;
  assert.equal(workspace.projection().active, selected);
  assert.deepEqual(published, ['research'], 'late completion re-reads the current owner instead of publishing the old page');
  assert.doesNotMatch(JSON.stringify(workspace.projection().active), /OLD_MAIN/);
  await assert.rejects(workspace.execute({ kind: 'approval', toolCallId: 'old-card', action: 'allow-once' },
    { expectedConversation: { laneName: 'main', sessionId } }), /agent_lane_workspace_stale/);
  assert.equal(f.http.requests.length, 0, 'history and stale approvals cannot invoke a provider');
});

test('R02 actual SDK compaction retains original branch IDs and visible skill history', async (t) => {
  const f = await createLaneFixture(t, [
    { type: 'text', text: 'history '.repeat(18000), usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary without original input' },
    { type: 'text', text: 'summary' },
    { type: 'text', text: 'continued' },
  ]);
  const input = { capture: () => ({ approvalPolicy: { mode: 'request' as const }, skillKey: 'storyboard' }),
    activate: () => {}, providerContent: async (m: { content: string }) => m.content, rewritePayload: (p: unknown) => p };
  const lane = await f.openLane({ ...f.options, input, model: { ...f.options.model, contextWindow: 1000000 } });
  await lane.execute({ kind: 'prompt', text: 'Only three characters' });
  await lane.execute({ kind: 'prompt', text: 'Continue' });
  const visible = lane.projection().parts.filter(p => p.kind === 'user');
  await lane.close();
  const opened = await openLaneSession({ projectDir: f.projectDir });
  f.after(async () => { await opened.release(); });
  const entries = opened.session.findBranchEntries({ order: 'oldestFirst' });
  assert.ok(entries.some(e => e.type === 'compaction'), 'real pi compact lifecycle ran');
  const originals = entries.filter(e => e.type === 'message' && isLaneInputMessage(e.message));
  t.diagnostic(JSON.stringify({ originalIds: originals.map(e => e.id), visible }));
  assert.equal(visible.length, originals.length, 'compaction is not a UI history cutoff');
  assert.ok(visible.some(p => p.kind === 'user' && p.text === 'Only three characters' && p.skillKey === 'storyboard'));
});

test('R04 current operation original intent remains in requests when automatic compaction omits all inputs', async (t) => {
  const f = await createLaneFixture(t, [
    { type: 'text', text: 'history '.repeat(18000), usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary intentionally omits user constraints' },
    { type: 'text', text: 'summary intentionally omits user constraints' },
    { type: 'text', text: 'done' },
  ]);
  const lane = await f.openLane({ ...f.options, model: { ...f.options.model, contextWindow: 1000000 } });
  await lane.execute({ kind: 'prompt', text: 'Earlier unrelated job' });
  await lane.execute({ kind: 'prompt', text: 'ONLY_THREE_CHARACTERS_CURRENT_JOB' });
  const request = JSON.stringify(f.http.requests.at(-1)!.body);
  assert.match(request, /ONLY_THREE_CHARACTERS_CURRENT_JOB/);
  assert.doesNotMatch(request, /Earlier unrelated job/);
});

test('R03 paged history remains current-branch-only and original IDs survive reopen', async (t) => {
  const f = await createLaneFixture(t, []);
  const opened = await openLaneSession({ projectDir: f.projectDir });
  const ids: string[] = [];
  for (let i = 0; i < 175; i++) ids.push(await opened.session.appendMessage({ role: 'user', content: `original ${i}`, timestamp: i }));
  opened.session.branchTo(ids[2]!);
  await opened.session.appendMessage({ role: 'user', content: 'SIDE_BRANCH_SECRET', timestamp: 1 });
  opened.session.branchTo(ids.at(-1)!);
  await opened.release();
  const history = await openLaneHistory({ projectDir: f.projectDir });
  f.after(() => history.close());
  assert.equal(history.projection().parts.length, 80);
  while (history.projection().history?.hasMore) {
    await history.execute({ kind: 'history-older', before: history.projection().history!.before! });
  }
  assert.deepEqual(history.projection().parts.map(p => p.entryId), ids);
  assert.doesNotMatch(JSON.stringify(history.projection()), /SIDE_BRANCH_SECRET/);
  await history.close();
  const reopened = await openLaneHistory({ projectDir: f.projectDir });
  f.after(() => reopened.close());
  assert.deepEqual(reopened.projection().parts.map(p => p.entryId), ids.slice(-80));
});

test('R04 active run intent and skill survive two summaries that omit both', async (t) => {
  const f = await createLaneFixture(t, [
    { type: 'message', parts: [{ type: 'text', text: 'material '.repeat(18000) }, { type: 'toolCall', id: 'read-one', name: 'read_script', arguments: { scope: 'full' } }], usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary deliberately omits task' },
    { type: 'message', parts: [{ type: 'text', text: 'material '.repeat(18000) }, { type: 'toolCall', id: 'read-two', name: 'read_script', arguments: { scope: 'full' } }], usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary deliberately omits task' },
    { type: 'text', text: 'finished' },
  ]);
  const skill = { name: 'Storyboard', contentHash: 'hash-original', content: 'EXACT_PREPARED_SKILL' } as SkillRecord;
  const input = { capture: () => ({ approvalPolicy: { mode: 'request' as const },
    skillKey: 'storyboard', systemPrompt: 'EXACT_ORIGINAL_TEMPLATE' }),
    prepare: (context: LaneComposerContext) => prepareLaneSkillContext(context,
      { resolve: async () => skill, render: async resolved => resolved.content }),
    activate: () => {}, providerContent: async (m: { content: string }) => m.content, rewritePayload: (p: unknown) => p };
  const lane = await f.openLane({ ...f.options, input, model: { ...f.options.model, contextWindow: 1000000 } });
  await lane.execute({ kind: 'prompt', text: 'ONLY_THREE_CHARACTERS' });
  const assistantRequests = f.http.requests.filter(r => Array.isArray(r.body.tools) && r.body.tools.length);
  assert.ok(assistantRequests.length >= 2);
  assert.match(JSON.stringify(assistantRequests.at(-1)!.body), /ONLY_THREE_CHARACTERS/);
  assert.match(JSON.stringify(assistantRequests.at(-1)!.body), /storyboard/);
  assert.match(JSON.stringify(assistantRequests.at(-1)!.body), /EXACT_ORIGINAL_TEMPLATE/);
  assert.match(JSON.stringify(assistantRequests.at(-1)!.body), /EXACT_PREPARED_SKILL/);
  const visible = lane.projection().parts;
  await lane.close();
  const reopened = await openLaneSession({ projectDir: f.projectDir });
  f.after(async () => { await reopened.release(); });
  const entries = reopened.session.findBranchEntries({ order: 'oldestFirst' });
  assert.ok(entries.filter(e => e.type === 'compaction').length >= 2, 'two actual SDK compactions');
  const assistantIds = entries.filter(e => e.type === 'message' && e.message.role === 'assistant').map(e => e.id);
  const displayedIds = [...new Set(visible.filter(p => p.kind === 'assistant-text').map(p => p.entryId))];
  assert.deepEqual(displayedIds, assistantIds, 'retainedTail must not duplicate historical assistants');
});

test('S25 explicit Continue still addresses the original stopped entry after compaction', async t => {
  const f = await createLaneFixture(t, [
    { type: 'text', text: 'history '.repeat(18000), usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary' },
    { type: 'text', text: 'summary' },
    { type: 'text', text: 'continued' },
  ]);
  const seed = await openLaneSession({ projectDir: f.projectDir });
  await seed.session.appendMessage({ role: 'user', content: 'ORIGINAL_TASK_BEFORE_STOP', timestamp: 0 });
  const id = await seed.session.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'STOPPED_ORIGINAL' }],
    api: 'openai-completions', provider: 'fixture', model: 'fixture', timestamp: 1, stopReason: 'aborted',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  await seed.release();

  let reference: string | undefined;
  const input = { capture: () => ({ approvalPolicy: { mode: 'request' as const }, continueFromEntryId: reference }),
    activate: () => {}, providerContent: async (m: { content: string }) => m.content, rewritePayload: (p: unknown) => p };
  const host = await f.openLane({ ...f.options, input, model: { ...f.options.model, contextWindow: 1000000 } });
  await host.execute({ kind: 'prompt', text: 'Another job' });
  await host.close();

  const inspect = await openLaneSession({ projectDir: f.projectDir });
  const activeTranscript = inspect.session.activeTranscript();
  assert.ok(activeTranscript.some(e => e.type === 'compaction'));
  assert.ok(!activeTranscript.some(e => e.id === id));
  await inspect.release();

  const resumed = await f.openLane({ ...f.options, input, model: { ...f.options.model, contextWindow: 1000000 } });
  reference = id;
  await resumed.execute({ kind: 'prompt', text: 'Continue the selected stopped response' });
  assert.match(JSON.stringify(f.http.requests.at(-1)!.body), /STOPPED_ORIGINAL/);
});

test('independent R04 live lifecycle: short steer survives two lossy SDK compactions with long seed', async t => {
  const f = await createLaneFixture(t, [
    { type: 'message', parts: [{ type: 'text', text: 'material '.repeat(18000) }, { type: 'toolCall', id: 'read-one', name: 'read_script', arguments: { scope: 'full' } }], usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary deliberately omits task' },
    { type: 'message', parts: [{ type: 'text', text: 'material '.repeat(18000) }, { type: 'toolCall', id: 'read-two', name: 'read_script', arguments: { scope: 'full' } }], usage: { input: 81000, output: 100 } },
    { type: 'text', text: 'summary deliberately omits task' },
    { type: 'text', text: 'finished' },
  ]);
  const input = { capture: () => ({ approvalPolicy: { mode: 'request' as const }, skillKey: 'storyboard' }), activate: () => {}, providerContent: async (m: { content: string }) => m.content, rewritePayload: (p: unknown) => p };
  const host = await f.openLane({ ...f.options, input, model: { ...f.options.model, contextWindow: 1000000 } });
  let queued: ReturnType<typeof host.execute> | undefined;
  await host.execute({ kind: 'prompt', text: 'ORIGINAL_LONG_MANUSCRIPT ' + 'x'.repeat(17000) }, { onAccepted: () => { queued = host.execute({ kind: 'steer', text: 'LATEST_SCOPE_ONLY_THREE_CHARACTERS' }); } });
  await queued;
  const assistantRequests = f.http.requests.filter(r => Array.isArray(r.body.tools) && r.body.tools.length);
  const finalBody = JSON.stringify(assistantRequests.at(-1)!.body);
  await host.close();
  const opened = await openLaneSession({ projectDir: f.projectDir });
  f.after(async () => { await opened.release(); });
  const entries = opened.session.findBranchEntries({ order: 'oldestFirst' });
  const compactCount = entries.filter(e => e.type === 'compaction').length;
  const steerStillStored = entries.some(e => e.type === 'message' && 'content' in e.message && JSON.stringify(e.message.content).includes('LATEST_SCOPE_ONLY_THREE_CHARACTERS'));
  t.diagnostic(JSON.stringify({ compactions: compactCount, assistantRequests: assistantRequests.length, steerStillStored,
    finalHasLatestSteer: finalBody.includes('LATEST_SCOPE_ONLY_THREE_CHARACTERS'), finalHasSeed: finalBody.includes('ORIGINAL_LONG_MANUSCRIPT') }));
  assert.ok(compactCount >= 2);
  assert.ok(steerStillStored);
  assert.ok(finalBody.includes('LATEST_SCOPE_ONLY_THREE_CHARACTERS'), 'latest restriction must remain in final assistant request');
});

test('an older-page request for a different anchor is refused, not answered with the page in flight', async t => {
  const f = await createLaneFixture(t, []);
  const opened = await openLaneSession({ projectDir: f.projectDir });
  f.after(async () => { await opened.release(); });
  for (let i = 0; i < 170; i++) await opened.session.appendMessage({ role: 'user', content: `ROW_${i}`, timestamp: i });

  const page = await openLaneHistoryPage(opened.session, opened.session.getTipId());
  assert.equal(page.entries().length, 80, 'positive control: this is an actually paged native history');
  const before = page.state().before!;

  const inFlight = page.older(before);
  assert.equal(page.older(before), inFlight, 'the same anchor reuses the in-flight read');
  await assert.rejects(page.older('not-the-current-anchor'), /agent_lane_workspace_stale/);
  await inFlight;
  assert.equal(page.entries().length, 160);

  const pending = page.older(page.state().before!);
  await page.reset();
  const afterReset = page.older(page.state().before!);
  assert.notEqual(afterReset, pending, 'a reset lane does not hand out the page request it just invalidated');
  await Promise.allSettled([pending, afterReset]);
});
