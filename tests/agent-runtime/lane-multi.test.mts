// 阶段 3d · G2「一个项目多条对话」（方案 §2.2 G2 那一行）。
//
// ── 它解决的真实摩擦 ──
// 今天一个项目只有一条 Agent 对话。用户想一边让它改第三场戏、一边另起一条问「这个片种
// 一般怎么排」，只能把两件事挤进同一条历史——上下文越滚越长，压缩把前一件事的细节吃掉，
// 模型开始把两件事搅在一起。多 lane 的价值是**上下文隔离**，不是多开几个窗口。
//
// ── 这一族钉的四件事 ──
//   ① 列表 / 新建 / 切换 / 删除四条命令，每条都落在 pi 自己的会话能力上（R29）。
//   ② 切过去看到的是**那条**对话的转录，不是当前这条的。
//   ③ 冷重启后列表与每条投影**逐字相等**——这是「历史真的在盘上」唯一的机器判据。
//   ④ 四种拒绝：重名新建 / 切到不存在 / 删不存在 / 删当前这条。四条都抛，不静默。
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { openLaneWorkspace } from '../../electron/agentLane/laneWorkspace.mjs';
import { laneSessionsRoot } from '../../electron/agentLane/laneSession.mjs';
import type { LanePart, LaneSummary } from '../../electron/shared/agentLane/laneContracts.js';
import { createLaneFixture } from './laneFixture.mjs';

const SAY = (text: string) => ({ type: 'text' as const, text });

/** 对话的**身份**。`updatedAt` 是文件 mtime，它随每次写入合法地往前走，不属于身份。 */
const identity = (lanes: readonly LaneSummary[]) =>
  lanes.map(({ laneName, sessionId, createdAt }) => ({ laneName, sessionId, createdAt }));

const userTexts = (parts: readonly LanePart[]) =>
  parts.flatMap((part) => (part.kind === 'user' ? [part.text] : []));

test('G2 · 两条对话各有各的转录；切过去看到的是那一条，不是当前这条', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [SAY('Shot three, noted.'), SAY('Anthology, usually.')]);
  const workspace = await openLaneWorkspace(fixture.options);
  fixture.after(() => workspace.close());

  await workspace.execute({ kind: 'prompt', text: '把第三场戏改成夜戏。' });
  await workspace.execute({ kind: 'lane-create', laneName: 'research' });
  await workspace.execute({ kind: 'prompt', text: '这个片种一般怎么排？' });

  const afterCreate = workspace.projection();
  assert.equal(afterCreate.active.lane, 'research', '新建之后就停在新那条上 —— 用户新建就是为了在那儿说话');
  assert.deepEqual(userTexts(afterCreate.active.parts), ['这个片种一般怎么排？'],
    '新那条是干净的：上一条的上下文一个字都不该跟过来（这就是多 lane 的全部意义）');
  assert.deepEqual([...afterCreate.lanes].map((lane) => lane.laneName).sort(), ['main', 'research']);

  await workspace.execute({ kind: 'lane-select', laneName: 'main' });
  assert.deepEqual(userTexts(workspace.projection().active.parts), ['把第三场戏改成夜戏。'],
    '切回去看到的是那条自己的历史 —— 两条对话共用一份转录就是今天那条「越聊越乱」的根');

  // 盘上是两个目录，一条对话一个（`laneSessionCwd`）。删项目即删历史，本地优先该有的样子。
  const slugs = (await readdir(laneSessionsRoot(fixture.projectDir))).sort();
  assert.deepEqual(slugs, ['--nomi-lane-main--', '--nomi-lane-research--']);
});

test('G2 · 冷重启：列表与每条投影逐字相等（历史真的在盘上，不在内存里）', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [SAY('Noted.'), SAY('Anthology.')]);
  const first = await openLaneWorkspace(fixture.options);
  fixture.after(() => first.close());
  await first.execute({ kind: 'prompt', text: '第一条说的话' });
  await first.execute({ kind: 'lane-create', laneName: 'research' });
  await first.execute({ kind: 'prompt', text: '第二条说的话' });

  const before = { lanes: identity(first.projection().lanes), research: first.projection().active.parts };
  await first.execute({ kind: 'lane-select', laneName: 'main' });
  const beforeMain = first.projection().active.parts;
  await first.close();

  // 冷重启 = 同一个项目目录、全新的宿主。除了目录，什么都没带过来。
  const second = await openLaneWorkspace(fixture.options);
  fixture.after(() => second.close());

  assert.deepEqual(identity(second.projection().lanes), before.lanes, '对话列表逐条相等');
  assert.deepEqual(second.projection().active.parts, beforeMain, 'main 那条的投影逐字相等');
  await second.execute({ kind: 'lane-select', laneName: 'research' });
  assert.deepEqual(second.projection().active.parts, before.research, 'research 那条的投影逐字相等');
});

test('G2 · 删一条对话：它从列表和盘上一起消失；当前这条删不得', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [SAY('Noted.')]);
  const workspace = await openLaneWorkspace(fixture.options);
  fixture.after(() => workspace.close());

  await workspace.execute({ kind: 'lane-create', laneName: 'research' });
  await workspace.execute({ kind: 'lane-select', laneName: 'main' });
  await workspace.execute({ kind: 'lane-delete', laneName: 'research' });

  assert.deepEqual(workspace.projection().lanes.map((lane) => lane.laneName), ['main']);
  // 「列表里没有」和「盘上没有」是两件事。只查列表的话，一个只改内存的实现照样全绿，
  // 而用户重开 App 会看到那条对话回来了。
  //
  // 查的是**转录文件**不是目录：`repo.delete()` 删的是那个 jsonl，留下一个空的 slug 目录
  // （pi 自己的清理边界）。我们不去替它删——那要求我们知道它的目录布局，而知道就会跟着它变。
  const laneDir = join(laneSessionsRoot(fixture.projectDir), '--nomi-lane-research--');
  assert.deepEqual((await readdir(laneDir)).filter((name) => name.endsWith('.jsonl')), [],
    '那条对话的转录真的从盘上没了');

  await assert.rejects(() => workspace.execute({ kind: 'lane-delete', laneName: 'main' }),
    /agent_lane_conversation_in_use/, '删掉当前这条就没有活着的对话了 —— 正确姿势是先切走再删');
});

test('G2 · 四条命令的拒绝面：重名新建 / 切到不存在 / 删不存在，都抛，不静默', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, []);
  const workspace = await openLaneWorkspace(fixture.options);
  fixture.after(() => workspace.close());

  // 重名新建静默变成「打开」是最坏的默认值：用户以为自己在白纸上开始，
  // 而模型看得见上一件事的全部上下文。
  await assert.rejects(() => workspace.execute({ kind: 'lane-create', laneName: 'main' }), /agent_lane_conversation_exists/);
  // 静默新建会给他一条空白对话，而他以为那是自己昨天写的东西。
  await assert.rejects(() => workspace.execute({ kind: 'lane-select', laneName: 'ghost' }), /agent_lane_conversation_missing/);
  await assert.rejects(() => workspace.execute({ kind: 'lane-delete', laneName: 'ghost' }), /agent_lane_conversation_missing/);
  // 拒绝之后工作区还活着：一次被拒的命令不该把当前那条对话关掉。
  assert.equal(workspace.projection().active.lane, 'main');
});

test('G2 · lane 命令不属于单条 lane：宿主自己收到它必须抛，而不是猜一个语义', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, []);
  const lane = await fixture.openLane(fixture.options);
  // 一条 lane 的宿主对隔壁一无所知，**这是它该有的样子**——知道了就会长出第二个所有者。
  await assert.rejects(() => lane.execute({ kind: 'lane-select', laneName: 'research' }),
    /belongs to the workspace/);
});
