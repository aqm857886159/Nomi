// 阶段 3d · G13「生成任务卡」的承接点（方案 §2.2 G13 那一行 · §1.4 规则二第二行）。
//
// ── 为什么这一条是阶段 4 的硬前置 ──
// 待删的旧宿主里有一件功能**新通路一点都没有**：任务卡（进度 % / 已花·预估 / 候选缩略图）。
// 没有承接点就删旧路 = 用户面板上那张卡凭空消失。这一族钉的就是承接点本身。
//
// ── 承接点的形状：两个 id，零份状态 ──
// 转录里那条 `nomi.ui.task` 只写 `productionRunId`（+ 建卡的那次调用）。会动的数字全部在
// 投影那一刻按 id 去领域读一次。把它们写进转录的代价不是几个字节，是**第二份真相**——
// 转录是追加式的，写进去那一刻就冻住了：用户重开对话会看到一个早跑完的任务停在 37%，
// 而任务中心一切正常。这一族的「三态投影」正是在证明这件事：**同一条转录**、三份不同的
// 领域事实，投出三张不同的卡。
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type { LaneTaskFactsResolver } from '../../electron/agentLane/laneRuntimePort.js';
import {
  LANE_TASK_NOTE_TYPE, type LaneProjection, type LaneTaskFacts,
} from '../../electron/shared/agentLane/laneContracts.js';
import { createLaneFixture } from './laneFixture.mjs';

const RUN_ID = 'run-7f2c';
const CLOSING = { type: 'text' as const, text: 'Started the generation.' };

/** 一条 ProductionRun 从排队 → 在跑 → 完成。字段与今天 `V4TaskFacts` 的产地一一对应。 */
const QUEUED: LaneTaskFacts = { status: 'queued', stagesDone: 0, stagesTotal: 3, progress: 0, currency: 'CNY' };
const RUNNING: LaneTaskFacts = {
  status: 'running', stagesDone: 1, stagesTotal: 3, progress: 33,
  currency: 'CNY', spent: 0.24, estimated: 0.48,
};
const COMPLETE: LaneTaskFacts = {
  status: 'complete', stagesDone: 3, stagesTotal: 3, progress: 100,
  currency: 'CNY', spent: 0.46, candidates: ['artifact-1', 'artifact-2'].map(artifactId => ({ artifactId, projectId: 'fixture', productionRunId: 'run-1', thumbnailUrl: `nomi-local://asset/fixture/${artifactId}.png`, adopted: false, canAdopt: true })),
};

function taskParts(projection: LaneProjection) {
  return projection.parts.flatMap((part) => (part.kind === 'task' ? [part] : []));
}

/**
 * 一条**真**的 lane：真 pi 循环、真会话落盘。任务记录用 `appendCustomEntry` 骑在同一条
 * 转录上——阶段 4 之后建卡的是生成工具，此刻用宿主直接追加，钉的是投影而不是那个工具。
 */
async function laneWithTaskNote(t: TestContext, tasks?: LaneTaskFactsResolver) {
  const fixture = await createLaneFixture(t, [CLOSING, CLOSING]);
  const lane = await fixture.openLane({ ...fixture.options, ...(tasks ? { tasks } : {}) });
  await lane.execute({ kind: 'prompt', text: '把第三场戏生成出来。' });
  await lane.appendTaskNote({ productionRunId: RUN_ID, operationId: 'call-generate' });
  return { lane, http: fixture.http };
}

test('G13 · 同一条转录 + 三份领域事实 = 三张不同的卡（状态不在转录里）', async (t: TestContext) => {
  let facts: LaneTaskFacts = QUEUED;
  const { lane } = await laneWithTaskNote(t, () => facts);

  const seen: LaneTaskFacts[] = [];
  for (const next of [QUEUED, RUNNING, COMPLETE]) {
    facts = next;
    // 领域变了就说一声，宿主重投一次。**转录一个字没动**——这正是「引用而不复制」的效果。
    lane.refreshTasks();
    const [task] = taskParts(lane.projection());
    assert.equal(task?.productionRunId, RUN_ID);
    assert.equal(task?.operationId, 'call-generate', '卡挂回建它的那次调用，用来在流里定位');
    seen.push(task!.facts!);
  }
  assert.deepEqual(seen, [QUEUED, RUNNING, COMPLETE],
    '三态各投各的；把状态写进转录的实现会在这里连出三张一模一样的排队卡');

  // 阳性对照：转录里那条记录**自始至终只有两个 id**。多一个字段就是多一处会过期的真相。
  const raw = lane.projection().parts.find((part) => part.kind === 'task');
  assert.deepEqual(Object.keys(raw!).sort(),
    ['contentIndex', 'entrySeq', 'facts', 'kind', 'operationId', 'productionRunId', 'sequence'].sort());
});

test('G13 · join 不到就只画标题：不给一个假的「排队中」', async (t: TestContext) => {
  // 没有领域读口（任务中心没装、那条 run 已经被清理掉）。
  const { lane } = await laneWithTaskNote(t);
  const [task] = taskParts(lane.projection());
  assert.equal(task?.productionRunId, RUN_ID);
  assert.equal(task?.facts, undefined,
    '解不出来就是解不出来。编一个「排队中」会让用户以为有东西在跑，而其实什么都没有');
});

test('G13 · 任务记录不进模型上下文：证据在出站报文里，不在一句注释里', async (t: TestContext) => {
  const { lane, http } = await laneWithTaskNote(t, () => RUNNING);
  // 前缀就是判据（`nomi.ui.*` 的 projector 恒 `undefined`），但「判据存在」不等于「它生效了」。
  assert.ok(LANE_TASK_NOTE_TYPE.startsWith('nomi.ui.'));

  // 再发一句话，让模型重新读一遍上下文——这一次的报文里必须**一个字**都没有那条记录。
  await lane.execute({ kind: 'prompt', text: '好了吗？' });
  const lastPayload = JSON.stringify(http.requests.at(-1)?.body ?? {});
  assert.ok(!lastPayload.includes(RUN_ID),
    '任务卡的 id 进了上下文 = 模型开始拿一条冻住的记录当状态源，而它该调 check_job');
  assert.ok(!lastPayload.includes(LANE_TASK_NOTE_TYPE));
  // 阳性对照：同一份报文里**有**用户刚说的那句话——证明我们查的确实是这一轮的上下文。
  assert.ok(lastPayload.includes('好了吗？'));
});
