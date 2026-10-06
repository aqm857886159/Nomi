// `draft_shots` 那条**有损投影**的行为锁：三处形状变化各一条，两处「这条路上没有它的位置」各一条。
//
// 这一族的前身是对照表的尺子测试（合成坏表必须在装配期抛）。表删掉之后那些判据没有消失，只是**换了
// 一层**：「一个字段都不许没人管」成了 `tsc`（解构剩下的落进 `Record<string, never>`）、「落点必须在
// 宿主上真的存在」成了返回类型（取自宿主 schema）。编译期的东西没法在 vitest 里断言，所以这里留下的
// 是**行为**那一半——它证明的是：换真相源之后，发出去的载荷与对照表时代逐字节相同。
import { describe, expect, it } from "vitest";

import { verbToTransportCall } from "../../../agentLane/laneVerbTransport";
import { NOT_YET_DECLARED, PROVENANCE_UNVERIFIABLE, VERB_FIELD_PROVENANCE } from "./verbFieldProvenance";
import { VERB_DECLARATIONS } from "../verbDeclarations";

const translate = (args: unknown) => verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots", args })!.call.args;

describe("draft_shots 的投影与对照表时代逐字节相同", () => {
  it("① 时长落 parameters.duration 并与已有 parameters 合并，不是一个宿主没有的顶层字段", () => {
    expect(translate({ shots: [{ prompt: "p", durationSec: 3, parameters: { seed: 7 } }] }))
      .toMatchObject({ operation: "create", prompt: "p", parameters: { seed: 7, duration: 3 }, cardHidden: true });
  });

  it("② 目录点名赢过平铺的 modelId，两件各自落位（谁赢是声明出来的，不靠写的顺序）", () => {
    expect(translate({ shots: [{ prompt: "p", modelId: "fallback", candidate: { providerId: "apimart", modelId: "image-1" } }] }))
      .toMatchObject({ providerId: "apimart", modelId: "image-1" });
    // 只给平铺 modelId 时它就是赢家——否则上一条可能只是「candidate 恒赢」而平铺那条根本没接。
    expect(translate({ shots: [{ prompt: "p", modelId: "fallback" }] })).toMatchObject({ modelId: "fallback" });
  });

  it("③ 参考素材出去的是宿主认的引用外壳，身份留给宿主补", () => {
    expect(translate({ shots: [{ prompt: "p", references: ["asset-1", "asset-2"] }] }))
      .toMatchObject({ references: [{ assetId: "asset-1" }, { assetId: "asset-2" }] });
  });

  it("寻址字段提到信封上：改草稿时一镜的 shotId 落在 plan patch 顶层，候选 patch 里没有它", () => {
    // #813 之前这一条是「有意丢弃」，于是「改第 2 镜」永远改的是顶层候选，用户在画布上什么都看不到。
    const patched = translate({ operationId: "op-1", shots: [{ shotId: "shot-2", prompt: "逆光侧脸" }] }) as Record<string, unknown>
    expect(patched).toMatchObject({ operation: "patch", operationId: "op-1", shotId: "shot-2" })
    expect(patched.patch).toEqual({ prompt: "逆光侧脸" })
    // 不带 shotId = 单镜草稿的顶层候选：信封上就不该冒出一个空的寻址字段。
    const topLevel = translate({ operationId: "op-1", shots: [{ prompt: "换一句" }] }) as Record<string, unknown>
    expect(topLevel).not.toHaveProperty("shotId")
  });

  it("信封字段进多镜（改草稿那条路上它们被拒，见下一条）", () => {
    const multi = translate({ shots: [{ role: "anchor", title: "锚", prompt: "a" }, { role: "shot", prompt: "b" }] }) as { shots: Array<Record<string, unknown>> };
    expect(multi.shots[0]).toMatchObject({ role: "anchor", title: "锚", prompt: "a" });
  });

  it("信封落不进去的两条路上当场拒绝，不静默消失", () => {
    // 改一镜（带 shotId）那条路上没有信封的位置。
    expect(() => translate({ operationId: "op-1", shots: [{ shotId: "shot-1", prompt: "p", title: "标题" }] }))
      .toThrow(/shots\[\]\.title/);
    expect(() => translate({ shots: [{ prompt: "p", shotId: "shot-3" }] }))
      .toThrow(/shots\[\]\.shotId/);
  });

  it("带 operationId 的新镜头（不带 shotId、带标题或不止一镜）补到那份方案后面，信封随行（2026-10-05）", () => {
    expect(translate({ operationId: "op-1", shots: [{ prompt: "p", title: "结尾" }] }))
      .toMatchObject({ operation: "extend", operationId: "op-1", shots: [{ prompt: "p", title: "结尾" }] });
    expect(translate({ operationId: "op-1", shots: [{ prompt: "a" }, { role: "anchor", title: "锚", prompt: "b" }] }))
      .toMatchObject({ operation: "extend", shots: [{ prompt: "a" }, { role: "anchor", title: "锚", prompt: "b" }] });
    // 只写一镜、没 shotId、没信封：照旧是改单镜草稿的顶层候选。
    expect(translate({ operationId: "op-1", shots: [{ prompt: "换一句" }] })).toMatchObject({ operation: "patch" });
  });

  it("用户明确要另起一份：newPlan 随新建走到宿主", () => {
    expect(translate({ newPlan: true, shots: [{ prompt: "p" }] })).toMatchObject({ operation: "create", newPlan: true });
    expect(translate({ newPlan: true, shots: [{ prompt: "a" }, { prompt: "b" }] })).toMatchObject({ operation: "create", newPlan: true });
  });

  it("顶层缺省折进每一镜，逐镜自己写的优先", () => {
    const multi = translate({
      taskKind: "text_to_video", candidate: { providerId: "apimart", modelId: "video-1" },
      shots: [{ role: "anchor", prompt: "a", taskKind: "text_to_image" }, { role: "shot", prompt: "b" }],
    }) as { shots: Array<Record<string, unknown>> };
    expect(multi.shots[0]).toMatchObject({ taskKind: "text_to_image", providerId: "apimart", modelId: "video-1" });
    expect(multi.shots[1]).toMatchObject({ taskKind: "text_to_video", providerId: "apimart", modelId: "video-1" });
  });
});

describe("「模型从哪拿到这个值」那条轴（投影接不住它，所以它留下来了）", () => {
  it("只剩没有运行时 operation 结果 schema 的两个生成动词", () => {
    // 身份棘轮由 check:verb-host-conformance 的仓库基线与变异自检负责。
    expect(Object.keys(PROVENANCE_UNVERIFIABLE).sort())
      .toEqual(["draft_shots", "generate"]);
  });

  it("「还没进表」的清单也是棘轮：静默的空白与「想过了」长得一模一样，所以它必须被写出来", () => {
    expect([...NOT_YET_DECLARED].sort()).toEqual([
      "arrange_canvas", "list_models", "look_at_canvas", "look_at_media", "make_artifact",
      "read_script", "read_timeline", "stage_shot", "start_model_setup", "write_script",
    ]);
    // 两份名单不许有交集，加起来也不许漏掉任何一个动词——否则「没进表」就成了静默的第三种状态。
    expect([...Object.keys(VERB_FIELD_PROVENANCE), ...NOT_YET_DECLARED].sort().length).toBe(20);
  });
});

describe("比例只有一个家（2026-10-05：用户说 16:9，卡上是档案默认）", () => {
  const draftShots = VERB_DECLARATIONS.find((verb) => verb.name === "draft_shots")!;

  it("①' shots[].aspectRatio 下沉到宿主的语义载体键 parameters.aspectRatio，与时长、已有参数合并", () => {
    expect(translate({ shots: [{ prompt: "p", aspectRatio: "16:9", durationSec: 5, parameters: { resolution: "2K" } }] }))
      .toMatchObject({ operation: "create", parameters: { resolution: "2K", duration: 5, aspectRatio: "16:9" } });
    const multi = translate({ shots: [{ prompt: "a", aspectRatio: "1:1" }, { prompt: "b", aspectRatio: "9:16" }] }) as { shots: Array<Record<string, unknown>> };
    expect(multi.shots.map((shot) => shot.parameters)).toEqual([{ aspectRatio: "1:1" }, { aspectRatio: "9:16" }]);
    const patched = translate({ operationId: "op-1", shots: [{ shotId: "shot-2", aspectRatio: "9:16" }] }) as { patch: Record<string, unknown> };
    expect(patched.patch).toEqual({ parameters: { aspectRatio: "9:16" } });
  });

  it("模型面上 parameters.aspectRatio 当场拒，点名 aspectRatio 字段——不再静默吞掉", () => {
    expect(() => draftShots.prepareArguments!({ shots: [{ prompt: "p", parameters: { aspectRatio: "16:9" } }] }))
      .toThrow(/set aspectRatio on the shot/);
    // 阳性对照：写在自己的位置上不拒。
    expect(() => draftShots.prepareArguments!({ shots: [{ prompt: "p", aspectRatio: "16:9" }] })).not.toThrow();
  });

  it("schema 收它（严格对象，少这一行模型写了也会被 ajv 拒）", () => {
    expect(draftShots.schema.safeParse({ shots: [{ prompt: "p", aspectRatio: "16:9" }] }).success).toBe(true);
  });
});
