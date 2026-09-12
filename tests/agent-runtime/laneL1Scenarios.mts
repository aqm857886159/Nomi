import type { RecordedPart } from './replayShadowSources.mjs';
import type { LaneTaskFacts } from '../../electron/shared/agentLane/laneContracts.js';

export interface L1Call {
  id: string; name: string; args: Record<string, unknown>; resultText: string;
  domainArgs: unknown; domainResult?: unknown; denied?: boolean;
}
export interface L1Frame { parts: RecordedPart[]; calls: L1Call[] }
export interface L1Turn { prompt: string; frames: L1Frame[] }
export interface L1Scenario {
  id: string; family: 'document' | 'canvas' | 'timeline' | 'generation' | 'task' | 'interaction';
  title: string; turns: L1Turn[]; finalDocument: string;
  queue?: { messages: string[]; cancelIndex?: number };
  refusal?: string; restartBetweenTurns?: boolean;
  task?: { productionRunId: string; operationId?: string; facts: Array<LaneTaskFacts | undefined> };
}

export const INITIAL_DOCUMENT = 'Opening.';
const text = (value: string): RecordedPart => ({ kind: 'text', text: value });
const thinking = (value: string): RecordedPart => ({ kind: 'thinking', text: value });
const say = (value: string): L1Frame => ({ parts: [text(value)], calls: [] });
const calls = (...items: L1Call[]): L1Frame => ({
  parts: items.map(item => ({ kind: 'toolCall', id: item.id, name: item.name, args: item.args })), calls: items,
});
const read = (id: string, value = INITIAL_DOCUMENT): L1Call => ({ id, name: 'read_script', args: {},
  domainArgs: { scope: 'full' }, resultText: value });
const write = (id: string, operation: 'append' | 'insert' | 'replace', content: string, revision: number): L1Call => ({
  id, name: operation === 'append' ? 'write_script' : operation === 'insert' ? 'write_script' : 'write_script',
  args: { content }, domainArgs: { operation, content }, resultText: `Applied ${operation} to the document. New revision ${revision}.`,
});
const domain = (id: string, name: string, args: Record<string, unknown>, result: unknown, domainArgs = args): L1Call => ({
  id, name, args, domainArgs, domainResult: result, resultText: JSON.stringify(result),
});
const canvas = (id: string, name: string, args: { operation: string; [key: string]: unknown }): L1Call => ({
  id, name, args, domainArgs: args,
  domainResult: { applied: true, proposalId: `receipt-${id}`, operation: args.operation },
  resultText: `Applied ${args.operation}.`,
});
const turn = (prompt: string, ...frames: L1Frame[]): L1Turn => ({ prompt, frames });
const scenario = (id: string, family: L1Scenario['family'], title: string, turns: L1Turn[],
  extra: Partial<L1Scenario> = {}): L1Scenario => ({ id, family, title, turns, finalDocument: INITIAL_DOCUMENT, ...extra });
const emptyCanvas = { nodes: [], edges: [], groups: [], selectedNodeIds: [] };
const timeline = { operation: 'read_timeline', revision: 'r1', fps: 30, scale: 1,
  playheadFrame: 0, durationFrames: 0, valid: true, tracks: [], textClips: [], transitions: [] };
const plan = { planId: 'plan-1', baseRevision: 'r1', summary: 'Move opening clip',
  operations: [{ kind: 'move', clipId: 'clip-1', startFrame: 30 }] };
const nestedParameters = { seed: 7, options: { frames: [1, 2], references: [{ enabled: true }] } };
const queued: LaneTaskFacts = { status: 'queued', progress: 0, currency: 'CNY' };
const running: LaneTaskFacts = { status: 'running', progress: 40, currency: 'CNY', spent: 0.1 };
const complete: LaneTaskFacts = { status: 'complete', progress: 100, currency: 'CNY', spent: 0.2, candidates: [{ artifactId: 'asset-1', projectId: 'fixture', productionRunId: 'run-1', thumbnailUrl: 'nomi-local://asset/fixture/asset-1.png', adopted: true, canAdopt: false }] };

/** Five capability families × three concrete scripts, plus four interaction scripts.
 * Expected receipts and final states are fixture facts, never copied from a live projection.
 */
export const L1_SCENARIOS: readonly L1Scenario[] = [
  scenario('D1', 'document', 'Read a draft and append its ending', [turn('Read and finish the draft.',
    calls(read('read-d1')), calls(write('write-d1', 'append', ' End.', 1)), say('The ending is appended.'))], { finalDocument: 'Opening. End.' }),
  scenario('D2', 'document', 'Replace selected prose then insert a heading', [turn('Replace the selection and add a heading.',
    calls(write('replace-d2', 'replace', 'Scene.', 1)), calls(write('insert-d2', 'insert', 'Title: ', 2)), say('The scene has a heading.'))], { finalDocument: 'Title: Scene.' }),
  scenario('D3', 'document', 'Think, explain and issue two writes in one reply', [turn('Add two closing beats.', {
    ...calls(write('first-d3', 'append', ' One.', 1), write('second-d3', 'append', ' Two.', 2)),
    parts: [thinking('Keep the beats in order.'), text('I will add both beats.'),
      ...calls(write('first-d3', 'append', ' One.', 1), write('second-d3', 'append', ' Two.', 2)).parts],
  }, say('Both beats are written.'))], { finalDocument: 'Opening. One. Two.' }),
  scenario('C1', 'canvas', 'Inspect the canvas then create an opening node', [turn('Create an opening frame.',
    calls({ ...domain('read-c1', 'look_at_canvas', {}, emptyCanvas), resultText: '画布当前为空。' }),
    calls(canvas('write-c1', 'nomi_canvas_write', { operation: 'create_canvas_nodes', summary: 'Opening frame',
      nodes: [{ clientId: 's1', kind: 'keyframe', title: 'Opening', prompt: 'Sunrise' }] })), say('The opening frame is ready for review.'))]),
  scenario('C2', 'canvas', 'Save an ordered two-shot storyboard', [turn('Make two shots from the scene.',
    calls(canvas('write-c2', 'nomi_storyboard_write', { operation: 'propose_storyboard_plan', title: 'Morning', anchors: [],
      shots: [{ index: 1, durationSec: 0, anchorIds: [], prompt: 'Sunrise', shotKind: 'image' },
        { index: 2, durationSec: 0, anchorIds: [], prompt: 'Open door', shotKind: 'image' }] })), say('The two shots stay in story order.'))]),
  scenario('C3', 'canvas', 'Attach a vocabulary camera reference', [turn('Use a slow push in for shot one.',
    calls(canvas('write-c3', 'nomi_shot_reference_write', { operation: 'create_camera_move', shotClientId: 's1', move: 'push_in', speed: 'slow' })), say('The camera reference is attached.'))]),
  scenario('T1', 'timeline', 'Read current timeline revision and duration', [turn('Inspect the edit before changing it.',
    calls(domain('read-t1', 'read_timeline', {}, timeline, { operation: 'read_timeline' })), say('The timeline is empty at revision r1.'))]),
  scenario('T2', 'timeline', 'Inspect a bounded frame interval', [turn('Inspect frames thirty through sixty.',
    calls(domain('read-t2', 'inspect_timeline_range', { startFrame: 30, endFrame: 60 },
      { operation: 'inspect_timeline_range', revision: 'r1', startFrame: 30, endFrame: 60, tracks: [], textClips: [] },
      { operation: 'inspect_timeline_range', startFrame: 30, endFrame: 60 })), say('The requested interval has no clips.'))]),
  scenario('T3', 'timeline', 'Preview a revision-bound plan then apply it', [turn('Move the opening clip after preview.',
    calls(domain('preview-t3', 'propose_edit_plan', plan, { valid: true, baseRevision: 'r1' })),
    calls(domain('write-t3', 'apply_edit_plan', plan, { applied: true, revision: 'r2', undoToken: 'undo-1' })), say('The edit has an undo token.'))]),
  scenario('G1', 'generation', 'Read catalog context and create a draft without spending', [turn('Draft a sunrise image.',
    calls({ ...domain('context-g1', 'nomi_generation_plan', { operation: 'context', scope: 'full' }, { models: ['fixture-image'] }), resultText: JSON.stringify({ models: ['fixture-image'] }, null, 2) }),
    calls(domain('create-g1', 'nomi_generation_plan', { operation: 'create', prompt: 'Sunrise' }, { operationId: 'gen-1', state: 'draft' })), say('The draft awaits review.'))]),
  scenario('G2', 'generation', 'Read a submitted operation then cancel it', [turn('Stop the existing generation.',
    calls(domain('read-g2', 'nomi_generation_status', { operation: 'read', operationId: 'gen-2' }, { operationId: 'gen-2', state: 'submitted' })),
    calls(domain('cancel-g2', 'nomi_generation_status', { operation: 'cancel', operationId: 'gen-2' }, { operationId: 'gen-2', state: 'cancelled' })), say('Cancellation was requested once.'))]),
  scenario('G3', 'generation', 'Preserve nested parameters while creating and revising', [turn('Revise this structured generation plan.',
    calls(domain('create-g3', 'nomi_generation_plan', { operation: 'create', prompt: 'Sunrise', parameters: nestedParameters }, { operationId: 'gen-3', state: 'draft' })),
    calls(domain('patch-g3', 'nomi_generation_plan', { operation: 'patch', operationId: 'gen-3', patch: { parameters: nestedParameters } }, { operationId: 'gen-3', state: 'draft' })), say('Nested parameters survived the revision.'))]),
  scenario('K1', 'task', 'A production draft task progresses without duplicating state', [turn('Start a reviewable short-film draft.',
    calls(domain('start-k1', 'start_production_run', { goal: 'A short film' }, { runId: 'run-k1' })), say('The draft task was created.'))],
    { task: { productionRunId: 'run-k1', operationId: 'start-k1', facts: [queued, running, complete] } }),
  scenario('K2', 'task', 'An unavailable task joins no invented progress', [turn('Read the old task.',
    calls(domain('read-k2', 'nomi_generation_status', { operation: 'read', operationId: 'gen-k2' }, { operationId: 'gen-k2' })), say('Only its saved identity is available.'))],
    { task: { productionRunId: 'run-k2', facts: [undefined] } }),
  scenario('K3', 'task', 'Task identity and completed artifacts survive restart', [turn('Record the completed task.',
    calls(domain('read-k3', 'get_production_run', { runId: 'run-k3' }, { runId: 'run-k3', status: 'complete' })), say('The completed task is recorded.'))],
    { task: { productionRunId: 'run-k3', operationId: 'gen-k3', facts: [complete] } }),
  scenario('F1', 'interaction', 'User steers the next step while a real read is running', [turn('Read then update the format.',
    calls(read('hold-f1')), calls(write('write-f1', 'append', ' Landscape.', 1)), say('The next step uses landscape.'))],
    { finalDocument: 'Opening. Landscape.', queue: { messages: ['Use landscape.'] } }),
  scenario('F2', 'interaction', 'Cancel the second queued instruction before consumption', [turn('Read and keep the first instruction.',
    calls(read('hold-f2')), calls(write('write-f2', 'append', ' Keep.', 1)), say('Only the retained instruction was applied.'))],
    { finalDocument: 'Opening. Keep.', queue: { messages: ['Keep the first.', 'Discard this.'], cancelIndex: 1 } }),
  scenario('F3', 'interaction', 'Reject a write with feedback and approve its correction', [turn('Append an ending after approval.',
    calls({ ...write('denied-f3', 'append', ' Wrong.', 1), denied: true, resultText: 'Use a quiet ending.' }),
    calls(write('allowed-f3', 'append', ' Quiet.', 1)), say('The approved quiet ending is written.'))],
    { finalDocument: 'Opening. Quiet.', refusal: 'Use a quiet ending.' }),
  scenario('F4', 'interaction', 'Reopen a completed conversation and continue its document', [
    turn('Write the first beat.', calls(write('first-f4', 'append', ' First.', 1)), say('First beat written.')),
    turn('Continue the same conversation.', calls(read('read-f4', 'Opening. First.')), calls(write('second-f4', 'append', ' Second.', 2)), say('Second beat written.')),
  ], { finalDocument: 'Opening. First. Second.', restartBetweenTurns: true }),
];
