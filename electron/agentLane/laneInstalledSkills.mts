// Skill discovery remains skillStore's job. This adapter consumes its trusted records only.
//
// ── 这个文件为什么是一个「来源」而不是一次「读取」（2026-09-11）──
//
// 一条 lane 会跨很多回合活着，而技能库是用户随时会动的东西：他在 Agent 面板旁边点两下
// 导入一个技能包，或者让 Agent 自己写一个落盘。开 lane 那一刻取一次数组，等于把
// 「这个项目有哪些技能」冻在那一刻——用户报的现象是「刚导入的技能，Agent 说它没有，
// 要关掉项目再打开」（评审：docs/audit/2026-09-11-agent-lane-live-vs-snapshot.md）。
//
// 所以这里出的是 `LaneSkillIndexSource`：**一个回合刷新一次，回合内不变**。
//   · 回合内不变，是因为「模型看到的技能索引」和「read 允许读的技能根」必须是同一份快照——
//     两者各自刷新就会出现「提示词里有这条技能、read 它却越界」这种自相矛盾的一刻。
//   · 回合是最小的刷新粒度，不是每次模型请求：一个回合最多 24 次请求，按请求刷等于把
//     全量重扫乘 24，而且违反「正在跑的那一个回合不会中途改口」（评审裁决 ③）。
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { SkillRecord } from '../skills/skillStore.js';
import { parseSkillFrontmatter } from '../skills/skillFrontmatter.js';
import type { LaneSkillIndexEntry } from '../shared/agentLane/laneContracts.js';
import { laneSkillRequiresCodingTools, loadPiSkillFormatter, renderLaneSkillSection, type PiSkillFormatter } from './laneSkillIndex.mjs';

export async function createLaneInstalledSkills(records: readonly SkillRecord[]): Promise<{
  skills: readonly LaneSkillIndexEntry[];
  trustedSkillRoots: readonly string[];
}> {
  const skills: LaneSkillIndexEntry[] = [];
  const trustedSkillRoots = new Set<string>();
  for (const record of records) {
    if (!path.isAbsolute(record.filePath) || path.basename(record.filePath) !== 'SKILL.md') {
      throw new Error('Installed Skill records require an absolute SKILL.md path.');
    }
    const root = path.dirname(path.resolve(record.filePath));
    // 这份记录是在刚才那一次目录扫描里读到的，校验发生在之后一瞬——用户正好在这中间删掉了
    // 那个技能，于是 lstat 报 ENOENT。**「它已经不在了」不是安全事件，是这一刻它不在索引里**：
    // 跳过这一条，别让整条 lane 的下一个回合失败。其它错误（软链、越出包）照旧抛。
    const stats = await Promise.all([lstat(root), lstat(record.filePath)]).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return undefined;
      throw cause;
    });
    if (!stats) continue;
    const [rootStat, fileStat] = stats;
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error('Installed Skill package roots and SKILL.md must not be symbolic links.');
    }
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(record.filePath);
    if (path.dirname(canonicalFile) !== canonicalRoot) throw new Error('Installed Skill path escaped its package.');
    const children = await readdir(canonicalRoot, { withFileTypes: true });
    skills.push({
      name: record.name,
      description: record.description,
      filePath: canonicalFile,
      disableModelInvocation: record.disableModelInvocation === true,
      requiresCodingTools: laneSkillRequiresCodingTools({
        childDirectoryNames: children.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name),
        frontmatterValues: parseSkillFrontmatter(record.body).values,
      }),
    });
    trustedSkillRoots.add(root);
  }
  return { skills, trustedSkillRoots: [...trustedSkillRoots] };
}

/** 这一刻这条 lane 关于技能的**全部**事实。三样东西同一份快照，不许各刷各的。 */
export interface LaneSkillIndex {
  /** 模型索引（name + description + 绝对路径），正文不在里面。 */
  readonly entries: readonly LaneSkillIndexEntry[];
  /** `read` 允许越出项目去读的只读技能包根。与 `entries` 同源，所以「看得见 = 读得到」。 */
  readonly trustedSkillRoots: readonly string[];
  /** 系统提示词里的 `<available_skills>` 段（pi 的 `formatSkillsForPrompt` 渲染）。空索引 = 空串。 */
  readonly promptSection: string;
}

/**
 * 技能事实的唯一 owner。
 *
 * `current()` 不读盘——它返回上一次 `refresh()` 定下来的那一份，所以同一个回合里
 * 提示词渲染与 `read` 的越界判定看到的是**同一个**索引。`refresh()` 在回合边界调，
 * 记录集没变就连 pi 的渲染都不重跑（指纹里含 `contentHash`，改了技能正文也算变）。
 */
export interface LaneSkillIndexSource {
  current(): LaneSkillIndex;
  refresh(): Promise<LaneSkillIndex>;
}

const EMPTY_INDEX: LaneSkillIndex = Object.freeze({
  entries: Object.freeze([]) as readonly LaneSkillIndexEntry[],
  trustedSkillRoots: Object.freeze([]) as readonly string[],
  promptSection: '',
});

/**
 * 指纹只认「会改变模型看到什么 / 允许读什么」的那几样。`contentHash` 覆盖正文与包内脚本，
 * 所以「技能没变」是真的没变，而不是「名字没变」。
 */
function fingerprint(records: readonly SkillRecord[]): string {
  return records
    .map((record) => [record.filePath, record.name, record.description,
      record.disableModelInvocation === true ? '1' : '0', record.contentHash].join('\u0000'))
    .join('\u0001');
}

export function createLaneSkillIndexSource(
  read: () => readonly SkillRecord[],
  deps: { loadFormatter?: () => Promise<PiSkillFormatter> } = {},
): LaneSkillIndexSource {
  const loadFormatter = deps.loadFormatter ?? loadPiSkillFormatter;
  let index: LaneSkillIndex = EMPTY_INDEX;
  let seen: string | undefined;
  // 渲染器只在真的有技能时才 import 一次。**不能在开 lane 时决定「这条 lane 没有技能所以永远不加载」**：
  // 用户会在半路导入第一个技能，那一刻才需要它。
  let formatter: Promise<PiSkillFormatter> | undefined;
  return {
    current: () => index,
    refresh: async () => {
      const records = read();
      const next = fingerprint(records);
      if (seen === next) return index;
      const { skills, trustedSkillRoots } = await createLaneInstalledSkills(records);
      const promptSection = skills.length > 0
        ? renderLaneSkillSection(await (formatter ??= loadFormatter()), skills)
        : '';
      index = Object.freeze({ entries: skills, trustedSkillRoots, promptSection });
      seen = next;
      return index;
    },
  };
}
