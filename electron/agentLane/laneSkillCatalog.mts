// 技能目录（catalog）的唯一 owner：**发现与解析交给 pi，Nomi 只做投影与策略。**
//
// ── 它在解决哪个真实摩擦（D6 ①）──
//
// 用户拿到一个以 `my-skill.md` 形式分发的技能，放进技能目录：pi / Claude Code 直接认，Nomi 报错——
// 因为我们自己写了一份「只认 `root/<dir>/SKILL.md`」的遍历器（`skillStore.ts` 旧 `discoverSkillRecordsFromRoots`），
// 而 lane 那一侧又有一份「`basename === 'SKILL.md'` 否则抛」的校验（旧 `laneInstalledSkills.mts:29`）。
// 两份自研加载器，两处各自比生态窄一点。2026-09-07 我们已经拿 pi 的加载器当「别的宿主能不能读」的判官
// （`check:skills-format` F6）；判官读得到的技能，我们没有理由读不到。
//
// 2026-09-18 用户拍板：「一定要迁移，不能留我们那个废物。」
//
// ── pi 给的（0.85.1）──
//   `loadSourcedSkills(env, [{path, source}], mapSkill, context)`：递归遍历、`SKILL.md` 或根目录下带 frontmatter 的
//   `.md`、认 ignore 文件、`SkillDiagnostic` 只 warning 不失败（name 不匹配目录 / 超长 / 非 kebab 都只是 warning，
//   description 缺失才不加载）。`Skill.content` 已去 frontmatter。
//
// ── Nomi 留下的（pi 不管的）──
//   多根优先级（内置先于用户目录，同名先到先得，输家记诊断）、`metadata.nomi` 扩展块与策展块、内容寻址
//   （`contentHash`）、受众（用户导入的一律 internal）、可信读根的软链纪律、损坏包不许占坑、
//   存量 `skill.json` 的一次性迁移、「这条技能要不要 coding 工具」。每一条都在
//   `docs/plan/2026-09-18-skill-loading-migration.md` §2 有出处与断言。
//
// ── 为什么住在岛上 ──
//   pi 是 ESM-only，主进程是 CommonJS；凡直接摸 pi 的文件都住这个 NodeNext 岛（`tsconfig.pi.json`）。
//   CJS 侧的 `readSkillRecords()` 经 `laneNativeLoader.cts` 那座桥拿到这里的实现。`SkillRecord` 类型仍留在
//   `electron/skills/skillStore.ts`（中立于岛的 CJS 类型，岛只 `import type` 它），所以 CJS 工程看不见岛地。
import { watch, type FSWatcher } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { loadSourcedSkills, type Skill } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
// pi-coding-agent 也导出一个叫 `Skill` 的类型，**形状与 pi-agent-core 的不同**
// （这个有 baseDir/sourceInfo 没有 content，那个相反）。带别名引用，不再手抄。
import type { Skill as PiCodingAgentSkill, formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/harness/env/nodejs';

import type { LaneSkillIndexEntry } from '../shared/agentLane/laneContracts.js';
import { readSkillCuration } from '../shared/skillCuration.js';
import { frontmatterString, parseSkillFrontmatter } from '../skills/skillFrontmatter.js';
import { migrateLegacySkillManifest } from '../skills/skillManifestMigration.js';
import { readSkillManifest } from '../skills/skillManifestSchema.js';
import { computeSkillContentHash, readSkillPackageFiles, SKILL_PACKAGE_VERSION } from '../skills/skillPackage.js';
import {
  getSkillDiscoveryRoots,
  type SkillDiscoveryDiagnostic,
  type SkillDiscoveryResult,
  type SkillDiscoveryRoot,
  type SkillRecord,
} from '../skills/skillStore.js';
import { LANE_CODING_TOOL_NAMES } from './laneCodingTools.mjs';
import type { LaneCodingUnlockReason } from './laneToolGroups.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// 发现：pi 的 loadSourcedSkills → Nomi 的 SkillRecord
// ─────────────────────────────────────────────────────────────────────────────

/** 技能包里被认作「可执行区」的目录名。与 `skillPackage.ts` 同一份语义。 */
const SKILL_EXECUTABLE_DIR_NAMES: ReadonlySet<string> = new Set(['scripts', 'bin', 'hooks']);

/**
 * 这个技能要不要 coding 工具。**两条来源，任一即真**：
 *   ① 盘上真的有可执行区——技能作者写了脚本，它就是要跑的；
 *   ② frontmatter 里 `tools:` 声明了 `coding`——技能不带脚本，但正文会让模型去写/跑东西。
 *
 * 为什么不只看 ②：既有技能一条都没写 `tools:`，而它们中有几条是带 `scripts/` 的。只认声明 = 那几条永远
 * 解锁不了，症状是「模型说它要跑 selftest，然后说它没有工具」——一句用户完全看不懂的话。
 * 这是 Nomi 的工具预算策略（`laneToolGroups`），pi 没有这个概念。
 */
export function laneSkillRequiresCodingTools(input: {
  readonly childDirectoryNames?: readonly string[]
  readonly frontmatterValues?: Readonly<Record<string, unknown>>
}): boolean {
  for (const name of input.childDirectoryNames ?? []) {
    if (SKILL_EXECUTABLE_DIR_NAMES.has(name.trim().toLowerCase())) return true;
  }
  const declared = input.frontmatterValues?.['tools'];
  const declaredList = typeof declared === 'string'
    ? declared.split(',')
    : Array.isArray(declared) ? declared : [];
  return declaredList.some((value) => {
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'coding' || (LANE_CODING_TOOL_NAMES as readonly string[]).includes(normalized);
  });
}

/** 根目录下直接的 `<stem>.md` 也是技能（pi 的规则）。它的包就是那一个文件，句柄是文件名去掉 `.md`。 */
export function isLooseSkillFile(filePath: string): boolean {
  return path.basename(filePath) !== 'SKILL.md';
}

function skillHandle(filePath: string): string {
  return isLooseSkillFile(filePath)
    ? path.basename(filePath).replace(/\.md$/i, '')
    : path.basename(path.dirname(filePath));
}

async function isSymbolicLink(target: string): Promise<boolean> {
  return (await lstat(target)).isSymbolicLink();
}

/**
 * Windows 记事本写的 SKILL.md 带 UTF-8 BOM。pi-agent-core 的 `loadSkills` 不剥它：文件不再以 `---` 开头，
 * frontmatter 整个读成空、description 缺失、技能被丢掉——而 pi-coding-agent 自己的加载器（`stripBom`）
 * 和我们 2026-09-07 起的 `parseSkillFrontmatter` 都剥。这是 pi 两层之间的缝，不是新造一份加载器：
 * 只在 `readTextFile` 这一处把 BOM 去掉，遍历 / ignore / 解析 / 诊断全部照旧是 pi 的（S14）。
 */
class BomTolerantExecutionEnv extends NodeExecutionEnv {
  override async readTextFile(...args: Parameters<NodeExecutionEnv['readTextFile']>): ReturnType<NodeExecutionEnv['readTextFile']> {
    const result = await super.readTextFile(...args);
    return result.ok && result.value.charCodeAt(0) === 0xfeff ? { ...result, value: result.value.slice(1) } : result;
  }
}

/**
 * 存量 `skill.json` 的一次性迁移，只碰用户目录（`skillManifestMigration.ts` 头注释）。
 * 必须跑在 pi 读盘**之前**：迁移会重写 SKILL.md。失败不阻断加载，只记一条诊断。
 */
async function migrateLegacyManifests(root: SkillDiscoveryRoot, diagnostics: SkillDiscoveryDiagnostic[]): Promise<void> {
  if (root.origin !== 'user') return;
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(root.path, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(root.path, entry.name);
    const migration = migrateLegacySkillManifest(skillDir);
    if (migration.message) {
      diagnostics.push({ type: migration.migrated ? 'warning' : 'error', code: 'legacy_manifest', message: migration.message, path: skillDir });
    }
  }
}

type TrackedSkillPath = {
  readonly path: string;
  readonly stat: string;
};

type TrackedSkillRoot = {
  readonly root: SkillDiscoveryRoot;
  readonly rootStat: string;
  readonly shallowVerify: boolean;
  readonly rootEntries: readonly string[];
  readonly watchedFiles: readonly TrackedSkillPath[];
  watcher: FSWatcher | null;
};

type CachedSkillDiscovery = {
  dirty: boolean;
  readonly roots: readonly TrackedSkillRoot[];
  readonly result: SkillDiscoveryResult;
};

const MAX_SKILL_DISCOVERY_CACHE_ENTRIES = 16;
const SHALLOW_VERIFY_SKILL_LIMIT = 16;
const skillDiscoveryCache = new Map<string, CachedSkillDiscovery>();

async function lstatSignature(target: string): Promise<string> {
  try {
    const st = await lstat(target, { bigint: true });
    return `${st.ino}:${st.mode}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code ? `ERR:${code}` : 'ERR';
  }
}

async function readSortedEntryNames(rootPath: string): Promise<readonly string[]> {
  try {
    const names = await readdir(rootPath);
    names.sort();
    return names;
  } catch {
    return [];
  }
}

function attachRecursiveWatcher(rootPath: string, onDirty: () => void): FSWatcher | null {
  try {
    const watcher = watch(rootPath, { recursive: true }, () => { onDirty(); });
    watcher.on('error', () => { onDirty(); });
    watcher.unref();
    return watcher;
  } catch {
    return null;
  }
}

function disposeCachedDiscovery(entry: CachedSkillDiscovery | undefined): void {
  if (!entry) return;
  for (const root of entry.roots) {
    if (!root.watcher) continue;
    try { root.watcher.close(); } catch { /* ignore */ }
    root.watcher = null;
  }
}

let exitCleanupRegistered = false;
function ensureExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.once('exit', () => {
    for (const entry of skillDiscoveryCache.values()) disposeCachedDiscovery(entry);
    skillDiscoveryCache.clear();
  });
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function isSkillDiscoveryCacheFresh(cached: CachedSkillDiscovery): Promise<boolean> {
  if (cached.dirty) return false;
  for (const tracked of cached.roots) {
    const currentRootStat = await lstatSignature(tracked.root.path);
    if (currentRootStat !== tracked.rootStat) return false;
    if (!tracked.shallowVerify) continue;
    const currentEntries = currentRootStat.startsWith('ERR:')
      ? []
      : await readSortedEntryNames(tracked.root.path);
    if (!arrayEqual(currentEntries, tracked.rootEntries)) return false;
    for (const watched of tracked.watchedFiles) {
      if ((await lstatSignature(watched.path)) !== watched.stat) return false;
    }
  }
  return !cached.dirty;
}

async function buildTrackedSkillRoot(
  root: SkillDiscoveryRoot,
  records: readonly SkillRecord[],
  onDirty: () => void,
): Promise<TrackedSkillRoot> {
  const rootStat = await lstatSignature(root.path);
  const exists = !rootStat.startsWith('ERR:');
  const watcher = exists ? attachRecursiveWatcher(root.path, onDirty) : null;
  const prefix = `${root.path}${path.sep}`;
  const matching = records.filter((record) => record.filePath.startsWith(prefix) || record.packageDir === root.path);
  const shallowVerify = root.origin === 'user' || matching.length <= SHALLOW_VERIFY_SKILL_LIMIT || !watcher;
  const rootEntries = shallowVerify && exists ? await readSortedEntryNames(root.path) : [];
  const watchedFiles: TrackedSkillPath[] = [];
  if (shallowVerify && matching.length > 0) {
    const seenPaths = new Set<string>();
    for (const record of matching) {
      for (const candidate of [record.filePath, record.packageDir]) {
        if (candidate === root.path || seenPaths.has(candidate)) continue;
        seenPaths.add(candidate);
        watchedFiles.push({ path: candidate, stat: await lstatSignature(candidate) });
      }
    }
  }
  return { root, rootStat, shallowVerify, rootEntries, watchedFiles, watcher };
}

/**
 * 全部根 → `SkillRecord[]`。**发现交给 pi**；这里只做 Nomi 的投影与策略，每一条都对应 §2 里的一行。
 *
 * 目录树未变更时复用上次索引（`fs.watch({ recursive: true })` 脏位 + 根目录/用户技能轻量 `lstat` 复核）：
 * 避免每条消息在回合边界两次 `refresh()` 触发上千次盘扫描与双重 YAML 解析；新增技能、改 frontmatter、
 * 删技能或替换软链在下一次调用立刻失效重扫。
 */
export async function discoverSkillRecords(roots: readonly SkillDiscoveryRoot[]): Promise<SkillDiscoveryResult> {
  const normalizedRoots = roots
    .filter((root) => typeof root?.path === 'string' && path.isAbsolute(root.path))
    .map((root) => ({ path: path.resolve(root.path), origin: root.origin === 'user' ? 'user' as const : 'builtin' as const }));
  const cacheKey = normalizedRoots.map((root) => `${root.origin}:${root.path}`).join('\u0000');
  const existing = skillDiscoveryCache.get(cacheKey);
  if (existing && await isSkillDiscoveryCacheFresh(existing)) {
    return { records: [...existing.result.records], diagnostics: [...existing.result.diagnostics] };
  }
  if (existing) {
    disposeCachedDiscovery(existing);
    skillDiscoveryCache.delete(cacheKey);
  }

  const records: SkillRecord[] = [];
  const diagnostics: SkillDiscoveryDiagnostic[] = [];
  for (const root of normalizedRoots) await migrateLegacyManifests(root, diagnostics);

  // pi 的 env：cwd 无关紧要（根全是绝对路径），沿用 laneFileSystem 同一个 NodeExecutionEnv，不自己写 FileSystem。
  const env = new BomTolerantExecutionEnv({ cwd: normalizedRoots[0]?.path ?? process.cwd() });
  const loaded = await loadSourcedSkills<SkillDiscoveryRoot>(
    env,
    normalizedRoots.map((root) => ({ path: root.path, source: root })),
    undefined,
    BACKGROUND_CONTEXT,
  );
  for (const diagnostic of loaded.diagnostics) {
    diagnostics.push({ type: 'warning', code: diagnostic.code, message: diagnostic.message, path: diagnostic.path });
  }

  // 多根优先级：先出现的根赢（内置在前、用户目录在末，`runtimePaths.getSkillsRoots`），同名输家记诊断——
  // 与 pi-coding-agent 自己的 `loadSkills(options)` 同一规则（collision，winner=first）。
  // 键按 NFC 小写：大小写不敏感的文件系统上 `Foo/` 与 `foo/` 是同一个目录。
  const seen = new Map<string, string>();
  for (const { skill, source } of loaded.skills) {
    const record = await projectSkill(skill, source, diagnostics);
    if (!record) continue;
    const key = record.directoryName.normalize('NFC').toLowerCase();
    const winner = seen.get(key);
    if (winner) {
      diagnostics.push({ type: 'warning', code: 'shadowed', message: `Skill "${record.directoryName}" is shadowed by ${winner}`, path: record.filePath });
      continue;
    }
    seen.set(key, record.filePath);
    records.push(record);
  }
  const result: SkillDiscoveryResult = { records, diagnostics };
  if (normalizedRoots.length > 0) {
    ensureExitCleanup();
    if (skillDiscoveryCache.size >= MAX_SKILL_DISCOVERY_CACHE_ENTRIES) {
      const oldestKey = skillDiscoveryCache.keys().next().value;
      if (oldestKey !== undefined) {
        disposeCachedDiscovery(skillDiscoveryCache.get(oldestKey));
        skillDiscoveryCache.delete(oldestKey);
      }
    }
    const entry: CachedSkillDiscovery = { dirty: false, roots: [], result };
    const markDirty = () => { entry.dirty = true; };
    const trackedRoots: TrackedSkillRoot[] = [];
    for (const root of normalizedRoots) {
      trackedRoots.push(await buildTrackedSkillRoot(root, records, markDirty));
    }
    skillDiscoveryCache.set(cacheKey, {
      get dirty() { return entry.dirty; },
      set dirty(value: boolean) { entry.dirty = value; },
      roots: trackedRoots,
      result,
    });
  }
  return { records: [...records], diagnostics: [...diagnostics] };
}

/** pi 的 `Skill` + 它来自哪个根 → Nomi 的 `SkillRecord`。返回 `null` = 这一条不进目录（原因已记进 diagnostics）。 */
async function projectSkill(skill: Skill, source: SkillDiscoveryRoot, diagnostics: SkillDiscoveryDiagnostic[]): Promise<SkillRecord | null> {
  const filePath = path.resolve(skill.filePath);
  const packageDir = path.dirname(filePath);
  const loose = isLooseSkillFile(filePath);
  const skip = (code: string, message: string): null => {
    diagnostics.push({ type: 'warning', code, message, path: filePath });
    return null;
  };

  // 可信读根纪律：包根或 SKILL.md 本身是软链 = 把它指向的任何地方变成可读区。pi 的 resolveKind 会跟着软链走，
  // 与我们的模型相反，所以这里拒。判越界的那一层（laneCodingPaths）还会再拒一次，它不依赖这里记得校验。
  try {
    if (await isSymbolicLink(filePath) || (!loose && await isSymbolicLink(packageDir))) {
      return skip('symlink', 'Installed Skill package roots and SKILL.md must not be symbolic links');
    }
    if (path.dirname(await realpath(filePath)) !== await realpath(packageDir)) {
      return skip('escaped', 'Installed Skill path escaped its package');
    }
  } catch (cause) {
    // 扫描与校验之间被删掉：它只是不在这一刻的目录里，不是安全事件（pi 对读失败同样只记 warning）。
    return skip('read_failed', (cause as Error).message);
  }

  let files: Record<string, string>;
  try {
    files = readSkillPackageFiles({ filePath, packageDir });
  } catch (cause) {
    return skip('read_failed', `Skill package could not be read, skipped: ${(cause as Error).message}`);
  }
  const body = (files['SKILL.md'] ?? '').trim();
  // 损坏包（正文含 NUL 等 C0 控制字符 = 二进制/截断/写坏）不许「占坑遮蔽」：pi 的 YAML 解析只看 frontmatter，
  // 不会替我们拦；这里当损坏处理且**不占键**，让后续根里同名的合法包顶上（commit 7dcc5a240）。
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) {
    return skip('corrupt', 'Skill package SKILL.md contains control characters, skipped as corrupt');
  }

  const front = parseSkillFrontmatter(body);
  const { manifest, error } = readSkillManifest(front);
  const directoryName = skillHandle(filePath);
  let childDirectoryNames: string[] = [];
  if (!loose) {
    const children = await readdir(packageDir, { withFileTypes: true });
    childDirectoryNames = children.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
  }
  return {
    curation: front.error ? undefined : readSkillCuration(front.values),
    // name / description 来自 pi（它只读 frontmatter；name 缺时回落目录名）。根 .md 技能缺 name 时 pi 回落的是
    // **技能根目录**的名字（对它来说那就是父目录），那不是一个句柄——我们回落到文件名。
    name: loose && !frontmatterString(front, 'name') ? directoryName : skill.name,
    directoryName,
    filePath,
    packageDir,
    description: skill.description,
    content: skill.content,
    body,
    manifest,
    manifestError: error,
    disableModelInvocation: skill.disableModelInvocation === true,
    origin: source.origin,
    // Imported Skills cannot publish themselves through package metadata.
    audience: source.origin === 'user' ? 'internal' : (manifest?.audience ?? 'internal'),
    packageVersion: SKILL_PACKAGE_VERSION,
    contentHash: computeSkillContentHash(files),
    requiresCodingTools: laneSkillRequiresCodingTools({ childDirectoryNames, frontmatterValues: front.values }),
  };
}

/** 进程级的那一批有序根（`skillStore.getSkillDiscoveryRoots`）→ 目录。每次调用都重扫盘：目录没有快照。 */
export async function readSkillRecords(): Promise<SkillRecord[]> {
  return (await discoverSkillRecords(getSkillDiscoveryRoots())).records;
}

// ─────────────────────────────────────────────────────────────────────────────
// lane 索引：SkillRecord → pi 的 Skill 形状 → formatSkillsForPrompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pi-coding-agent 的 `Skill`，**引用上游类型，不再手抄**（`dist/core/skills.d.ts:9`）。
 *
 * 手抄过一版逐字段相同的 interface。它是这条分支自己论点的反例：整条迁移就是为了
 * 不再手写 pi 已经提供的东西，而**类型是最容易漏掉的那一份**——它不跑、不报错，
 * 上游加个字段也不会红。当初大概率是为了避开重名才手抄的：本文件第 31 行已经从
 * pi-agent-core 导入了另一个同名的 `Skill`，两者形状不同。重名正是漂移的起点，
 * 解法是别名，不是复制。
 */
export type PiSkill = PiCodingAgentSkill

/** pi 那一侧我们要用到的那一个函数；签名从上游 `typeof` 取，单测仍只需实现这一个方法。 */
export interface PiSkillFormatter {
  formatSkillsForPrompt: typeof formatSkillsForPrompt
}

export async function loadPiSkillFormatter(): Promise<PiSkillFormatter> {
  return (await import('@earendil-works/pi-coding-agent')) as unknown as PiSkillFormatter;
}

/**
 * 索引条目 → pi 的 `Skill`。`baseDir` / `sourceInfo` 是 pi 的必填项而 `formatSkillsForPrompt` 不读它们——
 * 按事实填：`source` 就是发现来源（builtin / user）。2026-09-08 那条注释预言「下一个人会把这批 Skill 交给
 * pi 的别的函数，那时一个撒过谎的字段不会报错」——现在就是那一天，所以字段不再是常量。
 */
export function toPiSkills(entries: readonly LaneSkillIndexEntry[]): PiSkill[] {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    filePath: entry.filePath,
    baseDir: path.dirname(entry.filePath),
    sourceInfo: { path: entry.filePath, source: entry.origin, scope: 'user', origin: isLooseSkillFile(entry.filePath) ? 'top-level' : 'package' },
    disableModelInvocation: entry.disableModelInvocation,
  }));
}

/**
 * 系统提示词里的 `<available_skills>` 那一段：只有 name / description / location，正文按需 `read`。
 * 渲染一行都不写（`check:framework-boundary › own-available-skills-xml`）。
 */
export function renderLaneSkillSection(formatter: PiSkillFormatter, entries: readonly LaneSkillIndexEntry[]): string {
  if (entries.length === 0) return '';
  return formatter.formatSkillsForPrompt(toPiSkills(entries), 'read').trim();
}

/** 解锁条件 ①：**只看被引用的那几条**，不看整个索引——按整个索引解锁等于 coding 组永远亮着（付 20% 前缀）。 */
export function laneSkillUnlockReason(
  entries: readonly LaneSkillIndexEntry[],
  referencedSkillNames: readonly string[],
): LaneCodingUnlockReason | null {
  if (referencedSkillNames.length === 0) return null;
  const referenced = new Set(referencedSkillNames.map((name) => name.trim().toLowerCase()));
  const hit = entries.some((entry) => referenced.has(entry.name.trim().toLowerCase()) && entry.requiresCodingTools);
  return hit ? 'skill-requires-scripts' : null;
}

/** 目录记录 → 索引条目（纯投影，正文不在里面）。 */
export function toLaneSkillIndexEntry(record: SkillRecord): LaneSkillIndexEntry {
  return {
    name: record.name,
    description: record.description,
    filePath: record.filePath,
    origin: record.origin,
    disableModelInvocation: record.disableModelInvocation === true,
    requiresCodingTools: record.requiresCodingTools,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 回合边界：一个回合刷新一次，回合内不变（2026-09-11 评审裁决）
// ─────────────────────────────────────────────────────────────────────────────

/** 这一刻这条 lane 关于技能的**全部**事实。三样东西同一份快照，不许各刷各的。 */
export interface LaneSkillIndex {
  readonly entries: readonly LaneSkillIndexEntry[];
  /** `read` 允许越出项目去读的只读技能包根。与 `entries` 同源，所以「看得见 = 读得到」。 */
  readonly trustedSkillRoots: readonly string[];
  readonly promptSection: string;
}

/**
 * 技能事实的唯一 owner。`current()` 不读盘——它返回上一次 `refresh()` 定下来的那一份，所以同一个回合里
 * 提示词渲染与 `read` 的越界判定看到的是**同一个**索引。`refresh()` 在回合边界调，记录集没变就连 pi 的渲染都不重跑。
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

/** 指纹只认「会改变模型看到什么 / 允许读什么」的那几样；`contentHash` 覆盖正文与包内脚本。 */
function fingerprint(records: readonly SkillRecord[]): string {
  return records
    .map((record) => [record.filePath, record.name, record.description,
      record.disableModelInvocation === true ? '1' : '0', record.requiresCodingTools ? '1' : '0', record.contentHash].join('\u0000'))
    .join('\u0001');
}

export type LaneSkillRecordSource = () => readonly SkillRecord[] | Promise<readonly SkillRecord[]>;

export function createLaneSkillIndexSource(
  read: LaneSkillRecordSource,
  deps: { loadFormatter?: () => Promise<PiSkillFormatter> } = {},
): LaneSkillIndexSource {
  const loadFormatter = deps.loadFormatter ?? loadPiSkillFormatter;
  let index: LaneSkillIndex = EMPTY_INDEX;
  let seen: string | undefined;
  // 渲染器只在真的有技能时才 import 一次：用户会在半路导入第一个技能，那一刻才需要它。
  let formatter: Promise<PiSkillFormatter> | undefined;
  return {
    current: () => index,
    refresh: async () => {
      const records = await read();
      const next = fingerprint(records);
      if (seen === next) return index;
      const entries = records.map(toLaneSkillIndexEntry);
      const trustedSkillRoots = [...new Set(records.map((record) => record.packageDir))];
      const promptSection = entries.length > 0
        ? renderLaneSkillSection(await (formatter ??= loadFormatter()), entries)
        : '';
      index = Object.freeze({ entries, trustedSkillRoots, promptSection });
      seen = next;
      return index;
    },
  };
}
