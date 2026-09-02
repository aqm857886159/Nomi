// 反向不变量：**专用 codec 上一个槽都不许被误伤**。
//
// 收窄这类改动最大的风险不是「漏收」而是「过收」——把本来能用的槽藏掉，用户会觉得功能没了。
// 所以对每个内置模型 × 它自己的 mapping，用**真实档案声明的槽（含各自的 inputKey）** 跑一遍：
// 只要该模式声明了参考槽，就至少得留下一个能用，否则说明判据把原生通道也判死了。
//
// ⚠️ 写这条时踩过一次：先用「缺省 inputKey 的通用槽」去扫，扫出 34 条 mapping「全隐」，差点当成
// 大 bug。真相是 apimart 用 image_urls、火山用 volcengine_*，都不是缺省键——**必须喂真实档案的槽**，
// 拿泛槽扫等于自己造了个错夹具骗自己。
import { describe, expect, it } from "vitest";
import { resolveArchetypeForModel } from "../../src/config/modelArchetypes";
import { modeTransportFor } from "../shared/videoCapabilities";
import { modeSlotReach } from "./referenceReachability";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";

type SeededModel = {
  modelKey: string;
  modelAlias?: string;
  vendorKey?: string;
  meta?: unknown;
  mappings: Array<{ taskKind: string; create?: { body?: unknown } }>;
};

const SEED_GROUPS: Array<[string, SeededModel[]]> = [
  ["apimart", APIMART_VIDEO_MODELS as unknown as SeededModel[]],
  ["volcengine", VOLCENGINE_VIDEO_MODELS as unknown as SeededModel[]],
];

describe("专用 codec 零误伤（收窄不许把原生通道判死）", () => {
  for (const [vendor, models] of SEED_GROUPS) {
    it(`${vendor}：每个带参考槽的模式，至少留下一个可用槽`, () => {
      const casualties: string[] = [];
      let checked = 0;
      for (const model of models) {
        const archetype = resolveArchetypeForModel({
          modelKey: model.modelKey,
          modelAlias: model.modelAlias,
          vendorKey: model.vendorKey,
          meta: model.meta as Record<string, unknown> | undefined,
        });
        if (!archetype) continue;
        for (const mode of archetype.modes) {
          if (mode.slots.length === 0) continue; // 纯文生模式没有参考槽
          const taskKind = modeTransportFor(mode, archetype, model.vendorKey);
          const body = model.mappings.find((m) => m.taskKind === taskKind)?.create?.body;
          if (!body) continue; // 该桶没 mapping —— 属另一类问题（无通道），不在本条断言范围
          checked += 1;
          const reach = modeSlotReach(mode.slots, body, mode.combineSlotsInto?.key);
          if (reach.every((r) => r === "none")) {
            casualties.push(`${model.modelKey}/${mode.id} (${taskKind})`);
          }
        }
      }
      expect(checked).toBeGreaterThan(0); // 防「一条都没扫到」的空跑假绿
      expect(casualties).toEqual([]);
    });
  }
});
