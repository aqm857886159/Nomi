import { z } from "zod";
import { DOCUMENT_READ_ALIASES, DOCUMENT_READ_CAPABILITY } from "../../shared/agentCapabilities/documentRead";

/** Pure Nomi-owned document metadata; the host owns editor reads, writes, and approval. */

const contentParam = z.object({
  content: z.string().min(1).describe("The exact text to write into the document. Markdown is supported."),
});

export const documentToolDescriptors = {
  read_full_text: {
    name: DOCUMENT_READ_ALIASES.full,
    description:
      "Read the full plain text of the user's current creation document. Call this when you need the existing draft as context before writing or rewriting.",
    parameters: z.object({}),
  },
  read_selection: {
    name: DOCUMENT_READ_ALIASES.selection,
    description:
      "Read the text the user has currently selected in the editor. Returns an empty string if nothing is selected.",
    parameters: z.object({}),
  },
  insert_at_cursor: {
    name: "insert_at_cursor",
    description:
      "Insert text at the current cursor position. Use for continuations or additions that belong where the user is working. Requires user confirmation.",
    parameters: contentParam,
  },
  replace_selection: {
    name: "replace_selection",
    description:
      "Replace the user's current selection with new text. Use for rewrites/polish of a selected passage. Requires user confirmation.",
    parameters: contentParam,
  },
  append_to_end: {
    name: "append_to_end",
    description:
      "Append text to the end of the document. Use when delivering a complete result that should sit after the existing draft. Requires user confirmation.",
    parameters: contentParam,
  },
  author_skill: {
    name: "author_skill",
    description:
      "Author a Nomi skill and save it to the user's skill library. Call this AFTER you have read the user's source skill/doc/description and mapped it to Nomi's tools and capabilities. A skill is one file: SKILL.md, opening with YAML frontmatter. The renderer saves it immediately (low-stakes, reversible); after it lands, tell the user in one line what it does and offer to run it once.",
    parameters: z.object({
      dirName: z.string().min(1).describe("Directory name suggestion, kebab-case ascii, e.g. 'music-mv'. Slugified on save."),
      skillMarkdown: z.string().min(1).describe(
        "The complete SKILL.md, written in the user's language. It MUST open with YAML frontmatter delimited by --- lines, containing `name` (lowercase letters/digits/hyphens only, matching dirName) and `description` (what it does AND when to use it). Nomi-specific declarations go under `metadata.nomi`: `version` (e.g. \"1.0.0\"), `label` (display name), `tools` (Nomi tool names the skill uses), `required-providers` (any of text/image/video). The methodology itself follows the closing --- as Markdown.",
      ),
    }),
  },
} as const;

export type DocumentToolName = keyof typeof documentToolDescriptors;
export const documentToolNames = Object.keys(documentToolDescriptors) as DocumentToolName[];

export function documentReadDescriptorForScope(scope: "full" | "selection") {
  return scope === "full" ? documentToolDescriptors[DOCUMENT_READ_CAPABILITY.aliases.pi] : documentToolDescriptors[DOCUMENT_READ_ALIASES.selection];
}
