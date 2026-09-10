import { z } from "zod";
import { skillProviderKindSchema } from "./skillProvider";

const localMediaPath = z.string().regex(/^(?:assets|references)\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|mp4|webm)$/)
  .refine((value) => !value.split("/").some((part) => part === ".." || part === "." || !part));
const localizedText = z.object({ "zh-CN": z.string().min(1), en: z.string().min(1) }).strict();

/** One curation contract for both a reusable Skill and a one-click effect. */
export const skillCurationSchema = z.object({
  kind: z.enum(["skill", "effect"]),
  summary: localizedText,
  title: localizedText,
  appliesTo: z.array(skillProviderKindSchema).min(1)
    .refine((values) => new Set(values).size === values.length),
  group: localizedText,
  slots: z.array(z.object({
    token: z.string().regex(/^\{[^{}\n]+\}$/),
    reference: z.enum(["character", "scene", "subject", "text"]),
  }).strict()),
  source: z.object({
    url: z.string().url(),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    author: z.string().min(1),
    changes: z.string().min(1),
    evidence: z.array(z.string().url()).min(1),
  }).strict(),
  preview: z.object({
    path: localMediaPath,
    type: z.enum(["image", "video"]),
    provenance: z.enum(["upstream-output", "local-output", "illustration"]),
    sourceUrl: z.string().url().optional(),
  }).strict().optional(),
}).strict();

const licensedCurationSchema = skillCurationSchema.extend({
  license: z.enum(["MIT", "Apache-2.0", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "AGPL-3.0-only"]),
});
export type SkillCuration = z.infer<typeof licensedCurationSchema>;

/** Ordinary private/official Skills need no license. Only curated redistribution opts in. */
export function readSkillCuration(values: Record<string, unknown>): SkillCuration | undefined {
  const metadata = values.metadata as { nomi?: { library?: unknown } } | undefined;
  const library = metadata?.nomi?.library;
  if (library === undefined) return undefined;
  if (!library || typeof library !== "object" || Array.isArray(library)) {
    throw new Error("Invalid curated Skill metadata");
  }
  return licensedCurationSchema.parse({ ...library, license: values.license });
}
