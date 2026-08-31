import { describe, expect, it, vi } from "vitest";
import {
  applyRequestTransform,
  applyRequestTransformSync,
  registerRequestTransform,
  validateRequestTransformSync,
} from "./requestTransforms";

describe("requestTransforms 注册表", () => {
  it("未声明 / 未注册 → 原样返回（对现有 vendor 零影响）", async () => {
    const body = { a: 1 };
    expect(await applyRequestTransform(undefined, body, { baseUrl: "" })).toBe(body);
    expect(await applyRequestTransform("nope-not-registered", body, { baseUrl: "" })).toBe(body);
  });

  it("已注册 → 变换执行，拿到 baseUrl 上下文；支持 async", async () => {
    registerRequestTransform("test-echo", async (body, { baseUrl }) => ({ body, baseUrl }));
    expect(await applyRequestTransform("test-echo", { x: 1 }, { baseUrl: "http://h" })).toEqual({ body: { x: 1 }, baseUrl: "http://h" });
  });

  it("变换抛错要冒泡（fail fast 给人话，与 responseTransforms 吞错的契约刻意相反）", async () => {
    registerRequestTransform("test-throw", () => {
      throw new Error("确定性人话错误");
    });
    await expect(applyRequestTransform("test-throw", {}, { baseUrl: "" })).rejects.toThrow("确定性人话错误");
  });

  it("同步预检复用同一注册表，并运行同步 validator 与 transform", () => {
    const validate = vi.fn();
    registerRequestTransform("test-sync", (body, { baseUrl }) => ({ body, baseUrl, checked: true }), validate);
    const body = { x: 1 };
    validateRequestTransformSync("test-sync", body, { baseUrl: "https://sync.example" });
    expect(validate).toHaveBeenCalledWith(body, { baseUrl: "https://sync.example" });
    expect(applyRequestTransformSync("test-sync", body, { baseUrl: "https://sync.example" })).toEqual({
      body,
      baseUrl: "https://sync.example",
      checked: true,
    });
  });

  it("同步预检遇到未知或异步 transform 时 fail-closed", () => {
    expect(() => applyRequestTransformSync("missing-sync-transform", {}, { baseUrl: "" }))
      .toThrow(/未注册|not registered/i);
    expect(() => validateRequestTransformSync("missing-sync-transform", {}, { baseUrl: "" }))
      .toThrow(/未注册|not registered/i);

    let asyncInvoked = false;
    let asyncValidatorInvoked = false;
    registerRequestTransform("test-async-sync-boundary", async (body) => {
      asyncInvoked = true;
      return body;
    }, async () => {
      asyncValidatorInvoked = true;
    });
    expect(() => validateRequestTransformSync("test-async-sync-boundary", {}, { baseUrl: "" }))
      .toThrow(/同步|synchronous/i);
    expect(() => applyRequestTransformSync("test-async-sync-boundary", {}, { baseUrl: "" }))
      .toThrow(/同步|synchronous/i);
    expect(asyncInvoked).toBe(false);
    expect(asyncValidatorInvoked).toBe(false);
  });
});
