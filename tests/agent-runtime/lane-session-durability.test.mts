// Agent lane · 会话落盘的三条**看不见的**保证：谁能读它、谁在持有它、它怎么被替换。
//
// 三条的共同点是**失败时不报错**：世界可读的转录看起来和私密的一模一样；被打开两次的
// 会话在写坏之前一切正常；一次非原子的替换只在被中断的那一刻毁掉文件。所以这一族只能
// 用断言证，不能用「跑一遍看着没事」证。
//
// 出处：`docs/research/2026-09-07-pi-reference-implementation-conformance.md` §3.2 / §9.5
// 与 CHANGELOG 坑 1（0.84.0 的 `FileSystem.renameFile` breaking change）。
import assert from 'node:assert/strict';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/harness/env/nodejs';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { getOrThrow } from '@earendil-works/pi-agent-core';

import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createLaneFileSystem, LANE_DIR_MODE, LANE_FILE_MODE } from '../../electron/agentLane/laneFileSystem.mjs';
import { laneSessionsRoot } from '../../electron/agentLane/laneSession.mjs';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import { createDocumentPort, createLaneFixture } from './laneFixture.mjs';

const ONE_TURN = [
  { type: 'tool' as const, calls: [{ id: 'call-read', name: 'read_full_text', arguments: {} }] },
  { type: 'text' as const, text: 'Read it.' },
];

const mode = async (path: string) => (await stat(path)).mode & 0o777;

/** 盘上那一个 jsonl 会话文件。断言权限之前先证明**确实有**一个文件——否则「空 == 空」。 */
async function theSessionFile(projectDir: string): Promise<{ root: string; slug: string; file: string }> {
  const root = laneSessionsRoot(projectDir);
  const slugs = await readdir(root);
  assert.equal(slugs.length, 1, 'exactly one slug directory');
  const slug = join(root, slugs[0]);
  const files = (await readdir(slug)).filter((name) => name.endsWith('.jsonl'));
  assert.equal(files.length, 1, 'exactly one jsonl session file');
  return { root, slug, file: join(slug, files[0]) };
}

test('the transcript is owner-only on disk — it holds the user’s manuscript, not just metadata', async (t) => {
  // umask 是这台机器的变量，而阳性对照的成立与否取决于它。把它按住，别拿运气当对照。
  const previousUmask = process.umask(0o022);
  t.after(() => { process.umask(previousUmask); });

  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const lane = await openLane(fixture.options);
  await lane.execute({ kind: 'prompt', text: 'Read the document.' });
  await lane.close();

  const { root, slug, file } = await theSessionFile(fixture.projectDir);
  assert.equal(await mode(file), LANE_FILE_MODE, 'the session jsonl is 0o600');
  assert.equal(await mode(slug), LANE_DIR_MODE, 'the slug directory is 0o700');
  assert.equal(await mode(root), LANE_DIR_MODE, 'the sessions root is 0o700');

  // 阳性对照：**同一个目录里**，一次不经过我们这层的写入落地是什么样。
  // 没有它，上面三条在一台 umask 是 077 的机器上会自动为真，而我们什么也没做。
  const unhardened = join(slug, 'control.jsonl');
  await writeFile(unhardened, 'x');
  assert.equal(await mode(unhardened), 0o644,
    'without the hardening a write in this very directory is world-readable — that is what upstream ships');
});

test('renameFile stays pi’s own: an atomic same-filesystem replace, never a copy+delete', async (t) => {
  const fixture = await createLaneFixture(t, []);
  const fileSystem = createLaneFileSystem(fixture.projectDir);

  // ① 结构断言：我们**没有**改写 `renameFile`。0.84.0 起 pi 要求它是「同文件系统替换，
  //    不跨卷复制」（`harness/types.d.ts:189`）；一个满足签名但底层是 copy+delete 的实现
  //    只在被中断的那一刻损坏 JSONL——测试里全绿，生产里坏会话。我们能破坏这条的唯一方式
  //    就是自己写一个，所以这里钉的是「没有自己写」。
  assert.equal(Object.hasOwn(fileSystem, 'renameFile'), false,
    'the lane filesystem decorates writes only; renameFile is inherited from NodeExecutionEnv verbatim');
  assert.equal(Object.getPrototypeOf(fileSystem).renameFile, NodeExecutionEnv.prototype.renameFile);

  // ② 行为断言：目标已经存在时，一次 rename 就把它换掉——没有「先删再写」那个中间窗口。
  const source = join(fixture.projectDir, 'staged.tmp');
  const destination = join(fixture.projectDir, 'published.jsonl');
  await writeFile(destination, 'old');
  await writeFile(source, 'new');
  getOrThrow(await fileSystem.renameFile(source, destination, BACKGROUND_CONTEXT));
  assert.equal(getOrThrow(await fileSystem.readTextFile(destination, BACKGROUND_CONTEXT)), 'new');
  assert.equal(getOrThrow(await fileSystem.exists(source, BACKGROUND_CONTEXT)), false);
});

test('every atomic publish stages its temp file as a sibling — that is what makes “same filesystem” structural', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const lane = await openLane(fixture.options);
  await lane.execute({ kind: 'prompt', text: 'Read the document.' });
  await lane.close();

  // pi 的 `publishFileAtomically` 用 `${destination}.tmp`（`session/jsonl/storage.js:71`）。
  // 同目录 ⇒ 同文件系统 ⇒ `rename(2)` 原子——**与用户把项目放在 iCloud 还是外接盘无关**。
  // 这条断言把那个「结构上不可能跨卷」钉住：哪天上游改成 `os.tmpdir()` 暂存，它先红。
  const { slug } = await theSessionFile(fixture.projectDir);
  const strays = (await readdir(slug)).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(strays, [], 'a published session leaves no staging file behind');
});

test('one session has exactly one owner: a second open in this process is refused, not silently duplicated', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const first = await openLane(fixture.options);
  t.after(() => first.close());

  // 上游 #8852：同一条 JSONL 被打开两次会写出重复 `seq` 并把文件写坏。Nomi 是多窗口
  // Electron——「一个项目被两个窗口打开」是日常操作。
  await assert.rejects(() => openLane({ ...fixture.options, sessionId: first.sessionId }),
    /already has an owner/, 'the second opener is turned away with the reason, not handed a second writer');

  // 阳性对照 ①：拦的是**这一条会话**，不是「这个项目」。同一个项目里另起一条 lane 照常打开——
  // 否则这道防线会把「两个窗口看两条不同对话」也一起拦掉，那是产品功能不是事故。
  const sibling = await openLane(fixture.options);
  t.after(() => sibling.close());
  assert.notEqual(sibling.sessionId, first.sessionId);
});

test('the owner is released on close — a reopened history is not permanently locked out', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  const first = await openLane(fixture.options);
  const { sessionId } = first;
  await first.close();

  const reopened = await openLane({ ...fixture.options, sessionId });
  t.after(() => reopened.close());
  assert.equal(reopened.sessionId, sessionId);
});

test('a failed assembly hands the session back — the next open does not meet a ghost owner', async (t) => {
  const fixture = await createLaneFixture(t, [...ONE_TURN]);
  // 两个同名工具：`createLaneTools` 在装配阶段抛。会话此刻已经打开了。
  const duplicated = [...createDocumentLaneTools(createDocumentPort())];
  const clash = duplicated[0] as LaneToolDescriptor;
  await assert.rejects(() => openLane({ ...fixture.options, tools: [clash, clash] }), /duplicate/i);

  // 会话没有被一个失败退出的调用扣住。
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  assert.ok(lane.sessionId);
});

test('G-02 · a tool failure throws, so pi records an errored result instead of a successful one', async (t) => {
  const message = 'The document is locked by another window; ask the user to close it and try again.';
  const failing: LaneToolDescriptor = {
    name: 'always_fails',
    description: 'A tool that always reports a failure, used to prove failures are not recorded as successes.',
    schema: z.object({}).strict(),
    execute: async () => ({ ok: false, message }),
  };
  const succeeding: LaneToolDescriptor = { ...failing, name: 'always_succeeds', execute: async () => ({ ok: true, text: message }) };

  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'bad', name: 'always_fails', arguments: {} }] },
    { type: 'tool', calls: [{ id: 'good', name: 'always_succeeds', arguments: {} }] },
    { type: 'text', text: 'Done.' },
  ]);
  const lane = await openLane({ ...fixture.options, tools: [failing, succeeding] });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Try both.' });

  const results = lane.projection().parts.filter((part) => part.kind === 'tool-result');
  const bad = results.find((part) => part.toolCallId === 'bad');
  const good = results.find((part) => part.toolCallId === 'good');

  assert.ok(bad?.isError, 'a failure lands as an errored result — returning a failure object would land as a success');
  assert.match(bad.text, /locked by another window/, 'the actionable sentence reaches the model, not an error code');
  // 阳性对照：**逐字相同的文本**走成功路径时 `isError` 是 false。少了它，一个把每条结果
  // 都标成错误的实现也能通过上面那条。
  assert.equal(good?.isError, false);
  assert.equal(good.text, message);
});
