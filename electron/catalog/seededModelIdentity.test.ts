// 不变量：**每个内置模型的 modelKey，都必须能被认回它自己声明的档案**。
//
// 为什么这条重要：内置模型走种子接入时带着显式 archetypeId，所以 UI 一直是对的——但用户**经中转**
// 接同一个模型时，Nomi 手上只有一个 modelKey，靠 archetypeIdForModel 反查身份。认不回来 = 这个模型
// 在中转上被当成陌生模型：拿不到档案的尺寸/模式/参考槽，改图被塞进 chat/completions，也拿不到原生报文。
//
// 这里曾经烂过一大片（13/31 认不回来）。根因是 identifierPatterns 被当**前缀**写
// （"doubao-seedream-5" / "black-forest-labs/flux"），而 identifierMatchesPattern 是**严格相等**——
// 两者语义对不上，那些 pattern 永远匹配不到任何真实 key。
// 不改成前缀匹配是有意的：那会让 "seedance-2" 误命中 "seedance-2-fast"（档案注释明写要防这个）。
// 所以约定是**列完整 key**，由本测试把关：新增内置模型忘了补 pattern，这里立刻红。
import { describe, expect, it } from "vitest";
import { archetypeIdForModel } from "../shared/modelArchetypes";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";
import { VOLCENGINE_IMAGE_MODELS } from "./volcengineImages";
import { MODELSCOPE_IMAGE_MODELS } from "./modelscopeImages";

type Seeded = { modelKey: string; archetypeId?: string };

const GROUPS: Array<[string, Seeded[]]> = [
  ["apimart 视频", APIMART_VIDEO_MODELS as unknown as Seeded[]],
  ["apimart 图像", APIMART_IMAGE_MODELS as unknown as Seeded[]],
  ["火山 视频", VOLCENGINE_VIDEO_MODELS as unknown as Seeded[]],
  ["火山 图像", VOLCENGINE_IMAGE_MODELS as unknown as Seeded[]],
  ["魔搭 图像", MODELSCOPE_IMAGE_MODELS as unknown as Seeded[]],
];

describe("内置模型的 modelKey 必须认得回自己的档案（中转接入靠它）", () => {
  for (const [name, models] of GROUPS) {
    it(`${name}：每个模型都反查得到自己声明的 archetypeId`, () => {
      const misses: string[] = [];
      let checked = 0;
      for (const model of models) {
        if (!model?.modelKey || !model.archetypeId) continue;
        checked += 1;
        const got = archetypeIdForModel(model.modelKey);
        if (got !== model.archetypeId) misses.push(`${model.modelKey} 声明=${model.archetypeId} 实得=${got}`);
      }
      expect(checked).toBeGreaterThan(0); // 防「一个都没扫到」的空跑假绿
      expect(misses).toEqual([]);
    });
  }
});
