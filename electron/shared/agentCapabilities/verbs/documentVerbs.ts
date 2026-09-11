// `document.read` / `document.write` 的动词声明（两个 profile 共用；执行那一半住 `electron/agentLane/laneDocumentTools.ts`）。
//
// 形状规则来自 #547 的真实数据：一个别名 = 一个工具；别名定死的字段（`scope` / `operation`）不出现在
// 模型可见 schema 里而以 `aliasBoundInput` 留在声明上——对外 MCP 的判别枚举正是从它派生的。
import { z } from "zod";

import {
  DOCUMENT_READ_ALIASES,
  documentReadScopeForAlias,
} from "../documentRead";
import {
  DOCUMENT_WRITE_ALIASES,
  documentWriteOperationForAlias,
} from "../documentWrite";
import {
  LANE_MODEL_OUTPUT_MAX_BYTES,
  LANE_MODEL_OUTPUT_MAX_LINES,
} from "../../agentLane/laneContracts";
import { modelArgumentTolerance, noArgumentTolerance } from "../modelArgumentTolerance";
import { NO_ARGUMENTS_SCHEMA } from "../verbDeclaration";
import type { VerbDeclaration } from "../verbDeclaration";

/**
 * 说明书和执行必须是同一个数（G-04）：两个上限从 `laneContracts.ts` 的同一对常量插出来，
 * 截断真正发生的地方（`laneTools.mts`）读的也是它们。
 */
const OUTPUT_LIMIT = `Long text is truncated to the first ${LANE_MODEL_OUTPUT_MAX_LINES} lines or ${
  LANE_MODEL_OUTPUT_MAX_BYTES / 1024
}KB, whichever comes first; when that happens the result says so.`;

const DOCUMENT_GUIDELINES = Object.freeze([
  "Read the creation document before you change it: the user may have edited it since the last thing you saw.",
  "Write finished prose into the document, never a diff, a summary of your change, or a plan to write it later.",
]);

const writeContentSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .describe("The exact text to write into the document. Plain prose or Markdown, never a diff or a summary of the change."),
  })
  .strict();

/**
 * `content` 是这一族里唯一会被写错的字段，实机见过三种写法——整包参数序列化成 JSON 字符串、
 * 字段名写成 `text`/`body`、正文拆成字符串数组。三种都是「意思对、形状错」。
 */
const prepareWriteArguments = (() => {
  const shared = modelArgumentTolerance({ fieldAliases: { content: ["text", "body"] } });
  return (args: unknown): Record<string, unknown> => {
    if (typeof args === "string" && !args.trim().startsWith("{")) return { content: args };
    const record = shared(args);
    if (Array.isArray(record.content)) {
      record.content = record.content.filter((part): part is string => typeof part === "string").join("");
    }
    return record;
  };
})();

/** 「哪一份文稿」只有外部宿主需要说；Agent lane 永远写用户此刻正看着的那份。 */
const DOCUMENT_ID_TRANSPORT_FIELD = Object.freeze({
  documentId: Object.freeze({
    type: "string" as const,
    minLength: 1,
    description: "Which document to act on. Omit to use the project's active creation document.",
  }),
});

const READ_DESCRIBE = {
  full: {
    does: "Read the entire creation document as plain text, exactly as the user sees it.",
    useWhen: "Use it before editing the script, when splitting text into shots, and whenever you need the whole document rather than a fragment.",
    notWhen: `Do not use it to resolve "this" or "here" — that needs read_selection. Do not use it for canvas shots (nomi_canvas_read) or the timeline (read_timeline).`,
    params: `Takes no arguments. ${OUTPUT_LIMIT}`,
  },
  selection: {
    does: "Read only the text the user currently has selected in the creation document.",
    useWhen: `Use it whenever the user says "this", "here" or "the selected part" — it is the only way to resolve those words.`,
    notWhen: "Do not use it when the user means the whole document (read_full_text). An empty result means nothing is selected: ask, do not guess.",
    params: `Takes no arguments. ${OUTPUT_LIMIT}`,
  },
} as const;

const WRITE_DESCRIBE = {
  insert: {
    does: "Insert finished prose at the user's cursor in the creation document, pushing later text down.",
    useWhen: "Use it when the user asks you to add text where they are working and nothing should be removed.",
    notWhen: "Do not use it to replace what the user selected (replace_selection) or to add a new section at the very end (append_to_end). Not for shot prompts (nomi_generation_plan).",
    params: "`content` is the exact text to write — plain prose or Markdown, never a diff or a description of what you would write. Read the document first (read_full_text).",
  },
  replace: {
    does: "Replace the text the user currently has selected with new prose.",
    useWhen: "Use it when the user asks you to rewrite, tighten or fix the part they selected.",
    notWhen: "Do not use it without reading the selection first (read_selection) unless the user told you exactly what to replace; an empty selection makes it behave like insert_at_cursor.",
    params: "`content` is the exact replacement text; the selection disappears and `content` takes its place.",
  },
  append: {
    does: "Append finished prose to the very end of the creation document.",
    useWhen: "Use it to add a new section when the cursor position is irrelevant and nothing existing should be touched.",
    notWhen: "Do not use it to change text that already exists (replace_selection) or to write at the cursor (insert_at_cursor).",
    params: "`content` is the exact text, including any leading blank line you want between it and the previous text.",
  },
} as const;

export function documentVerbs(): VerbDeclaration[] {
  const reads = (Object.values(DOCUMENT_READ_ALIASES) as string[]).map((alias): VerbDeclaration => {
    const scope = documentReadScopeForAlias(alias);
    if (!scope) throw new Error(`Unregistered document.read alias: ${alias}`);
    return {
      name: alias,
      contractId: "document.read",
      effect: "read",
      nextAction: "none",
      describe: READ_DESCRIBE[scope],
      promptGuidelines: DOCUMENT_GUIDELINES,
      schema: NO_ARGUMENTS_SCHEMA,
      examples: [{ when: "Always call it with no arguments:", arguments: {} }],
      aliasBoundInput: Object.freeze({ scope }),
      mcpTransportFields: DOCUMENT_ID_TRANSPORT_FIELD,
      prepareArguments: noArgumentTolerance,
    };
  });
  const writes = (Object.values(DOCUMENT_WRITE_ALIASES) as string[]).map((alias): VerbDeclaration => {
    const operation = documentWriteOperationForAlias(alias);
    if (!operation) throw new Error(`Unregistered document.write alias: ${alias}`);
    return {
      name: alias,
      contractId: "document.write",
      effect: "reversible_local",
      nextAction: "none",
      describe: WRITE_DESCRIBE[operation],
      promptGuidelines: DOCUMENT_GUIDELINES,
      schema: writeContentSchema,
      examples: [{ when: "Write one finished paragraph:", arguments: { content: "The rain had not stopped for three days." } }],
      aliasBoundInput: Object.freeze({ operation }),
      mcpTransportFields: DOCUMENT_ID_TRANSPORT_FIELD,
      prepareArguments: prepareWriteArguments,
    };
  });
  return [...reads, ...writes];
}
