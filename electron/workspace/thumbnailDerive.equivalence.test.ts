import { describe, expect, it } from "vitest";
import { deriveThumbnailUrls } from "./workspaceRepository";
import { extractThumbnailUrlsFromRaw } from "../../src/workbench/project/projectNormalize";

// 缩略图派生唯一真相源（P4）：renderer(src) 与 main(electron) 各持一份等价实现，跨 tsconfig
// 无法 import 共享一个纯模块（CJS/ESM + rootDir 隔离）。本测试用同一组 fixture 跑两份并断言
// 输出逐字相等——任一侧规则漂移（max、length>4 过滤、payload/顶层 generationCanvas 取址、脏数据
// 降级）立刻红。这是「证明等价」式收口的回归门。
const fixtures: Array<{ name: string; record: unknown }> = [
  { name: "null", record: null },
  { name: "undefined", record: undefined },
  { name: "非对象", record: 42 },
  { name: "空记录", record: {} },
  { name: "payload 非对象", record: { payload: "oops" } },
  { name: "无 generationCanvas", record: { payload: {} } },
  { name: "nodes 非数组", record: { payload: { generationCanvas: { nodes: "nope" } } } },
  {
    name: "顶层 generationCanvas（无 payload 包裹）",
    record: {
      generationCanvas: {
        nodes: [{ result: { url: "https://cdn/top.png" } }],
      },
    },
  },
  {
    name: "payload.generationCanvas 优先于顶层",
    record: {
      generationCanvas: { nodes: [{ result: { url: "https://cdn/top.png" } }] },
      payload: { generationCanvas: { nodes: [{ result: { url: "https://cdn/inner.png" } }] } },
    },
  },
  {
    name: "脏节点混入（null / 非对象 / 无 result）",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            null,
            7,
            {},
            { result: null },
            { result: { url: "https://cdn/a.png" } },
          ],
        },
      },
    },
  },
  {
    name: "thumbnailUrl 兜底 + 过短 url 过滤（length<=4）",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            { result: { url: "abc" } }, // 过短，丢
            { result: { thumbnailUrl: "https://cdn/thumb.png" } }, // url 缺，取 thumbnailUrl
            { result: { url: "", thumbnailUrl: "https://cdn/fallback.png" } }, // 空 url → thumbnailUrl
          ],
        },
      },
    },
  },
  {
    name: "超过 max 截断",
    record: {
      payload: {
        generationCanvas: {
          nodes: Array.from({ length: 9 }, (_, i) => ({
            result: { url: `https://cdn/n${i}.png` },
          })),
        },
      },
    },
  },
];

describe("缩略图派生 main↔renderer 等价（收口回归门）", () => {
  for (const { name, record } of fixtures) {
    it(`输出逐字相等（默认 max）：${name}`, () => {
      expect(deriveThumbnailUrls(record)).toEqual(extractThumbnailUrlsFromRaw(record));
    });
  }

  it("自定义 max 一致（main 接受 max 参数；renderer 走默认 4，单独验 main 截断语义）", () => {
    const record = {
      payload: {
        generationCanvas: {
          nodes: Array.from({ length: 6 }, (_, i) => ({
            result: { url: `https://cdn/n${i}.png` },
          })),
        },
      },
    };
    // renderer 入口固定 max=4；main 默认也 4，两者在默认下必相等。
    expect(deriveThumbnailUrls(record, 4)).toEqual(extractThumbnailUrlsFromRaw(record));
    expect(deriveThumbnailUrls(record, 2)).toHaveLength(2);
    expect(deriveThumbnailUrls(record, 2)).toEqual([
      "https://cdn/n0.png",
      "https://cdn/n1.png",
    ]);
  });
});
