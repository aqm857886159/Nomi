import fs from "node:fs";
import path from "node:path";

import { getSkillsRoots, getUserSkillsRoot } from "../runtimePaths";
import { computeSkillContentHash, readSkillDirFiles, SKILL_PACKAGE_VERSION } from "./skillPackage";
import {
  parseSkillManifest,
  type SkillAudience,
  type SkillManifest,
} from "./skillManifestSchema";

export type SkillRecord = {
  name: string;
  directoryName: string;
  filePath: string;
  description: string;
  body: string;
  manifest: SkillManifest | null;
  manifestError?: string;
  origin: "builtin" | "user";
  audience: SkillAudience;
  packageVersion: typeof SKILL_PACKAGE_VERSION;
  contentHash: string;
};

function frontmatterValue(markdown: string, key: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const value = match?.[1].match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return String(value?.[1] || "").trim();
}

function parseSkillName(markdown: string, directoryName: string): string {
  return frontmatterValue(markdown, "name") || directoryName;
}

function parseSkillDescription(markdown: string): string {
  return frontmatterValue(markdown, "description");
}

function parseSkillAudience(markdown: string): SkillAudience {
  return frontmatterValue(markdown, "audience") === "mcp" ? "mcp" : "internal";
}

export function normalizeSkillLookupKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function readSkillManifest(files: Record<string, string>): { manifest: SkillManifest | null; error?: string } {
  const rawManifest = files["skill.json"];
  if (!rawManifest) return { manifest: null };
  let raw: unknown;
  try {
    raw = JSON.parse(rawManifest);
  } catch (error) {
    return { manifest: null, error: `skill.json 不是合法 JSON：${(error as Error).message}` };
  }
  const parsed = parseSkillManifest(raw);
  return parsed.ok ? { manifest: parsed.manifest } : { manifest: null, error: parsed.error };
}

export function readSkillRecords(): SkillRecord[] {
  const records: SkillRecord[] = [];
  const seenDirs = new Set<string>();
  const userRoot = path.resolve(getUserSkillsRoot());
  for (const root of getSkillsRoots()) {
    if (!fs.existsSync(root)) continue;
    const origin: SkillRecord["origin"] = path.resolve(root) === userRoot ? "user" : "builtin";
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || seenDirs.has(entry.name)) continue;
      const skillDir = path.join(root, entry.name);
      if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) continue;
      let files: Record<string, string>;
      try {
        files = readSkillDirFiles(skillDir);
      } catch {
        continue;
      }
      const body = files["SKILL.md"].trim();
      if (!body) continue;
      seenDirs.add(entry.name);
      const { manifest, error } = readSkillManifest(files);
      records.push({
        name: manifest?.name || parseSkillName(body, entry.name),
        directoryName: entry.name,
        filePath: path.join(skillDir, "SKILL.md"),
        description: manifest?.description || parseSkillDescription(body),
        body,
        manifest,
        manifestError: error,
        origin,
        // Imported Skills cannot publish themselves through package metadata.
        audience: origin === "user" ? "internal" : (manifest?.audience ?? parseSkillAudience(body)),
        packageVersion: SKILL_PACKAGE_VERSION,
        contentHash: computeSkillContentHash(files),
      });
    }
  }
  return records;
}

export function findSkillRecord(
  skillKey: string,
  skillName: string,
  records: SkillRecord[] = readSkillRecords(),
): SkillRecord | null {
  if (!records.length) return null;
  const normalizedKey = normalizeSkillLookupKey(skillKey);
  const normalizedName = normalizeSkillLookupKey(skillName);
  const exact = records.find((skill) => skill.name === skillKey);
  if (exact) return exact;
  const prefix = records.filter((skill) => skillKey.startsWith(`${skill.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix;
  return records.find((skill) =>
    normalizeSkillLookupKey(skill.name) === normalizedKey ||
    normalizeSkillLookupKey(skill.directoryName) === normalizedKey ||
    (normalizedName && normalizeSkillLookupKey(skill.name) === normalizedName) ||
    (normalizedName && normalizeSkillLookupKey(skill.directoryName) === normalizedName)) ?? null;
}

export function isSkillVisibleTo(record: SkillRecord, audience: SkillAudience): boolean {
  if (audience === "internal") return true;
  return record.origin === "builtin" && record.audience === "mcp";
}

export type SkillSummary = {
  name: string;
  directoryName: string;
  description: string;
  origin: "builtin" | "user";
  packageVersion: typeof SKILL_PACKAGE_VERSION;
  contentHash: string;
};

export function listSkillSummaries(
  audience: SkillAudience,
  records: SkillRecord[] = readSkillRecords(),
): SkillSummary[] {
  return records.filter((record) => isSkillVisibleTo(record, audience)).map((record) => ({
    name: record.name,
    directoryName: record.directoryName,
    description: record.description,
    origin: record.origin,
    packageVersion: record.packageVersion,
    contentHash: record.contentHash,
  }));
}

export type SkillContent = SkillSummary & { body: string };

export function readSkillContent(
  key: string,
  audience: SkillAudience,
  records: SkillRecord[] = readSkillRecords(),
  expected?: Readonly<{ packageVersion: string; contentHash: string }>,
): SkillContent | null {
  const record = records.find((candidate) => candidate.name === key || candidate.directoryName === key);
  if (!record || !isSkillVisibleTo(record, audience)) return null;
  if (expected && (record.packageVersion !== expected.packageVersion || record.contentHash !== expected.contentHash)) {
    return null;
  }
  return {
    name: record.name,
    directoryName: record.directoryName,
    description: record.description,
    body: record.body,
    origin: record.origin,
    packageVersion: record.packageVersion,
    contentHash: record.contentHash,
  };
}
