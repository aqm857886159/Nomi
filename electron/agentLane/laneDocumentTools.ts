// Agent lane · `document.read` / `document.write` 的模型可见工具面（阶段 1 的那一条能力）
//
// 为什么先选这两个：#547 实测它们今天就是 **100%**（读类 37/37）。所以垂直切片里
// 任何一次失败都能干净地归因到**新通路**，而不是「模型本来就填不对」。
//
// 三条形状规则，全部来自 #547 的真实数据而不是审美：
//   ① **一个别名 = 一个工具**。`read_full_text` / `read_selection` 是两个工具，不是一个
//      带 `scope` 枚举的工具——出问题的从来不是「工具多」，是「一个工具里塞 9 个分支」。
//   ② **别名定死的字段不出现在模型可见 schema 里**。`read_full_text` 的 `scope` 已经由
//      名字说完了，再让模型填一次就是请它多做一次可能做错的选择。
//   ③ **容忍在 `prepareArguments`，不在 schema**。探针 §4.2 臂 A 实测：schema 不合法的
//      参数**根本走不到** `before_tool`，所以捏合只能发生在校验之前；把 schema 放松则是
//      对**所有**调用放松，那是 0/18 的来历。
import { z } from "zod";

import {
  DOCUMENT_READ_ALIASES,
  documentReadScopeForAlias,
  projectDocumentRead,
  type DocumentReadInput,
  type DocumentReadResult,
} from "../shared/agentCapabilities/documentRead";
import {
  DOCUMENT_WRITE_ALIASES,
  documentWriteOperationForAlias,
  documentWriteResultSchema,
  type DocumentWriteInput,
  type DocumentWriteResult,
} from "../shared/agentCapabilities/documentWrite";
import {
  LANE_MODEL_OUTPUT_MAX_BYTES,
  LANE_MODEL_OUTPUT_MAX_LINES,
} from "../shared/agentLane/laneContracts";
import type { LaneToolDescriptor } from "./laneRuntimePort";

/** 领域侧。lane 不认识编辑器，只认识这两个动作——K4/K5 的「按 id 引用，永不复制」同一条纪律。 */
export interface DocumentLanePort {
  read(scope: DocumentReadInput["scope"]): Promise<unknown>;
  write(input: DocumentWriteInput): Promise<DocumentWriteResult>;
}

/**
 * 说明书和执行必须是同一个数（G-04）。这句话里的两个上限**不是抄的**，是从
 * `laneContracts.ts` 的同一对常量插出来的——截断真正发生的地方（`laneTools.mts`）
 * 读的也是它们。原来这里写的是 "with no truncation"，那句话在截断落地的那一刻
 * 就变成了一句谎：模型会把半截原稿当成全文，而它读到的说明书告诉它「不会被截」。
 */
const OUTPUT_LIMIT_SENTENCE = `Long text is truncated to the first ${LANE_MODEL_OUTPUT_MAX_LINES} lines or ${
  LANE_MODEL_OUTPUT_MAX_BYTES / 1024
}KB, whichever comes first; when that happens the result says so and tells you what to do next.`;

const READ_DESCRIPTIONS: Readonly<Record<DocumentReadInput["scope"], string>> = {
  full: [
    "Read the entire creation document as plain text.",
    "Call this before writing anything, so your edit lands in the document that actually exists rather than the one you assume.",
    "Takes no arguments; the returned text is the document exactly as the user sees it.",
    OUTPUT_LIMIT_SENTENCE,
  ].join(" "),
  selection: [
    "Read only the text the user currently has selected in the creation document.",
    "Use this when the user says \"this\", \"here\" or \"the selected part\" — it is the only way to know what they pointed at.",
    "Takes no arguments; returns an empty string when nothing is selected, which means you should ask rather than guess.",
    OUTPUT_LIMIT_SENTENCE,
  ].join(" "),
};

const WRITE_DESCRIPTIONS: Readonly<Record<DocumentWriteInput["operation"], string>> = {
  insert: [
    "Insert new text into the creation document at the user's cursor.",
    "Existing text is never removed; everything after the cursor is pushed down.",
    "Pass the finished prose in `content` — not a diff, not a description of what you would write.",
  ].join(" "),
  replace: [
    "Replace the text the user currently has selected with new text.",
    "The selection disappears and `content` takes its place, so read the selection first unless the user told you exactly what to write.",
    "Pass the finished prose in `content`; an empty selection makes this behave like an insertion at the cursor.",
  ].join(" "),
  append: [
    "Append text to the very end of the creation document.",
    "Nothing existing is touched and the cursor position is irrelevant, which makes this the safe choice for adding a new section.",
    "Pass the finished prose in `content`, including any leading blank line you want between it and the previous text.",
  ].join(" "),
};

const writeContentSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .describe("The exact text to write into the document. Plain prose or Markdown, never a diff or a summary of the change."),
  })
  .strict();

/** 不收参数的工具。**显式的空对象**说的是「这个工具不收参数」，`{}` 说的是「随便填」。 */
const noArgumentsSchema = z.object({}).strict();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return undefined;
    try {
      return asRecord(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * 无参工具的容忍：模型很爱给不收参数的工具塞一个 `{"scope":"full"}`（因为别的工具收）。
 * 那不是错误，是它在复述我们已经用工具名说过的事——把它安静地丢掉，别让一次正确意图
 * 死在 `additionalProperties: false` 上。
 */
function prepareNoArguments(): Record<string, never> {
  return {};
}

/**
 * 写入工具的容忍：`content` 是这一族里唯一会被写错的字段，实机见过三种写法——
 * 整包参数被序列化成 JSON 字符串、字段名写成 `text`/`body`、正文拆成字符串数组。
 * 三种都是「意思对、形状错」，捏合它们不放松任何语义。
 */
function prepareWriteArguments(args: unknown): { content: string } {
  const record = asRecord(args) ?? {};
  const raw = record.content ?? record.text ?? record.body;
  if (Array.isArray(raw)) {
    return { content: raw.filter((part): part is string => typeof part === "string").join("") };
  }
  if (typeof raw === "string") return { content: raw };
  if (typeof args === "string" && !args.trim().startsWith("{")) return { content: args };
  // 捏不出来就原样交给 pi 的校验器：它会告诉模型「缺 content」并回显收到的参数
  // （探针 §4.2 臂 A），那比我们编一个空字符串强得多。
  return record as { content: string };
}

export function createDocumentLaneTools(port: DocumentLanePort): LaneToolDescriptor[] {
  const readTools = (Object.values(DOCUMENT_READ_ALIASES) as string[]).map((alias): LaneToolDescriptor => {
    const scope = documentReadScopeForAlias(alias);
    if (!scope) throw new Error(`Unregistered document.read alias: ${alias}`);
    return {
      name: alias,
      description: READ_DESCRIPTIONS[scope],
      schema: noArgumentsSchema,
      prepareArguments: prepareNoArguments,
      execute: async () => {
        const result: DocumentReadResult = projectDocumentRead(await port.read(scope));
        return { ok: true, text: result.text, details: { scope } };
      },
    };
  });
  const writeTools = (Object.values(DOCUMENT_WRITE_ALIASES) as string[]).map((alias): LaneToolDescriptor => {
    const operation = documentWriteOperationForAlias(alias);
    if (!operation) throw new Error(`Unregistered document.write alias: ${alias}`);
    return {
      name: alias,
      description: WRITE_DESCRIPTIONS[operation],
      schema: writeContentSchema,
      prepareArguments: prepareWriteArguments,
      execute: async (args) => {
        // 校验只发生一次，就是 pi 的那次：`prepareArguments` 捏合 → pi 用
        // `toModelVisibleSchema` 生成的 schema 跑 ajv → 才轮到这里。再 `parse` 一遍
        // 就又变成两个互不认识的验证器（#547 §2.2③），而「信息不丢」门岗保证了
        // 生成的 schema 不弱于 zod，所以这个断言不是在赌。
        const { content } = args as z.infer<typeof writeContentSchema>;
        // 领域适配器的**输出**仍然校验：那是能力契约的收据形状（K1），
        // 与「模型输入校验几次」是两件事。
        const receipt = documentWriteResultSchema.parse(await port.write({ operation, content }));
        // 模型看到的是一张**收据**，不是被写进去的正文——正文它自己刚写的，回显一遍
        // 只是在烧上下文。`revision` 是它下一步该引用的那个 id（按 id join，不复制）。
        return {
          ok: true,
          text: `Applied ${operation} to the document. New revision ${receipt.revision}.`,
          details: receipt,
        };
      },
    };
  });
  return [...readTools, ...writeTools];
}
