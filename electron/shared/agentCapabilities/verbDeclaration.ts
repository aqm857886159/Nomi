// 一个模型可见动词的**唯一声明**，以及从它派生一切的地方（设计正本 §6.1「一份声明，三处派生」）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 2026-09-11 审计：同一个工具名（`nomi_generation_plan`）在仓库里有三份不同的说明书，其中两份
// 互相否定（一份说它能 preview，一份说它 cannot preview），而**没有任何东西会因此报错**。
// 三份各住一个代码层（注册表 / harness 清单 / 契约投影），每层对「这个工具做什么、后果是什么」
// 各写一遍，各用一套副作用词表（`{mutates,billable,reversal}` / `{sideEffect,risk}` / `effect+effectClass`）。
//
// 这个文件把「一个动词是什么」收成**一个对象**（`VerbDeclaration`），描述、提示词菜单、副作用、
// 超时预算、MCP 注解全部从它**派生**——手抄的地方没有了，漂移就没有地方发生。
//
// ── 四条装配期不变量（R28：编译器拦不住的，装配期当场抛，App 起不来） ──
//
//   A1 一效果一工具：`effect` 恰好一个四值枚举，且与契约一致；内部 profile 见 `spend` 即抛。
//   A2 描述五槽：does / useWhen / notWhen / params 必填；`notWhen` 至少点名一个**别的**动词；
//      描述里出现的 `x_y` 形名字必须解析得到（动词名或本工具 schema 的枚举值）。
//   A3 语言统一：模型读的说明性文字全英文（示例**值**豁免——它们演示「提示词跟用户同语言」）。
//   A4 不与付费边界矛盾：后果句由 `effect × nextAction` 表派生，手写文本里不得再出现
//      "cannot … paid generation" 一族（那正是 M2/M3 矛盾的来源）。
//
// 规则本体住这里（`assembleVerbDeclarations`），阳性对照住 `verbDeclarations.test.ts`（R17）。
import type { ZodTypeAny } from "zod";

import { z } from "zod";

import type { CapabilityContract, CapabilityEffectClass } from "./capabilityContract";
import type { JsonSchemaObject } from "./modelVisibleJsonSchema";
import { toPublishedJsonSchema } from "./modelVisibleJsonSchema";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;

/** 两个 profile。名字与 `check:model-schema` 的 profile 列、方案 §3.1 的表头逐字一致。 */
export type ToolProfile = "internal" | "mcp";
export type LaneDomainToolGroup = "timeline" | "production" | "generation" | "media" | "maintenance" | "models";

/**
 * **全仓唯一的效果词表**（设计正本 §3）。
 *   · `read`             不改任何状态
 *   · `reversible_local` 改了、能撤、不花钱
 *   · `spend`            花用户的钱（宿主独占；内部 profile 装配期即抛）
 *   · `irreversible`     撤不回
 */
export const VERB_EFFECTS = ["read", "reversible_local", "spend", "irreversible"] as const;
export type VerbEffect = (typeof VERB_EFFECTS)[number];

/** 成功时用户接下来会看到什么（设计正本 §6.2）。读动词恒 `none`。 */
export const VERB_NEXT_ACTIONS = [
  "none",
  "user_sees_spend_card",
  "user_sees_review_card",
  "user_sees_confirm_card",
  "user_sees_panel",
  "job_running",
] as const;
export type VerbNextAction = (typeof VERB_NEXT_ACTIONS)[number];

/**
 * 两个 profile 之间允许的差异，只有两种领域约束（设计正本 §6.4）。
 * `mcpHandwrittenTransport` 是**过渡值**：对外面今天还有手写的传输目录（`mcpToolCatalog.ts` /
 * `mcpGenerationToolCatalog.ts` / 手写适配器），这些动词在 PR B 收编对外面时改成前两种或删掉；
 * `check:tool-face` 的 `profile-reason-transitional` 棘轮只许它减少。
 */
export type VerbProfileReason = "paidBoundary" | "headlessHost" | "mcpHandwrittenTransport";

/**
 * 「同一句用户的话，两个动词都能办成」的组（审计 §4.1 D1–D4）。同组动词两两之间**必须**
 * 在 `notWhen` 里互相点名并给出裁决——门岗 `mutual-tiebreak` 逐对核。
 */
export type VerbEffectGroup = "canvas-node-creation" | "finished-piece" | "media-record" | "job-status-cancel";

/**
 * 描述不是一段散文，是四个必填槽 + 一个派生槽（Anthropic define-tools 的四要素 + 「不返回什么」）。
 * 第五槽 `consequence` **不手写**：由 `effect × nextAction` 查表，手写就会出现
 * "This host cannot preview or start paid generation" 这种与付费边界矛盾的句子。
 */
export interface VerbDescription {
  /** 一句：改/读什么。同时是系统提示词 `Available tools` 菜单里的那一行。 */
  readonly does: string;
  /** 用户说什么时用。 */
  readonly useWhen: string;
  /** 什么时候不要用 + 该用哪个（点名动词）。 */
  readonly notWhen: string;
  /** 参数从哪来（"ids come from nomi_canvas_read"）。 */
  readonly params: string;
}

/** 一个 schema-valid 的调用示例。`when` 是说明性文字（英文），`arguments` 的值可以是中文。 */
export interface VerbExample {
  readonly when: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** 显式的空对象 schema。`{}` 说的是「随便填」，这个说的是「这个工具不收参数」。 */
export const NO_ARGUMENTS_SCHEMA = z.object({}).strict();

export interface VerbDeclaration {
  /** 内部 profile 的工具名。一别名一工具。 */
  readonly name: string;
  /** 归属契约。MCP profile 按它归并成一个对外工具；审批按它（或 `operationCapabilityIds`）查。 */
  readonly contractId: string;
  /** 恰好一个。见 `VERB_EFFECTS`。 */
  readonly effect: VerbEffect;
  /** 成功时用户看到什么。读动词恒 `none`。 */
  readonly nextAction: VerbNextAction;
  readonly describe: VerbDescription;
  /** 模型真正要填的那一部分语义输入。别名定死的字段已经剥掉（见 `aliasBoundInput`）。 */
  readonly schema: ZodTypeAny;
  /** 至少一个，当工具字段数 ≥10 或语义上有分支时（门岗 `missing-example`）。 */
  readonly examples: readonly VerbExample[];
  /** 通道③：进系统提示词的 `Guidelines`，跨工具去重。 */
  readonly promptGuidelines?: readonly string[];
  /** 延迟披露的领域组。缺省 = 常驻。 */
  readonly internalGroup?: LaneDomainToolGroup;
  /** 混合读写工具按 operation 解析审批对象。 */
  readonly operationCapabilityIds?: Readonly<Record<string, string>>;
  /** 别名已经替模型填掉的语义字段；两个 profile 都从这里恢复它们。 */
  readonly aliasBoundInput?: Readonly<Record<string, string>>;
  /** 哪些 profile 投影它。缺省两个都投；不同于缺省时必须给 `profileReason`。 */
  readonly profiles?: readonly ToolProfile[];
  readonly profileReason?: VerbProfileReason;
  /** 「外部才有」的传输字段（`documentId`）。不进语义输入，不进指纹。 */
  readonly mcpTransportFields?: Readonly<Record<string, JsonSchemaObject>>;
  /** 同效果组（一个动词可以在多个组里），见 `VerbEffectGroup`。 */
  readonly effectGroups?: readonly VerbEffectGroup[];
  /** pi 官方的容忍钩子，在 ajv 校验之前跑。 */
  prepareArguments?(args: unknown): unknown;
}

/** 后果句：`effect × nextAction` 一张表，全仓只此一份。查不到的组合 = 声明不自洽，装配期抛。 */
const CONSEQUENCE_BY: Readonly<Record<VerbEffect, Partial<Record<VerbNextAction, string>>>> = Object.freeze({
  read: Object.freeze({
    none: "Nothing changes; it only reads.",
  }),
  reversible_local: Object.freeze({
    none: "The change lands in the project as a reversible local edit (in step-by-step approval mode the user confirms it first; otherwise it applies right away). Nothing is generated and nothing is spent.",
    user_sees_spend_card: "The draft lands on the canvas and Nomi shows the user a priced confirmation card in its own panel; nothing is generated and nothing is spent until the user approves it there. Never say generation has started — say what the card shows.",
    user_sees_review_card: "The user sees the plan highlighted with a review card before it applies (in full-auto mode it applies and the result says so). The edit is reversible.",
    user_sees_panel: "A Nomi panel opens for the user; this call stores nothing by itself.",
  }),
  spend: Object.freeze({
    user_sees_spend_card: "The user's provider credit is spent only after the user approves the card in the host; the call itself never spends.",
  }),
  irreversible: Object.freeze({
    user_sees_confirm_card: "The user always sees a confirmation card first, in every approval mode; once applied it cannot be undone by Nomi.",
    job_running: "After the user confirms, the job runs and can be followed with the matching status tool; it cannot be undone.",
  }),
});

export function verbConsequence(effect: VerbEffect, nextAction: VerbNextAction): string {
  const sentence = CONSEQUENCE_BY[effect][nextAction];
  if (!sentence) throw new Error(`No consequence sentence for effect "${effect}" with nextAction "${nextAction}"; the declaration is inconsistent.`);
  return sentence;
}

/** 描述五槽 → 模型读到的那一段（Anthropic 的五步顺序：做什么 → 何时用 → 何时不用 → 参数 → 后果）。 */
export function renderVerbDescription(declaration: Pick<VerbDeclaration, "describe" | "effect" | "nextAction">): string {
  const { does, useWhen, notWhen, params } = declaration.describe;
  return [does, useWhen, notWhen, params, verbConsequence(declaration.effect, declaration.nextAction)]
    .map((part) => part.trim())
    .join(" ");
}

// ── 派生：副作用与预算 ────────────────────────────────────────────────────

/** 读类工具的预算（毫秒）。一次领域读跑到 30 秒就是领域坏了，不是慢。 */
export const MODEL_TOOL_READ_TIMEOUT_MS_VALUE = 30_000;
/** 写类工具的预算（毫秒）。画布/文稿一次写入含持久化，给到一分钟。 */
export const MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE = 60_000;

/** 会不会改领域状态。pi `replay` 与 `executionMode` 的唯一派生点。 */
export function verbMutates(effect: VerbEffect): boolean {
  return effect !== "read";
}

/** 会不会花用户在供应商那里的钱。 */
export function verbBillable(effect: VerbEffect): boolean {
  return effect === "spend";
}

/**
 * 审批闸眼里的两个事实（`capabilityApprovalPolicy.ts` 的 `CapabilityApprovalSubject`），从一个动词
 * 效果派生。**与契约层词表的对应关系只写这一次**；契约上的 `effect/effectClass` 是审批的判据，
 * 动词的 `effect` 与它对账（A1），不替换它。
 */
export function approvalFacetsOf(effect: VerbEffect): {
  readonly effect: AnyCapabilityContract["effect"];
  readonly effectClass: CapabilityEffectClass;
} {
  switch (effect) {
    case "read": return { effect: "read", effectClass: "reversible_local" };
    case "reversible_local": return { effect: "reversible_write", effectClass: "reversible_local" };
    case "spend": return { effect: "paid", effectClass: "spend" };
    case "irreversible": return { effect: "reversible_write", effectClass: "irreversible" };
  }
}

/** 契约 → 它期待的动词效果。A1 用它对账。 */
export function verbEffectExpectedByContract(contract: Pick<AnyCapabilityContract, "effect" | "effectClass">): VerbEffect {
  if (contract.effect === "paid" || contract.effectClass === "spend") return "spend";
  if (contract.effect === "read") return "read";
  if (contract.effectClass === "irreversible") return "irreversible";
  return "reversible_local";
}

// ── 装配期不变量 ─────────────────────────────────────────────────────────

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/;
/** `x_y` 形的名字：动词名、operation 值、taskKind 值都长这样。 */
const NAME_TOKEN = /\b(?:nomi_)?[a-z]+(?:_[a-z]+)+\b/g;
/** 与付费边界矛盾的手写措辞（审计 M2/M3）。后果句是派生的，手写文本里出现这些就是第二份后果。 */
const PAID_CONTRADICTION = /\b(?:host\s+)?cannot\s+(?:preview|start|run|submit)\b[^.]*\b(?:paid|generation|credit)\b|\bnever\s+generates?\b|\bdoes\s+not\s+spend\b/i;
const DOES_MAX_CHARS = 160;

function enumValuesOf(schema: JsonSchemaObject, out: Set<string>): void {
  if (Array.isArray(schema.enum)) for (const value of schema.enum) if (typeof value === "string") out.add(value);
  for (const key of ["properties", "definitions", "$defs"] as const) {
    const bucket = schema[key];
    if (bucket && typeof bucket === "object" && !Array.isArray(bucket)) {
      for (const child of Object.values(bucket as Record<string, unknown>)) {
        if (child && typeof child === "object") enumValuesOf(child as JsonSchemaObject, out);
      }
    }
  }
  for (const key of ["items", "additionalProperties"] as const) {
    const child = schema[key];
    if (child && typeof child === "object" && !Array.isArray(child)) enumValuesOf(child as JsonSchemaObject, out);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) for (const branch of branches) if (branch && typeof branch === "object") enumValuesOf(branch as JsonSchemaObject, out);
  }
}

function fieldDescriptionsOf(schema: JsonSchemaObject, pointer: string, out: Array<{ pointer: string; text: string }>): void {
  if (typeof schema.description === "string" && pointer) out.push({ pointer, text: schema.description });
  const properties = schema.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [field, child] of Object.entries(properties as Record<string, unknown>)) {
      if (child && typeof child === "object") fieldDescriptionsOf(child as JsonSchemaObject, `${pointer}/${field}`, out);
    }
  }
  for (const key of ["items", "additionalProperties"] as const) {
    const child = schema[key];
    if (child && typeof child === "object" && !Array.isArray(child)) fieldDescriptionsOf(child as JsonSchemaObject, `${pointer}/${key}`, out);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) branches.forEach((branch, index) => {
      if (branch && typeof branch === "object") fieldDescriptionsOf(branch as JsonSchemaObject, `${pointer}/${key}/${index}`, out);
    });
  }
  for (const key of ["definitions", "$defs"] as const) {
    const bucket = schema[key];
    if (bucket && typeof bucket === "object" && !Array.isArray(bucket)) {
      for (const [name, child] of Object.entries(bucket as Record<string, unknown>)) {
        if (child && typeof child === "object") fieldDescriptionsOf(child as JsonSchemaObject, `${pointer}/${key}/${name}`, out);
      }
    }
  }
}

export interface VerbAssemblyInput {
  readonly declarations: readonly VerbDeclaration[];
  readonly contractById: (id: string) => AnyCapabilityContract | undefined;
  /** 付费边界上的名字（`paidBoundary.isPaidBoundaryAlias`）。A4 用它对账。 */
  readonly isPaidBoundaryName: (name: string) => boolean;
}

/**
 * 装配：跑四条不变量，返回冻结的声明表。**任何一条不满足就抛**，不过滤、不降级。
 * 这是 `modelFacingToolRegistry.ts` 的唯一输入口。
 */
export function assembleVerbDeclarations(input: VerbAssemblyInput): readonly VerbDeclaration[] {
  const names = new Set<string>();
  for (const declaration of input.declarations) {
    if (names.has(declaration.name)) throw new Error(`Duplicate verb declaration: ${declaration.name}`);
    names.add(declaration.name);
  }
  const published = new Map<string, JsonSchemaObject>();
  for (const declaration of input.declarations) {
    const contract = input.contractById(declaration.contractId);
    if (!contract) throw new Error(`Verb ${declaration.name} names an unregistered capability: ${declaration.contractId}`);
    published.set(declaration.name, toPublishedJsonSchema(declaration.schema));
    assertOneEffect(declaration, contract, input.isPaidBoundaryName);
    assertFiveSlots(declaration, names, published.get(declaration.name)!);
    assertEnglish(declaration, published.get(declaration.name)!);
    assertNoPaidContradiction(declaration, input.isPaidBoundaryName);
    if (declaration.profiles && declaration.profiles.length !== 2 && !declaration.profileReason) {
      throw new Error(`Verb ${declaration.name} projects to ${declaration.profiles.join("+")} only but gives no profileReason (paidBoundary | headlessHost).`);
    }
    for (const example of declaration.examples) {
      const parsed = declaration.schema.safeParse(example.arguments);
      if (!parsed.success) {
        throw new Error(`Verb ${declaration.name} example "${example.when}" fails its own schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
      }
    }
  }
  return Object.freeze([...input.declarations]);
}

/** A1 · 一效果一工具，且与契约一致；内部 profile 见 `spend` 即抛。 */
function assertOneEffect(
  declaration: VerbDeclaration,
  contract: AnyCapabilityContract,
  isPaidBoundaryName: (name: string) => boolean,
): void {
  if (!VERB_EFFECTS.includes(declaration.effect)) {
    throw new Error(`Verb ${declaration.name} declares effect "${String(declaration.effect)}"; allowed: ${VERB_EFFECTS.join(", ")}`);
  }
  if ("operationEffects" in declaration || "effects" in declaration) {
    throw new Error(`Verb ${declaration.name} declares per-operation effects; a verb has exactly one effect (split the verb instead).`);
  }
  if (!VERB_NEXT_ACTIONS.includes(declaration.nextAction)) {
    throw new Error(`Verb ${declaration.name} declares nextAction "${String(declaration.nextAction)}"`);
  }
  if (declaration.effect === "read" && declaration.nextAction !== "none") {
    throw new Error(`Verb ${declaration.name} is read-only but promises the user will see "${declaration.nextAction}".`);
  }
  verbConsequence(declaration.effect, declaration.nextAction);
  const expected = verbEffectExpectedByContract(contract);
  if (expected !== declaration.effect) {
    throw new Error(
      `Verb ${declaration.name} declares effect "${declaration.effect}" but its capability ${contract.id} `
      + `(effect=${contract.effect}, effectClass=${contract.effectClass}) implies "${expected}".`,
    );
  }
  const projectsInternal = (declaration.profiles ?? ["internal", "mcp"]).includes("internal");
  if (declaration.effect === "spend" && projectsInternal) {
    throw new Error(`Verb ${declaration.name} spends the user's credit and cannot project to the internal profile (paid boundary).`);
  }
  if (declaration.effect === "spend" && !isPaidBoundaryName(declaration.name)) {
    throw new Error(`Verb ${declaration.name} declares "spend" but is not on the paid boundary (contract must declare effect:"paid").`);
  }
  if (declaration.effect !== "spend" && isPaidBoundaryName(declaration.name)) {
    throw new Error(`Verb ${declaration.name} is on the paid boundary but declares "${declaration.effect}" instead of "spend".`);
  }
}

/** A2 · 描述五槽齐全；`notWhen` 点名别的动词；名字都解析得到。 */
function assertFiveSlots(declaration: VerbDeclaration, names: ReadonlySet<string>, schema: JsonSchemaObject): void {
  const { does, useWhen, notWhen, params } = declaration.describe;
  for (const [slot, text] of Object.entries({ does, useWhen, notWhen, params })) {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error(`Verb ${declaration.name} leaves describe.${slot} empty; all four slots are required (does / useWhen / notWhen / params).`);
    }
  }
  if (/\n/.test(does) || does.length > DOES_MAX_CHARS || does.includes("{")) {
    throw new Error(`Verb ${declaration.name}: describe.does is the one-line menu entry — no newline, no JSON, at most ${DOES_MAX_CHARS} characters (got ${does.length}).`);
  }
  const enums = new Set<string>();
  enumValuesOf(schema, enums);
  const resolvable = (token: string) => names.has(token) || enums.has(token);
  const siblings = [...notWhen.matchAll(NAME_TOKEN)].map((m) => m[0]).filter((token) => names.has(token) && token !== declaration.name);
  if (siblings.length === 0) {
    throw new Error(`Verb ${declaration.name}: describe.notWhen must name at least one other declared verb ("use X instead").`);
  }
  for (const [slot, text] of Object.entries({ does, useWhen, notWhen, params })) {
    for (const match of text.matchAll(NAME_TOKEN)) {
      const token = match[0];
      if (!resolvable(token)) {
        throw new Error(`Verb ${declaration.name}: describe.${slot} names "${token}", which is neither a declared verb nor a value in its own schema.`);
      }
    }
  }
}

/** 说明性文字里**引号包着的示例值**（`e.g. '林夏'`）不是说明，是示范数据——A3 判 CJK 前先摘掉。 */
// 开引号前不能是字母——否则 `user's language (e.g. '林夏')` 里 `user's` 的撇号会被当成开引号。
const QUOTED_EXAMPLE = /(?<![A-Za-z])'[^']*'|"[^"]*"|‘[^’]*’|“[^”]*”/g;
export function proseWithoutQuotedExamples(text: string): string {
  return text.replace(QUOTED_EXAMPLE, "");
}

/** A3 · 模型读的说明性文字全英文。示例的 `arguments` 值与引号里的示例值豁免。 */
function assertEnglish(declaration: VerbDeclaration, schema: JsonSchemaObject): void {
  const prose: Array<[string, string]> = [
    ["describe.does", declaration.describe.does],
    ["describe.useWhen", declaration.describe.useWhen],
    ["describe.notWhen", declaration.describe.notWhen],
    ["describe.params", declaration.describe.params],
    ...(declaration.promptGuidelines ?? []).map((line, index): [string, string] => [`promptGuidelines[${index}]`, line]),
    ...declaration.examples.map((example, index): [string, string] => [`examples[${index}].when`, example.when]),
  ];
  const fields: Array<{ pointer: string; text: string }> = [];
  fieldDescriptionsOf(schema, "", fields);
  for (const field of fields) prose.push([`schema${field.pointer}.description`, field.text]);
  for (const [where, text] of prose) {
    if (CJK.test(proseWithoutQuotedExamples(text))) {
      throw new Error(`Verb ${declaration.name}: ${where} contains CJK characters; model-facing prose is English (example values may stay in the user's language).`);
    }
  }
}

/** A4 · 手写文本里不得出现与付费边界矛盾的后果句。 */
function assertNoPaidContradiction(declaration: VerbDeclaration, _isPaidBoundaryName: (name: string) => boolean): void {
  for (const [slot, text] of Object.entries(declaration.describe)) {
    if (PAID_CONTRADICTION.test(text)) {
      throw new Error(
        `Verb ${declaration.name}: describe.${slot} hand-writes a consequence ("${text.match(PAID_CONTRADICTION)?.[0]}"); `
        + "consequences derive from effect × nextAction and must not be restated.",
      );
    }
  }
}
