import { describe, expect, it } from "vitest";
import { BUILTIN_VENDOR_SEEDS, isLocalSeed } from "./builtinVendorSeeds";
import { outboundVendor } from "./outboundVendor";

const LOCAL_SEED_KEYS = ["comfyui-local", "local-text", "codex-local", "antigravity-cli", "local-speech"];

describe("一个 vendor key 出门时的样子", () => {
  it.each([
    ["apimart", { vendor: "apimart", modelsLeave: true }],
    ["apimart--mini", { vendor: "apimart", modelsLeave: true }],
    ["apimart--candidate-0123456789abcdef", { vendor: "apimart", modelsLeave: true }],
    ["comfyui-local", { vendor: "comfyui-local", modelsLeave: false }],
    ["comfyui-local--second-rig", { vendor: "comfyui-local", modelsLeave: false }],
    ["codex-local", { vendor: "codex-local", modelsLeave: false }],
    ["gw-example-com", { vendor: "custom", modelsLeave: false }],
    ["gw-example-com--mini", { vendor: "custom", modelsLeave: false }],
    ["comfyui-local-studio-rig", { vendor: "custom", modelsLeave: false }],
    ["local-8080", { vendor: "custom", modelsLeave: false }],
    ["custom", { vendor: "custom", modelsLeave: false }],
    ["", { vendor: "custom", modelsLeave: false }],
  ])("%s", (key, expected) => {
    expect(outboundVendor(key)).toEqual(expected);
  });

  it("种子表里本机的家就这几个；新加一个要来这里看一眼", () => {
    expect(BUILTIN_VENDOR_SEEDS.filter(isLocalSeed).map((seed) => seed.key).sort()).toEqual([...LOCAL_SEED_KEYS].sort());
  });

  it("每个种子：云端的名字和模型都留，本机的只留名字", () => {
    for (const seed of BUILTIN_VENDOR_SEEDS) {
      expect(outboundVendor(seed.key)).toEqual({ vendor: seed.key, modelsLeave: !LOCAL_SEED_KEYS.includes(seed.key) });
    }
  });
});
