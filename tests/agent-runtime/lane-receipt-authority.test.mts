import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { obj } from '@earendil-works/pi-schema';
import type { LaneSnapshot } from '../../electron/shared/agentLane/laneSnapshotTypes.js';
import { findLaneReceiptAuthority } from '../../electron/agentLane/laneReceiptAuthority.mjs';
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../../electron/shared/agentLane/laneReceiptAuthority.js';
import { projectLaneSnapshot } from '../../electron/shared/agentLane/laneProjection.js';
import { createHttpFixture } from './httpFixture.mjs';
import { openProbeLane, PROBE_CONTEXT } from './stage3ProbeHarness.mjs';

const authority = { receiptProposalId: 'fixture-receipt', approvalId: 'fixture-approval', actionHash: 'fixture-action-hash' };
const note = { ...authority, toolCallId: 'fixture-call' };
type ReceiptSnapshot = {
  transcript: LaneSnapshot['transcript'];
  queues: LaneSnapshot['queues'][number][];
};
const customEntry = (id: string, data = note): Extract<LaneSnapshot['transcript'][number], { type: 'custom' }> => ({
  id, parentId: null, seq: 1, timestamp: 0, type: 'custom', customType: LANE_RECEIPT_AUTHORITY_NOTE, data,
});
const queuedEntry = (entryId: string, data: unknown = note): LaneSnapshot['queues'][number] => ({
  entryId, kind: 'write', type: 'custom', customType: LANE_RECEIPT_AUTHORITY_NOTE,
  data: data as Extract<LaneSnapshot['queues'][number], { type: 'custom' }>['data'],
});

test('a real before_tool durable authority is queryable inside execute and after cold reopen', async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'nomi-receipt-authority-'));
  const http = await createHttpFixture([
    { type: 'tool', calls: [{ id: 'fixture-call', name: 'receipt_probe', arguments: {} }] },
    { type: 'text', text: 'Fixture complete.' },
  ]);
  let first: Awaited<ReturnType<typeof open>> | undefined;
  let reopened: Awaited<ReturnType<typeof open>> | undefined;
  let executionAuthority: ReturnType<typeof findLaneReceiptAuthority>;
  let queuedWhileExecuting = false;

  async function open(sessionId?: string) {
    const cleanups: Array<() => void | Promise<void>> = [];
    const probe = await openProbeLane(
      { after: (fn) => { cleanups.push(fn); } },
      {
        fetch: globalThis.fetch,
        projectDir,
        systemPrompt: 'Receipt fixture.',
        model: {
          kind: 'openai-compatible',
          providerId: 'fixture',
          modelId: 'fixture',
          baseURL: http.baseURL,
          authType: 'api-key',
          apiKey: 'fixture',
        },
        tools: [],
      },
      sessionId ? { sessionId } : {},
    );
    const watch = await probe.lane.watch(PROBE_CONTEXT);
    let snapshot = watch.snapshot;
    watch.start((next) => { snapshot = next; });
    await probe.harness.setTools([{
      name: 'receipt_probe',
      label: 'Fixture',
      description: 'Fixture.',
      parameters: obj({}),
      execute: async () => {
        const current = await watch.resnapshot(PROBE_CONTEXT);
        queuedWhileExecuting = current.queues.some((entry) => entry.type === 'custom' && entry.customType === LANE_RECEIPT_AUTHORITY_NOTE);
        executionAuthority = findLaneReceiptAuthority(current, authority.receiptProposalId);
        assert.deepEqual(executionAuthority, authority, 'Renderer receipt preparation needs this authority before the tool finishes.');
        assert.equal(projectLaneSnapshot(current, { pricing: 'unpriced', supportedThinkingLevels: ['off'] }).parts
          .filter((part) => part.kind === 'host-note' && part.noteType === LANE_RECEIPT_AUTHORITY_NOTE).length, 0);
        return { content: [{ type: 'text' as const, text: 'Fixture result.' }], details: {} };
      },
    }]);
    await probe.lane.setActiveTools(['receipt_probe']);
    return {
      lane: probe.lane,
      harness: probe.harness,
      snapshot: () => snapshot,
      resnapshot: () => watch.resnapshot(PROBE_CONTEXT),
      sessionId: probe.sessionId,
      close: async () => {
        watch.unsubscribe();
        await probe.close();
      },
    };
  }
  try {
    first = await open();
    first.harness.hooks.on('before_tool', async () => {
      await first!.lane.appendCustomEntry(LANE_RECEIPT_AUTHORITY_NOTE, note, PROBE_CONTEXT);
      return undefined;
    });
    await first.lane.prompt('Run the receipt fixture.', undefined, PROBE_CONTEXT);
    assert.equal(queuedWhileExecuting, true, 'The fixture must exercise the real queued-write boundary.');
    assert.deepEqual(executionAuthority, authority);
    const settled = await first.resnapshot();
    assert.deepEqual(findLaneReceiptAuthority(settled, authority.receiptProposalId), authority);
    assert.equal(settled.queues.length, 0);
    const sessionId = first.sessionId;
    await first.close();
    first = undefined;
    reopened = await open(sessionId);
    assert.deepEqual(findLaneReceiptAuthority(await reopened.resnapshot(), authority.receiptProposalId), authority);
  } finally {
    await first?.close();
    await reopened?.close();
    await http.close();
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('one persisted entry is counted once across transcript and queued writes without mutating either', () => {
  const snapshot: ReceiptSnapshot = { transcript: [customEntry('same-entry')], queues: [queuedEntry('same-entry')] };
  const original = structuredClone(snapshot);
  assert.deepEqual(findLaneReceiptAuthority(snapshot, authority.receiptProposalId), authority);
  assert.deepEqual(snapshot, original);
  snapshot.queues.push(queuedEntry('different-entry'));
  assert.throws(() => findLaneReceiptAuthority(snapshot, authority.receiptProposalId), /lane_receipt_authority_ambiguous/);
});

test('conflicting entry identities fail closed and unrelated valid authorities do not authorize a proposal', () => {
  const snapshot: ReceiptSnapshot = { transcript: [customEntry('same-entry')],
    queues: [queuedEntry('same-entry', { ...note, approvalId: 'different-approval' })] };
  assert.throws(() => findLaneReceiptAuthority(snapshot, authority.receiptProposalId), /lane_receipt_authority_conflict/);
  assert.equal(findLaneReceiptAuthority({ transcript: [], queues: [queuedEntry('entry')] }, 'other-receipt'), undefined);
  const unrelated: ReceiptSnapshot = { transcript: [{ ...customEntry('other'), customType: 'nomi.ui.task' }], queues: [] };
  assert.equal(findLaneReceiptAuthority(unrelated, authority.receiptProposalId), undefined);
});

test('malformed queued authority fields and invalid proposal identities fail closed', () => {
  for (const data of [null, [], {}, { ...note, approvalId: '' }, { ...note, actionHash: 1 },
    { ...note, approvalId: ' padded ' }, { ...note, toolCallId: '' }, { ...note, extra: true },
    { ...note, receiptProposalId: 'x'.repeat(513) }]) {
    assert.throws(() => findLaneReceiptAuthority({ transcript: [], queues: [queuedEntry('entry', data)] }, authority.receiptProposalId), /lane_receipt_authority_invalid/);
  }
  assert.throws(() => findLaneReceiptAuthority({ transcript: [], queues: [] }, ''), /lane_receipt_authority_invalid/);
  assert.throws(() => findLaneReceiptAuthority({ transcript: [], queues: [queuedEntry('')] }, authority.receiptProposalId), /lane_receipt_authority_invalid/);
});
