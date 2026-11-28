// Agent lane 的测试夹具：一个真 HTTP 端点 + 一个真项目目录 + 真 `document` 端口。
//
// 只有**远端模型**是假的（复用 `httpFixture.mts` 那个真 HTTP 服务器）。pi 的循环、
// 会话落盘、工具校验、闸全部是真的跑——把它们也 mock 掉，这套测试就只能证明
// 「我写的 mock 和我写的断言一致」。
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { laneSessionsRoot, openLaneSession, type LaneSession } from '../../electron/agentLane/laneSession.mjs';
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
  does: 'Fixture tool.', useWhen: 'Only inside this test.', notWhen: 'Never outside the fixture (read_script is the real read).', params: 'None.',
});

/**
 * 「这一次调用必然停下来等人」的审批夹具（等待 / 停止 / 重启 / 排队这类测试要一个稳定的等待点）。
 *
 * 2026-10-12 挡位收成两档（请求批准 / 直接生成）之后，没有任何一档会让本地可撤销的写入（更不用说只读）停下来——
 * 原来这些测试用的「每步问」已删。这里不换成某个恰好是硬闸的能力，而是用闸自己的那条事实：宿主说「这一次必须当场确认」
 * （`forceConfirmation` → `hostMustConfirm`，与逃逸档 shell 命令同一条路），并且不给「本会话允许这类」。
 * 被测的是等待本身的语义，与这张卡为什么出现无关。不在 `toolNames` 里的工具照常按契约解析。
 */
export function mustConfirm(input: { toolNames?: readonly string[]; hasUserInterface?: boolean } = {}): LaneApprovalOptions {
  const toolNames = new Set(input.toolNames ?? ['write_script']);
  return {
    hasUserInterface: input.hasUserInterface ?? true,
    policy: () => ({ mode: 'request' }),
    resolveSubject: (request) => toolNames.has(request.toolName) ? {
      subject: {
        toolName: request.toolName, capabilityId: `fixture-must-confirm:${request.toolName}`,
        effect: 'reversible_write', effectClass: 'reversible_local', requiresPlanReview: false, destructiveHint: false,
      },
      forceConfirmation: true,
      grantable: false,
    } : undefined,
  };
}

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

/** Read the actual native log, never the derived trace. Fixtures here own one session. */
export async function readFixtureNativeEntries(projectDir: string): Promise<Array<{
  id: string; seq: number; type: string; customType?: string; data?: unknown; message?: { role?: string };
}>> {
  const root = laneSessionsRoot(projectDir);
  const files: string[] = [];
  for (const slug of await readdir(root)) {
    for (const name of await readdir(join(root, slug))) {
      if (name.endsWith('.jsonl')) files.push(join(root, slug, name));
    }
  }
  if (files.length !== 1) throw new Error(`Expected one native session, found ${files.length}`);
  const rows = (await readFile(files[0]!, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return rows
    .filter((row) => row && typeof row === 'object' && row.type !== 'session')
    .map((row, index) => ({ ...row, seq: index + 1 }));
}

export async function openTempLaneSession(t?: TestContext): Promise<LaneSession> {
  const holder = await createLaneFixture(t, []);
  const opened = await openLaneSession({ projectDir: holder.projectDir });
  const closeAll = async () => {
    await opened.release().catch(() => undefined);
    await holder.close().catch(() => undefined);
  };
  if (t) registerFixtureCleanup(t, closeAll);
  return {
    ...opened.session,
    close: closeAll,
  };
}
