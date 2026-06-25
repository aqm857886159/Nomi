import { describe, expect, it } from "vitest";
import { resolveNodeVisualSize } from "./nodeSizing";
import { CARD_FIXED_WIDTH } from "./nodeSizing";

// 回归：连线「连不上」的根因是锚点用名义 node.size，而卡片类实际按固定宽渲染。
// resolveNodeVisualSize 必须返回**真实渲染尺寸**，让连线锚点落在节点框上而非框外空中。
const node = (over: Record<string, unknown>) => over as Parameters<typeof resolveNodeVisualSize>[0];

describe("resolveNodeVisualSize — 真实渲染尺寸（连线锚点单一真相源）", () => {
  it("character-card：名义 size.width=300 但实渲固定宽 200（本次根因）", () => {
    const v = resolveNodeVisualSize(node({ kind: "character", size: { width: 300, height: 190 } }));
    expect(v.width).toBe(200);
    expect(v.width).toBe(CARD_FIXED_WIDTH["character-card"]);
    // 名义 300 与实渲 200 差 100px ⇒ 旧锚点（用 size.width）让连线从节点右侧 100px 外起笔。
    expect(v.width).not.toBe(300);
  });

  it("scene-card 固定宽 320；audio-strip 固定 420×80", () => {
    expect(resolveNodeVisualSize(node({ kind: "scene", size: { width: 300, height: 190 } })).width).toBe(320);
    const audio = resolveNodeVisualSize(node({ kind: "audio", size: { width: 300, height: 190 } }));
    expect(audio).toEqual({ width: 420, height: 80 });
  });

  it("非卡片节点（无 size）回退到默认宽，不被卡片固定宽影响", () => {
    // image 在 shots（无 categoryId 信号）→ 非卡片；无 size 时按 max(minWidth, 默认宽)
    const v = resolveNodeVisualSize(node({ kind: "image", size: { width: 340, height: 280 } }));
    expect(v.width).toBe(340); // 非卡片不套固定宽，沿用 size.width
  });

  it("已存 meta.previewHeight 的卡片：高用 previewHeight（与渲染一致），宽仍固定", () => {
    const v = resolveNodeVisualSize(
      node({ kind: "character", size: { width: 300, height: 190 }, meta: { previewHeight: 260 } }),
    );
    expect(v.width).toBe(200);
    expect(v.height).toBe(260);
  });

  it("媒体节点高用实渲 previewHeight 而非名义 size.height（连线终点落空的真因）", () => {
    // video 镜头节点名义 size.height=340，但按比例实渲更矮（meta.previewHeight=236）。
    // 连线终点必须锚到 236（端口真实位置），否则落在节点下方 52px 处＝「线条没连上」。
    const v = resolveNodeVisualSize(
      node({ kind: "video", categoryId: "shots", renderKind: "shot-frame", size: { width: 420, height: 340 }, meta: { previewHeight: 236 } }),
    );
    expect(v.height).toBe(236);
    expect(v.height).not.toBe(340);
  });
});
