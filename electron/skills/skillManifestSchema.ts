import { z } from "zod";
import { CAPABILITY_CONTRACTS } from "../shared/agentCapabilities/registry";

/**
 * Nomi 的技能扩展块 schema —— 住在 `SKILL.md` frontmatter 的 `metadata.nomi` 下。
 *
 * 一个技能包就是一个目录 + 一个 `SKILL.md`：
 *   ---
 *   name: brand-promo          # Agent Skills 规范必填（小写 kebab，且等于目录名）
 *   description: …             # 规范必填
 *   metadata:
 *     nomi:                    # ← 本文件校验的就是这一块
 *       version: "1.0.0"
 *       required-providers: [text, image, video]
 *   ---
 *
 * 为什么是 `metadata.nomi` 而不是第二份文件、也不是新的顶层键（2026-09-07）：
 * pi / Claude Code / Codex 都实现 Agent Skills 标准，`metadata` 是三家一致认可的
 * 「客户端自定义属性」扩展点，而顶层键是闭集——官方参考校验器 skills-ref 的
 * validator.py:104-115 对顶层多一个键就报 error，却完全不检查 metadata 内部。
 * 所以独有字段挂这里，别的宿主原样忽略、我们照常读到。
 * 收敛前这份 schema 校验的是另一份文件 `skill.json`，两份清单已经漂出不同的
 * description —— 详见 docs/plan/2026-09-07-skill-format-convergence.md。
 *
 * 线上（YAML）用 kebab-case，与 frontmatter 的既有习惯（`allowed-tools`、
 * `disable-model-invocation`）一致；schema 在这里一次性转成 camelCase，
 * 让下游消费者一个字都不用改。
 *
 * `name` 与 `description` **不在这里**：它们是规范的顶层必填字段，唯一真相源是
 * frontmatter 顶层（`electron/skills/skillStore.ts`），不许在扩展块里再写一份。
 */

export const skillProviderKindSchema = z.enum(["text", "image", "video"]);
export type SkillProviderKind = z.infer<typeof skillProviderKindSchema>;

export const skillAudienceSchema = z.enum(["internal", "mcp"]);
export type SkillAudience = z.infer<typeof skillAudienceSchema>;

const canonicalCapabilityIds = new Set<string>(CAPABILITY_CONTRACTS.map((contract) => contract.id));
export const skillRequestedCapabilitySchema = z.string().refine(
  (capabilityId) => canonicalCapabilityIds.has(capabilityId),
  "must be a canonical Capability Registry id",
);

/**
 * 阶段级模型偏好 —— **只声明能力身份（kind + 可选 family），绝不绑 vendor 专属 archetypeId，
 * 也不写死参数**（参数合法区间交模型档案给）。这是「通用第一（P4）」+「分享出去不绑死」的硬约束：
 * 用 `.strict()` 从结构上拒绝 `archetypeId` / `params` 等键，违规直接校验失败。
 * 详见 docs/plan/2026-06-19-skill-playbook-system.md §0.5.b。
 */
export const skillStageModelPrefSchema = z
  .object({
    /** 能力类别：text / image / video（机读，决定路由到哪类模型）。 */
    kind: skillProviderKindSchema,
    /** 软提示：模型家族，如 "seedance"（跨 vendor 通用；缺省=该 kind 任意可用模型）。 */
    family: z.string().min(1).optional(),
  })
  .strict();
export type SkillStageModelPref = z.infer<typeof skillStageModelPrefSchema>;

/**
 * Playbook 阶段 —— 把「单段 skill」扩成「多段 playbook」的骨架（无 stages = 现有单段包）。
 * 人话方法论写进 SKILL.md 正文，机读结构在这里。
 */
export type SkillStage = {
  id: string;
  goal: string;
  tools: string[];
  dependsOn?: string[];
  pause?: boolean;
  skillRefs?: string[];
  modelPrefs?: SkillStageModelPref[];
};

export const skillStageSchema = z
  .object({
    /** 阶段稳定 id，如 'storyboard' | 'media' | 'assemble'。 */
    id: z.string().min(1),
    /** 这阶段要达成什么（人话，进 agent 规划上下文）。 */
    goal: z.string().min(1),
    /** 本阶段允许的工具白名单（空=不调工具，纯规划/对话）。 */
    tools: z.array(z.string().min(1)),
    /** 依赖哪些阶段（DAG）。 */
    "depends-on": z.array(z.string().min(1)).optional(),
    /** 完成后是否暂停让用户确认。 */
    pause: z.boolean().optional(),
    /** 本阶段按需加载的创作方法论 skill 引用；只注入这些 skill，不把整包 craft skills 全量塞进上下文。 */
    "skill-refs": z.array(z.string().min(1)).optional(),
    /** 阶段级模型偏好（能力身份，见 skillStageModelPrefSchema）。 */
    "model-prefs": z.array(skillStageModelPrefSchema).optional(),
  })
  .transform((stage): SkillStage => ({
    id: stage.id,
    goal: stage.goal,
    tools: stage.tools,
    dependsOn: stage["depends-on"],
    pause: stage.pause,
    skillRefs: stage["skill-refs"],
    modelPrefs: stage["model-prefs"],
  }));

export type SkillManifest = {
  version: string;
  label?: string;
  author?: string;
  audience?: SkillAudience;
  selectableInWorkbench?: boolean;
  requestedCapabilities?: string[];
  tools: string[];
  requiredProviders: SkillProviderKind[];
  stages?: SkillStage[];
};

export const skillManifestSchema = z
  .object({
    /** Semver-ish string, e.g. `1.0.0`.  Lands in production-run artifact evidence. */
    version: z.string().min(1),
    /** Human display label for cards / picker (optional; falls back to the frontmatter name). */
    label: z.string().min(1).optional(),
    /** Author handle for cards / sharing (optional). */
    author: z.string().min(1).optional(),
    /** Visibility request. User-imported Skills are still forced internal by origin policy. */
    audience: skillAudienceSchema.optional(),
    /** Explicitly allow a built-in Skill to appear in the Workbench picker. */
    "selectable-in-workbench": z.boolean().optional(),
    /** Canonical requests can only shrink the Host-owned capability ceiling. */
    "requested-capabilities": z.array(skillRequestedCapabilitySchema).max(64)
      .refine((items) => new Set(items).size === items.length, "must not contain duplicate capability ids")
      .optional(),
    /** Workflow metadata. Runtime authorization is derived only from requested-capabilities. */
    tools: z.array(z.string().min(1)),
    /** Provider modalities required to run this skill end-to-end (drives the ✓/⚠ chips). */
    "required-providers": z.array(skillProviderKindSchema),
    /** Multi-stage playbook skeleton (optional). Absent ⇒ single-stage pack. */
    stages: z.array(skillStageSchema).optional(),
  })
  .transform((manifest): SkillManifest => ({
    version: manifest.version,
    label: manifest.label,
    author: manifest.author,
    audience: manifest.audience,
    selectableInWorkbench: manifest["selectable-in-workbench"],
    requestedCapabilities: manifest["requested-capabilities"],
    tools: manifest.tools,
    requiredProviders: manifest["required-providers"],
    stages: manifest.stages,
  }));

/**
 * Parse and validate the `metadata.nomi` block, returning a discriminated result.
 * Callers treat any failure as "extension block unusable" and fail closed —
 * `electron/ai/agentChatV2.ts` turns a `manifestError` into an empty capability
 * list, which is zero tools.  We intentionally do not throw because skill loads
 * happen on the hot path of every chat turn.
 */
export function parseSkillManifest(input: unknown):
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string } {
  const parsed = skillManifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
