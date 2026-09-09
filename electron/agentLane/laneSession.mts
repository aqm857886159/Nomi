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
import { join, relative, sep } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { laneTraceDirectory, writeLaneTrace, writeTraceFile, type LaneTraceTurn } from './laneTrace.mjs';
import { refreshLiveLaneTrace } from './laneTraceRecorder.mjs';
import { JsonlSessionRepo, type JsonlSessionMetadata } from '@earendil-works/pi-agent-core/harness/session';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import type { Session } from '@earendil-works/pi-agent-core';
import { createLaneFileSystem, ensureLaneSessionsRoot } from './laneFileSystem.mjs';

/**
 * 一条对话的 `cwd`。它只用来生成 slug 目录名与 `list()` 的过滤键，**不是文件系统路径**。
 *
 * 三件事一起写在这一个函数里，因为它们是同一个决定的三面：
 *
 * ① **必须是绝对路径。** `JsonlSessionRepo` 把 cwd 交给 `FileSystem.absolutePath()`
 *    （`repo.js:180`），而我们的 `NodeExecutionEnv` 的 cwd 就是项目目录——传相对串
 *    `'nomi-project'` 会被解析成 `<项目绝对路径>/nomi-project`，slug 目录名里于是带着
 *    项目的完整路径。用户把项目文件夹改个名，`list()` 按新路径算出的 slug 就对不上盘上
 *    那个旧的，历史「消失」——而这正是本文件开头那段注释想避免的事。绝对串原样穿过
 *    `path.resolve`，与宿主路径无关。
 * ② **一条对话一个 cwd。** 「一个项目多条对话」= 多个 `laneName`，每条自己一个 slug 目录
 *    （方案 §2.2 G2）。列表 = `repo.list()` 走一遍目录读表头；删除 = `repo.delete()`。
 *    两样都是 pi 自己的能力，我们不另记一份对话索引（R29：框架给的不许再造一份）。
 * ③ **laneName 的字符集由 `laneCommandCodec` 守。** 走到这里的名字已经不含 `/`、`\`、`:`，
 *    所以 pi 的 slug 编码（把这三个字符换成 `-`）不会把两条不同的对话折成同一个目录。
 */
export function laneSessionCwd(laneName: string): string {
  return `/nomi-lane/${laneName}`;
}

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

/** 盘上一条对话。`laneName` 从 `cwd` 反解出来——真相是文件表头，不是我们另记的索引。 */
export interface LaneSessionSummary {
  laneName: string
  sessionId: string
  createdAt: number
  updatedAt: number
}

const CWD_PREFIX = '/nomi-lane/';

/**
 * 这个项目盘上有哪些对话，最近更新的在前。
 *
 * 不带 `cwd` 的 `repo.list()` 会走遍 sessionsRoot 下每个 slug 目录、只读每个文件的**表头**
 * （`repo.js:listDirectory` → `readTextLines({maxLines:1})`），所以列一百条对话读的是一百行，
 * 不是一百份转录。这就是不另建索引文件的底气：索引会和真相分叉，表头不会。
 *
 * 一条 lane 理论上只该有一个会话（`openLaneSession` 按 lane 复用）。真出现两个（比如
 * 一次崩溃留下的半截文件），取**最新**的那个并把旧的留在盘上——静默删掉用户的转录，
 * 比多留一个文件危险得多。
 */
export async function listLaneSessions(projectDir: string, context: Context): Promise<LaneSessionSummary[]> {
  const repo = await acquireRepo(projectDir);
  try {
    const all = await repo.list(undefined, context);
    const byLane = new Map<string, LaneSessionSummary>();
    for (const metadata of all) {
      if (!metadata.cwd.startsWith(CWD_PREFIX)) continue;
      const laneName = metadata.cwd.slice(CWD_PREFIX.length);
      if (!laneName) continue;
      const summary: LaneSessionSummary = {
        laneName, sessionId: metadata.id, createdAt: metadata.createdAt, updatedAt: metadata.modifiedAt,
      };
      const existing = byLane.get(laneName);
      if (!existing || existing.createdAt < summary.createdAt) byLane.set(laneName, summary);
    }
    return [...byLane.values()].sort((left, right) => right.updatedAt - left.updatedAt
      || left.laneName.localeCompare(right.laneName));
  } finally {
    await releaseRepo(projectDir, context);
  }
}

/**
 * 删掉一条对话的落盘转录。**这一条只删这一条 lane 的文件**，不碰目录里别的东西。
 *
 * pi 的 `repo.delete()` 对一条**还开着**的会话直接抛（`repo.js:113`）——那正是我们要的：
 * 删一条正在写的对话会留下一个半截文件，而调用方本来就该先切走再删。
 */
export async function deleteLaneSession(projectDir: string, laneName: string, context: Context): Promise<boolean> {
  const repo = await acquireRepo(projectDir);
  try {
    const cwd = laneSessionCwd(laneName);
    const known = await repo.list({ cwd }, context);
    if (known.length === 0) return false;
    for (const metadata of known) {
      await repo.delete(metadata, context);
      await rm(laneTraceDirectory(metadata), { recursive: true, force: true });
    }
    return true;
  } finally {
    await releaseRepo(projectDir, context);
  }
}

/**
 * 打开（或新建）一条 lane 的会话。
 *
 * · 给了 `sessionId` 就必须找得到——**找不到就抛**，不静默新建一条。
 *   静默新建的后果是用户点进一条历史对话、看到一片空白，而系统认为一切正常。
 * · 没给 `sessionId`：这条 lane 盘上已经有会话就**接着它**，没有才新建。
 *   「按名字打开同一条对话」是多 lane 的全部意义——每次开都新建的话，
 *   对话列表里同一个名字会长出一串空壳，而用户以为他点开的是昨天那条。
 */
export async function openLaneSession(
  options: { projectDir: string; laneName?: string; sessionId?: string; createSessionId?: string }, context: Context,
): Promise<LaneSessionOpen> {
  const repo = await acquireRepo(options.projectDir);
  const release = (releaseContext: Context) => releaseRepo(options.projectDir, releaseContext);
  const cwd = laneSessionCwd(options.laneName ?? 'main');
  try {
    const known = await repo.list({ cwd }, context);
    if (options.createSessionId !== undefined) {
      if (options.sessionId !== undefined || known.length > 1
        || (known.length === 1 && known[0].id !== options.createSessionId)) throw new Error('legacy-target-session-conflict');
      const session = known[0] ? await repo.open(known[0], context)
        : await repo.create({ cwd, id: options.createSessionId }, context);
      return { session, sessionId: session.metadata.id, release };
    }
    if (options.sessionId === undefined) {
      // 同一条 lane 下有多份时取最新的那份（见 `listLaneSessions` 的同一条裁决）。
      const newest = known.reduce<JsonlSessionMetadata | undefined>(
        (best, candidate) => (best && best.createdAt >= candidate.createdAt ? best : candidate), undefined);
      const session = newest ? await repo.open(newest, context) : await repo.create({ cwd }, context);
      return { session, sessionId: session.metadata.id, release };
    }
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
        `Nomi lane session ${options.sessionId ?? `"${options.laneName ?? 'main'}"`} already has an owner in this process. `
        + 'One session has exactly one owner: opening the same JSONL twice writes duplicate seq numbers '
        + 'and corrupts the transcript (upstream pi #8852).',
        { cause },
      );
    }
    throw cause;
  }
}

/** Resolve from pi metadata, never from a renderer-supplied filesystem path. */
export async function openLaneTraceDirectory(projectDir: string, laneName?: string): Promise<string> {
  const context = BACKGROUND_CONTEXT;
  const repo = await acquireRepo(projectDir);
  try {
    const all = await repo.list(laneName === undefined ? undefined : { cwd: laneSessionCwd(laneName) }, context);
    const known = all.filter(item => item.cwd.startsWith(CWD_PREFIX));
    if (laneName !== undefined && !known.length) throw new Error('Agent conversation not found');
    const summaries: string[] = [];
    let selected: { createdAt: number; directory: string } | undefined;
    for (const metadata of known) {
      let directory = await refreshLiveLaneTrace(metadata.path);
      if (!directory) {
        const session = await repo.open(metadata, context);
        try { directory = await writeLaneTrace(session); }
        finally { await session.close(context); }
      }
      const rows = (await readFile(join(directory, 'trace.jsonl'), 'utf8')).trim().split('\n').filter(Boolean)
        .map(line => JSON.parse(line) as LaneTraceTurn);
      const total = rows.every(row => row.estimatedCostUsd !== null)
        ? rows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0) : null;
      const link = relative(laneSessionsRoot(projectDir), join(directory, 'trace.md')).split(sep).map(encodeURIComponent).join('/');
      summaries.push(`- [${metadata.id}](${link}) · ${rows.length} turns · estimated USD ${total ?? 'unknown'}`);
      if (!selected || metadata.createdAt > selected.createdAt) selected = { createdAt: metadata.createdAt, directory };
    }
    if (laneName !== undefined) return selected!.directory;
    const root = laneSessionsRoot(projectDir);
    await writeTraceFile(root, 'index.md', ['# Agent traces', '', 'Local pi sessions · costs are estimates, not a bill.', '', ...summaries, ''].join('\n'));
    return root;
  } finally { await releaseRepo(projectDir, context); }
}
