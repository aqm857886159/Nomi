import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { createCanvasLaneTools } from '../../electron/agentLane/laneCanvasTools.js';
import { createTimelineLaneTools } from '../../electron/agentLane/laneTimelineTools.js';
import { createExtendedLaneTools } from '../../electron/agentLane/laneExtendedTools.js';
import type { CanvasWriteResult } from '../../electron/shared/agentCapabilities/canvasWrite.js';
import type { LaneHandle, LaneTaskFacts } from '../../electron/shared/agentLane/laneContracts.js';
import { createDocumentPort, createLaneFixture } from './laneFixture.mjs';
import { compareSteps, fixtureReplyOf, stepsOfProjection, stepsOfRecorded,
  type ComparableStep } from './replayShadowEngine.mjs';
import type { RecordedMessage } from './replayShadowSources.mjs';
import { INITIAL_DOCUMENT, type L1Call, type L1Scenario } from './laneL1Scenarios.mjs';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function expectedSteps(scenario: L1Scenario): ComparableStep[] {
  const steps: ComparableStep[] = [];
  for (const [turnIndex, turn] of scenario.turns.entries()) {
    const user: RecordedMessage = { role: 'user', text: turn.prompt };
    steps.push(...stepsOfRecorded([user]));
    for (const [frameIndex, frame] of turn.frames.entries()) {
      const messages: RecordedMessage[] = [{ role: 'assistant', parts: frame.parts }];
      for (const call of frame.calls) messages.push({ role: 'toolResult', toolCallId: call.id,
        toolName: call.name, text: call.resultText, isError: call.denied === true });
      steps.push(...stepsOfRecorded(messages));
      if (turnIndex === 0 && frameIndex === 0 && scenario.queue) {
        steps.push(...stepsOfRecorded(scenario.queue.messages
          .filter((_, index) => index !== scenario.queue!.cancelIndex).map(text => ({ role: 'user' as const, text }))));
      }
    }
  }
  if (scenario.task) steps.push({ kind: 'task', productionRunId: scenario.task.productionRunId,
    ...(scenario.task.operationId ? { operationId: scenario.task.operationId } : {}) });
  return steps;
}

const isTool = (step: ComparableStep) => step.kind === 'tool-call' || step.kind === 'tool-result';
const forTranscript = (steps: readonly ComparableStep[]) => steps.filter(step => !isTool(step) && step.kind !== 'host-note');

/** Real lane/HTTP loop/session IO. Only the remote reply and application-domain ports are fixtures.
 * Uses the established L2 comparator, not a second projection or runtime.
 */
export async function runL1Scenario(t: TestContext, scenario: L1Scenario): Promise<void> {
  const frames = scenario.turns.flatMap(turn => turn.frames);
  const expectedCalls = frames.flatMap(frame => frame.calls);
  const byId = new Map(expectedCalls.map(call => [call.id, call]));
  assert.equal(byId.size, expectedCalls.length, 'fixture tool-call ids must be unique');
  const entered = deferred(), release = deferred();
  t.after(release.resolve);
  const fixture = await createLaneFixture(t, frames.map(frame => fixtureReplyOf(frame.parts)));
  const document = createDocumentPort(INITIAL_DOCUMENT);
  const executed: string[] = [];
  const inputs: Array<{ name: string; args: unknown }> = [];
  function domainCall(id: string, args: unknown): L1Call {
    const call = byId.get(id);
    assert.ok(call, `unexpected domain invocation ${id}`);
    assert.ok(!call.denied, 'a refused action must never reach a domain port');
    assert.deepEqual(args, call.domainArgs, `${call.name} domain input`);
    executed.push(id); inputs.push({ name: call.name, args });
    return call;
  }
  let readCount = 0;
  const tools = [
    ...createDocumentLaneTools({
      async read(scope, context) {
        domainCall(context.toolCallId, { scope });
        if (scenario.queue && readCount++ === 0) { entered.resolve(); await release.promise; }
        return document.read(scope);
      },
      async write(input, context) {
        domainCall(context.toolCallId, input);
        return document.write(input);
      },
    }),
    ...createCanvasLaneTools({
      async read(context) { return domainCall(context.toolCallId, {}).domainResult; },
      async write(input, context) { return domainCall(context.toolCallId, input).domainResult as CanvasWriteResult; },
    }),
    ...createTimelineLaneTools({
      async read(input, context) { return domainCall(context.toolCallId, input).domainResult; },
    }),
    ...createExtendedLaneTools({
      async execute(call) { return { ok: true, result: domainCall(call.toolCallId, call.args).domainResult }; },
    }),
  ];
  let taskFacts: LaneTaskFacts | undefined;
  const options = { ...fixture.options, tools,
    model: { ...fixture.options.model, tokenPricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 2 } },
    ...(scenario.task ? { tasks: (runId: string) => runId === scenario.task!.productionRunId ? taskFacts : undefined } : {}),
    ...(scenario.refusal ? { approval: { hasUserInterface: true,
      policy: () => ({ mode: 'step' as const, spend: 'confirm' as const }) } } : {}),
  };
  let lane: LaneHandle = await openLane(options);
  t.after(() => lane.close());
  const answered = new Set<string>();
  const approvalActions: Promise<unknown>[] = [];
  const subscribeApproval = () => lane.subscribe(projection => {
    const pending = projection.pending;
    if (!pending || answered.has(pending.toolCallId)) return;
    answered.add(pending.toolCallId);
    const refused = byId.get(pending.toolCallId)?.denied === true;
    approvalActions.push(lane.execute({ kind: 'approval', toolCallId: pending.toolCallId,
      action: refused ? 'deny' : 'allow-once', ...(refused ? { reason: scenario.refusal } : {}) }));
  });
  let stop = subscribeApproval();
  t.after(() => stop());
  for (const [turnIndex, turn] of scenario.turns.entries()) {
    if (turnIndex > 0 && scenario.restartBetweenTurns) {
      const sessionId = lane.sessionId;
      stop(); await lane.close();
      lane = await openLane({ ...options, sessionId });
      stop = subscribeApproval();
    }
    const running = lane.execute({ kind: 'prompt', text: turn.prompt });
    if (turnIndex === 0 && scenario.queue) {
      await entered.promise;
      try {
        const queued = [];
        for (const text of scenario.queue.messages) queued.push(await lane.execute({ kind: 'steer', text }));
        assert.deepEqual(lane.projection().queues.map(item => item.text), scenario.queue.messages);
        assert.deepEqual(lane.projection().queues.map(item => item.entryId), queued.map(item => item.queuedEntryId));
        if (scenario.queue.cancelIndex !== undefined) {
          const entryId = queued[scenario.queue.cancelIndex].queuedEntryId!;
          const cancelled = await lane.execute({ kind: 'cancel-queued', entryId });
          assert.equal(cancelled.cancelQueued, 'cancelled');
        }
      } finally { release.resolve(); }
    }
    await running;
  }
  await Promise.all(approvalActions);
  if (scenario.refusal) {
    assert.equal(answered.size, expectedCalls.length, 'both the refusal and correction must cross the real approval gate');
    assert.equal(lane.projection().pending, undefined);
  }
  if (scenario.task) {
    const { productionRunId, operationId, facts } = scenario.task;
    await lane.appendTaskNote({ productionRunId, ...(operationId ? { operationId } : {}) });
    for (const value of facts) {
      taskFacts = value; lane.refreshTasks();
      const tasks = lane.projection().parts.filter(part => part.kind === 'task');
      assert.equal(tasks.length, 1, 'refreshing a task must not append a duplicate card');
      assert.deepEqual(tasks[0].facts, value, 'facts join from the current domain state, never an invented queued value');
    }
  }
  const projection = lane.projection();
  const expected = expectedSteps(scenario), actual = stepsOfProjection(projection);
  assert.equal(compareSteps(forTranscript(expected), forTranscript(actual)), undefined, '1/4 transcript: user/text/thinking/task order');
  assert.equal(compareSteps(expected.filter(isTool), actual.filter(isTool)), undefined, '2/4 tools: exact names, ids, args, result text and error state');
  assert.equal(projection.usage.inputTokens, frames.length * 10, '3/4 usage: every fixture response counted once');
  assert.equal(projection.usage.outputTokens, frames.length * 4);
  assert.equal(projection.usage.cost.state, 'known');
  if (projection.usage.cost.state === 'known') assert.ok(Math.abs(projection.usage.cost.value - frames.length * 18 / 1_000_000) < 1e-12);
  assert.equal(document.text(), scenario.finalDocument, '4/4 document final state');
  const allowed = expectedCalls.filter(call => !call.denied);
  assert.deepEqual(executed, allowed.map(call => call.id), 'domain execution is ordered, complete and never duplicated');
  assert.deepEqual(inputs, allowed.map(call => ({ name: call.name, args: call.domainArgs })), 'domain input facts are independent of the visible transcript');
  assert.deepEqual(projection.queues, []);
  assert.equal(fixture.http.requests.length, frames.length, 'no unexpected retry/model request');
  const nextRequest = JSON.stringify(fixture.http.requests[1]?.body.messages ?? []);
  if (scenario.queue) {
    for (const [index, message] of scenario.queue.messages.entries()) {
      assert.equal(nextRequest.includes(message), index !== scenario.queue.cancelIndex,
        'the next model request receives retained instructions and excludes cancelled ones');
    }
  }
  if (scenario.refusal) assert.ok(nextRequest.includes(scenario.refusal),
    'approval feedback must reach the model before it proposes a correction');
  const sessionId = lane.sessionId;
  stop(); await lane.close();
  lane = await openLane({ ...options, sessionId });
  assert.equal(compareSteps(actual, stepsOfProjection(lane.projection())), undefined, 'cold restart replays every part, including host notes');
  assert.deepEqual(lane.projection().usage, projection.usage, 'cold restart preserves recorded usage');
  if (scenario.task) assert.deepEqual(lane.projection().parts.filter(part => part.kind === 'task').map(part => part.facts), [taskFacts]);
  console.log(`[L1] ${scenario.id} ${scenario.family}: transcript=1 tools=1 spend=1 final-state=1 parity=4/4 restart=1`);
}

/** Positive controls prove the comparator rejects a changed transcript, arg, result or identity. */
export function assertL1ComparatorControls(): void {
  const baseline: ComparableStep[] = [{ kind: 'assistant-text', text: 'Done.' },
    { kind: 'tool-call', toolCallId: 'a', toolName: 'write_script', args: '{"content":"A"}' },
    { kind: 'tool-result', toolCallId: 'a', toolName: 'write_script', text: 'Applied.', isError: false }];
  for (const changed of [
    [{ ...baseline[0], text: 'Changed.' }, ...baseline.slice(1)],
    [baseline[0], { ...baseline[1], args: '{"content":"B"}' }, baseline[2]],
    [baseline[0], baseline[2], baseline[1]],
    [baseline[0], baseline[1], { ...baseline[2], isError: true }],
  ]) assert.ok(compareSteps(baseline, changed as ComparableStep[]));
}
