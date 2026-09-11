// Agent lane 的测试夹具：一个真 HTTP 端点 + 一个真项目目录 + 真 `document` 端口。
//
// 只有**远端模型**是假的（复用 `httpFixture.mts` 那个真 HTTP 服务器）。pi 的循环、
// 会话落盘、工具校验、闸全部是真的跑——把它们也 mock 掉，这套测试就只能证明
// 「我写的 mock 和我写的断言一致」。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { openLane } from '../../electron/agentLane/laneHost.mjs';

import { createDocumentLaneTools, type DocumentLanePort } from '../../electron/agentLane/laneDocumentTools.js';
import type { LaneApprovalOptions, OpenLaneOptions } from '../../electron/agentLane/laneRuntimePort.js';
import type { DocumentWriteInput, DocumentWriteResult } from '../../electron/shared/agentCapabilities/documentWrite.js';
import { createHttpFixture, type FixtureReply } from './httpFixture.mjs';

// One after hook per test also closes sibling fixtures if one fixture fails.
const cleanupsByTest = new WeakMap<TestContext, Array<() => Promise<void>>>();

function registerFixtureCleanup(t: TestContext, close: () => Promise<void>): void {
  let cleanups = cleanupsByTest.get(t);
  if (!cleanups) {
    cleanups = [];
    cleanupsByTest.set(t, cleanups);
    const owned = cleanups;
    t.after(async () => {
      const results = await Promise.allSettled(owned.map((cleanup) => cleanup()));
      const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Lane fixtures cleanup failed');
    });
  }
  cleanups.push(close);
}

export const LANE_SYSTEM_PROMPT = 'NOMI_LANE_SYSTEM';

/** 测试里手写的工具声明共用的五槽描述（`VerbDeclaration.describe` 必填；夹具只关心执行，不关心措辞）。 */
export const FIXTURE_DESCRIBE = Object.freeze({
  does: 'Fixture tool.', useWhen: 'Only inside this test.', notWhen: 'Never outside the fixture (read_full_text is the real read).', params: 'None.',
});

/** 一个最小但**真**的文稿端口：写进去的东西读得回来，revision 会涨。 */
export function createDocumentPort(initial = 'The opening scene.') {
  let text = initial;
  let selection = '';
  let revision = 0;
  return {
    text: () => text,
    read: async (scope: Parameters<DocumentLanePort['read']>[0]) => (scope === 'full' ? { text } : { text: selection }),
    write: async (input: DocumentWriteInput): Promise<DocumentWriteResult> => {
      if (input.operation === 'append') text = `${text}${input.content}`;
      else if (input.operation === 'insert') text = `${input.content}${text}`;
      else { selection = input.content; text = input.content; }
      revision += 1;
      return { applied: true, revision, contentHash: `hash-${revision}` };
    },
  };
}

export interface LaneFixture {
  after(fn: () => void | Promise<void>): void;
  openLane: typeof openLane;
  options: OpenLaneOptions;
  projectDir: string;
  document: ReturnType<typeof createDocumentPort>;
  http: Awaited<ReturnType<typeof createHttpFixture>>;
}

export async function createLaneFixture(
  t: TestContext,
  replies: FixtureReply[],
  approval?: LaneApprovalOptions,
): Promise<LaneFixture> {
  const projectDir = await mkdtemp(join(tmpdir(), 'nomi-lane-'));
  const owners: Array<() => void | Promise<void>> = [];
  const after = (close: () => void | Promise<void>) => { owners.push(close); };
  // node:test runs after hooks in registration order and stops after a rejected hook.
  // One owner must close dependencies before removing the directory, even on failure.
  registerFixtureCleanup(t, async () => {
    const errors: unknown[] = [];
    for (const close of owners.reverse()) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    // A failed close may still have a writer. Preserve its directory and report the failure.
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Lane fixture cleanup failed');
    await rm(projectDir, { recursive: true, force: true });
  });
  const http = await createHttpFixture(replies);
  after(http.close);
  const document = createDocumentPort();
  const options: OpenLaneOptions = {
    fetch: globalThis.fetch,
    projectDir,
    systemPrompt: LANE_SYSTEM_PROMPT,
    model: {
      kind: 'openai-compatible', providerId: 'nomi-lane', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key',
    },
    tools: createDocumentLaneTools(document),
    ...(approval ? { approval } : {}),
  };
  return { options, projectDir, document, http, after,
    openLane: async (input) => {
      const lane = await openLane(input);
      after(() => lane.close());
      return lane;
    },
  };
}
