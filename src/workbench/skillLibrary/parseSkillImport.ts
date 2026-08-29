// Normalize common Skill share formats. Main remains authoritative for package validation and writes.
import type { SkillZipImportPayload } from "../../../electron/shared/skillImportContracts";

export type SkillImportPayload =
  | ({ dirName: string; files: Record<string, string> } & Record<string, unknown>)
  | SkillZipImportPayload;
export type SkillImportFailure =
  | "unsupportedType"
  | "unsupportedContent"
  | "invalidText"
  | "badJson"
  | "zipBroken"
  | "noSkillMd"
  | "empty"
  | "tooBig";
export type SkillImportParse =
  | { ok: true; payload: SkillImportPayload }
  | { ok: false; reason: SkillImportFailure; detail?: string };

const MAX_BYTES = 10 * 1024 * 1024;

export function readFrontmatterName(markdown: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = match?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m);
  return (name?.[1] ?? "").trim();
}

function suggestDirName(markdown: string, fallback: string): string {
  return readFrontmatterName(markdown) || fallback.replace(/\.(?:md|markdown|zip|json)$/i, "") || "imported-skill";
}

export function packageFromMarkdown(fileName: string, text: string): SkillImportParse {
  if (!text.trim()) return { ok: false, reason: "empty" };
  return { ok: true, payload: { dirName: suggestDirName(text, fileName), files: { "SKILL.md": text } } };
}

export function packageFromEnvelope(json: unknown): SkillImportParse {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, reason: "badJson" };
  const envelope = json as Record<string, unknown>;
  if (typeof envelope.dirName !== "string" || !envelope.files || typeof envelope.files !== "object"
    || Array.isArray(envelope.files)) {
    return { ok: false, reason: "badJson" };
  }
  return { ok: true, payload: envelope as SkillImportPayload };
}

export async function parseSkillImportFile(file: File): Promise<SkillImportParse> {
  if (file.size > MAX_BYTES) return { ok: false, reason: "tooBig" };
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".zip")) {
    if (file.size === 0) return { ok: false, reason: "empty" };
    return {
      ok: true,
      payload: { kind: "zip", fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    };
  }
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return packageFromMarkdown(file.name, await file.text());
  }
  if (lowerName.endsWith(".json") || lowerName.endsWith(".nomiskill")) {
    try {
      return packageFromEnvelope(JSON.parse(await file.text()));
    } catch {
      return { ok: false, reason: "badJson" };
    }
  }
  return { ok: false, reason: "unsupportedType" };
}
