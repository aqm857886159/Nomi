// 存量 0.85.1 `JsonlSessionRepo` v4 会话 → `pi-coding-agent@1.7.0` `SessionManager` v3 单向无损升级回归（设计卡 ★1c）。
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { LANE_FILE_MODE } from '../../electron/agentLane/laneFileSystem.mjs';
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import {
  laneSessionDirectory,
  listLaneSessions,
  openLaneSession,
} from '../../electron/agentLane/laneSession.mjs';
import { LANE_APPROVAL_NOTE_TYPE } from '../../electron/shared/agentLane/laneContracts.js';
import { createLaneFixture } from './laneFixture.mjs';

const V4_SESSION_ID = '08510000-0000-4000-8000-000000000001';
const V4_CREATED_AT = 1_700_000_000_000;

function buildAuthenticV4Transcript(): string {
  const usage = {
    input: 500,
    output: 120,
    cacheRead: 40,
    cacheWrite: 0,
    totalTokens: 660,
    cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0, total: 0.0031 },
  };
  const lines = [
    JSON.stringify({
      v: 4,
      kind: 'header',
      id: V4_SESSION_ID,
      cwd: '/nomi-lane/main',
      createdAt: V4_CREATED_AT,
    }),
    JSON.stringify([
      {
        kind: 'entry',
        entry: {
          id: 'e1',
          parentId: null,
          seq: 1,
          timestamp: V4_CREATED_AT + 1_000,
          type: 'message',
          message: {
            role: 'nomi.input',
            content: '检查第一场分镜',
            timestamp: V4_CREATED_AT + 1_000,
            context: {
              approvalPolicy: { mode: 'request' },
              skillKey: 'storyboard',
              attachments: [{ assetId: 'asset-v4-1', version: 2 }],
            },
          },
        },
      },
      {
        kind: 'value',
        key: 'pi.session.branch:main',
        action: 'set',
        value: 'e1',
      },
    ]),
    JSON.stringify([
      {
        kind: 'entry',
        entry: {
          id: 'side-1',
          parentId: 'e1',
          seq: 2,
          timestamp: V4_CREATED_AT + 1_500,
          type: 'message',
          message: {
            role: 'user',
            content: 'SIDE_BRANCH_UNTOUCHED',
            timestamp: V4_CREATED_AT + 1_500,
          },
        },
      },
      {
        kind: 'value',
        key: 'pi.session.branch:side',
        action: 'set',
        value: 'side-1',
      },
    ]),
    JSON.stringify([
      {
        kind: 'entry',
        entry: {
          id: 'e2',
          parentId: 'e1',
          seq: 3,
          timestamp: V4_CREATED_AT + 2_000,
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'v4-call-1', name: 'read_script', arguments: {} }],
            api: 'openai-completions',
            provider: 'nomi-lane',
            model: 'v4-model',
            stopReason: 'toolUse',
            usage,
            timestamp: V4_CREATED_AT + 2_000,
          },
        },
      },
      {
        kind: 'entry',
        entry: {
          id: 'e3',
          parentId: 'e2',
          seq: 4,
          timestamp: V4_CREATED_AT + 3_000,
          type: 'message',
          message: {
            role: 'toolResult',
            toolCallId: 'v4-call-1',
            toolName: 'read_script',
            content: [{ type: 'text', text: 'SCENE_ONE_FROM_V4' }],
            isError: false,
            timestamp: V4_CREATED_AT + 3_000,
          },
        },
      },
      {
        kind: 'entry',
        entry: {
          id: 'e4',
          parentId: 'e3',
          seq: 5,
          timestamp: V4_CREATED_AT + 3_500,
          type: 'custom',
          customType: LANE_APPROVAL_NOTE_TYPE,
          data: { toolCallId: 'v4-call-1', toolName: 'read_script', decision: 'granted-once' },
        },
      },
      {
        kind: 'entry',
        entry: {
          id: 'e5',
          parentId: 'e4',
          seq: 6,
          timestamp: V4_CREATED_AT + 4_000,
          type: 'compaction',
          summary: 'V4_COMPACTION_SUMMARY_PRESERVED',
          firstKeptEntryId: 'e1',
          tokensBefore: 12_000,
        },
      },
      {
        kind: 'entry',
        entry: {
          id: 'e6',
          parentId: 'e5',
          seq: 7,
          timestamp: V4_CREATED_AT + 5_000,
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'V4_FINAL_ANSWER' }],
            api: 'openai-completions',
            provider: 'nomi-lane',
            model: 'v4-model',
            stopReason: 'stop',
            usage,
            timestamp: V4_CREATED_AT + 5_000,
          },
        },
      },
      {
        kind: 'value',
        key: 'pi.session.branch:main',
        action: 'set',
        value: 'e6',
      },
      {
        kind: 'value',
        key: 'pi.lane.config:main',
        action: 'set',
        value: {
          model: { provider: 'nomi-lane', modelId: 'v4-model' },
          thinkingLevel: 'medium',
          activeToolNames: ['read_script'],
        },
      },
    ]),
  ];
  // 模拟进程掉电留下的无换行半截尾行（0.85.1 崩溃容错规则：忽略无 `\n` 残行，不炸整条会话）。
  const crashTailWithoutNewline = '{"kind":"entry","entry":{"id":"torn-tail","parentId":"e6"';
  return `${lines.join('\n')}\n${crashTailWithoutNewline}`;
}

test('0.85.1 v4 session JSONL lists read-only, upgrades losslessly to SessionManager v3 at 0o600, and continues cleanly', async (t) => {
  const previousUmask = process.umask(0o022);
  t.after(() => { process.umask(previousUmask); });

  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'V3_FOLLOWUP_ANSWER' }]);
  const dir = laneSessionDirectory(fixture.projectDir, 'main');
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${V4_SESSION_ID}.jsonl`);
  const rawV4 = buildAuthenticV4Transcript();
  await writeFile(filePath, rawV4, { mode: 0o644 });

  // 1) 冷读列表：识别 v4 表头但不改写盘上任何字节。
  const listed = await listLaneSessions(fixture.projectDir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.laneName, 'main');
  assert.equal(listed[0]!.sessionId, V4_SESSION_ID);
  assert.equal(listed[0]!.createdAt, V4_CREATED_AT);
  assert.equal(await readFile(filePath, 'utf8'), rawV4, 'listLaneSessions must never mutate disk');

  // 2) 打开历史：单向无损升级至 SessionManager v3，收紧权限为 0o600，丢弃半截残行，保留主分支全部历史。
  const history = await openLaneHistory({ projectDir: fixture.projectDir });
  assert.equal(history.sessionId, V4_SESSION_ID);
  const projection = history.projection();
  const userPart = projection.parts.find((part) => part.kind === 'user');
  assert.ok(userPart && userPart.kind === 'user');
  assert.equal(userPart.text, '检查第一场分镜');
  assert.equal(userPart.skillKey, 'storyboard');
  assert.deepEqual(userPart.attachments, [{ assetId: 'asset-v4-1', version: 2 }]);
  assert.ok(projection.parts.some((part) => part.kind === 'tool-call' && part.toolCallId === 'v4-call-1'));
  assert.ok(projection.parts.some((part) => part.kind === 'tool-result' && part.text === 'SCENE_ONE_FROM_V4'));
  assert.ok(projection.parts.some((part) => part.kind === 'host-note' && part.noteType === LANE_APPROVAL_NOTE_TYPE));
  assert.ok(projection.parts.some((part) => part.kind === 'assistant-text' && part.text === 'V4_FINAL_ANSWER'));
  assert.doesNotMatch(JSON.stringify(projection), /SIDE_BRANCH_UNTOUCHED/);
  assert.doesNotMatch(JSON.stringify(projection), /torn-tail/);
  await history.close();

  const upgradedRaw = await readFile(filePath, 'utf8');
  const upgradedLines = upgradedRaw.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(upgradedLines[0], {
    type: 'session',
    version: 3,
    id: V4_SESSION_ID,
    timestamp: new Date(V4_CREATED_AT).toISOString(),
    cwd: '/nomi-lane/main',
  });
  assert.equal((await stat(filePath)).mode & 0o777, LANE_FILE_MODE, 'upgraded v3 file is hardened to 0o600');

  const inspected = await openLaneSession({ projectDir: fixture.projectDir, sessionId: V4_SESSION_ID });
  const ctx = inspected.session.buildSessionContext();
  assert.equal(ctx.thinkingLevel, 'medium');
  assert.deepEqual(ctx.model, { provider: 'nomi-lane', modelId: 'v4-model' });
  assert.ok(JSON.stringify(ctx.messages).includes('V4_COMPACTION_SUMMARY_PRESERVED'));
  await inspected.release();

  // 3) 升级后继续在同一会话里跑新回合：保留恢复的 activeTools（只激活 read_script，不激活 write_script）。
  const live = await openLane({
    ...fixture.options,
    sessionId: V4_SESSION_ID,
    input: {
      capture: () => ({ approvalPolicy: { mode: 'request' } }),
      activate: () => {},
      providerContent: async (m) => m.content,
      rewritePayload: (p) => p,
    },
  });
  t.after(() => live.close());
  await live.execute({ kind: 'prompt', text: '继续第二场' });
  const wireTools = (fixture.http.requests[0]!.body.tools as Array<{ function: { name: string } }>)
    .map((tool) => tool.function.name);
  assert.deepEqual(wireTools, ['read_script'], 'v4 activeToolNames migrated into nomi.ui.active-tools');
  assert.ok(live.projection().parts.some((part) => part.kind === 'assistant-text' && part.text === 'V3_FOLLOWUP_ANSWER'));
});
