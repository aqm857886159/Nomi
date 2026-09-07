// **R30 的两个数**：一次写对率 与 回合成功率，零额度 loopback 夹具版。
//
// R30 说的是：Agent 改动的验收门必须含这两个数，设计实验室基线只证外观、走查截图只证界面，
// 两者都不得单独判「接好了」。所以这里把它们做成**可复跑的测量**，而不是一句「应该好了」。
//
// 八条首调都取自 #547 真机抓到的畸形（`docs/audit/2026-09-06-agent-tool-layer-audit.md`）：
// 18 次失败里 100% 是「模型把结构化值序列化成 JSON 字符串」那一族——它是**跨模型的通用行为**，
// 不是某个模型的毛病，所以正确的落点是模型能到达的第一层（`prepareArguments`），
// 不是在提示词里恳求它别犯（`storyboardLauncher.ts:40/:80` 恳求过三次，三次都没挡住）。
//
// **带阳性对照**：同一批畸形也喂给一个「没有容忍钩子」的对照臂。没有对照，
// 一个恒等于 100% 的数字看起来和真的做对了一模一样。
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import { createDocumentPort, createLaneFixture } from './laneFixture.mjs';
import type { FixtureReply } from './httpFixture.mjs';

const APPENDED = 'The lights went out.';

/** 八条首调：一条正确的 + 七条真机见过的畸形。 */
const FIRST_CALLS: ReadonlyArray<{ label: string; tool: string; args: unknown }> = [
  { label: 'well-formed', tool: 'append_to_end', args: { content: APPENDED } },
  { label: 'whole-argument-object serialized as a JSON string', tool: 'append_to_end', args: JSON.stringify({ content: APPENDED }) },
  { label: 'field named `text` instead of `content`', tool: 'append_to_end', args: { text: APPENDED } },
  { label: 'field named `body` instead of `content`', tool: 'append_to_end', args: { body: APPENDED } },
  { label: 'content split into an array of strings', tool: 'append_to_end', args: { content: ['The lights ', 'went out.'] } },
  { label: 'no-argument tool handed the argument a sibling tool takes', tool: 'read_full_text', args: { scope: 'full' } },
  { label: 'no-argument tool handed an empty JSON string', tool: 'read_full_text', args: '{}' },
  { label: 'no-argument tool handed an unrelated hint', tool: 'read_full_text', args: { path: 'draft.md' } },
];

/** 把容忍钩子摘掉的对照臂。**只摘这一样**，其余（schema、描述、执行）全同。 */
function withoutTolerance(descriptors: readonly LaneToolDescriptor[]): LaneToolDescriptor[] {
  return descriptors.map(({ prepareArguments: _dropped, ...rest }) => ({ ...rest }));
}

interface Measurement {
  firstCallHits: number
  turnsFinished: number
  total: number
}

async function measure(t: TestContext, arm: 'with-tolerance' | 'without-tolerance'): Promise<Measurement> {
  let firstCallHits = 0;
  let turnsFinished = 0;
  for (const attempt of FIRST_CALLS) {
    const replies: FixtureReply[] = [
      { type: 'tool', calls: [{ id: 'first', name: attempt.tool, arguments: attempt.args }] },
      // 第二回合永远是「正确的那次」：模型读到错误后自纠。它存在是为了让回合能收尾——
      // 一次写对时它不会被消费（夹具按需出队）。
      { type: 'tool', calls: [{ id: 'second', name: 'append_to_end', arguments: { content: APPENDED } }] },
      { type: 'text', text: 'Done.' },
    ];
    const document = createDocumentPort();
    const fixture = await createLaneFixture(t, replies);
    const tools = createDocumentLaneTools(document);
    const lane = await openLane({
      ...fixture.options, tools: arm === 'with-tolerance' ? tools : withoutTolerance(tools),
    });
    await lane.execute({ kind: 'prompt', text: 'Append the closing line.' });
    const parts = lane.projection().parts;
    await lane.close();

    const firstResult = parts.find((part) => part.kind === 'tool-result' && part.toolCallId === 'first');
    if (firstResult?.kind === 'tool-result' && !firstResult.isError) firstCallHits += 1;
    // 回合算成功 = 收尾文字出现了，且文稿真的被改成了预期的样子。
    // 少了后半句，一个「说完成了但什么也没做」的回合也会被记成成功。
    const finished = parts.some((part) => part.kind === 'assistant-text' && part.text.includes('Done.'));
    const applied = (await document.read('full') as { text: string }).text.includes(APPENDED);
    if (finished && applied) turnsFinished += 1;
  }
  return { firstCallHits, turnsFinished, total: FIRST_CALLS.length };
}

test('R30 · first-call accuracy and turn success, with a no-tolerance control arm', async (t) => {
  const treated = await measure(t, 'with-tolerance');
  const control = await measure(t, 'without-tolerance');

  // 数字打进日志，PR 正文直接引用它，不用谁去心算。
  console.log(`[R30] first-call accuracy  with tolerance: ${treated.firstCallHits}/${treated.total}`
    + `  ·  control (no prepareArguments): ${control.firstCallHits}/${control.total}`);
  console.log(`[R30] turn success rate    with tolerance: ${treated.turnsFinished}/${treated.total}`
    + `  ·  control (no prepareArguments): ${control.turnsFinished}/${control.total}`);

  // ① 阳性对照必须**明显更差**。它要是也接近满分，说明这批畸形根本没打到点上，
  //    上面那个漂亮的数字就什么都不证明。
  assert.ok(control.firstCallHits < treated.firstCallHits,
    `the control arm must do worse; got control=${control.firstCallHits} treated=${treated.firstCallHits}`);
  assert.ok(control.firstCallHits <= 1, 'only the well-formed call should survive without a tolerance hook');

  // ② 一次写对率：这八种畸形都该被第一次就捏合成功。
  assert.equal(treated.firstCallHits, treated.total,
    'every shape #547 actually observed must land on the first call');

  // ③ 回合成功率：两臂都该 8/8——容忍买的是**少一次往返**，不是「能不能做完」。
  //    把这条写成断言是为了防一种自我欺骗：拿「回合成功率也涨了」去夸容忍，
  //    而在有重试的世界里它本来就不会涨。
  assert.equal(treated.turnsFinished, treated.total);
  assert.equal(control.turnsFinished, control.total);
});

test('R30 · tolerance is a hug, not a loosened schema', async (t) => {
  // 容忍必须只捏合**这一次**调用，不能把 schema 放松——放松是对**所有**调用放松，
  // 那正是 0/18 的来历。所以真正缺 content 的调用仍然必须失败，而且失败信息里
  // 要带上收到的参数（探针 §4.2 臂 A：pi 的校验器自己会回显）。
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'empty', name: 'append_to_end', arguments: { unrelated: 1 } }] },
    { type: 'text', text: 'I could not append.' },
  ]);
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Append something.' });
  const result = lane.projection().parts.find((part) => part.kind === 'tool-result');
  assert.ok(result?.kind === 'tool-result' && result.isError,
    'a genuinely empty call still fails — tolerance never invents content');
  assert.match(result.text, /content/, 'the model is told which field it is missing');
});
