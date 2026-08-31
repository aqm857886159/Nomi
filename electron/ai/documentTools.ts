import { tool } from "ai";
import { z } from "zod";

/**
 * Zod schemas for the creation-area document tools the LLM is allowed to call.
 *
 * Mirrors the canvas tools design (see canvasTools.ts): we declare schemas only
 * and deliberately omit `execute`. The actual mutation happens in the renderer
 * (via `CreationDocumentTools` on the tiptap editor) once the user confirms; the
 * main process emits the tool-call to the UI and feeds the decision back to the
 * model as the tool result.
 *
 * Read tools (read_full_text / read_selection) are auto-executed by the renderer
 * without a confirmation card; write tools require explicit user approval.
 */

export const documentToolNames = [
  "read_full_text",
  "read_selection",
  "insert_at_cursor",
  "replace_selection",
  "append_to_end",
  "author_skill",
] as const;
export type DocumentToolName = (typeof documentToolNames)[number];

// author_skill 的 manifest 形状（贴近 skillManifestSchema，帮 LLM 一次产出合法 skill.json；
// 最终校验仍在 electron/skills/skillPackage.ts 的 validateSkillPackage → parseSkillManifest）。
const authorSkillModelPref = z.object({
  kind: z.enum(["text", "image", "video"]),
  family: z.string().min(1).optional(),
});
const authorSkillStage = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  tools: z.array(z.string().min(1)),
  dependsOn: z.array(z.string().min(1)).optional(),
  pause: z.boolean().optional(),
  modelPrefs: z.array(authorSkillModelPref).optional(),
});
const authorSkillManifest = z.object({
  name: z.string().min(1).describe("Stable id, e.g. 'music.mv' or 'ecom.product-shot'."),
  version: z.string().min(1).describe("e.g. '1.0.0'."),
  label: z.string().min(1).describe("Human display name in the user's language, e.g. '音乐 MV'."),
  description: z.string().min(1).describe("One line: what it does + when to use it (trigger condition)."),
  tools: z.array(z.string().min(1)).describe("Nomi tool names this skill uses (from the catalog in the skill body)."),
  requiredProviders: z
    .array(z.enum(["text", "image", "video"]))
    .describe("Capability modalities needed end-to-end. Declare every modality any stage needs, so missing ones surface as a capability gap."),
  permissions: z.array(z.enum(["read-only", "create", "delete", "export"])),
  author: z.string().min(1).optional(),
  stages: z.array(authorSkillStage).optional().describe("Multi-stage playbook (optional). modelPrefs only declare kind+family, never a specific model."),
});

const contentParam = z.object({
  content: z.string().min(1).describe("The exact text to write into the document. Markdown is supported."),
});

export const documentTools = {
  read_full_text: tool({
    description:
      "Read the full plain text of the user's current creation document. Call this when you need the existing draft as context before writing or rewriting.",
    parameters: z.object({}),
  }),
  read_selection: tool({
    description:
      "Read the text the user has currently selected in the editor. Returns an empty string if nothing is selected.",
    parameters: z.object({}),
  }),
  insert_at_cursor: tool({
    description:
      "Insert text at the current cursor position. Use for continuations or additions that belong where the user is working. Requires user confirmation.",
    parameters: contentParam,
  }),
  replace_selection: tool({
    description:
      "Replace the user's current selection with new text. Use for rewrites/polish of a selected passage. Requires user confirmation.",
    parameters: contentParam,
  }),
  append_to_end: tool({
    description:
      "Append text to the end of the document. Use when delivering a complete result that should sit after the existing draft. Requires user confirmation.",
    parameters: contentParam,
  }),
  author_skill: tool({
    description:
      "Author a Nomi skill and save it to the user's skill library. Call this AFTER you have read the user's source skill/doc/description and mapped it to Nomi's tools and capabilities. Provide the skill.json manifest object + the SKILL.md body. The renderer saves it immediately (low-stakes, reversible); after it lands, tell the user in one line what it does and offer to run it once.",
    parameters: z.object({
      dirName: z.string().min(1).describe("Directory name suggestion, kebab-case ascii, e.g. 'music-mv'. Slugified on save."),
      manifest: authorSkillManifest.describe("The skill.json manifest."),
      skillMarkdown: z.string().min(1).describe("The SKILL.md body: the skill's methodology, written in the user's language."),
    }),
  }),
} as const;

export type DocumentTools = typeof documentTools;
