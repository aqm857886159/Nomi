import { z } from "zod";
import { CAPABILITY_CONTRACTS } from "../shared/agentCapabilities/registry";

/**
 * Skill Pack v2 manifest schema.
 *
 * A Skill Pack is a directory under `skills/<name>/` that contains:
 *   - `SKILL.md`     : pure knowledge / domain methodology (system prompt body)
 *   - `skill.json`   : machine-readable manifest validated by this schema
 *
 * The runtime loader prefers `skill.json` to derive tool whitelists and provider
 * requirements; if absent, the loader falls back to reading `SKILL.md` only
 * (legacy behavior, preserved for back-compat).
 *
 * See `docs/skill-pack-format.md` for the human-facing spec.
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

export const skillPermissionSchema = z.enum([
  "read-only",
  "create",
  "delete",
  "export",
]);
export type SkillPermission = z.infer<typeof skillPermissionSchema>;

export const skillInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().optional(),
});
export type SkillInput = z.infer<typeof skillInputSchema>;

export const skillExampleSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  input: z.string().optional(),
});
export type SkillExample = z.infer<typeof skillExampleSchema>;

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
 * Playbook 阶段 —— 把「单段 skill」扩成「多段 playbook」的骨架（向后兼容：无 stages = 现有单段包）。
 * 编排器（runPlaybook）按 dependsOn 拓扑排序逐段执行，每段只放 tools 白名单，pause 段完成后走 gate
 * 暂停让用户审阅。人话方法论写进 SKILL.md 的 6 固定分区，机读结构在这里。
 */
export const skillStageSchema = z.object({
  /** 阶段稳定 id，如 'storyboard' | 'media' | 'assemble'。 */
  id: z.string().min(1),
  /** 这阶段要达成什么（人话，进 agent 规划上下文）。 */
  goal: z.string().min(1),
  /** 本阶段允许的工具白名单（gate 据此按阶段收紧；空=不调工具，纯规划/对话）。 */
  tools: z.array(z.string().min(1)),
  /** 依赖哪些阶段（DAG；编排器据此定序）。 */
  dependsOn: z.array(z.string().min(1)).optional(),
  /** 完成后是否暂停让用户确认（缺省由编排器按 true 处理，对齐 Flova「何时暂停」）。 */
  pause: z.boolean().optional(),
  /** 本阶段按需加载的创作方法论 skill 引用；只注入这些 skill，不把整包 craft skills 全量塞进上下文。 */
  skillRefs: z.array(z.string().min(1)).optional(),
  /** 阶段级模型偏好（能力身份，见 skillStageModelPrefSchema）。 */
  modelPrefs: z.array(skillStageModelPrefSchema).optional(),
});
export type SkillStage = z.infer<typeof skillStageSchema>;

export const skillManifestSchema = z.object({
  /** Stable identifier (e.g. `workbench.storyboard.planner`). */
  name: z.string().min(1),
  /** Semver-ish string, e.g. `1.0.0`. */
  version: z.string().min(1),
  /** One-line human-readable summary shown in the UI. */
  description: z.string().min(1),
  /** Visibility request. User-imported Skills are still forced internal by origin policy. */
  audience: skillAudienceSchema.optional(),
  /** Canonical requests can only shrink the Host-owned capability ceiling. */
  requestedCapabilities: z.array(skillRequestedCapabilitySchema).max(64)
    .refine((items) => new Set(items).size === items.length, "must not contain duplicate capability ids")
    .optional(),
  /** Legacy workflow metadata. Runtime authorization is derived only from requestedCapabilities. */
  tools: z.array(z.string().min(1)),
  /** Provider modalities required to run this skill end-to-end. */
  requiredProviders: z.array(skillProviderKindSchema),
  /** Legacy workflow metadata; never grants runtime capabilities. */
  permissions: z.array(skillPermissionSchema),
  /** Declared inputs the caller is expected to supply (optional). */
  inputs: z.array(skillInputSchema).optional(),
  /** Sample prompts shown in onboarding or the skill picker (optional). */
  examples: z.array(skillExampleSchema).optional(),
  /**
   * Multi-stage playbook skeleton (optional). Absent ⇒ legacy single-stage pack
   * (current 5 built-ins are unaffected — full back-compat). Present ⇒ the
   * orchestrator (runPlaybook) runs each stage in dependency order with
   * per-stage tool whitelists and pause points.
   */
  stages: z.array(skillStageSchema).optional(),
  /** Author handle for cards / sharing (optional). */
  author: z.string().min(1).optional(),
  /** Human display label for cards / picker (optional; falls back to `name`). */
  label: z.string().min(1).optional(),
});
export type SkillManifest = z.infer<typeof skillManifestSchema>;

/**
 * Parse and validate raw JSON into a SkillManifest, returning a discriminated
 * result. Callers should treat any failure as "manifest absent" and fall back
 * to markdown-only loading; we intentionally do not throw because skill loads
 * happen on the hot path of every chat turn.
 */
export function parseSkillManifest(input: unknown):
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string } {
  const parsed = skillManifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
