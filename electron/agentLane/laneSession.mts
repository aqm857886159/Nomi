// Agent lane · 会话落盘（pi 的 `JsonlSessionRepo`，不是我们自己的第二份持久化）
//
// **为什么这一整个文件只有几十行**：会话的序列化、追加、恢复、分支、版本迁移全部是 pi 的活
// （R29 登记表 `session-persistence` 那一条）。Nomi 在这里只回答两个问题——
// 「写到哪儿」和「叫什么名字」。
//
// ⚠️ 探针报告 §3.3 实测的那个坑：`sessionsRoot` **不是**最终目录，`JsonlSessionRepo`
// 会在它下面按 `cwd` 生成一层 slug 子目录。如果把宿主的绝对路径当 `cwd` 传进去，
// 用户把项目文件夹改个名，同一个项目就会长出第二个 slug 目录——旧会话还在盘上，
// 但 `list({cwd})` 按新 cwd 一条都查不到，用户看到的是「我的历史没了」。
// 所以这里传一个**稳定的、与宿主路径无关的常量**，slug 就跟着稳定。
import { join } from 'node:path';
import { JsonlSessionRepo, type JsonlSessionMetadata } from '@earendil-works/pi-agent-core/harness/session';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/harness/env/nodejs';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import type { Session } from '@earendil-works/pi-agent-core';

/**
 * 传给 `JsonlSessionRepo` 的 `cwd`。它只用来生成 slug 目录名与 `list()` 的过滤键，
 * **不是文件系统路径**——所以它必须是一个常量，而不是项目的真实位置。
 * 项目已经由 `sessionsRoot`（`<project>/.nomi/agent-sessions`）唯一确定了。
 */
export const LANE_SESSION_CWD = 'nomi-project';

/** 会话根目录。跟着项目走，删项目即删历史——这是本地优先该有的样子。 */
export function laneSessionsRoot(projectDir: string): string {
  return join(projectDir, '.nomi', 'agent-sessions');
}

export interface LaneSessionOpen {
  repo: JsonlSessionRepo
  session: Session<JsonlSessionMetadata>
  sessionId: string
}

/**
 * 打开（或新建）一条 lane 的会话。
 * 给了 `sessionId` 就必须找得到——**找不到就抛**，不静默新建一条。
 * 静默新建的后果是用户点进一条历史对话、看到一片空白，而系统认为一切正常。
 */
export async function openLaneSession(
  options: { projectDir: string; sessionId?: string }, context: Context,
): Promise<LaneSessionOpen> {
  const fileSystem = new NodeExecutionEnv({ cwd: options.projectDir });
  const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: laneSessionsRoot(options.projectDir) });
  if (options.sessionId === undefined) {
    const session = await repo.create({ cwd: LANE_SESSION_CWD }, context);
    return { repo, session, sessionId: session.metadata.id };
  }
  const known = await repo.list({ cwd: LANE_SESSION_CWD }, context);
  const metadata = known.find((candidate) => candidate.id === options.sessionId);
  if (!metadata) {
    throw new Error(`Nomi lane session ${options.sessionId} is not on disk under ${laneSessionsRoot(options.projectDir)}`);
  }
  const session = await repo.open(metadata, context);
  return { repo, session, sessionId: metadata.id };
}
