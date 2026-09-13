import { describe, expect, expectTypeOf, it } from "vitest";
import { CAPABILITY_EFFECT_CLASSES, type CapabilityContract } from "./capabilityContract";
import { ASSET_READ_CAPABILITY } from "./assetRead";
import { CANVAS_DELETE_CAPABILITY } from "./canvasDelete";
import { CANVAS_READ_CAPABILITY } from "./canvasRead";
import { CANVAS_WRITE_CAPABILITY } from "./canvasWrite";
import { DOCUMENT_READ_CAPABILITY, DOCUMENT_READ_ALIASES } from "./documentRead";
import { DOCUMENT_WRITE_CAPABILITY, DOCUMENT_WRITE_ALIASES } from "./documentWrite";
import { EXPORT_READ_CAPABILITY, EXPORT_WRITE_CAPABILITY } from "./exportCapabilities";
import { TIMELINE_READ_CAPABILITY } from "./timelineRead";
import { TIMELINE_WRITE_CAPABILITY } from "./timelineWrite";
import { LAYOUT_READ_CAPABILITY, LAYOUT_WRITE_CAPABILITY } from "./layout";
import { MODEL_SETUP_OPEN_CAPABILITY } from "./modelSetup";
import {
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
} from "./productionRun";
import {
  GENERATION_CONTEXT_READ_CAPABILITY,
  GENERATION_PLAN_CAPABILITY,
  GENERATION_RESOLVE_CAPABILITY,
  GENERATION_GATE_CAPABILITY,
  GENERATION_RUN_READ_CAPABILITY,
  GENERATION_CONTROL_CAPABILITY,
} from "./generation";
import { SKILL_WRITE_CAPABILITY } from "./skillWrite";
import { SKILL_READ_CAPABILITY } from "./skillRead";
import { CAPABILITY_ALIAS_ENTRIES, CAPABILITY_CONTRACTS, capabilityOperationAliasesFor, capabilityPlanReviewOf, capabilityRequiresPlanReview, resolveCapabilityAlias } from "./registry";
import type { ContractOnlyRegistry } from "./registry";

type AssertNever<Value extends never> = Value;
type RuntimeObject = {
  readonly invoke: () => void;
};
type ContractWithRuntimeObjects = CapabilityContract<unknown, unknown> & {
  readonly adapter: RuntimeObject;
  readonly port: RuntimeObject;
  readonly executor: RuntimeObject;
};
type RejectedRuntimeObjects = AssertNever<ContractOnlyRegistry<readonly [ContractWithRuntimeObjects]>[0]>;
type MissingEffectClass = Omit<CapabilityContract<unknown, unknown>, "effectClass">;
// @ts-expect-error Every registered capability must declare its Host effect class.
const missingEffectClassMustFail: CapabilityContract<unknown, unknown> = {} as MissingEffectClass;
void missingEffectClassMustFail;

it("derives fresh storyboard review from operation metadata without making ordinary canvas writes require review", () => {
  for (const operation of ["propose_storyboard_plan", "patch_shots"]) {
    expect(capabilityPlanReviewOf(CANVAS_WRITE_CAPABILITY, { operation }))
      .toEqual({ requiresPlanReview: true, planReviewAllowsReuse: false });
    expect(capabilityRequiresPlanReview("nomi_canvas_edit", { operation })).toBe(true);
  }
  expect(capabilityRequiresPlanReview("nomi_storyboard_write", { operation: "propose_storyboard_plan" })).toBe(true);
  expect(capabilityPlanReviewOf(CANVAS_WRITE_CAPABILITY, { operation: "set_node_prompt" }))
    .toEqual({ requiresPlanReview: false, planReviewAllowsReuse: true });
  expect(capabilityPlanReviewOf(TIMELINE_WRITE_CAPABILITY, {}))
    .toEqual({ requiresPlanReview: true, planReviewAllowsReuse: true });
});

describe("capability contract registry", () => {
  it("registers canonical contracts exactly once with globally unique aliases", () => {
    expect(CAPABILITY_CONTRACTS).toEqual([
      ASSET_READ_CAPABILITY,
      CANVAS_DELETE_CAPABILITY,
      CANVAS_READ_CAPABILITY,
      CANVAS_WRITE_CAPABILITY,
      DOCUMENT_READ_CAPABILITY,
      DOCUMENT_WRITE_CAPABILITY,
      EXPORT_READ_CAPABILITY,
      EXPORT_WRITE_CAPABILITY,
      TIMELINE_READ_CAPABILITY,
      TIMELINE_WRITE_CAPABILITY,
      LAYOUT_READ_CAPABILITY,
      LAYOUT_WRITE_CAPABILITY,
      PRODUCTION_RUN_READ_CAPABILITY,
      PRODUCTION_RUN_WRITE_CAPABILITY,
      PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
      SKILL_READ_CAPABILITY,
      SKILL_WRITE_CAPABILITY,
      GENERATION_CONTEXT_READ_CAPABILITY,
      GENERATION_PLAN_CAPABILITY,
      GENERATION_RESOLVE_CAPABILITY,
      GENERATION_GATE_CAPABILITY,
      GENERATION_RUN_READ_CAPABILITY,
      GENERATION_CONTROL_CAPABILITY,
      MODEL_SETUP_OPEN_CAPABILITY,
    ]);

    const ids = CAPABILITY_CONTRACTS.map((contract) => contract.id);
    // 一个名字只能指向一个契约。同一契约在两个 surface 上用同一个名字（`nomi_canvas_read` 内外同名）
    // 不是重复——那正是「内外同源」；两个契约共用一个名字才是。
    const ownerByAlias = new Map<string, string>();
    for (const contract of CAPABILITY_CONTRACTS) {
      for (const alias of Object.values(contract.aliases)) {
        expect(ownerByAlias.get(alias) ?? contract.id, `${alias} claimed by two contracts`).toBe(contract.id);
        ownerByAlias.set(alias, contract.id);
      }
    }

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "asset.read",
      "canvas.delete",
      "canvas.read",
      "canvas.write",
      "document.read",
      "document.write",
      "export.read",
      "export.write",
      "timeline.read",
      "timeline.write",
      "layout.read",
      "layout.write",
      "production.run.read",
      "production.run.write",
      "production.artifact.write",
      "skill.read",
      "skill.write",
      "generation.context.read",
      "generation.plan",
      "generation.resolve",
      "generation.gate",
      "generation.run.read",
      "generation.control",
      "model.setup.open",
    ]);
    // 主别名按 surface 摆平：`pi` 只放模型可见动词名（与 `verbDeclarations.ts` 对账，门岗
    // `no-orphan-alias`），`method` 放宿主/dispatcher 方法名，`mcp` 放对外名，`ui` 放渲染层入口名。
    const aliases = CAPABILITY_CONTRACTS.flatMap((contract) => Object.values(contract.aliases));
    expect(aliases).toEqual([
      "look_at_media", "nomi_media_query", "get_media",
      "delete_from_canvas", "nomi_canvas_maintenance", "delete_canvas_nodes",
      "look_at_canvas", "nomi_canvas_read", "nomi_canvas_read",
      "arrange_canvas", "nomi_canvas_edit", "nomi_canvas_plan",
      "read_script", "nomi_document_read", "read_full_text",
      "write_script", "nomi_document_edit", "insert_at_cursor",
      "nomi_export_job", "inspect_export_job", "export_video", "export_timeline",
      "read_timeline", "nomi_timeline_read", "inspect_timeline_range",
      "edit_timeline", "nomi_timeline_edit", "apply_edit_plan",
      "nomi_layout_read", "nomi_layout_write", "get_production_run",
      "start_production_run", "revise_production_artifact", "read_skill", "load_skill",
      "save_skill", "author_skill", "list_models", "nomi_get_generation_context",
      "draft_shots", "nomi_resolve_generation_plan", "nomi_request_generation_gate",
      "check_job", "nomi_operation_read", "nomi_generation_status",
      "start_model_setup", "nomi_open_model_setup",
    ]);
    expect(CAPABILITY_CONTRACTS.find((contract) => contract.id === "canvas.read")?.exposure).toBe("mcp_safe");
    expect(CAPABILITY_CONTRACTS.every((contract) => CAPABILITY_EFFECT_CLASSES.includes(contract.effectClass))).toBe(true);
    expect(resolveCapabilityAlias(CANVAS_WRITE_CAPABILITY.aliases.pi)?.contract).toBe(CANVAS_WRITE_CAPABILITY);
    expect(capabilityOperationAliasesFor(CANVAS_WRITE_CAPABILITY.id, "pi")).toEqual([
      "make_artifact",
      "stage_shot",
    ]);
    expect(resolveCapabilityAlias("nomi_set_node_prompt")).toBeUndefined();
    expect(resolveCapabilityAlias(DOCUMENT_READ_ALIASES.selection)?.contract).toBe(DOCUMENT_READ_CAPABILITY);
    expect(resolveCapabilityAlias(DOCUMENT_WRITE_ALIASES.replace)?.contract).toBe(DOCUMENT_WRITE_CAPABILITY);
    expect(resolveCapabilityAlias(DOCUMENT_WRITE_ALIASES.append)?.contract).toBe(DOCUMENT_WRITE_CAPABILITY);
    expect(resolveCapabilityAlias("inspect_timeline_range")?.contract).toBe(TIMELINE_READ_CAPABILITY);
    expect(resolveCapabilityAlias("undo_timeline_edit")?.contract).toBe(TIMELINE_WRITE_CAPABILITY);
    expect(resolveCapabilityAlias("read_waveform")?.contract).toBe(ASSET_READ_CAPABILITY);
    expect(resolveCapabilityAlias("delete_canvas_nodes")?.contract).toBe(CANVAS_DELETE_CAPABILITY);
    expect(resolveCapabilityAlias("verify_render")?.contract).toBe(EXPORT_READ_CAPABILITY);
    expect(resolveCapabilityAlias("cancel_export_job")?.contract).toBe(EXPORT_WRITE_CAPABILITY);
    expect(resolveCapabilityAlias("author_skill")?.contract).toBe(SKILL_WRITE_CAPABILITY);
    expect(resolveCapabilityAlias("load_skill")?.contract).toBe(SKILL_READ_CAPABILITY);
    expect(SKILL_READ_CAPABILITY.execution).toEqual({ port: "skills", availability: "main_only" });
    expect(SKILL_WRITE_CAPABILITY.execution).toEqual({ port: "skills", availability: "main_only" });
  });

  /**
   * `aliases.pi` 是**模型看得见的工具名**，运行时在组装工具表时按这条正则校验
   * （`electron/harness/runtime/pi/tools.mts` 的 `createHostTools`）。不合法不是「这个工具
   * 用不了」——`createHostTools` 会直接抛，于是**包含它的整个工具档一次请求都发不出去**，
   * 回合当场失败、没有出站请求、没有 failure item，用户只看到一句「发送失败」。
   *
   * 2026-09-06 就这么炸过一次：layout 的 pi 别名写成了带点的 `layout.read`，
   * 于是 timeline / production 两个档全废——而 `PRODUCTION_INTENT` 命中「短片」，
   * 「帮我做一条 20 秒短片」这句话每一次都发不出去。契约 id 带点是**对的**
   * （RPC method、requiredScope 都按它走），出错的只是「喂给模型的那个名字」也跟着抄了 id。
   *
   * 所以这条断言守的是**整张表**，不是 layout 一处：任何新能力的 pi 别名都得先过这一关。
   * 防线建在最早能拦住的那层（R28）——编译期拦不住字符串，那就在这里拦，
   * 别留给用户在真机上按下发送时才发现。
   */
  it("every pi alias is a legal runtime tool name", () => {
    // 与 `createHostTools` 逐字符相同的规则；抄一份是因为那边是 `.mts`（pi 私有边界）。
    const RUNTIME_TOOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
    const piAliases = CAPABILITY_ALIAS_ENTRIES.filter((entry) => entry.surface === "pi").map((entry) => entry.alias);
    expect(piAliases.length).toBeGreaterThan(0);
    const illegal = piAliases.filter((alias) => !RUNTIME_TOOL_NAME.test(alias));
    expect(illegal, `这些 pi 别名过不了运行时的工具名规则，含它们的工具档会整档发不出请求：${illegal.join(", ")}`).toEqual([]);
    // 阳性对照：这把尺子确实量得出带点的名字，不是一条恒真断言。
    expect(RUNTIME_TOOL_NAME.test("layout.read")).toBe(false);
  });

  it("rejects adapter, port, and executor objects at compile time", () => {
    expectTypeOf<RejectedRuntimeObjects>().toEqualTypeOf<never>();
  });
});
