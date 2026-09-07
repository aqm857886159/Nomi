// Agent lane · `document.read` / `document.write` 的模型可见工具面
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
//
// 阶段 2 的增量：说明书那一半（`LaneToolSpec`）与执行那一半分开，三条描述通道各就各位，
// 容忍改从 `laneArgumentTolerance` 那一个 owner 拿（原来这里各写了一小段）。
import { z } from "zod";

import {
  DOCUMENT_READ_ALIASES,
  DOCUMENT_READ_CAPABILITY,
  documentReadScopeForAlias,
  projectDocumentRead,
  type DocumentReadInput,
  type DocumentReadResult,
} from "../shared/agentCapabilities/documentRead";
import {
  DOCUMENT_WRITE_ALIASES,
  DOCUMENT_WRITE_CAPABILITY,
  documentWriteOperationForAlias,
  documentWriteResultSchema,
  type DocumentWriteInput,
  type DocumentWriteResult,
} from "../shared/agentCapabilities/documentWrite";
import {
  LANE_MODEL_OUTPUT_MAX_BYTES,
  LANE_MODEL_OUTPUT_MAX_LINES,
} from "../shared/agentLane/laneContracts";
import type { LaneToolSpec } from "../shared/agentLane/laneToolContract";
import { laneArgumentTolerance, laneNoArgumentTolerance } from "./laneArgumentTolerance";
import { bindLaneTool, type LaneToolDescriptor } from "./laneRuntimePort";

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

/**
 * 通道③ · 这一族工具共享的纪律，**只写一次**。
 *
 * 上游 pi 把「该用它还是用隔壁那个」放进系统提示词的 `Guidelines`，去重且按实际工具集
 * 条件化（`core/system-prompt.js:45-76`）。写进每个工具的 description 等于把同一段话
 * 买 N 遍——那正是方案原本的 S4 与 S7（≤4000 token）在数学上互斥的地方。
 */
const DOCUMENT_GUIDELINES = Object.freeze([
  "Read the creation document before you change it: the user may have edited it since the last thing you saw.",
  "Write finished prose into the document, never a diff, a summary of your change, or a plan to write it later.",
]);

const READ_SPECS: Readonly<Record<DocumentReadInput["scope"], { description: string; snippet: string }>> = {
  full: {
    description: [
      "Read the entire creation document as plain text.",
      "Takes no arguments; the returned text is the document exactly as the user sees it.",
      OUTPUT_LIMIT_SENTENCE,
    ].join(" "),
    snippet: "read the whole creation document as plain text.",
  },
  selection: {
    description: [
      "Read only the text the user currently has selected in the creation document.",
      "Takes no arguments; returns an empty string when nothing is selected, which means you should ask rather than guess.",
      OUTPUT_LIMIT_SENTENCE,
    ].join(" "),
    snippet: 'read just the text the user has selected — the only way to resolve "this" or "here".',
  },
};

const WRITE_SPECS: Readonly<Record<DocumentWriteInput["operation"], { description: string; snippet: string }>> = {
  insert: {
    description: [
      "Insert new text into the creation document at the user's cursor.",
      "Existing text is never removed; everything after the cursor is pushed down.",
      "Pass the finished prose in `content` — not a diff, not a description of what you would write.",
    ].join(" "),
    snippet: "insert finished prose at the user's cursor, pushing later text down.",
  },
  replace: {
    description: [
      "Replace the text the user currently has selected with new text.",
      "The selection disappears and `content` takes its place, so read the selection first unless the user told you exactly what to write.",
      "Pass the finished prose in `content`; an empty selection makes this behave like an insertion at the cursor.",
    ].join(" "),
    snippet: "swap the user's current selection for new prose.",
  },
  append: {
    description: [
      "Append text to the very end of the creation document.",
      "Nothing existing is touched and the cursor position is irrelevant, which makes this the safe choice for adding a new section.",
      "Pass the finished prose in `content`, including any leading blank line you want between it and the previous text.",
    ].join(" "),
    snippet: "add a new section at the very end of the document.",
  },
};

const writeContentSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .describe("The exact text to write into the document. Plain prose or Markdown, never a diff or a summary of the change."),
  })
  .strict();

/**
 * 文稿这一族的副作用声明（第 ⑨ 维）。
 *
 * 与画布那一族差一档：文稿写入是**直接落进用户的稿子**的，它只是进了撤销栈
 * （`reversal: "undoable"`），不像画布提案那样还等一次接受。这一档差别过去只存在于
 * 两个领域适配器的实现里，模型面和恢复策略都看不见它。
 */
const DOCUMENT_READ_EFFECTS = Object.freeze({ mutates: false, billable: false, reversal: "none" } as const);
const DOCUMENT_WRITE_EFFECTS = Object.freeze({ mutates: true, billable: false, reversal: "undoable" } as const);

/** 不收参数的工具。**显式的空对象**说的是「这个工具不收参数」，`{}` 说的是「随便填」。 */
const noArgumentsSchema = z.object({}).strict();

/**
 * 写入工具的容忍：`content` 是这一族里唯一会被写错的字段，实机见过三种写法——
 * 整包参数被序列化成 JSON 字符串、字段名写成 `text`/`body`、正文拆成字符串数组。
 * 三种都是「意思对、形状错」，捏合它们不放松任何语义。
 *
 * 前两种由共享的 `laneArgumentTolerance` 处理（A 族与 D 族）；第三种是这一族特有的
 * ——数组元素拼回一整段正文，而不是包成一元数组——所以在这里补一小步。
 */
const prepareWriteArguments = (() => {
  const shared = laneArgumentTolerance({ fieldAliases: { content: ["text", "body"] } });
  return (args: unknown): Record<string, unknown> => {
    if (typeof args === "string" && !args.trim().startsWith("{")) return { content: args };
    const record = shared(args);
    if (Array.isArray(record.content)) {
      record.content = record.content.filter((part): part is string => typeof part === "string").join("");
    }
    return record;
  };
})();

/** 说明书那一半。门岗与系统提示词渲染只要这个，不需要任何领域 port。 */
export function documentLaneToolSpecs(): LaneToolSpec[] {
  const readSpecs = (Object.values(DOCUMENT_READ_ALIASES) as string[]).map((alias): LaneToolSpec => {
    const scope = documentReadScopeForAlias(alias);
    if (!scope) throw new Error(`Unregistered document.read alias: ${alias}`);
    return {
      name: alias,
      capabilityId: DOCUMENT_READ_CAPABILITY.id,
      description: READ_SPECS[scope].description,
      promptSnippet: READ_SPECS[scope].snippet,
      promptGuidelines: DOCUMENT_GUIDELINES,
      effects: DOCUMENT_READ_EFFECTS,
      schema: noArgumentsSchema,
      examples: [{ when: "Always call it with no arguments:", arguments: {} }],
      prepareArguments: laneNoArgumentTolerance,
    };
  });
  const writeSpecs = (Object.values(DOCUMENT_WRITE_ALIASES) as string[]).map((alias): LaneToolSpec => {
    const operation = documentWriteOperationForAlias(alias);
    if (!operation) throw new Error(`Unregistered document.write alias: ${alias}`);
    return {
      name: alias,
      capabilityId: DOCUMENT_WRITE_CAPABILITY.id,
      description: WRITE_SPECS[operation].description,
      promptSnippet: WRITE_SPECS[operation].snippet,
      promptGuidelines: DOCUMENT_GUIDELINES,
      effects: DOCUMENT_WRITE_EFFECTS,
      schema: writeContentSchema,
      examples: [{ when: "Write one finished paragraph:", arguments: { content: "The rain had not stopped for three days." } }],
      prepareArguments: prepareWriteArguments,
    };
  });
  return [...readSpecs, ...writeSpecs];
}

export function createDocumentLaneTools(port: DocumentLanePort): LaneToolDescriptor[] {
  return documentLaneToolSpecs().map((spec) => {
    const scope = documentReadScopeForAlias(spec.name);
    if (scope) {
      return bindLaneTool(spec, async () => {
        const result: DocumentReadResult = projectDocumentRead(await port.read(scope));
        return { ok: true, text: result.text, details: { scope } };
      });
    }
    const operation = documentWriteOperationForAlias(spec.name);
    if (!operation) throw new Error(`Unregistered document lane tool: ${spec.name}`);
    return bindLaneTool(spec, async (args) => {
      // 形状由 pi 的 ajv 验过、契约 parse 由 `laneTools.mts` 在唯一出口跑过，才轮到这里。
      // 这里**不再** parse——再来一遍就是第二个互不认识的验证器（#547 §2.2③）。
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
    });
  });
}
