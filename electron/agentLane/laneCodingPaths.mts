// Nomi supplies trusted package roots; model paths never add authority.
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

export class LaneCodingPathError extends Error {
  constructor(attempted: string, projectDir: string) {
    super(`${attempted} is outside this project or its permitted read-only Skill packages. `
      + `Writes must remain under ${projectDir}. Use a path relative to the project root, `
      + 'or read a Skill at the exact installed location listed in available_skills.');
    this.name = 'LaneCodingPathError';
  }
}

function within(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function containPath(absolutePath: string, projectDir: string): string {
  const target = path.resolve(absolutePath);
  if (!within(target, path.resolve(projectDir))) throw new LaneCodingPathError(absolutePath, projectDir);
  return target;
}

/** Resolve missing write targets through the nearest existing parent, including mkdir's nested parents. */
async function canonicalTarget(target: string, missing: boolean): Promise<string> {
  try { return await realpath(target); } catch (cause) {
    if (!missing || (cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    const entry = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    // ENOENT is also returned for an existing symlink whose destination is missing. Treating
    // that link as a new ordinary file would let writeFile follow it outside the pinned root.
    if (entry?.isSymbolicLink()) throw new Error('Cannot write through a dangling symbolic link.', { cause });
    const parent = path.dirname(target);
    if (parent === target) throw cause;
    return path.join(await canonicalTarget(parent, true), path.basename(target));
  }
}

/**
 * 可信技能包根：**可以给一个来源，不必给一份快照**（与 `OpenLaneOptions` 上 `tasks` / `systemPrompt`
 * 同一条纪律）。理由是用户会在会话中途导入技能：那一刻模型的索引里多了一条，而
 * `read` 允许越出项目的根如果还是开 lane 时那一份，就会出现「提示词里有这条技能、读它却越界」。
 * 索引与根来自同一个 `LaneSkillIndexSource`，所以「看得见 = 读得到」是结构事实。
 */
export type LaneTrustedSkillRoots = readonly string[] | (() => readonly string[])

export async function createLaneCodingPaths(projectDir: string, trustedSkillRoots: LaneTrustedSkillRoots = []) {
  const pin = async (root: string) => {
    if (!path.isAbsolute(root)) throw new Error('Coding roots must be trusted absolute paths.');
    // 一个根本身就是软链，等于把它指向的任何地方变成可读区。索引层已经拒过一次
    // （`laneInstalledSkills.mts`），这里再拒一次：这是判越界的那一层，它不该依赖上游记得校验。
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Coding roots must not be symbolic links.');
    return { lexical: path.resolve(root), canonical: await realpath(root) };
  };
  const project = await pin(projectDir);
  const listRoots = () => [...new Set(typeof trustedSkillRoots === 'function' ? trustedSkillRoots() : trustedSkillRoots)].sort();
  /**
   * **每个根只 canonicalize 一次，就在它第一次出现的那一刻。**
   *
   * 两条性质要同时成立，它们看起来打架但并不：
   *   · 根的**集合**是活的——用户中途导入一个技能，新根下一个回合就该可读；
   *   · 已经认下的那个根**不许重新解析**——把一个已信任的目录换成指向别处的软链，
   *     不该让它悄悄变成一块新的可读区（`lane-native-paths` 里那条「装配之后被换成软链」的用例）。
   * 所以这里是一张 `lexical → pinned` 的表：表里有的直接用，表里没有的现在 pin 一次，
   * 不在当前名单里的移出去。realpath 只为真正新出现的根付一次。
   */
  const pinned = new Map<string, Awaited<ReturnType<typeof pin>>>();
  const pinRoot = async (root: string) => {
    // 一个刚被删掉的技能根解析不出来。它不是越权信号，是「它不在了」——把它从名单里去掉，
    // 而不是让这条 lane 之后每一次 read 都炸。
    try { pinned.set(root, await pin(root)); } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
  };
  // 装配期的那一批立刻 pin：晚一步 pin 就等于把「装配之后再换软链」这条路留着。
  for (const root of listRoots()) await pinRoot(path.resolve(root));
  const skillRoots = async () => {
    const roots = listRoots().map((root) => path.resolve(root));
    const current = new Set(roots);
    for (const key of [...pinned.keys()]) if (!current.has(key)) pinned.delete(key);
    for (const root of roots) if (!pinned.has(root)) await pinRoot(root);
    return roots.flatMap((root) => { const entry = pinned.get(root); return entry ? [entry] : []; });
  };
  const check = async (targetPath: string, writing: boolean, missing = false, skillsOnly = false): Promise<string> => {
    const target = path.resolve(targetPath);
    const skills = await skillRoots();
    const allowed = writing ? [project] : skillsOnly ? skills : [project, ...skills];
    // Canonical aliases (e.g. /var -> /private/var) remain usable after pi resolves a previous path.
    const roots = allowed.filter((root) => within(target, root.lexical) || within(target, root.canonical));
    if (!roots.length) throw new LaneCodingPathError(targetPath, project.lexical);
    const canonical = await canonicalTarget(target, missing);
    if (writing && skills.some((root) => within(canonical, root.canonical))) {
      throw new LaneCodingPathError(targetPath, project.lexical);
    }
    if (!roots.some((root) => within(canonical, root.canonical))) {
      throw new LaneCodingPathError(targetPath, project.lexical);
    }
    return canonical;
  };
  return {
    read: (target: string) => check(target, false),
    readSkill: (target: string) => check(target, false, false, true),
    write: (target: string) => check(target, true, true),
    readExists: async (target: string) => {
      try { await check(target, false); return true; } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw cause;
      }
    },
  };
}
