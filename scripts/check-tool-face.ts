/**
 * `check:tool-face` —— 模型可见工具面的**语义与一致性**门岗（审计 §6.2；实施方案 §2.3）。
 *
 * **它在解决哪个真实摩擦**：2026-09-11 审计发现同一个工具名在仓库里有三份互相否定的说明书，
 * 而**没有任何东西会因此报错**。PR A 把 owner 收成一份（`verbDeclarations.ts`），四条装配期不变量
 * （A1–A4）住在 `verbDeclaration.ts`，App 起不来就是它们在拦。这个门岗管剩下的那一半：
 *   · 「只有一份」这件事本身要可被机器证明（`single-description-owner` / `no-tool-outside-declarations`）；
 *   · 同效果组的动词要互相点名裁决（`mutual-tiebreak`）；
 *   · 契约别名不能再长出幽灵（`no-orphan-alias`）；
 *   · 三条棘轮只减不增（字段描述缺失 / 对外手写传输目录 / 过渡 profile 理由 / 内部前缀约定）。
 *
 * 与 `check:model-schema` 职责不重叠：那边量结构（空 schema / 根级 union / const / 漂移），这边量语义。
 * 身份式棘轮，与 `check:boundaries` 同款纪律：`added` 红、`removed` 也红。
 *
 * 用法：
 *   pnpm exec tsx scripts/check-tool-face.ts                    校验
 *   pnpm exec tsx scripts/check-tool-face.ts --update-baseline  重算棘轮基线（只许变小）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { VerbDeclaration } from "../electron/shared/agentCapabilities/verbDeclaration";
import type { JsonSchemaObject } from "../electron/shared/agentCapabilities/modelVisibleJsonSchema";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "scripts", "tool-face-baseline.json");

export type RuleId =
  | "single-description-owner"
  | "no-tool-outside-declarations"
  | "mutual-tiebreak"
  | "no-orphan-alias"
  | "field-descriptions-complete"
  | "mcp-transport-catalog"
  | "profile-reason-transitional"
  | "name-convention-uniform";

export type RuleMode = "hard" | "ratchet";

/** 规则清单以这里为准（R17：每条都有阳性对照，见 `check-tool-face.node-test.mjs`）。 */
export const RULES: readonly { readonly id: RuleId; readonly mode: RuleMode; readonly why: string }[] = Object.freeze([
  { id: "single-description-owner", mode: "hard", why: "描述只能有一个 owner：契约上的 projections / *DescriptionForAlias / 清单 intent 都是第二份文案" },
  { id: "no-tool-outside-declarations", mode: "hard", why: "lane / shared / harness 里手写的 {description, parameters} 工具形状就是第二个注册表" },
  { id: "mutual-tiebreak", mode: "hard", why: "同效果组的动词两两之间必须在 notWhen 里互相点名并裁决，否则模型只能抛硬币" },
  { id: "no-orphan-alias", mode: "hard", why: "契约的 pi 别名必须是已声明动词名；幽灵别名让审批/付费边界查到不存在的工具" },
  { id: "field-descriptions-complete", mode: "ratchet", why: "发布 schema 每个字段要有 description；schema 合法但字段无描述，编译器与 ajv 都不会说话" },
  { id: "mcp-transport-catalog", mode: "ratchet", why: "对外 tools/list 上不从声明派生的手写工具（PR B 收编）" },
  { id: "profile-reason-transitional", mode: "ratchet", why: "profileReason=mcpHandwrittenTransport 是过渡值，只许减少" },
  { id: "name-convention-uniform", mode: "ratchet", why: "internal profile 前缀约定要唯一（PR B 归零）；mcp profile 必须全 nomi_（硬）" },
]);

export interface Finding {
  readonly rule: RuleId;
  /** 稳定身份。修掉一条必须同步删基线那一行。 */
  readonly identity: string;
  readonly detail: string;
}

// ── 文本扫描：owner 只有一份 ───────────────────────────────────────────────

export interface ScannedFile {
  readonly path: string;
  readonly text: string;
}

/** 声明本体与派生层：这些文件**就是** owner，不扫。 */
const OWNER_FILES = new Set([
  "electron/shared/agentCapabilities/verbDeclaration.ts",
  "electron/shared/agentCapabilities/verbDeclarations.ts",
  // 派生层：从声明算出说明书与 MCP 投影，本身不写第二份文案。
  "electron/shared/agentCapabilities/modelFacingTools.ts",
  "electron/shared/agentCapabilities/modelFacingToolRegistry.ts",
]);

/** 登记过的、有理由的手写工具形状。理由必须是「不是 Nomi 领域工具」。 */
export const TOOL_SHAPE_EXEMPTIONS: Readonly<Record<string, string>> = Object.freeze({
  "electron/agentLane/laneToolGroups.mts": "pi 官方 tool-search 形状（nomi_request_tools 只切工具组，不碰领域）",
});

const PROJECTIONS_KEY = /\bprojections\s*:\s*\{/;
const DESCRIPTION_FOR_ALIAS = /\bfunction\s+\w*DescriptionForAlias\b/;
const INTENT_LITERAL = /\bintent\s*:\s*["'`]/;
const LITERAL_DESCRIPTION = /\bdescription\s*:\s*["'`]/;
const SCHEMA_KEY = /\b(?:parameters|inputSchema)\s*:/;
const TOOL_SHAPE_WINDOW = 12;

/** 只在 owner 之外找第二份说明书。返回两条规则的发现。 */
export function scanOwnerDrift(files: readonly ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (OWNER_FILES.has(file.path) || file.path.includes("/verbs/") || /\.test\.[mc]?ts$/.test(file.path)) continue;
    const lines = file.text.split("\n");
    lines.forEach((line, index) => {
      const where = `${file.path}:${index + 1}`;
      if (PROJECTIONS_KEY.test(line)) findings.push({ rule: "single-description-owner", identity: where, detail: `${where} 契约上的 projections 块是第二份描述` });
      if (DESCRIPTION_FOR_ALIAS.test(line)) findings.push({ rule: "single-description-owner", identity: where, detail: `${where} *DescriptionForAlias 是第二份描述` });
      if (INTENT_LITERAL.test(line) && file.text.includes("capabilityRefs")) {
        findings.push({ rule: "single-description-owner", identity: where, detail: `${where} 清单 intent 是第二份描述` });
      }
      if (LITERAL_DESCRIPTION.test(line) && !(file.path in TOOL_SHAPE_EXEMPTIONS)) {
        const window = lines.slice(Math.max(0, index - TOOL_SHAPE_WINDOW), index + TOOL_SHAPE_WINDOW + 1).join("\n");
        if (SCHEMA_KEY.test(window)) {
          findings.push({ rule: "no-tool-outside-declarations", identity: where, detail: `${where} 手写的 {description, parameters|inputSchema} 工具形状——声明进 verbs/` });
        }
      }
    });
  }
  return findings;
}

// ── 声明级规则 ──────────────────────────────────────────────────────────────

type DeclarationView = Pick<VerbDeclaration, "name" | "describe" | "effectGroups" | "profiles" | "profileReason">;

/** 同效果组两两**双向**点名。身份 = 组 + 有序对。 */
export function mutualTiebreak(declarations: readonly DeclarationView[]): Finding[] {
  const findings: Finding[] = [];
  const byGroup = new Map<string, DeclarationView[]>();
  for (const declaration of declarations) {
    for (const group of declaration.effectGroups ?? []) byGroup.set(group, [...(byGroup.get(group) ?? []), declaration]);
  }
  for (const [group, members] of byGroup) {
    for (const a of members) {
      for (const b of members) {
        if (a === b) continue;
        if (!new RegExp(`\\b${b.name}\\b`).test(a.describe.notWhen)) {
          findings.push({ rule: "mutual-tiebreak", identity: `${group}:${a.name}->${b.name}`, detail: `${a.name} 与 ${b.name} 同在效果组 ${group}，但 ${a.name}.describe.notWhen 没有点名 ${b.name}` });
        }
      }
    }
  }
  return findings;
}

export interface AliasView {
  readonly id: string;
  readonly aliases: Readonly<Partial<Record<string, string>>>;
  readonly additionalAliases?: Readonly<Partial<Record<string, readonly string[]>>>;
}

/** 契约的 `pi` 别名 ⊆ 已声明动词名。 */
export function orphanAliases(contracts: readonly AliasView[], declaredNames: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const contract of contracts) {
    const names = [contract.aliases.pi, ...(contract.additionalAliases?.pi ?? [])].filter((name): name is string => typeof name === "string");
    for (const name of names) {
      if (!declaredNames.has(name)) {
        findings.push({ rule: "no-orphan-alias", identity: `${contract.id}:${name}`, detail: `${contract.id} 在 pi surface 上声明了 ${name}，但没有任何动词声明叫这个名字（幽灵别名）` });
      }
    }
  }
  return findings;
}

function walkFields(schema: JsonSchemaObject, pointer: string, out: string[]): void {
  const properties = schema.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [field, child] of Object.entries(properties as Record<string, JsonSchemaObject>)) {
      const here = `${pointer}/${field}`;
      if (typeof child.description !== "string" || child.description.trim().length === 0) out.push(here);
      walkFields(child, here, out);
    }
  }
  for (const key of ["items", "additionalProperties"] as const) {
    const child = schema[key];
    if (child && typeof child === "object" && !Array.isArray(child)) walkFields(child as JsonSchemaObject, `${pointer}/${key}`, out);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) branches.forEach((branch, index) => walkFields(branch as JsonSchemaObject, `${pointer}/${key}/${index}`, out));
  }
}

/** 发布 schema 里没有 description 的字段。身份 = 工具名 + JSON 指针。 */
export function fieldDescriptions(published: readonly { name: string; schema: JsonSchemaObject }[]): Finding[] {
  const findings: Finding[] = [];
  for (const tool of published) {
    const missing: string[] = [];
    walkFields(tool.schema, "", missing);
    for (const pointer of missing) {
      findings.push({ rule: "field-descriptions-complete", identity: `${tool.name}#${pointer}`, detail: `${tool.name}${pointer} 没有 description` });
    }
  }
  return findings;
}

/** 对外 tools/list 上、不从声明派生的名字。 */
export function handwrittenMcp(resolverNames: readonly string[], derivedNames: ReadonlySet<string>): Finding[] {
  return resolverNames.filter((name) => !derivedNames.has(name)).map((name) => ({
    rule: "mcp-transport-catalog" as const, identity: name, detail: `${name} 是手写的对外工具，不从动词声明派生`,
  }));
}

export function transitionalProfiles(declarations: readonly DeclarationView[]): Finding[] {
  return declarations.filter((d) => d.profileReason === "mcpHandwrittenTransport").map((d) => ({
    rule: "profile-reason-transitional" as const, identity: d.name, detail: `${d.name} 的 profileReason 仍是过渡值 mcpHandwrittenTransport`,
  }));
}

/**
 * 内部 profile：前缀约定只能有一种；少数派逐个报（身份 = 名字），PR B 归零。
 * 对外 profile：必须全 `nomi_`（硬——不进棘轮，进 `hard` 桶）。
 */
export function nameConvention(internalNames: readonly string[], mcpNames: readonly string[]): { ratchet: Finding[]; hard: Finding[] } {
  const prefixed = internalNames.filter((name) => name.startsWith("nomi_"));
  const bare = internalNames.filter((name) => !name.startsWith("nomi_"));
  const minority = prefixed.length === 0 || bare.length === 0 ? [] : prefixed.length < bare.length ? prefixed : bare;
  const ratchet = minority.map((name) => ({
    rule: "name-convention-uniform" as const, identity: `internal/${name}`,
    detail: `internal profile 里 ${name} 与多数派的前缀约定不同（${prefixed.length} 带 nomi_ / ${bare.length} 不带）`,
  }));
  const hard = mcpNames.filter((name) => !name.startsWith("nomi_")).map((name) => ({
    rule: "name-convention-uniform" as const, identity: `mcp/${name}`, detail: `对外工具 ${name} 没有 nomi_ 前缀`,
  }));
  return { ratchet, hard };
}

// ── 真实输入 ────────────────────────────────────────────────────────────────

const SCAN_DIRS = ["electron/agentLane", "electron/shared/agentCapabilities", "electron/shared/agentLane", "electron/harness"];

function listSourceFiles(): ScannedFile[] {
  const out: ScannedFile[] = [];
  const walk = (dir: string) => {
    const absolute = path.join(repoRoot, dir);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (/\.(?:ts|mts|cts)$/.test(entry.name)) out.push({ path: relative, text: fs.readFileSync(path.join(repoRoot, relative), "utf8") });
    }
  };
  for (const dir of SCAN_DIRS) walk(dir);
  return out;
}

export async function collectFindings(): Promise<{ hard: Finding[]; ratchet: Finding[] }> {
  const [{ VERB_DECLARATIONS }, registry, { CAPABILITY_CONTRACTS }, { toPublishedJsonSchema }, { MCP_TOOL_RESOLVER }] = await Promise.all([
    import("../electron/shared/agentCapabilities/verbDeclarations"),
    import("../electron/shared/agentCapabilities/modelFacingToolRegistry"),
    import("../electron/shared/agentCapabilities/registry"),
    import("../electron/shared/agentCapabilities/modelVisibleJsonSchema"),
    import("../electron/capabilityCore/mcpToolCatalog"),
  ]);
  const declaredNames = new Set(VERB_DECLARATIONS.map((d) => d.name));
  const internal = registry.modelFacingToolSpecs("internal");
  const mcp = registry.mcpProfileTools();
  const convention = nameConvention(internal.map((s) => s.name), mcp.map((t) => t.name));
  const hard = [
    ...scanOwnerDrift(listSourceFiles()),
    ...mutualTiebreak(VERB_DECLARATIONS),
    ...orphanAliases(CAPABILITY_CONTRACTS as readonly AliasView[], declaredNames),
    ...convention.hard,
  ];
  const ratchet = [
    ...fieldDescriptions(registry.MODEL_FACING_TOOL_SPECS.map((spec) => ({ name: spec.name, schema: toPublishedJsonSchema(spec.schema) }))),
    ...handwrittenMcp((MCP_TOOL_RESOLVER.list() as readonly { name: string }[]).map((t) => t.name), new Set(mcp.map((t) => t.name))),
    ...transitionalProfiles(VERB_DECLARATIONS),
    ...convention.ratchet,
  ];
  return { hard, ratchet };
}

// ── 棘轮 ───────────────────────────────────────────────────────────────────

type Baseline = Record<string, readonly string[] | undefined>;

function writeBaseline(ratchet: readonly Finding[]): void {
  const out: Record<string, unknown> = {
    _comment: [
      "check:tool-face 棘轮基线（审计 §6.2 / 实施方案 §2.3）：身份式，只减不增。",
      "规则住 scripts/check-tool-face.ts 的 RULES；硬规则不进这里，任何一条命中直接红。",
      "修掉一条必须同步删这里对应一行；新增违规当场报红，不许追加进本文件抬高基线。",
      "归零时点：PR B（20 动词）收编对外面、补齐字段描述、统一前缀。",
    ],
  };
  for (const rule of RULES.filter((r) => r.mode === "ratchet")) {
    const identities = [...new Set(ratchet.filter((f) => f.rule === rule.id).map((f) => f.identity))].sort();
    if (identities.length > 0) out[rule.id] = identities;
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(out, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { hard, ratchet } = await collectFindings();
  if (process.argv.includes("--update-baseline")) {
    writeBaseline(ratchet);
    console.log(`✅ 已重算 tool-face 基线 → ${path.relative(repoRoot, baselinePath)}`);
    return;
  }
  if (hard.length > 0) {
    console.error(`✖ check:tool-face：${hard.length} 处硬规则命中：`);
    for (const finding of hard) console.error(`   · [${finding.rule}] ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(baselinePath)) {
    console.error(`✖ 缺少 ${path.relative(repoRoot, baselinePath)}；先核对实扫结果，再用 --update-baseline 初始化存量`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as Baseline;
  const added: Finding[] = [];
  const removed: string[] = [];
  for (const rule of RULES.filter((r) => r.mode === "ratchet")) {
    const current = new Map(ratchet.filter((f) => f.rule === rule.id).map((f) => [f.identity, f.detail]));
    const frozen = new Set(baseline[rule.id] ?? []);
    for (const [identity, detail] of current) if (!frozen.has(identity)) added.push({ rule: rule.id, identity, detail });
    for (const identity of frozen) if (!current.has(identity)) removed.push(`[${rule.id}] ${identity}`);
  }
  const counts = RULES.filter((r) => r.mode === "ratchet").map((r) => `${r.id}=${ratchet.filter((f) => f.rule === r.id).length}`).join(", ");
  console.log(`tool-face：硬规则 0 命中；棘轮 ${counts}`);
  if (added.length > 0) {
    console.error(`\n✖ check:tool-face 回归：${added.length} 处**新增**违规（不在基线里）：`);
    for (const finding of added) console.error(`   · [${finding.rule}] ${finding.detail}`);
    console.error("  绝不允许把新违规追加进 tool-face-baseline.json 抬高基线。");
    process.exitCode = 1;
    return;
  }
  if (removed.length > 0) {
    console.error(`\n✖ 基线过期：${removed.length} 处违规已消失，但仍留在基线里：`);
    for (const line of removed) console.error(`   · ${line}`);
    console.error("  跑：pnpm exec tsx scripts/check-tool-face.ts --update-baseline");
    process.exitCode = 1;
    return;
  }
  console.log("✅ check:tool-face 通过（单一 owner / 互相裁决 / 无幽灵别名；棘轮只减不增）。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
