// Agent lane · 会话落盘（pi 的 `JsonlSessionRepo`，不是我们自己的第二份持久化）
//
// **为什么这一整个文件只有百来行**：会话的序列化、追加、恢复、分支、版本迁移全部是 pi 的活
// （R29 登记表 `session-persistence` 那一条）。Nomi 在这里只回答三个问题——
// 「写到哪儿」「叫什么名字」「谁在持有它」。
//
// ⚠️ 探针报告 §3.3 实测的那个坑：`sessionsRoot` **不是**最终目录，`JsonlSessionRepo`
// 会在它下面按 `cwd` 生成一层 slug 子目录。如果把宿主的绝对路径当 `cwd` 传进去，
// 用户把项目文件夹改个名，同一个项目就会长出第二个 slug 目录——旧会话还在盘上，
// 但 `list({cwd})` 按新 cwd 一条都查不到，用户看到的是「我的历史没了」。
// 所以这里传一个**稳定的、与宿主路径无关的常量**，slug 就跟着稳定。
import { join } from 'node:path';
import { JsonlSessionRepo, type JsonlSessionMetadata } from '@earendil-works/pi-agent-core/harness/session';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import type { Session } from '@earendil-works/pi-agent-core';
import { createLaneFileSystem, ensureLaneSessionsRoot } from './laneFileSystem.mjs';

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

/**
 * 一个项目 = 一个 `JsonlSessionRepo` 实例，**进程内共享**。
 *
 * 这不是缓存优化，是一条正确性不变量。上游 [#8852](https://github.com/earendil-works/pi/issues/8852)：
 * **同一个进程里把同一条 JSONL 会话打开两次，会写出重复的 `seq` 并把文件写坏。**
 * pi 自己挡住了这件事——`JsonlSessionRepo` 里有一张 `openSessions` 表，重复 `open()`
 * 直接抛「Session is already open」（`session/jsonl/repo.js:86-87`）。
 *
 * 但那张表是**每个 repo 实例一份的**。每次开 lane 都 `new JsonlSessionRepo(...)`，
 * 等于给每个打开者发一张只有自己的名单，pi 的这道防线就被绕过去了——而 Nomi 是
 * Electron 多窗口：一个项目被两个窗口打开是**日常操作**，不是边缘情况。
 *
 * 所以正确的修法不是我们再写一把锁（那是 R28 说的「自研一份框架已有的能力」，
 * 而且 `check:framework-boundary` 已经把 `electron/agentLane/` 划进 `session-persistence`
 * 的 scope，写了当场红），而是**让 pi 的名单只有一张**。
 */
const openRepos = new Map<string, { repo: JsonlSessionRepo; holders: number }>();

async function acquireRepo(projectDir: string): Promise<JsonlSessionRepo> {
  const root = laneSessionsRoot(projectDir);
  const existing = openRepos.get(root);
  if (existing) {
    existing.holders += 1;
    return existing.repo;
  }
  await ensureLaneSessionsRoot(root);
  const repo = new JsonlSessionRepo({ fileSystem: createLaneFileSystem(projectDir), sessionsRoot: root });
  openRepos.set(root, { repo, holders: 1 });
  return repo;
}

async function releaseRepo(projectDir: string, context: Context): Promise<void> {
  const root = laneSessionsRoot(projectDir);
  const holder = openRepos.get(root);
  if (!holder) return;
  holder.holders -= 1;
  if (holder.holders > 0) return;
  openRepos.delete(root);
  await holder.repo.close(context);
}

export interface LaneSessionOpen {
  session: Session<JsonlSessionMetadata>
  sessionId: string
  /** 交还这个项目的 repo 持有权。最后一个持有者走了才真的关。 */
  release(context: Context): Promise<void>
}

/**
 * 打开（或新建）一条 lane 的会话。
 * 给了 `sessionId` 就必须找得到——**找不到就抛**，不静默新建一条。
 * 静默新建的后果是用户点进一条历史对话、看到一片空白，而系统认为一切正常。
 */
export async function openLaneSession(
  options: { projectDir: string; sessionId?: string }, context: Context,
): Promise<LaneSessionOpen> {
  const repo = await acquireRepo(options.projectDir);
  const release = (releaseContext: Context) => releaseRepo(options.projectDir, releaseContext);
  try {
    if (options.sessionId === undefined) {
      const session = await repo.create({ cwd: LANE_SESSION_CWD }, context);
      return { session, sessionId: session.metadata.id, release };
    }
    const known = await repo.list({ cwd: LANE_SESSION_CWD }, context);
    const metadata = known.find((candidate) => candidate.id === options.sessionId);
    if (!metadata) {
      throw new Error(`Nomi lane session ${options.sessionId} is not on disk under ${laneSessionsRoot(options.projectDir)}`);
    }
    const session = await repo.open(metadata, context);
    return { session, sessionId: metadata.id, release };
  } catch (cause) {
    await release(context);
    // pi 的那句「Session is already open」是对的，但它说不出**为什么这件事致命**。
    // 补一句，因为读到它的人下一步要判断的是「换个窗口打开」还是「文件坏了」。
    if (cause instanceof Error && /already open/i.test(cause.message)) {
      throw new Error(
        `Nomi lane session ${options.sessionId} already has an owner in this process. `
        + 'One session has exactly one owner: opening the same JSONL twice writes duplicate seq numbers '
        + 'and corrupts the transcript (upstream pi #8852).',
        { cause },
      );
    }
    throw cause;
  }
}
