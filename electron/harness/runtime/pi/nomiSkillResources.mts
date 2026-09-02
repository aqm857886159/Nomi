import {
  createSyntheticSourceInfo,
  type ResourceDiagnostic,
  type Skill,
} from '@earendil-works/pi-coding-agent';
import { dirname, isAbsolute, resolve } from 'node:path';
import { SKILL_PACKAGE_VERSION } from '../../../skills/skillPackage.js';
import * as skillStore from '../../../skills/skillStore.js';
import type { SkillDiscoveryRoot, SkillRecord } from '../../../skills/skillStore.js';
export { formatNomiSkillIndex } from '../../skillIndex.js';

export type NomiSkillRoot = {
  path: string;
  source: 'repository' | 'user';
};

export type NomiLoadedSkill = Skill & {
  directoryName: string;
  origin: 'builtin' | 'user';
  packageVersion: typeof SKILL_PACKAGE_VERSION;
  contentHash: string;
};

export type NomiSkillResourceCatalog = {
  list(): { skills: NomiLoadedSkill[]; diagnostics: ResourceDiagnostic[] };
  read(name: string, expectedContentHash?: string): Promise<NomiLoadedSkill & { body: string }>;
  reload(): Promise<void>;
};

/**
 * Some compatibility tests mock the legacy Skill facade with only
 * `findSkillRecord`. Read optional canonical exports defensively so the Pi
 * resource seam remains an empty, honest catalog under that harness; a real
 * desktop build always supplies every export below.
 */
function optionalSkillStoreFunction<T extends (...args: never[]) => unknown>(name: string): T | undefined {
  try {
    const candidate = (skillStore as unknown as Record<string, unknown>)[name];
    return typeof candidate === 'function' ? candidate as T : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRoots(roots: readonly NomiSkillRoot[]): NomiSkillRoot[] {
  const seen = new Set<string>();
  const result: NomiSkillRoot[] = [];
  for (const root of roots) {
    if (!isAbsolute(root.path)) continue;
    const resolved = resolve(root.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push({ ...root, path: resolved });
  }
  return result;
}

/**
 * Resolve the same roots used by `skillStore`.  In particular, the default
 * Electron `app.getPath('userData')/skills` root is included through
 * `getSkillsRoots`; Pi must not maintain a second user-data environment list.
 * The optional module URL is retained for source compatibility, but discovery
 * is intentionally runtime-path based so a packed app and the Workbench see
 * the same roots.
 */
export function getNomiSkillRoots(moduleUrl?: string): NomiSkillRoot[] {
  void moduleUrl;
  const getRoots = optionalSkillStoreFunction<() => SkillDiscoveryRoot[]>('getSkillDiscoveryRoots');
  if (!getRoots) return [];
  return normalizeRoots(getRoots().map((root) => ({
    path: root.path,
    source: root.origin === 'user' ? 'user' as const : 'repository' as const,
  })));
}

function toDiscoveryRoots(roots: readonly NomiSkillRoot[]): SkillDiscoveryRoot[] {
  return roots.map((root) => ({
    path: root.path,
    origin: root.source === 'user' ? 'user' : 'builtin',
  }));
}

function toPiSkill(record: SkillRecord): NomiLoadedSkill {
  const source = record.origin === 'user' ? 'nomi-user' : 'nomi-repository';
  return {
    name: record.name,
    description: record.description,
    filePath: record.filePath,
    baseDir: dirname(record.filePath),
    sourceInfo: createSyntheticSourceInfo(record.filePath, {
      source,
      scope: record.origin === 'user' ? 'user' : 'project',
      origin: 'top-level',
      baseDir: dirname(record.filePath),
    }),
    disableModelInvocation: record.disableModelInvocation ?? false,
    directoryName: record.directoryName,
    origin: record.origin,
    packageVersion: record.packageVersion,
    contentHash: record.contentHash,
  };
}

function discover(roots: readonly NomiSkillRoot[]): {
  skills: NomiLoadedSkill[];
  diagnostics: ResourceDiagnostic[];
} {
  const discoverRecords = optionalSkillStoreFunction<(roots: SkillDiscoveryRoot[]) => {
    records: SkillRecord[];
    diagnostics: Array<{ type: 'warning' | 'error'; message: string; path?: string }>;
  }>('discoverSkillRecordsFromRoots');
  if (!discoverRecords) {
    return {
      skills: [],
      diagnostics: [{ type: 'error', message: 'Nomi Skill catalog is unavailable.' }],
    };
  }
  const discovered = discoverRecords(toDiscoveryRoots(roots));
  return {
    skills: discovered.records.map(toPiSkill),
    diagnostics: discovered.diagnostics.map((diagnostic) => ({
      type: diagnostic.type,
      message: diagnostic.message,
      path: diagnostic.path,
    })),
  };
}

export function createNomiSkillResourceCatalog(
  roots: readonly NomiSkillRoot[] = getNomiSkillRoots(),
): NomiSkillResourceCatalog {
  const safeRoots = normalizeRoots(roots);
  let snapshot = discover(safeRoots);
  return {
    list: () => ({ skills: snapshot.skills, diagnostics: snapshot.diagnostics }),
    read: async (name, expectedContentHash) => {
      const normalize = optionalSkillStoreFunction<(value: unknown) => string>('normalizeSkillLookupKey');
      const normalizedName = normalize ? normalize(name) : name.trim().toLowerCase();
      const skill = snapshot.skills.find((candidate) => candidate.name === name || candidate.directoryName === name
        || (normalize && normalize(candidate.name) === normalizedName)
        || (normalize && normalize(candidate.directoryName) === normalizedName));
      if (!skill) throw new Error(`Skill not found: ${name}`);
      if (expectedContentHash && expectedContentHash !== skill.contentHash) {
        throw new Error(`Skill changed before load: ${name}`);
      }
      // Re-discover through the canonical store at the read boundary.  This
      // catches edits, package-file additions/removals and manifest changes,
      // not just a changed SKILL.md body.
      const discoverRecords = optionalSkillStoreFunction<(roots: SkillDiscoveryRoot[]) => {
        records: SkillRecord[];
        diagnostics: Array<{ type: 'warning' | 'error'; message: string; path?: string }>;
      }>('discoverSkillRecordsFromRoots');
      const findExact = optionalSkillStoreFunction<(key: string, records: readonly SkillRecord[]) => SkillRecord | undefined>('findExactSkillRecord');
      const current = discoverRecords
        ? discoverRecords(toDiscoveryRoots(safeRoots)).records : [];
      const currentRecord = findExact ? findExact(name, current) : undefined;
      if (!currentRecord || currentRecord.contentHash !== skill.contentHash) {
        throw new Error(`Skill changed before load: ${name}`);
      }
      return { ...toPiSkill(currentRecord), body: currentRecord.body };
    },
    reload: async () => {
      snapshot = discover(safeRoots);
      await Promise.resolve();
    },
  };
}
