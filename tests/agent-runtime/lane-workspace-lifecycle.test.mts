import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs';
import { openLaneWorkspace, type LaneWorkspaceOptions } from '../../electron/agentLane/laneWorkspace.mjs';
import type { LaneHandle, LaneProjection, LaneWorkspaceHandle } from '../../electron/shared/agentLane/laneContracts.js';
import { createLaneFixture } from './laneFixture.mjs';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Gate only delivery of an actually opened pi host. Its JSONL ownership and cleanup
// remain real, so an orphan is observable by reopening the same session.
function controlledOpener(t: TestContext) {
  const handles: LaneHandle[] = [];
  const opened: LaneWorkspaceOptions[] = [];
  let pause: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  t.after(async () => { for (const handle of handles) await handle.close(); });
  return {
    opened,
    pauseNext() {
      const gate = { entered: deferred(), release: deferred() };
      pause = gate;
      t.signal.addEventListener('abort', gate.release.resolve, { once: true });
      t.after(() => gate.release.resolve());
      return gate;
    },
    async open(options: LaneWorkspaceOptions) {
      const gate = pause;
      pause = undefined;
      const handle = options.model ? await openLane({ ...options, model: options.model }) : await openLaneHistory(options);
      handles.push(handle);
      opened.push(options);
      if (gate) { gate.entered.resolve(); await gate.release.promise; }
      return handle;
    },
  };
}

test('workspace serializes model replacement and create, retaining the selected lane and configured model', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const opener = controlledOpener(t);
  const workspace = await openLaneWorkspace(fixture.options, opener.open);
  t.after(() => workspace.close());
  const gate = opener.pauseNext();
  const model = { ...fixture.options.model, modelId: 'second-model' };
  const configuring = workspace.configureModel(model);
  await gate.entered.promise;
  const creating = workspace.execute({ kind: 'lane-create', laneName: 'research' });
  const outcomes = Promise.allSettled([configuring, creating]);
  gate.release.resolve();
  assert.deepEqual((await outcomes).map((result) => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(workspace.projection().active.lane, 'research');
  assert.deepEqual(opener.opened.map((options) => [options.laneName, options.model?.modelId]),
    [['main', 'chosen-model'], ['main', 'second-model'], ['research', 'second-model']]);
  assert.equal(fixture.http.requests.length, 0);
});

test('workspace serializes create and delete before deciding whether the target is active', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const opener = controlledOpener(t);
  const workspace = await openLaneWorkspace(fixture.options, opener.open);
  t.after(() => workspace.close());
  const gate = opener.pauseNext();
  const creating = workspace.execute({ kind: 'lane-create', laneName: 'research' });
  await gate.entered.promise;
  const deleting = workspace.execute({ kind: 'lane-delete', laneName: 'research' });
  const outcomes = Promise.allSettled([creating, deleting]);
  gate.release.resolve();
  const [created, deleted] = await outcomes;
  assert.equal(created.status, 'fulfilled');
  assert.equal(deleted.status, 'rejected');
  if (deleted.status === 'rejected') assert.match(String(deleted.reason), /agent_lane_conversation_in_use/);
  assert.equal(workspace.projection().active.lane, 'research');
  assert.deepEqual(workspace.projection().lanes.map((lane) => lane.laneName).sort(), ['main', 'research']);
});

test('duplicate concurrent creates consult the disk-backed list after the first create finishes', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const opener = controlledOpener(t);
  const workspace = await openLaneWorkspace(fixture.options, opener.open);
  t.after(() => workspace.close());
  const gate = opener.pauseNext();
  const first = workspace.execute({ kind: 'lane-create', laneName: 'research' });
  await gate.entered.promise;
  const second = workspace.execute({ kind: 'lane-create', laneName: 'research' });
  const outcomes = Promise.allSettled([first, second]);
  gate.release.resolve();
  const [created, duplicate] = await outcomes;
  assert.equal(created.status, 'fulfilled');
  assert.equal(duplicate.status, 'rejected');
  if (duplicate.status === 'rejected') assert.match(String(duplicate.reason), /agent_lane_conversation_exists/);
  assert.equal(workspace.projection().active.lane, 'research');
});

for (const operation of ['configure', 'create', 'select'] as const) {
  test(`close during ${operation} immediately denies new work and closes the host returned by the pending opener`, async (t) => {
    const fixture = await createLaneFixture(t, []);
    const opener = controlledOpener(t);
    const workspace = await openLaneWorkspace(fixture.options, opener.open);
    t.after(() => workspace.close());
    if (operation === 'select') {
      await workspace.execute({ kind: 'lane-create', laneName: 'research' });
      await workspace.execute({ kind: 'lane-select', laneName: 'main' });
    }
    const seen: string[] = [];
    workspace.subscribe((projection) => seen.push(projection.active.lane));
    const gate = opener.pauseNext();
    const changing = operation === 'configure' ? workspace.configureModel(fixture.options.model)
      : workspace.execute({ kind: operation === 'create' ? 'lane-create' : 'lane-select', laneName: 'research' });
    await gate.entered.promise;
    const changingOutcome = Promise.allSettled([changing]);
    const closing = workspace.close();
    const abortOutcome = Promise.allSettled([workspace.execute({ kind: 'abort' })]);
    gate.release.resolve();
    await closing;
    const laneName = operation === 'configure' ? 'main' : 'research';
    const reopened = await openLaneHistory({ projectDir: fixture.projectDir, laneName });
    await reopened.close();
    assert.equal((await changingOutcome)[0]?.status, 'rejected');
    assert.equal((await abortOutcome)[0]?.status, 'rejected');
    assert.deepEqual(seen, [], 'no projection may resurrect a conversation after close');
    assert.equal(fixture.http.requests.length, 0);
  });
}

test('failed replacement closes the workspace instead of dispatching commands to the closed previous host', async (t) => {
  const fixture = await createLaneFixture(t, []);
  let opens = 0;
  const workspace = await openLaneWorkspace(fixture.options, async (options) => {
    if (++opens > 1) throw new Error('fixture open failure');
    return openLane({ ...options, model: fixture.options.model });
  });
  t.after(() => workspace.close());
  await assert.rejects(workspace.execute({ kind: 'lane-create', laneName: 'research' }), /fixture open failure/);
  await assert.rejects(workspace.execute({ kind: 'abort' }), /agent_lane_disposed/);
  await assert.rejects(workspace.configureModel(fixture.options.model), /agent_lane_disposed/);
  assert.equal(opens, 2, 'a failed workspace cannot open more hosts');
});

test('commands fail immediately while the conversation itself is being replaced, instead of landing in the new one', { timeout: 10_000 }, async (t) => {
  const fixture = await createLaneFixture(t, []);
  const opener = controlledOpener(t);
  const workspace = await openLaneWorkspace(fixture.options, opener.open);
  t.after(() => workspace.close());
  const gate = opener.pauseNext();
  const creating = workspace.execute({ kind: 'lane-create', laneName: 'research' });
  await gate.entered.promise;
  try {
    // 换对话仍旧当场拒：等完再发，那句话就落进了**另一条**对话。码换成 workspace_stale，
    // 因为用户读到的正确解释是「对话换过了，重新发一次」，不是「等它开完」。
    await assert.rejects(workspace.execute({ kind: 'prompt', text: 'Do not send to the closing lane.' }), /agent_lane_workspace_stale/);
    await assert.rejects(workspace.execute({ kind: 'abort' }), /agent_lane_workspace_stale/);
    await assert.rejects(workspace.execute({ kind: 'approval', toolCallId: 'old-call', action: 'allow-once' }), /agent_lane_workspace_stale/);
    assert.equal(fixture.http.requests.length, 0);
  } finally { gate.release.resolve(); await creating; }
});

test('close cancels structural work admitted but not yet started and stays idempotent', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const opener = controlledOpener(t);
  const workspace = await openLaneWorkspace(fixture.options, opener.open);
  const creating = workspace.execute({ kind: 'lane-create', laneName: 'research' });
  const rejected = assert.rejects(creating, /agent_lane_disposed/);
  const closing = workspace.close();
  assert.equal(workspace.close(), closing);
  await Promise.all([closing, rejected]);
  assert.deepEqual(opener.opened.map((options) => options.laneName), ['main']);
  await assert.rejects(workspace.execute({ kind: 'lane-create', laneName: 'late' }), /agent_lane_disposed/);
  await assert.rejects(workspace.configureModel(fixture.options.model), /agent_lane_disposed/);
});

function pendingApproval(workspace: LaneWorkspaceHandle) {
  const ready = workspace.projection().active.pending;
  if (ready) return Promise.resolve(ready);
  return new Promise<NonNullable<LaneProjection['pending']>>((resolve) => {
    const stop = workspace.subscribe(({ active }) => { if (active.pending) { stop(); resolve(active.pending); } });
  });
}

for (const action of ['approval', 'abort'] as const) {
  test(`a running prompt never holds ${action} behind its model/tool turn`, { timeout: 10_000 }, async (t) => {
    const fixture = await createLaneFixture(t, [
      { type: 'tool', calls: [{ id: 'append', name: 'append_to_end', arguments: { content: 'The closing line.' } }] },
      { type: 'text', text: 'Done.' },
    ], { hasUserInterface: true, policy: () => ({ mode: 'step', spend: 'confirm' }) });
    const workspace = await openLaneWorkspace(fixture.options);
    t.after(() => workspace.close());
    const before = fixture.document.text();
    const prompt = workspace.execute({ kind: 'prompt', text: 'Append the closing line.' });
    const pending = await pendingApproval(workspace);
    await assert.rejects(workspace.configureModel(fixture.options.model), /agent_lane_busy_running/);
    await workspace.execute(action === 'approval'
      ? { kind: 'approval', toolCallId: pending.toolCallId, action: 'allow-once' } : { kind: 'abort' });
    await prompt;
    assert.equal(workspace.projection().active.pending, undefined);
    assert.equal(fixture.document.text() === before, action === 'abort');
    assert.equal(fixture.http.requests.length, action === 'abort' ? 1 : 2);
  });
}

// 2026-09-11 报障现场：用户在面板里换完模型接着动手（打字回车 / 点卡上的按钮），面板顶部
// 糊出一行红色英文原文「The agent is opening a conversation. Try again after it opens.」。
// 换模型开的还是**同一条**对话，用户换它就是为了用它发下一句——正确的行为是等它换完再发。
test('a command that lands while the model is being replaced waits for the same conversation instead of being refused', { timeout: 10_000 }, async (t) => {
  const fixture = await createLaneFixture(t, []);
  const opener = controlledOpener(t);
  const workspace = await openLaneWorkspace(fixture.options, opener.open);
  t.after(() => workspace.close());
  const gate = opener.pauseNext();
  const configuring = workspace.configureModel({ ...fixture.options.model, modelId: 'second-model' });
  await gate.entered.promise;
  const aborting = workspace.execute({ kind: 'abort' });
  gate.release.resolve();
  await configuring;
  await aborting;
  assert.equal(workspace.projection().active.lane, 'main');
  assert.deepEqual(opener.opened.map((options) => [options.laneName, options.model?.modelId]),
    [['main', 'chosen-model'], ['main', 'second-model']]);
});
