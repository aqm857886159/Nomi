// 一个能力 = 一份模型可见描述符；两个 profile 从它派生（方案 §3.1，阶段 5a）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 用户 2026-09-07 的原话是「足够开放——能被各 Agent 调用」。今天做不到的原因不是缺功能，
// 是**同一件事被描述了两遍**：Nomi 自己的 Agent 读 `electron/agentLane/lane*Tools.ts` 里的
// 一份说明书，外部宿主（Claude Code 之类）经 MCP 读 `mcpCapabilityProjection.ts` 里**另一份**
// 手抄的 JSON Schema。两份的字段表、描述、甚至**动作词表**都各写各的：内部管「读时间轴」叫
// `read_timeline`，MCP 管同一件事叫 `operation:"read"`，中间靠一张手写映射表接上
// （`"read"` → `read_timeline`）。那张表就是漂移本身——它存在的唯一理由是两边不同源。
//
// 于是外部宿主拿到的说明书永远比内部的旧一点、松一点，而**没有任何东西会因此报错**。
//
// ── 这一层的形状 ──
//
// `ModelFacingToolSpec` = 一个别名一个工具的说明书（名字、三条描述通道、schema、示例、容忍钩子、
// 副作用声明），住在能力契约旁边而不是某一个 profile 里。两个 profile 的差异**只允许来自声明**：
//
//   · `internal`（Agent lane）—— 一别名一工具，无租约字段；`effect:"paid"` 的能力**不投影**。
//   · `mcp`（对外 stdio）    —— 一契约一工具，别名折成 `aliasBoundInput` 那几个判别字段；
//                              每个工具首字段是 `leaseHandle`（`dispatcher.ts` 执行前验）。
//
// 「别名折成判别字段」这一步是本文件的关键：`read_full_text` 的 `scope:"full"` 不是 MCP 侧
// 编出来的第二套词表，而是**别名本来就定死的那个语义输入**（`aliasBoundInput`）。两个 profile
// 因此共用同一套动作词表，手写映射表无处可写——这就是三处 `parseCall` 映射被删掉的机制。
//
// ── 为什么判据是「指纹」而不是「看起来一样」 ──
//
// 同源之后两边**结构上**不可能不同，但结构性质要有人证明它还成立：`scripts/check-model-schema.ts`
// 的 `profile-schema-drift` 规则按能力逐个比对两个 profile 的 `alias → 模型可见 JSON Schema` 指纹，
// 手改任何一边当场红（R17 的阳性对照在 `check-model-schema.node-test.mjs`）。
import type { CapabilityContract } from "./capabilityContract";
import { unwrapWholeArguments } from "./modelArgumentTolerance";
import { toPublishedJsonSchema, type JsonSchemaObject } from "./modelVisibleJsonSchema";
import {
  MODEL_TOOL_READ_TIMEOUT_MS_VALUE,
  MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE,
  renderVerbDescription,
  verbMutates,
  type VerbDeclaration,
} from "./verbDeclaration";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;

// 类型与效果词表的**唯一定义**住 `verbDeclaration.ts`；这里只是同一份定义的再导出，
// 让 lane / MCP / 门岗继续从 `modelFacingTools` 这个名字 import（不是第二份定义）。
export type {
  ToolProfile,
  LaneDomainToolGroup,
  VerbEffect,
  VerbNextAction,
  VerbExample as ModelFacingToolExample,
} from "./verbDeclaration";
export { NO_ARGUMENTS_SCHEMA, verbMutates, verbBillable, approvalFacetsOf } from "./verbDeclaration";
import type { ToolProfile } from "./verbDeclaration";

/**
 * 一个工具**最多允许跑多久**（方案 §1.6 第五行；阶段 3c）。
 *
 * 上游一点都不给（[pi #8857](https://github.com/earendil-works/pi/issues/8857)：工具级超时
 * 明说不做），所以没有这条的后果是：领域端口挂住 = 整条 lane 挂住，而症状是「它不动了」——
 * 既没有报错也没有收据，和模型在想事情长得一模一样。
 *
 * **它从 `effect` 派生，不逐工具手写**：读类 30s；写类按领域最慢的那条路给。花钱的工具必须
 * **提交即返回**（拿到 id 就回），所以它的预算也在读类量级——见 `laneTools.mts` 的装配期不变量。
 *
 * **审批等待不计时**：计时器在 `laneTools.mts` 的 `execute` 里才 arm，而闸跑在
 * `before_tool`——也就是**进 execute 之前**。用户想看五分钟再点「允许」，这条预算一秒不走。
 */
export interface ModelFacingToolExecution {
  readonly timeoutMs: number;
}

/** 读类工具的预算。一次领域读跑到 30 秒就是领域坏了，不是慢。 */
export const MODEL_TOOL_READ_TIMEOUT_MS = MODEL_TOOL_READ_TIMEOUT_MS_VALUE;

/** 写类工具的预算。画布/文稿一次写入含持久化，给到一分钟。 */
export const MODEL_TOOL_WRITE_TIMEOUT_MS = MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE;

/**
 * 一个「模型可见工具」= 一份动词声明 + 从它派生的三样东西（描述、菜单行、超时预算）。
 *
 * **声明是唯一 owner**（`verbDeclaration.ts`）；这里的派生字段没有第二个写入点：
 * - `description`   = 五槽渲染（做什么 → 何时用 → 何时不用 → 参数 → 后果句）
 * - `promptSnippet` = `describe.does`（系统提示词 `Available tools` 菜单那一行）
 * - `execution`     = 按 `effect` 派生的预算
 *
 * **两个 profile 读的是同一个对象**，所以这里的每个字段都必须是「与传输无关」的：
 * 租约、方法路由键、结果投影都不在这里，它们住各自 profile 的适配器里。
 */
export interface ModelFacingToolSpec extends VerbDeclaration {
  /** 通道①，派生。只说这个工具自己的事。 */
  readonly description: string;
  /** 通道②，派生 = `describe.does`。一行，进系统提示词的 `Available tools` 菜单。 */
  readonly promptSnippet: string;
  /** 派生自 `effect`。 */
  readonly execution: ModelFacingToolExecution;
}

/** 声明 → 说明书。**唯一派生点**，注册表装配时对每条声明调一次。 */
export function toModelFacingToolSpec(declaration: VerbDeclaration): ModelFacingToolSpec {
  return Object.freeze({
    ...declaration,
    description: renderVerbDescription(declaration),
    promptSnippet: declaration.describe.does,
    execution: Object.freeze({
      timeoutMs: verbMutates(declaration.effect) ? MODEL_TOOL_WRITE_TIMEOUT_MS : MODEL_TOOL_READ_TIMEOUT_MS,
    }),
  });
}

/** 别名把哪几个语义字段定死了。空对象 = 一个都没有。 */
export function aliasBoundInputOf(spec: ModelFacingToolSpec): Readonly<Record<string, string>> {
  return spec.aliasBoundInput ?? {};
}

/** 模型填的那部分 + 别名定死的那部分 = 契约的语义输入。**唯一恢复点**，两个 profile 共用。 */
export function toSemanticInput(
  spec: ModelFacingToolSpec,
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...aliasBoundInputOf(spec), ...args };
}

/** 这份说明书声明的「外部才有」传输字段。 */
export function mcpTransportFieldsOf(spec: ModelFacingToolSpec): Readonly<Record<string, JsonSchemaObject>> {
  return spec.mcpTransportFields ?? {};
}

export function projectsToProfile(spec: ModelFacingToolSpec, profile: ToolProfile): boolean {
  return (spec.profiles ?? PROFILES).includes(profile);
}

const PROFILES: readonly ToolProfile[] = Object.freeze(["internal", "mcp"]);

// ── MCP profile：一契约一工具 ────────────────────────────────────────────────

/** MCP 每个工具的首字段。执行前由 `dispatcher.ts` 验；模型面不出现在 internal profile。 */
export const MCP_LEASE_PROPERTIES: Readonly<Record<string, JsonSchemaObject>> = Object.freeze({
  leaseHandle: Object.freeze({
    type: "string",
    minLength: 1,
    description: "The project lease handle returned by nomi_session_open.",
  }),
  projectId: Object.freeze({ type: "string", minLength: 1 }),
});

export const MCP_LEASE_FIELD_NAMES: readonly string[] = Object.freeze(Object.keys(MCP_LEASE_PROPERTIES));

/** 一次装配期冲突。带上「哪两个别名在同一个字段上说了不同的话」，因为「schema 冲突」救不了任何人。 */
export class ConflictingProfileField extends Error {
  constructor(readonly contractId: string, readonly field: string, readonly aliases: readonly string[]) {
    super(
      `MCP profile for "${contractId}" cannot publish field "${field}": ${aliases.join(", ")} declare `
      + "different shapes for it. Give the field one shape in the shared descriptor, or split the capability.",
    );
    this.name = "ConflictingProfileField";
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function propertiesOf(schema: JsonSchemaObject): Record<string, JsonSchemaObject> {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  return properties as Record<string, JsonSchemaObject>;
}

function requiredOf(schema: JsonSchemaObject): readonly string[] {
  return Array.isArray(schema.required) ? schema.required.filter((v): v is string => typeof v === "string") : [];
}

/**
 * 合并两份同名字段的发布形状。
 *
 * 只有一种合并是安全的：**枚举取并集**（同一个判别字段在不同别名下各带一半合法值，
 * 画布写那三个工具就是这样）。其余任何不同都是「同一个概念被声明成了两种东西」——
 * 那是设计上的问题，当场抛，不许在传输层悄悄挑一个。
 */
function mergeFieldSchema(
  contractId: string,
  field: string,
  left: { schema: JsonSchemaObject; aliases: string[] },
  right: JsonSchemaObject,
  alias: string,
): void {
  if (stableStringify(left.schema) === stableStringify(right)) {
    left.aliases.push(alias);
    return;
  }
  const leftEnum = left.schema.enum;
  const rightEnum = right.enum;
  if (Array.isArray(leftEnum) && Array.isArray(rightEnum)) {
    const merged = { ...left.schema, enum: [...new Set([...leftEnum, ...rightEnum])] };
    const rest = (source: JsonSchemaObject) => stableStringify({ ...source, enum: null });
    if (rest(left.schema) === rest(right)) {
      left.schema = merged;
      left.aliases.push(alias);
      return;
    }
  }
  throw new ConflictingProfileField(contractId, field, [...left.aliases, alias]);
}

/** 别名定死的字段，发布成一个只有一个合法值的枚举（不是 `const`——Google 的 legacy 路径不认它，G-05）。 */
function aliasBoundProperty(values: readonly string[], field: string): JsonSchemaObject {
  return {
    type: "string",
    enum: [...values],
    description: `Which action to perform. Every other field is required by, or only meaningful to, specific values of \`${field}\`.`,
  };
}

export interface McpProfileTool {
  readonly contractId: string;
  /** 对外工具名。契约自己声明的那一个（`aliases.mcp`），不在这里发明。 */
  readonly name: string;
  readonly description: string;
  /** `tools/list` 上真正广播出去的那份 JSON Schema（含租约字段）。 */
  readonly inputSchema: JsonSchemaObject;
  /** 判别字段名 → 合法值。别名恢复用；`parseCall` 因此不需要任何映射表。 */
  readonly discriminators: Readonly<Record<string, readonly string[]>>;
  /** 声明出来的「外部才有」传输字段名。剥语义输入与算指纹时都按它跳过。 */
  readonly transportOnlyFields: readonly string[];
  /** 组成它的别名说明书，按声明顺序。指纹门岗与测试直接读它。 */
  readonly specs: readonly ModelFacingToolSpec[];
  readonly annotations?: { readonly readOnlyHint?: true; readonly destructiveHint?: true };
}

/**
 * MCP 注解**全量派生**（方案 §3.1 第三行）。今天是对 4 个工具手写 `readOnlyHint`，
 * 手写的必然漏——注解漏掉的后果是宿主把一个写操作当只读自动放行。
 *
 * 三条来源全在契约/描述符上，不在这里判断：
 *   · `readOnlyHint`   ← 契约 `effect === "read"`
 *   · `destructiveHint` ← 契约 `effectClass ∈ {irreversible, spend}`
 *   · MCP 规范说 hint **不可信除非来自受信服务器**，所以我们只用它抬高摩擦，从不降低。
 */
export function mcpAnnotationsFor(contract: AnyCapabilityContract): McpProfileTool["annotations"] {
  if (
    contract.effect === "destructive"
    || contract.effectClass === "irreversible"
    || contract.effectClass === "spend"
  ) {
    return Object.freeze({ destructiveHint: true as const });
  }
  if (contract.effect === "read") return Object.freeze({ readOnlyHint: true as const });
  return undefined;
}

/**
 * 对外 MCP 工具的描述——**从同一批声明派生**（不再读契约上的 `projections.mcp.description`，
 * 那是审计 §6.1 里的第二扇门，随 PR A 删除）。
 *
 * 一契约一工具：每个别名一行 `selector: does`（单别名就只有 `does`），`promptGuidelines` 跨别名去重后附在末尾。
 * 只投 `does` 这一槽而不是五槽全文，是 PR A「不改语义」的边界：PR A 之前对外面就是「一句摘要 + 纪律」，
 * `check:mcp-payload` 的棘轮按那个体积冻结；五槽全文与后果句对外发布是 PR B 与 20 动词一起做的事
 * （设计正本 §6.4 零差异），届时棘轮按「能力面有意扩张」记账，不在这里悄悄涨。
 */
export function mcpToolDescription(contract: AnyCapabilityContract, specs: readonly ModelFacingToolSpec[]): string {
  if (specs.length === 0) throw new Error(`No model-facing descriptor for ${contract.id}`);
  // 选择器只在**传输也从这份声明派生**时才印（`operation=…:`，与广播出去的枚举逐字相同）。传输还手写的
  // 契约（`mcpHandwrittenTransport`）对外的 operation 词表是适配器自己的，印内部别名会指到不存在的值，
  // 所以只列「它能做什么」的句子，不带选择器。
  const lines = specs.length === 1
    ? [specs[0]!.describe.does]
    : specs.map((spec) => {
      if (!projectsToProfile(spec, "mcp")) return spec.describe.does;
      const bound = Object.entries(aliasBoundInputOf(spec)).map(([field, value]) => `${field}=${value}`);
      const selector = bound.length > 0 ? bound.join(", ") : rootEnumSelectorsLabel(spec);
      return `${selector}: ${spec.describe.does}`;
    });
  return [...lines, ...new Set(specs.flatMap((spec) => spec.promptGuidelines ?? []))].join("\n");
}

function rootEnumSelectorsLabel(spec: ModelFacingToolSpec): string {
  const selectors = rootEnumSelectors(spec);
  const entries = Object.entries(selectors);
  return entries.length > 0 ? entries.map(([field, values]) => `${field}=${values.join("|")}`).join(", ") : spec.name;
}

/**
 * 一个契约的若干别名说明书 → 一个对外 MCP 工具。
 *
 * 合并规则只有三条，全部机械：
 *   ① 别名定死的字段（`aliasBoundInput`）发布成枚举，值 = 各别名声明的那个值；
 *   ② 模型可填字段取并集，同名字段形状必须相同（枚举取并集是唯一例外，见 `mergeFieldSchema`）；
 *   ③ 必填 = 租约字段 + 判别字段 + **所有别名都必填**的那些字段（少一个别名必填就不能全局必填）。
 */
export function projectMcpTool(
  contract: AnyCapabilityContract,
  specs: readonly ModelFacingToolSpec[],
): McpProfileTool {
  const name = contract.aliases.mcp;
  if (!name) throw new Error(`Capability ${contract.id} has no mcp alias to publish under`);
  if (specs.length === 0) throw new Error(`No model-facing descriptor for ${contract.id}`);

  const discriminators = new Map<string, Set<string>>();
  const fields = new Map<string, { schema: JsonSchemaObject; aliases: string[] }>();
  const requiredCounts = new Map<string, number>();
  const transportOnly = new Map<string, JsonSchemaObject>();

  // 一契约多动词、且动词自己没有判别字段（`aliasBoundInput` 或必填根级枚举）时，对外工具用 `verb` 字段选动词。
  // 值就是动词名——不另起一套词表；内部面按名字选，外部面按同一个名字选。
  const needsVerbDiscriminator = specs.length > 1
    && specs.some((spec) => Object.keys(aliasBoundInputOf(spec)).length === 0 && Object.keys(rootEnumSelectors(spec)).length === 0);
  for (const spec of specs) {
    for (const [field, schema] of Object.entries(mcpTransportFieldsOf(spec))) transportOnly.set(field, schema);
    for (const [field, value] of Object.entries(needsVerbDiscriminator ? { ...aliasBoundInputOf(spec), verb: spec.name } : aliasBoundInputOf(spec))) {
      const bucket = discriminators.get(field) ?? new Set<string>();
      bucket.add(value);
      discriminators.set(field, bucket);
    }
    const published = toPublishedJsonSchema(spec.schema);
    for (const [field, schema] of Object.entries(propertiesOf(published))) {
      const existing = fields.get(field);
      if (!existing) {
        fields.set(field, { schema, aliases: [spec.name] });
        continue;
      }
      mergeFieldSchema(contract.id, field, existing, schema, spec.name);
    }
    for (const field of requiredOf(published)) {
      requiredCounts.set(field, (requiredCounts.get(field) ?? 0) + 1);
    }
  }

  for (const field of discriminators.keys()) {
    if (fields.has(field)) {
      // 一个字段不能既由别名定死、又让模型填——那正是「让模型再选一次」的形状（G-01）。
      throw new ConflictingProfileField(contract.id, field, specs.map((spec) => spec.name));
    }
  }

  const properties: Record<string, JsonSchemaObject> = { ...MCP_LEASE_PROPERTIES };
  for (const [field, schema] of transportOnly) {
    if (fields.has(field) || discriminators.has(field)) {
      // 一个字段不能既是「外部才有的传输寻址」又是模型可见的语义输入——那是两个真相源。
      throw new ConflictingProfileField(contract.id, field, specs.map((spec) => spec.name));
    }
    properties[field] = schema;
  }
  for (const [field, values] of discriminators) {
    properties[field] = aliasBoundProperty([...values].sort(), field);
  }
  for (const [field, entry] of fields) properties[field] = entry.schema;

  const required = [
    "leaseHandle",
    ...[...discriminators.keys()].sort(),
    ...[...requiredCounts.entries()].filter(([, count]) => count === specs.length).map(([field]) => field).sort(),
  ];

  const annotations = mcpAnnotationsFor(contract);
  return Object.freeze({
    contractId: contract.id,
    name,
    description: mcpToolDescription(contract, specs),
    inputSchema: Object.freeze({
      type: "object",
      properties,
      required,
      additionalProperties: false,
    }) as JsonSchemaObject,
    discriminators: Object.freeze(
      Object.fromEntries([...discriminators].map(([field, values]) => [field, Object.freeze([...values].sort())])),
    ),
    transportOnlyFields: Object.freeze([...transportOnly.keys()].sort()),
    specs: Object.freeze([...specs]),
    ...(annotations ? { annotations } : {}),
  });
}

/**
 * MCP 入参 → 「哪个别名 + 模型填的那部分」。**没有映射表**：判别字段的值就是别名定死的语义值，
 * 所以匹配一次就够了。
 */
export function resolveMcpSpec(
  tool: McpProfileTool,
  args: Readonly<Record<string, unknown>>,
): ModelFacingToolSpec | undefined {
  const discriminatorFields = Object.keys(tool.discriminators);
  if (discriminatorFields.length > 0) {
    return tool.specs.find((spec) => {
      const bound: Record<string, string> = { ...aliasBoundInputOf(spec), ...("verb" in tool.discriminators ? { verb: spec.name } : {}) };
      return discriminatorFields.every((field) => args[field] === bound[field]);
    });
  }
  if (tool.specs.length === 1) return tool.specs[0];
  // 别名没定死任何字段（画布写那一族：`operation` 本来就在参数里）。判别照样不需要映射表——
  // 每份说明书自己的根级枚举就是它认领的那几个动作，取值命中谁就是谁。
  return tool.specs.find((spec) => {
    const selectors = rootEnumSelectors(spec);
    const fields = Object.keys(selectors);
    return fields.length > 0 && fields.every((field) => {
      const value = args[field];
      return typeof value === "string" && selectors[field].includes(value);
    });
  });
}

/**
 * 一份说明书自己的**必填**根级枚举字段。它是「这个工具认领哪几个动作」的机器判据。
 *
 * 「必填」这一条不是修饰：`nomi_shot_reference_write` 的根上还有 `environment` / `layout` /
 * `move` / `speed` 等七八个**可选**枚举，把它们一并当判据就要求模型把它们全填上，
 * 于是 `create_staging_reference` 永远认领不到自己那次调用（`check:mcp-operation-constructible`
 * 当场抓到了这一条）。模型**必须**送的那个字段，才是能识别动作的那个字段。
 */
function rootEnumSelectors(spec: ModelFacingToolSpec): Record<string, readonly string[]> {
  const published = toPublishedJsonSchema(spec.schema);
  const required = new Set(requiredOf(published));
  return Object.fromEntries(
    Object.entries(propertiesOf(published))
      .filter(([field, schema]) => required.has(field) && Array.isArray(schema.enum))
      .map(([field, schema]) => [field, (schema.enum as unknown[]).filter((v): v is string => typeof v === "string")]),
  );
}

/** 判别字段的合法值清单，进拒收回执。模型自纠时最有用的一样东西。 */
export function mcpAllowedValues(tool: McpProfileTool): readonly string[] {
  return Object.values(tool.discriminators).flatMap((values) => [...values]);
}

// ── 指纹：两个 profile 是不是还在说同一句话 ────────────────────────────────

/**
 * 一个能力在一个 profile 上的**身份**：`别名 → 模型可见 JSON Schema` 的稳定串。
 *
 * 租约字段被摘掉——它是 profile 声明的差异，不是漂移。除此之外任何不同都是漂移：
 * 少一个字段、松一条约束、改一个描述，两边的串就不相等。
 */
export function profileFingerprint(entries: Readonly<Record<string, JsonSchemaObject>>): string {
  return stableStringify(entries);
}

/**
 * 指纹用的**规范形**。两个 profile 都过这一道，否则比到的是构造路径的差别，不是漂移：
 *   · `$schema` 摘掉——它是 zod→JSON Schema 转换器加的方言标记，与模型看到什么无关；
 *   · `required` 排序并在为空时省略——`[]` 与「没有这个键」说的是同一件事。
 */
function canonicalFingerprintEntry(
  properties: Readonly<Record<string, JsonSchemaObject>>,
  required: readonly string[],
): JsonSchemaObject {
  const sorted = [...new Set(required)].sort();
  return {
    type: "object",
    properties: { ...properties },
    ...(sorted.length > 0 ? { required: sorted } : {}),
    additionalProperties: false,
  } as JsonSchemaObject;
}

/** internal profile 的 `别名 → schema` 表。 */
export function internalFingerprintEntries(
  specs: readonly ModelFacingToolSpec[],
): Record<string, JsonSchemaObject> {
  return Object.fromEntries(specs.map((spec) => {
    const published = toPublishedJsonSchema(spec.schema);
    return [spec.name, canonicalFingerprintEntry(propertiesOf(published), requiredOf(published))];
  }));
}

/**
 * MCP profile 的 `别名 → schema` 表，从**广播出去的那份**反投影回来。
 *
 * 反投影而不是「再算一次 spec」是有意的：门岗要量的是宿主真正收到的东西。手改
 * `inputSchema` 的任何一个字节，这里就和 internal 对不上。
 *
 * 两处**合法**的还原，因为它们正是投影时机械做的那两步，不是网开一面：
 *   · 租约与判别字段摘掉——profile 声明的差异；
 *   · 合并时并集过的枚举收窄回这个别名自己声明的那几个值（画布写三个工具共用一个
 *     `operation` 字段，各带一半合法值）。收窄用交集：广播里少了一个值，这里就少一个，
 *     两边当场对不上。
 */
export function mcpFingerprintEntries(tool: McpProfileTool): Record<string, JsonSchemaObject> {
  const published = propertiesOf(tool.inputSchema);
  const declaredDifference = new Set([...MCP_LEASE_FIELD_NAMES, ...Object.keys(tool.discriminators), ...tool.transportOnlyFields]);
  return Object.fromEntries(tool.specs.map((spec) => {
    const own = toPublishedJsonSchema(spec.schema);
    const ownProperties = propertiesOf(own);
    const properties: Record<string, JsonSchemaObject> = {};
    for (const [field, schema] of Object.entries(published)) {
      if (declaredDifference.has(field)) continue;
      if (!ownProperties[field]) continue;
      properties[field] = narrowEnum(schema, ownProperties[field]);
    }
    // 必填按**这个别名自己**的清单还原，只保留广播里真的还在的字段。
    //
    // 为什么不直接读广播的 `required`：一契约一工具的合并是把 N 个别名摊平成一张属性表，
    // 全局必填只能取「所有别名都必填」的交集——`inspect_timeline_range` 的 startFrame
    // 因此在广播里不是必填（`read_timeline` 不要它）。那是合并的机械后果，不是漂移，
    // 判别字段的 description 已经把这件事对宿主说清了。手改广播里的 `required` 由
    // `mcpProjectionDrift` 那条（广播必须字节等于重算结果）抓，不由这条抓。
    return [spec.name, canonicalFingerprintEntry(
      properties,
      requiredOf(own).filter((field) => field in published),
    )];
  }));
}

/** Compare only aliases declared for both profiles; missing declared aliases still fail. */
export function declaredProfileDrift(
  internal: readonly ModelFacingToolSpec[],
  mcp: McpProfileTool,
): string[] {
  return profileDriftBetween(
    internalFingerprintEntries(internal.filter(spec => projectsToProfile(spec, "mcp"))),
    mcpFingerprintEntries({ ...mcp, specs: mcp.specs.filter(spec => projectsToProfile(spec, "internal")) }),
  );
}

function narrowEnum(published: JsonSchemaObject, own: JsonSchemaObject): JsonSchemaObject {
  const publishedEnum = published.enum;
  const ownEnum = own.enum;
  if (!Array.isArray(publishedEnum) || !Array.isArray(ownEnum)) return published;
  return { ...published, enum: ownEnum.filter((value) => publishedEnum.includes(value)) };
}

/**
 * 广播出去的那份还等于「从共享描述符重算一遍」的产物吗？
 *
 * 反投影只证明「两边**能对上**」；这一条证明「MCP 那份**就是**算出来的那份」——
 * 有人绕过投影函数手写一份，或者在枚举里悄悄多塞一个值，只有这条会红。
 */
export function mcpProjectionDrift(
  contract: AnyCapabilityContract,
  specs: readonly ModelFacingToolSpec[],
  broadcast: JsonSchemaObject,
): string | undefined {
  const expected = projectMcpTool(contract, specs).inputSchema;
  if (stableStringify(expected) === stableStringify(broadcast)) return undefined;
  return `${contract.aliases.mcp ?? contract.id} 广播的 inputSchema 与共享描述符重算的结果不同`;
}

/**
 * 两个 profile 对同一个能力还在说同一句话吗？
 *
 * 逐别名比「模型可见 JSON Schema」的稳定串，返回人话差异（空数组 = 没有漂移）。
 * **报的是哪个别名、差在哪一边**——"schema 漂移了" 这句话救不了任何人。
 *
 * 判据故意粗暴（整串相等）：少一个字段、松一条约束、改一个描述，全都算。同源之后
 * 两边结构上不可能不同，所以任何不同都只可能来自「有人绕过投影手写了一份」。
 */
export function profileDriftBetween(
  internalEntries: Readonly<Record<string, JsonSchemaObject>>,
  mcpEntries: Readonly<Record<string, JsonSchemaObject>>,
): string[] {
  const drift: string[] = [];
  for (const alias of [...new Set([...Object.keys(internalEntries), ...Object.keys(mcpEntries)])].sort()) {
    const internal = internalEntries[alias];
    const mcp = mcpEntries[alias];
    if (!internal) {
      drift.push(`${alias}：只在对外 MCP 上存在，内部 profile 没有它`);
      continue;
    }
    if (!mcp) {
      drift.push(`${alias}：只在内部 profile 上存在，对外 MCP 广播里没有它`);
      continue;
    }
    const left = stableStringify(internal);
    const right = stableStringify(mcp);
    if (left === right) continue;
    drift.push(
      `${alias}：内部与对外的模型可见 schema 不同\n`
      + `       internal = ${left}\n`
      + `       mcp      = ${right}`,
    );
  }
  return drift;
}

/**
 * 对外 MCP 侧的容忍：**同一个钩子，同一族畸形**（方案 §3.1）。
 *
 * 为什么它必须存在，而不是「内部才需要容忍」：容忍钩子是**描述符上的声明**，不是 lane
 * 的私产。#547 抓到的那 8 种畸形（整包序列化成 JSON 字符串、字段叫 `text`/`body`、
 * 正文被拆成字符串数组、给不收参数的工具塞一个兄弟工具的参数……）是**跨模型的通用行为**，
 * 外部宿主背后跑的也是同一批模型。阶段 5a 之前对外那条路一次也没跑过这个钩子，于是
 * 同一个模型、同一句话，从 Claude Code 打进来就失败，从 Nomi 自己的 Agent 打进来就成功——
 * 而两边读的说明书还宣称是同一份。
 *
 * 两条纪律：
 *   ① **只捏合模型填的那一半**。租约、别名定死的判别字段、声明出来的「外部才有」传输字段
 *      原样留下——`noArgumentTolerance` 会把整个对象清空，直接喂它会连 `leaseHandle` 一起吃掉。
 *   ② **在校验之前跑**（`mcpProtocol.ts` 的 `validateToolArguments` 之前），与 pi 把
 *      `prepareArguments` 放在 ajv 之前是同一条理由：schema 不合法的参数根本走不到执行边界。
 */
export function prepareMcpArguments(
  tool: McpProfileTool,
  args: unknown,
): Record<string, unknown> {
  const record = args && typeof args === "object" && !Array.isArray(args)
    ? { ...(args as Record<string, unknown>) }
    : unwrapWholeArguments(args);
  const spec = resolveMcpSpec(tool, record);
  if (!spec?.prepareArguments) return record;

  const declaredDifference = new Set([
    ...MCP_LEASE_FIELD_NAMES,
    ...Object.keys(tool.discriminators),
    ...tool.transportOnlyFields,
  ]);
  const kept: Record<string, unknown> = {};
  const modelArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (declaredDifference.has(key)) kept[key] = value;
    else modelArgs[key] = value;
  }
  const prepared = spec.prepareArguments(modelArgs);
  return {
    ...kept,
    ...(prepared && typeof prepared === "object" && !Array.isArray(prepared)
      ? prepared as Record<string, unknown>
      : {}),
  };
}

/** Invalid/missing operations retain the conservative base contract until schema validation rejects them. */
export function modelToolCapabilityId(spec: ModelFacingToolSpec, args: unknown): string {
  const operation = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>).operation : undefined;
  return typeof operation === "string" ? spec.operationCapabilityIds?.[operation] ?? spec.contractId : spec.contractId;
}
