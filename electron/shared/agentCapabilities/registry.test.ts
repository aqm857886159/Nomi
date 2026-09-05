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
import {
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
} from "./productionRun";
import {
  GENERATION_CONTEXT_READ_CAPABILITY,
  GENERATION_PLAN_CAPABILITY,
  GENERATION_GATE_CAPABILITY,
  GENERATION_RUN_READ_CAPABILITY,
  GENERATION_CONTROL_CAPABILITY,
} from "./generation";
import { SKILL_WRITE_CAPABILITY } from "./skillWrite";
import { SKILL_READ_CAPABILITY } from "./skillRead";
import { CAPABILITY_CONTRACTS, capabilityOperationAliasesFor, resolveCapabilityAlias } from "./registry";
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
      PRODUCTION_RUN_READ_CAPABILITY,
      PRODUCTION_RUN_WRITE_CAPABILITY,
      PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
      SKILL_READ_CAPABILITY,
      SKILL_WRITE_CAPABILITY,
      GENERATION_CONTEXT_READ_CAPABILITY,
      GENERATION_PLAN_CAPABILITY,
      GENERATION_GATE_CAPABILITY,
      GENERATION_RUN_READ_CAPABILITY,
      GENERATION_CONTROL_CAPABILITY,
    ]);

    const ids = CAPABILITY_CONTRACTS.map((contract) => contract.id);
    const aliases = CAPABILITY_CONTRACTS.flatMap((contract) => Object.values(contract.aliases));

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(aliases).size).toBe(aliases.length);
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
      "production.run.read",
      "production.run.write",
      "production.artifact.write",
      "skill.read",
      "skill.write",
      "generation.context.read",
      "generation.plan",
      "generation.gate",
      "generation.run.read",
      "generation.control",
    ]);
    expect(aliases).toEqual([
      "get_media",
      "nomi_media_query",
      "delete_canvas_nodes",
      "nomi_canvas_maintenance",
      "read_canvas_state",
      "nomi_canvas_read",
      "set_node_prompt",
      "nomi_canvas_edit",
      "nomi_canvas_plan",
      "read_full_text",
      "nomi_document_read",
      "insert_at_cursor",
      "nomi_document_edit",
      "inspect_export_job",
      "nomi_export_job",
      "export_timeline",
      "read_timeline",
      "nomi_timeline_read",
      "apply_edit_plan",
      "nomi_timeline_edit",
      "get_production_run",
      "start_production_run",
      "revise_production_artifact",
      "load_skill",
      "author_skill",
      "nomi_get_generation_context",
      "nomi_generation_plan",
      "nomi_request_generation_gate",
      "nomi_generation_status",
      "nomi_cancel_generation",
    ]);
    expect(CAPABILITY_CONTRACTS.find((contract) => contract.id === "canvas.read")?.exposure).toBe("mcp_safe");
    expect(CAPABILITY_CONTRACTS.every((contract) => CAPABILITY_EFFECT_CLASSES.includes(contract.effectClass))).toBe(true);
    expect(resolveCapabilityAlias(CANVAS_WRITE_CAPABILITY.aliases.pi)?.contract).toBe(CANVAS_WRITE_CAPABILITY);
    expect(capabilityOperationAliasesFor(CANVAS_WRITE_CAPABILITY.id, "pi")).toEqual([
      "create_canvas_nodes",
      "connect_canvas_edges",
      "tidy_canvas",
      "propose_storyboard_plan",
      "arrange_storyboard_to_timeline",
      "create_staging_reference",
      "create_camera_move",
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

  it("rejects adapter, port, and executor objects at compile time", () => {
    expectTypeOf<RejectedRuntimeObjects>().toEqualTypeOf<never>();
  });
});
