// 技能目录（catalog）的唯一 owner：**发现与解析交给 `pi-coding-agent@1.7.0`，Nomi 只做投影与策略。**
//
// ── pi 给的（1.7.0）──
//   `loadSkillsFromDir({ dir, source })`：递归遍历、`SKILL.md` 或根目录下带 frontmatter 的 `.md`、
//   认 `.gitignore`/`.ignore`/`.fdignore`、原生 `stripBom`（UTF-8 BOM 已由 pi 自己剥除，删除 0.85.1 的
//   `BomTolerantExecutionEnv` 补丁）、`ResourceDiagnostic` 只 warning 不失败（description 缺失才不加载）。
//   `stripFrontmatter`：同源去除 YAML 头得到 `content`。
//   `formatSkillsForPrompt`：标准 `<available_skills>` XML 渲染。
//
// ── 冷启动模块图纪律（`lane-open-graph.test.mts`）──
//   本模块在打开项目阶段静态装入（`phase: "open"`），故顶层只做 `import type`；真正的运行时函数在
//   `discoverSkillRecords` / `loadPiSkillFormatter` 调用时按需动态 `import('@earendil-works/pi-coding-agent')`。
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  Skill as PiCodingAgentSkill,
  formatSkillsForPrompt,
  loadSkillsFromDir,
  stripFrontmatter,
} from '@earendil-works/pi-coding-agent';

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

/** 技能包里被认作「可执行区」的目录名。与 `skillPackage.ts` 同一份语义。 */
const SKILL_EXECUTABLE_DIR_NAMES: ReadonlySet<string> = new Set(['scripts', 'bin', 'hooks']);

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

type LastSkillDiscovery = {
  readonly key: string;
  readonly fingerprint: string;
  readonly result: SkillDiscoveryResult;
};

let lastSkillDiscovery: LastSkillDiscovery | null = null;

const MAX_FINGERPRINT_DEPTH = 8;

async function lstatSignature(target: string): Promise<string> {
  try {
    const st = await lstat(target, { bigint: true });
    return `${st.ino}:${st.mode}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code ? `ERR:${code}` : 'ERR';
  }
}

async function walkRootFingerprint(dir: string, out: string[], depth: number): Promise<void> {
  const sig = await lstatSignature(dir);
  out.push(`${dir}=${sig}`);
  if (sig.startsWith('ERR:') || depth > MAX_FINGERPRINT_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    out.push(`${dir}:READERR:${code ?? 'ERR'}`);
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await Promise.all(entries.map(async (entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walkRootFingerprint(entryPath, out, depth + 1);
    } else {
      out.push(`${entryPath}=${await lstatSignature(entryPath)}`);
    }
  }));
}

async function computeRootsFingerprint(roots: readonly SkillDiscoveryRoot[]): Promise<string> {
  const lines: string[] = [];
  for (const root of roots) {
    await walkRootFingerprint(root.path, lines, 0);
  }
  lines.sort();
  return lines.join('\n');
}

interface PiSkillRuntime {
  loadSkillsFromDir: typeof loadSkillsFromDir;
  stripFrontmatter: typeof stripFrontmatter;
  formatSkillsForPrompt: typeof formatSkillsForPrompt;
}

let cachedPiSkillRuntime: Promise<PiSkillRuntime> | undefined;
function loadPiSkillRuntime(): Promise<PiSkillRuntime> {
  // 解析到包内 `./core/skills.js` 与 `./utils/frontmatter.js`，避免触发 `pi-coding-agent/dist/index.js` 整包 CLI 入口（约 1500 个模块）。
  const base = import.meta.resolve('@earendil-works/pi-coding-agent');
  const skillsModuleUrl = new URL('./core/skills.js', base).href;
  const frontmatterModuleUrl = new URL('./utils/frontmatter.js', base).href;
  return (cachedPiSkillRuntime ??= Promise.all([
    import(skillsModuleUrl) as Promise<{ loadSkillsFromDir: typeof loadSkillsFromDir; formatSkillsForPrompt: typeof formatSkillsForPrompt }>,
    import(frontmatterModuleUrl) as Promise<{ stripFrontmatter: typeof stripFrontmatter }>,
  ]).then(([skills, frontmatter]) => ({
    loadSkillsFromDir: skills.loadSkillsFromDir,
    formatSkillsForPrompt: skills.formatSkillsForPrompt,
    stripFrontmatter: frontmatter.stripFrontmatter,
  })));
}

export async function discoverSkillRecords(roots: readonly SkillDiscoveryRoot[]): Promise<SkillDiscoveryResult> {
  const normalizedRoots = roots
    .filter((root) => typeof root?.path === 'string' && path.isAbsolute(root.path))
    .map((root) => ({ path: path.resolve(root.path), origin: root.origin === 'user' ? 'user' as const : 'builtin' as const }));
  const cacheKey = normalizedRoots.map((root) => `${root.origin}:${root.path}`).join('\u0000');
  const fingerprint = normalizedRoots.length > 0 ? await computeRootsFingerprint(normalizedRoots) : '';
  if (lastSkillDiscovery && lastSkillDiscovery.key === cacheKey && lastSkillDiscovery.fingerprint === fingerprint) {
    return { records: [...lastSkillDiscovery.result.records], diagnostics: [...lastSkillDiscovery.result.diagnostics] };
  }

  const records: SkillRecord[] = [];
  const diagnostics: SkillDiscoveryDiagnostic[] = [];
  for (const root of normalizedRoots) await migrateLegacyManifests(root, diagnostics);

  const pi = await loadPiSkillRuntime();
  const discovered: Array<{ skill: PiCodingAgentSkill; source: SkillDiscoveryRoot }> = [];
  for (const root of normalizedRoots) {
    try {
      if ((await lstat(root.path)).isSymbolicLink()) {
        diagnostics.push({ type: 'warning', code: 'symlink', message: 'Skill discovery root must not be a symbolic link', path: root.path });
        continue;
      }
    } catch {
      continue;
    }
    const loaded = pi.loadSkillsFromDir({ dir: root.path, source: root.origin });
    for (const diagnostic of loaded.diagnostics) {
      const code = diagnostic.type === 'collision'
        ? 'shadowed'
        : /permission denied|EACCES|ENOENT|EISDIR|failed to read/i.test(diagnostic.message)
          ? 'read_failed'
          : 'invalid_metadata';
      diagnostics.push({
        type: 'warning',
        code,
        message: diagnostic.message,
        path: diagnostic.path,
      });
    }
    for (const skill of loaded.skills) {
      discovered.push({ skill, source: root });
    }
  }

  const seen = new Map<string, string>();
  for (const { skill, source } of discovered) {
    const record = await projectSkill(skill, source, pi.stripFrontmatter, diagnostics);
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
    const settledFingerprint = await computeRootsFingerprint(normalizedRoots);
    lastSkillDiscovery = { key: cacheKey, fingerprint: settledFingerprint, result };
  }
  return { records: [...records], diagnostics: [...diagnostics] };
}

async function projectSkill(
  skill: PiCodingAgentSkill,
  source: SkillDiscoveryRoot,
  strip: typeof stripFrontmatter,
  diagnostics: SkillDiscoveryDiagnostic[],
): Promise<SkillRecord | null> {
  const filePath = path.resolve(skill.filePath);
  const packageDir = path.dirname(filePath);
  const loose = isLooseSkillFile(filePath);
  const skip = (code: string, message: string): null => {
    diagnostics.push({ type: 'warning', code, message, path: filePath });
    return null;
  };

  try {
    if (await isSymbolicLink(filePath) || (!loose && await isSymbolicLink(packageDir))) {
      return skip('symlink', 'Installed Skill package roots and SKILL.md must not be symbolic links');
    }
    if (path.dirname(await realpath(filePath)) !== await realpath(packageDir)) {
      return skip('escaped', 'Installed Skill path escaped its package');
    }
  } catch (cause) {
    return skip('read_failed', (cause as Error).message);
  }

  let files: Record<string, string>;
  try {
    files = readSkillPackageFiles({ filePath, packageDir });
  } catch (cause) {
    return skip('read_failed', `Skill package could not be read, skipped: ${(cause as Error).message}`);
  }
  const body = (files['SKILL.md'] ?? '').trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) {
    return skip('corrupt', 'Skill package SKILL.md contains control characters, skipped as corrupt');
  }

  const front = parseSkillFrontmatter(body);
  const { manifest, error } = readSkillManifest(front);
  const directoryName = skillHandle(filePath);
  const declaredName = frontmatterString(front, 'name');
  if (!loose && declaredName && declaredName !== directoryName) {
    diagnostics.push({
      type: 'warning',
      code: 'invalid_metadata',
      message: `name "${declaredName}" does not match parent directory "${directoryName}"`,
      path: filePath,
    });
  }
  let childDirectoryNames: string[] = [];
  if (!loose) {
    const children = await readdir(packageDir, { withFileTypes: true });
    childDirectoryNames = children.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
  }
  return {
    curation: front.error ? undefined : readSkillCuration(front.values),
    name: loose && !frontmatterString(front, 'name') ? directoryName : skill.name,
    directoryName,
    filePath,
    packageDir,
    description: skill.description,
    content: strip(body).trim(),
    body,
    manifest,
    manifestError: error,
    disableModelInvocation: skill.disableModelInvocation === true,
    origin: source.origin,
    audience: source.origin === 'user' ? 'internal' : (manifest?.audience ?? 'internal'),
    packageVersion: SKILL_PACKAGE_VERSION,
    contentHash: computeSkillContentHash(files),
    requiresCodingTools: laneSkillRequiresCodingTools({ childDirectoryNames, frontmatterValues: front.values }),
  };
}

export async function readSkillRecords(): Promise<SkillRecord[]> {
  return (await discoverSkillRecords(getSkillDiscoveryRoots())).records;
}

export type PiSkill = PiCodingAgentSkill;

export interface PiSkillFormatter {
  formatSkillsForPrompt: typeof formatSkillsForPrompt;
}

export async function loadPiSkillFormatter(): Promise<PiSkillFormatter> {
  return loadPiSkillRuntime();
}

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

export function renderLaneSkillSection(formatter: PiSkillFormatter, entries: readonly LaneSkillIndexEntry[]): string {
  if (entries.length === 0) return '';
  return formatter.formatSkillsForPrompt(toPiSkills(entries), 'read').trim();
}

export function laneSkillUnlockReason(
  entries: readonly LaneSkillIndexEntry[],
  referencedSkillNames: readonly string[],
): LaneCodingUnlockReason | null {
  if (referencedSkillNames.length === 0) return null;
  const referenced = new Set(referencedSkillNames.map((name) => name.trim().toLowerCase()));
  const hit = entries.some((entry) => referenced.has(entry.name.trim().toLowerCase()) && entry.requiresCodingTools);
  return hit ? 'skill-requires-scripts' : null;
}

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

export interface LaneSkillIndex {
  readonly entries: readonly LaneSkillIndexEntry[];
  readonly trustedSkillRoots: readonly string[];
  readonly promptSection: string;
}

export interface LaneSkillIndexSource {
  current(): LaneSkillIndex;
  refresh(): Promise<LaneSkillIndex>;
}

const EMPTY_INDEX: LaneSkillIndex = Object.freeze({
  entries: Object.freeze([]) as readonly LaneSkillIndexEntry[],
  trustedSkillRoots: Object.freeze([]) as readonly string[],
  promptSection: '',
});

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
