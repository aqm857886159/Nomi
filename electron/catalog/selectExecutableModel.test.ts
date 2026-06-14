import { describe, it, expect } from "vitest";
import { selectExecutableModel, type Model } from "./types";

// 路由根因回归（P1·findExecutableModel 双键 OR 误路由）：
// 旧实现 `modelKey===k || modelAlias===k` 在「A 的 alias 撞 B 的 key」时，
// 会按数组序把 B 选成 A —— 精确 key 必须优先于 alias，否则路由到错模型。

function md(over: Partial<Model>): Model {
  return {
    modelKey: over.modelKey || "m",
    vendorKey: over.vendorKey || "kie",
    modelAlias: over.modelAlias ?? null,
    labelZh: over.labelZh || "x",
    kind: over.kind || "image",
    enabled: over.enabled ?? true,
    createdAt: "t",
    updatedAt: "t",
  } as Model;
}

describe("selectExecutableModel — 精确 key 优先于 alias", () => {
  it("alias 与另一模型的 key 碰撞时，精确 key 匹配胜出（不按数组序错选）", () => {
    // realA.modelKey === "kling-real"；fakeB.modelAlias 也叫 "kling-real" 但它是另一个模型。
    // 即使 fakeB 排在数组前面，传 "kling-real" 必须命中 realA（精确 key），不是 fakeB（alias）。
    const fakeB = md({ modelKey: "happyhorse", modelAlias: "kling-real" });
    const realA = md({ modelKey: "kling-real", modelAlias: null });
    expect(selectExecutableModel([fakeB, realA], "kie", "kling-real")?.modelKey).toBe("kling-real");
  });

  it("无精确 key 命中时回退到 alias 匹配（别名仍可用）", () => {
    const m = md({ modelKey: "internal-id", modelAlias: "friendly-name" });
    expect(selectExecutableModel([m], "kie", "friendly-name")?.modelKey).toBe("internal-id");
  });

  it("按 kind 过滤：要 video 时不会选到同名的 image 模型", () => {
    const img = md({ modelKey: "shared", kind: "image" });
    const vid = md({ modelKey: "shared", kind: "video" });
    expect(selectExecutableModel([img, vid], "kie", "shared", "video")?.kind).toBe("video");
  });

  it("只认 enabled + 同 vendor；都不匹配返回 undefined", () => {
    const disabled = md({ modelKey: "x", enabled: false });
    const otherVendor = md({ modelKey: "x", vendorKey: "other" });
    expect(selectExecutableModel([disabled, otherVendor], "kie", "x")).toBeUndefined();
  });

  it("精确 key 与精确 key 都在时取第一个匹配（确定性）", () => {
    const first = md({ modelKey: "dup", labelZh: "first" });
    const second = md({ modelKey: "dup", labelZh: "second" });
    expect(selectExecutableModel([first, second], "kie", "dup")?.labelZh).toBe("first");
  });
});
