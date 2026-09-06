// Agent lane 的测试夹具：一个真 HTTP 端点 + 一个真项目目录 + 真 `document` 端口。
//
// 只有**远端模型**是假的（复用 `httpFixture.mts` 那个真 HTTP 服务器）。pi 的循环、
// 会话落盘、工具校验、闸全部是真的跑——把它们也 mock 掉，这套测试就只能证明
// 「我写的 mock 和我写的断言一致」。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import { createDocumentLaneTools, type DocumentLanePort } from '../../electron/agentLane/laneDocumentTools.js';
import type { LaneToolGateDecision, LaneToolGateRequest, OpenLaneOptions } from '../../electron/agentLane/laneRuntimePort.js';
import type { DocumentWriteInput, DocumentWriteResult } from '../../electron/shared/agentCapabilities/documentWrite.js';
import { createHttpFixture, type FixtureReply } from './httpFixture.mjs';

export const LANE_SYSTEM_PROMPT = 'NOMI_LANE_SYSTEM';

/** 一个最小但**真**的文稿端口：写进去的东西读得回来，revision 会涨。 */
export function createDocumentPort(initial = 'The opening scene.'): DocumentLanePort & { text(): string } {
  let text = initial;
  let selection = '';
  let revision = 0;
  return {
    text: () => text,
    read: async (scope) => (scope === 'full' ? { text } : { text: selection }),
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
  options: OpenLaneOptions;
  projectDir: string;
  document: ReturnType<typeof createDocumentPort>;
  gateCalls: LaneToolGateRequest[];
  http: Awaited<ReturnType<typeof createHttpFixture>>;
}

export async function createLaneFixture(
  t: TestContext,
  replies: FixtureReply[],
  gate?: (request: LaneToolGateRequest) => LaneToolGateDecision,
): Promise<LaneFixture> {
  const projectDir = await mkdtemp(join(tmpdir(), 'nomi-lane-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  const http = await createHttpFixture(replies);
  t.after(http.close);
  const document = createDocumentPort();
  const gateCalls: LaneToolGateRequest[] = [];
  const options: OpenLaneOptions = {
    projectDir,
    systemPrompt: LANE_SYSTEM_PROMPT,
    model: {
      kind: 'openai-compatible', providerId: 'nomi-lane', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key',
    },
    tools: createDocumentLaneTools(document),
    ...(gate ? { gate: (request: LaneToolGateRequest) => { gateCalls.push(request); return gate(request); } } : {}),
  };
  return { options, projectDir, document, gateCalls, http };
}
