// **投影这件事成不成立**的判据（不是「今天这几个字段对不对」）：模型面恰好是宿主面减去宿主自补的
// 那些字段、补完能还原成一份合法的宿主输入、而且模型那一半单独喂给宿主必须过不了。
//
// 这张表按动词铺开（原型时代它只覆盖 `cancel_job` 一个）：投影多一个动词就在表里加一行，三条判据自动跟上。
// **漏加一行不会静默**——最后那条覆盖断言核的是「模块里导出的每一份 `*_HOST_FILL` 都在这张表里」。
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CANVAS_DELETE_ALIAS, canvasDeleteInputForAlias, canvasDeletePiInputSchema, canvasDeleteSemanticInputSchema } from "../canvasDelete";
import { documentReadSemanticInputSchema } from "../documentRead";
import { modelSetupOpenInputSchema } from "../modelSetup";
import { SKILL_WRITE_ALIASES, skillWriteInputForAlias, skillWriteSemanticInputSchema } from "../skillWrite";
import { TIMELINE_WRITE_ALIASES, timelineWriteInputForAlias, timelineWriteSemanticInputSchema, undoTimelineEditInputBaseSchema } from "../timelineWrite";
import {
  EXPORT_READ_ALIASES, EXPORT_WRITE_ALIASES, exportReadInputForAlias, exportReadSemanticInputSchema,
  exportWriteInputForAlias, exportWriteSemanticInputSchema,
} from "../exportCapabilities";
import { generationPlanInputSchema } from "../generationPlanSchemas";
import { verbToTransportCall } from "../../../agentLane/laneVerbTransport";
import { SKILL_READ_ALIASES, skillReadInputForAlias, skillReadSemanticInputSchema } from "../skillRead";
import * as projections from "./verbProjections";
import {
  CANCEL_JOB_HOST_FILL, cancelJobModelSchema, CHECK_JOB_HOST_FILL, checkJobModelSchema,
  DELETE_FROM_CANVAS_HOST_FILL, EXPORT_VIDEO_HOST_FILL, GENERATE_HOST_FILL, generateModelSchema,
  exportVideoModelSchema, objectFieldKeys, READ_SCRIPT_SCOPE_DEFAULT, READ_SKILL_HOST_FILL,
  editTimelineHostFill, editTimelineModelSchema, editTimelinePlanId, readScriptModelSchema,
  readSkillModelSchema, SAVE_SKILL_HOST_FILL, saveSkillModelSchema, startModelSetupModelSchema,
  UNDO_HOST_FILL, undoModelSchema,
} from "./verbProjections";

/** 一条投影：宿主 schema、模型面 schema、声明的 fill，以及宿主自己那条「补值 + 重过同一份 schema」的真路。 */
type ProjectionCase = {
  readonly verb: string;
  readonly hostSchema: { safeParse: (value: unknown) => { success: boolean } };
  readonly modelSchema: { parse: (value: unknown) => unknown };
  readonly hostFill: Readonly<Record<string, unknown>>;
  /** 宿主面上**有意不投给模型、也不由我们补**的字段（可选的宿主内部字段）。 */
  readonly hiddenOptional?: readonly string[];
  readonly sample: Record<string, unknown>;
  /** 生产路径上那一处「补值 + 重过同一份宿主 schema」。 */
  readonly admit: (modelArgs: unknown) => unknown;
};

const CASES: readonly ProjectionCase[] = [
  {
    verb: "read_skill",
    hostSchema: skillReadSemanticInputSchema,
    modelSchema: readSkillModelSchema,
    hostFill: READ_SKILL_HOST_FILL,
    hiddenOptional: ["expectedContentHash"],
    sample: { name: "ugc-ad" },
    admit: (args) => skillReadInputForAlias(SKILL_READ_ALIASES.load, args),
  },
  {
    verb: "export_video",
    hostSchema: exportWriteSemanticInputSchema.options[0],
    modelSchema: exportVideoModelSchema,
    hostFill: EXPORT_VIDEO_HOST_FILL,
    sample: { expectedRevision: "revision-3", resolution: "1080p" },
    admit: (args) => exportWriteInputForAlias(EXPORT_WRITE_ALIASES.start, args),
  },
  {
    verb: "save_skill",
    hostSchema: skillWriteSemanticInputSchema,
    modelSchema: saveSkillModelSchema,
    hostFill: SAVE_SKILL_HOST_FILL,
    sample: { dirName: "talking-head-cut", skillMarkdown: "---\nname: x\n---\nbody" },
    admit: (args) => skillWriteInputForAlias(SKILL_WRITE_ALIASES.author, args),
  },
  {
    verb: "delete_from_canvas",
    hostSchema: canvasDeleteSemanticInputSchema,
    modelSchema: canvasDeletePiInputSchema,
    hostFill: DELETE_FROM_CANVAS_HOST_FILL,
    sample: { nodeIds: ["node-a", "node-b"] },
    admit: (args) => canvasDeleteInputForAlias(CANVAS_DELETE_ALIAS, args),
  },
  {
    verb: "undo",
    hostSchema: undoTimelineEditInputBaseSchema.extend({ operation: z.literal("undo_timeline_edit") }) as never,
    modelSchema: undoModelSchema,
    hostFill: UNDO_HOST_FILL,
    hiddenOptional: ["reason", "undoToken"],
    sample: { changeId: "timeline:v1:undo-1", expectedRevision: "revision-2" },
    admit: (args) => timelineWriteSemanticInputSchema.parse({ operation: "undo_timeline_edit", ...(args as Record<string, unknown>) }),
  },
  {
    verb: "generate",
    hostSchema: generationPlanInputSchema.options[4],
    modelSchema: generateModelSchema,
    hostFill: GENERATE_HOST_FILL,
    sample: { operationId: "op-1" },
    // 生成 lane 没有 `*InputForAlias`：它的「补值 + 重过同一份 schema」就是传输层那一步加上宿主桥的
    // `generationPlanInputSchema.parse`。这里走的是**生产那条真路**，不是在测试里重拼一遍。
    admit: (args) => generationPlanInputSchema.parse(
      verbToTransportCall({ toolCallId: "probe", toolName: "generate", args })!.call.args,
    ),
  },
  {
    verb: "check_job（导出域）",
    hostSchema: exportReadSemanticInputSchema.options[0],
    modelSchema: checkJobModelSchema,
    hostFill: CHECK_JOB_HOST_FILL,
    sample: { domain: "export", jobId: "export-1" },
    admit: (args) => exportReadInputForAlias(EXPORT_READ_ALIASES.inspect, args),
  },
  {
    verb: "cancel_job（导出域）",
    hostSchema: exportWriteSemanticInputSchema.options[1],
    modelSchema: cancelJobModelSchema,
    hostFill: CANCEL_JOB_HOST_FILL,
    sample: { domain: "export", jobId: "export-1" },
    admit: (args) => exportWriteInputForAlias(EXPORT_WRITE_ALIASES.cancel, args),
  },
];

describe.each(CASES)("$verb 的模型面是宿主面的投影，不是第二份 schema", (item) => {
  it("模型面 + 宿主自补 = 宿主面，一个不多一个不少（两边名单都从各自的 schema 取，不手抄）", () => {
    const hostKeys = objectFieldKeys(item.hostSchema as never, `${item.verb} host`);
    const modelKeys = objectFieldKeys(item.modelSchema as never, `${item.verb} model face`);
    // 模型面没有任何宿主面之外的字段——这一条排除「投影里偷偷长出第二份形状」。
    expect(hostKeys).toEqual(expect.arrayContaining([...modelKeys]));
    // 差集恰好就是宿主补的那些，加上具名登记的「藏着且不补」的可选宿主字段。
    expect([...modelKeys, ...Object.keys(item.hostFill), ...(item.hiddenOptional ?? [])].sort())
      .toEqual([...hostKeys].sort());
  });

  it("补完重过同一份宿主 schema：那一步由宿主自己那条准入路跑，声明的 fill 与它逐字节相同", () => {
    const modelArgs = item.modelSchema.parse(item.sample) as Record<string, unknown>;
    expect(item.admit(modelArgs)).toEqual({ ...modelArgs, ...item.hostFill });
    // 反向：模型那一半单独喂给宿主 schema 必须过不了，否则被藏起来的字段根本不是宿主自补的，
    // 这条投影就是在藏一个模型本该给的值。
    expect(item.hostSchema.safeParse(modelArgs).success).toBe(false);
  });
});

describe("start_model_setup：宿主一个字段都不补，模型面 = 宿主面 + 一句描述", () => {
  it("字段名单两边逐字相同（宿主改名就是 tsc 红，这条是它的运行期同胞）", () => {
    expect(objectFieldKeys(startModelSetupModelSchema, "start_model_setup model face"))
      .toEqual(objectFieldKeys(modelSetupOpenInputSchema, "model.setup.open host"));
    expect(modelSetupOpenInputSchema.safeParse({ provider: "DeepSeek" }).success).toBe(true);
  });
});

describe("read_script：宿主必填、模型面可选，缺省由宿主补", () => {
  it("模型面与宿主面同名同形状，差别只有「可不可以不给」", () => {
    expect(objectFieldKeys(readScriptModelSchema, "read_script model face"))
      .toEqual(objectFieldKeys(documentReadSemanticInputSchema, "document.read host"));
    expect(readScriptModelSchema.safeParse({}).success).toBe(true);
    expect(documentReadSemanticInputSchema.safeParse({}).success).toBe(false);
  });

  it("缺省值是宿主枚举里的一档（改枚举而不改缺省是 tsc 红，这条是它的运行期同胞）", () => {
    expect(documentReadSemanticInputSchema.safeParse({ scope: READ_SCRIPT_SCOPE_DEFAULT }).success).toBe(true);
  });
});

describe("覆盖：每一份声明出来的宿主自补值都被上面那三条判据核过", () => {
  it("模块导出的 *_HOST_FILL 一个都不许不在表里", () => {
    const declared = Object.keys(projections).filter((name) => name.endsWith("_HOST_FILL"));
    const covered = CASES.map((item) => item.hostFill);
    for (const name of declared) {
      expect(covered, `${name} 声明了一份宿主自补值，却没有任何一条判据核它——补错了没人会说话`)
        .toContain((projections as Record<string, unknown>)[name]);
    }
    expect(declared.length).toBe(covered.length);
  });
});

describe("edit_timeline：fill 里有一个宿主**按这次调用派生**的值（幂等键），不是常量", () => {
  const modelArgs = editTimelineModelSchema.parse({
    baseRevision: "revision-1", summary: "Move the opening clip",
    operations: [{ kind: "move", clipId: "clip-1", startFrame: 0 }],
  });

  it("模型面 + 宿主自补 = 宿主面，一个不多一个不少", () => {
    const hostKeys = objectFieldKeys(timelineWriteSemanticInputSchema.options[0], "timeline apply host");
    const modelKeys = objectFieldKeys(editTimelineModelSchema, "edit_timeline model face");
    expect([...modelKeys, ...Object.keys(editTimelineHostFill("call-1"))].sort()).toEqual([...hostKeys].sort());
  });

  it("补完重过同一份宿主 schema：声明的 fill 与宿主那条真路逐字节相同", () => {
    const filled = { planId: editTimelinePlanId("call-1"), ...modelArgs };
    expect(timelineWriteInputForAlias(TIMELINE_WRITE_ALIASES.applyPlan, filled))
      .toEqual({ ...modelArgs, ...editTimelineHostFill("call-1") });
    // 模型那一半单独喂给宿主 schema 必须过不了（缺 planId 与 operation）。
    expect(timelineWriteSemanticInputSchema.options[0].safeParse(modelArgs).success).toBe(false);
  });
});

describe('K3 domain-qualified tool contract', () => {
  it.each([['check_job', projections.checkJobModelSchema], ['cancel_job', projections.cancelJobModelSchema]] as const)('%s requires the same domain identity as its runtime boundary', (_name, schema) => {
    expect(schema.safeParse({ jobId: 'same-id' }).success).toBe(false);
    for (const domain of ['generation', 'export']) expect(schema.safeParse({ domain, jobId: 'same-id' }).success).toBe(true);
  });
});
