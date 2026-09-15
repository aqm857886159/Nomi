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
/** `write_script(where)`：三个 `where` 是同一格里的三个分支（拍板一.3）；契约 operation 由声明上的翻译表派生。 */
const WHERE_BY_OPERATION = { append: 'end', insert: 'cursor', replace: 'selection' } as const;
const DOCUMENT_USER_SEES = (operation: string) => `User sees: The document now contains the new text (${operation}); the user can undo it with Cmd+Z.`;
const write = (id: string, operation: 'append' | 'insert' | 'replace', content: string, revision: number): L1Call => ({
  id, name: 'write_script', args: { content, where: WHERE_BY_OPERATION[operation] }, domainArgs: { operation, content },
  resultText: `Applied ${operation} to the document. New revision ${revision}.\n${DOCUMENT_USER_SEES(operation)}`,
});
const domain = (id: string, name: string, args: Record<string, unknown>, result: unknown, domainArgs = args, userSees?: string): L1Call => ({
  id, name, args, domainArgs, domainResult: result, resultText: userSees ? `${JSON.stringify(result)}\nUser sees: ${userSees}` : JSON.stringify(result),
});
/** 画布写动词（stage_shot）：领域端口收到的是契约语义输入；收据是「直接生效、可撤」。 */
const canvas = (id: string, name: string, args: Record<string, unknown>, semantic: { operation: string; [key: string]: unknown }, userSees: string): L1Call => ({
  id, name, args, domainArgs: semantic,
  domainResult: { applied: true, proposalId: `receipt-${id}`, operation: semantic.operation, result: {}, reconciliation: { ok: true, deviationCount: 0 } },
  resultText: `Applied directly (undoable).\nUser sees: ${userSees}`,
});
const DRAFT_USER_SEES = 'Draft shots are on the canvas with their model and price badge. Nothing has been generated and nothing has been spent; call generate when the user wants them made.';
/** `draft_shots` 建草稿（卡藏着）：返回 durable operation；模型手里拿到 draftId（jobId=）。 */
const draft = (id: string, args: Record<string, unknown>, operationId: string): L1Call =>
  domain(id, 'draft_shots', args, { operation: { operationId, state: 'draft', cardHidden: true } }, args, `${DRAFT_USER_SEES} (jobId=${operationId})`);
const turn = (prompt: string, ...frames: L1Frame[]): L1Turn => ({ prompt, frames });
const scenario = (id: string, family: L1Scenario['family'], title: string, turns: L1Turn[],
  extra: Partial<L1Scenario> = {}): L1Scenario => ({ id, family, title, turns, finalDocument: INITIAL_DOCUMENT, ...extra });
const emptyCanvas = { nodes: [], edges: [], groups: [], selectedNodeIds: [] };
const timeline = { operation: 'read_timeline', revision: 'r1', fps: 30, scale: 1,
  playheadFrame: 0, durationFrames: 0, valid: true, tracks: [], textClips: [], transitions: [] };
const plan = { revision: 'r1', summary: 'Move opening clip', operations: [{ kind: 'move', clipId: 'clip-1', startFrame: 30 }] };
// draft_shots 的 parameters 是模型档案声明的标量表；嵌套结构由宿主按目录钳值，不进模型面。
const nestedParameters = { seed: 7, aspect_ratio: '16:9', hd: true };
const queued: LaneTaskFacts = { status: 'queued', progress: 0, currency: 'CNY' };
const running: LaneTaskFacts = { status: 'running', progress: 40, currency: 'CNY', spent: 0.1 };
const complete: LaneTaskFacts = { status: 'complete', progress: 100, currency: 'CNY', spent: 0.2, candidates: [{ artifactId: 'asset-1', projectId: 'fixture', productionRunId: 'run-1', thumbnailUrl: 'nomi-local://asset/fixture/asset-1.png', adopted: true, canAdopt: false }] };

/** Five capability families × three concrete scripts, plus four interaction scripts — on the 20-verb face
 * (design 2026-09-11 §5): storyboard/generation go through `draft_shots`, the Run family is not on the model face.
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
  scenario('C1', 'canvas', 'Inspect the canvas then draft an opening shot', [turn('Create an opening frame.',
    calls({ ...domain('read-c1', 'look_at_canvas', {}, emptyCanvas), resultText: '画布当前为空。' }),
    calls(draft('write-c1', { shots: [{ title: 'Opening', prompt: 'Sunrise', taskKind: 'text_to_image' }] }, 'gen-c1')), say('The opening frame is drafted, nothing generated yet.'))]),
  scenario('C2', 'canvas', 'Draft an ordered two-shot storyboard', [turn('Make two shots from the scene.',
    calls(draft('write-c2', { shots: [{ title: 'Sunrise', prompt: 'Sunrise', taskKind: 'text_to_image' }, { title: 'Open door', prompt: 'Open door', taskKind: 'text_to_image' }] }, 'gen-c2')), say('The two shots stay in story order.'))]),
  scenario('C3', 'canvas', 'Attach a vocabulary camera reference', [turn('Use a slow push in for shot one.',
    calls(canvas('write-c3', 'stage_shot', { shotId: 's1', cameraMove: { move: 'push_in', speed: 'slow' } },
      { operation: 'create_camera_move', shotClientId: 's1', move: 'push_in', speed: 'slow' },
      'The canvas shows the new director reference node next to the shot; the user can undo it with Cmd+Z. Nothing was generated and nothing was spent.')), say('The camera reference is attached.'))]),
  scenario('T1', 'timeline', 'Read current timeline revision and duration', [turn('Inspect the edit before changing it.',
    calls(domain('read-t1', 'read_timeline', {}, timeline, { operation: 'read_timeline' })), say('The timeline is empty at revision r1.'))]),
  scenario('T2', 'timeline', 'Inspect a bounded frame interval', [turn('Inspect frames thirty through sixty.',
    calls(domain('read-t2', 'read_timeline', { startFrame: 30, endFrame: 60 },
      { operation: 'inspect_timeline_range', revision: 'r1', startFrame: 30, endFrame: 60, tracks: [], textClips: [] },
      { operation: 'inspect_timeline_range', startFrame: 30, endFrame: 60 })), say('The requested interval has no clips.'))]),
  scenario('T3', 'timeline', 'Apply a revision-bound plan through the review card', [turn('Move the opening clip.',
    calls(domain('write-t3', 'edit_timeline', plan, { applied: true, revision: 'r2', undoToken: 'undo-1' }, plan,
      'The timeline highlights the planned edit and a review card asks the user to apply it (in full-auto mode it is already applied). (changeId=undo-1)')), say('The edit has an undo token.'))]),
  scenario('G1', 'generation', 'Draft a shot without spending', [turn('Draft a sunrise image.',
    calls(draft('create-g1', { shots: [{ prompt: 'Sunrise' }] }, 'gen-1')), say('The draft awaits the user; nothing was spent.'))]),
  scenario('G2', 'generation', 'Read a submitted job then cancel it', [turn('Stop the existing generation.',
    calls(domain('read-g2', 'check_job', { jobId: 'gen-2' }, { operation: { operationId: 'gen-2', state: 'submitted' } })),
    calls(domain('cancel-g2', 'cancel_job', { jobId: 'gen-2' }, { operation: { operationId: 'gen-2', state: 'cancelled' } }, { jobId: 'gen-2' },
      'The job was cancelled after the user confirmed; credit already spent is not refunded.')), say('Cancellation was requested once.'))]),
  scenario('G3', 'generation', 'Preserve scalar parameters while drafting and revising', [turn('Revise this structured draft.',
    calls(draft('create-g3', { shots: [{ prompt: 'Sunrise', parameters: nestedParameters }] }, 'gen-3')),
    calls(draft('patch-g3', { draftId: 'gen-3', shots: [{ prompt: 'Sunrise', parameters: nestedParameters }] }, 'gen-3')), say('Nested parameters survived the revision.'))]),
  scenario('K1', 'task', 'A draft task progresses without duplicating state', [turn('Start a reviewable short-film draft.',
    calls(draft('start-k1', { shots: [{ prompt: 'A short film opening' }] }, 'run-k1')), say('The draft task was created.'))],
    { task: { productionRunId: 'run-k1', operationId: 'start-k1', facts: [queued, running, complete] } }),
  scenario('K2', 'task', 'An unavailable task joins no invented progress', [turn('Read the old task.',
    calls(domain('read-k2', 'check_job', { jobId: 'gen-k2' }, { operation: { operationId: 'gen-k2' } })), say('Only its saved identity is available.'))],
    { task: { productionRunId: 'run-k2', facts: [undefined] } }),
  scenario('K3', 'task', 'Task identity and completed artifacts survive restart', [turn('Record the completed task.',
    calls(domain('read-k3', 'check_job', { jobId: 'run-k3' }, { operation: { operationId: 'run-k3', state: 'submitted' } })), say('The completed task is recorded.'))],
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
