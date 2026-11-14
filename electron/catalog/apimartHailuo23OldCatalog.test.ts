/**
 * 老用户守卫（2026-11-14，通用输入判定那一刀）：Hailuo 2.3 的判输入挪进了发送前的通用一步，
 * 目录声明不再挂 `apimart-hailuo-23` 这个请求变换。v0.24.1 写盘的目录里那两行 Hailuo 映射还存着
 * `"request_transform": "apimart-hailuo-23"`（真实老存档 model-catalog.json）。如果升级不覆盖这个名字，
 * 发送前的同步预检会因为「变换名没注册」直接报错——老用户的 Hailuo 一个都发不出去。
 * 这条测试量的就是：用真实老存档走升级，再对两行走同步预检，不许报错、不许残留旧名。
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import "./apimartVideos";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { selectTaskMapping, type CatalogState } from "./types";
import { validateRequestTransformSync } from "../tasks/requestTransforms";

describe("v0.24.1 老目录里的 Hailuo 2.3 升级后照常过发送前预检", () => {
  const root = new URL("../../tests/fixtures/old-user-data/curated/v0.24.1-apimart/", import.meta.url);
  const original = JSON.parse(fs.readFileSync(new URL("model-catalog.json", root), "utf8")) as CatalogState;

  it("老存档确实存着旧变换名（夹具前提）", () => {
    const names = original.mappings.filter((row) => row.modelKey === "MiniMax-Hailuo-2.3").map((row) => row.create.request_transform);
    expect(names).toEqual(["apimart-hailuo-23", "apimart-hailuo-23"]);
  });

  it.each(["text_to_video", "image_to_video"])("%s：升级后的映射过同步预检不报错", (taskKind) => {
    const { state } = applyBuiltinSeeds(structuredClone(original), "2026-11-14");
    const mapping = selectTaskMapping(state.mappings, "apimart", taskKind as never, "MiniMax-Hailuo-2.3");
    expect(mapping, taskKind).toBeTruthy();
    expect(() => validateRequestTransformSync(mapping!.create.request_transform, { model: "MiniMax-Hailuo-2.3", prompt: "x", resolution: "768P", duration: 6 }, { baseUrl: "" })).not.toThrow();
    expect(mapping!.create.request_transform).not.toBe("apimart-hailuo-23");
  });
});
