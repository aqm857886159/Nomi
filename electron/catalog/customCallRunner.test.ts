/**
 * 自定义调用执行器回归锁：
 * ① 注入面与契约单源逐项一致（文档说有的变量必须真在作用域里——防「说明书骗人」类漂移）；
 * ② 返回值宽松归一的全部认可形状；③ 语法错误/超时/空产出的人话失败；
 * ④ apiKey 不得泄进错误消息与 transcript（脱敏）。
 * 纯脚本路径（不发网络），网络辅助器的行为由 vendorHttp 自己的测试负责。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

import { CUSTOM_CALL_INJECTED_KEYS, CUSTOM_CALL_VARIABLES } from "./customCallContract";
import {
  collectCustomCallAssets,
  collectCustomCallText,
  CustomCallScriptError,
  referencesViewFromParams,
  runCustomCallScript,
} from "./customCallRunner";
import type { Model, Vendor } from "./types";

const vendor = { key: "custom-x", name: "X", baseUrlHint: "https://relay.example/v1", enabled: true, authType: "bearer" } as unknown as Vendor;
const model = { vendorKey: "custom-x", modelKey: "m1", labelZh: "m1", kind: "image", enabled: true, createdAt: "", updatedAt: "" } as unknown as Model;

function run(script: string, params: Record<string, unknown> = {}, timeoutMs?: number) {
  return runCustomCallScript({ vendor, model, apiKey: "sk-secret-123", script, prompt: "p", params, timeoutMs });
}

describe("customCall contract alignment", () => {
  it("契约声明的每个变量都真的在脚本作用域里（单源对账）", async () => {
    const checks = CUSTOM_CALL_INJECTED_KEYS.map((k) => `if (typeof ${k} === 'undefined') throw new Error('missing ${k}')`).join("\n");
    const outcome = await run(`${checks}\nreturn 'data:image/png;base64,eA=='`);
    expect(outcome.assets).toEqual(["data:image/png;base64,eA=="]);
  });

  it("变量表与注入键一一对应（防契约文档与注入面漂移）", () => {
    expect(CUSTOM_CALL_VARIABLES.map((v) => v.name)).toEqual(CUSTOM_CALL_INJECTED_KEYS);
  });

  it("baseUrl/model/apiKey 注入真实值", async () => {
    const outcome = await run(`if (baseUrl !== 'https://relay.example/v1') throw new Error('baseUrl ' + baseUrl)
if (model !== 'm1') throw new Error('model')
if (apiKey !== 'sk-secret-123') throw new Error('key')
return 'https://relay.example/out.png'`);
    expect(outcome.assets[0]).toContain("out.png");
  });
});

describe("collectCustomCallAssets 归一", () => {
  it("认所有约定形状", () => {
    expect(collectCustomCallAssets("https://a/x.png")).toEqual(["https://a/x.png"]);
    expect(collectCustomCallAssets(["https://a/1.png", { url: "https://a/2.png" }])).toEqual(["https://a/1.png", "https://a/2.png"]);
    expect(collectCustomCallAssets({ video_url: "https://a/v.mp4" })).toEqual(["https://a/v.mp4"]);
    expect(collectCustomCallAssets({ image_url: "https://a/i.png" })).toEqual(["https://a/i.png"]);
    expect(collectCustomCallAssets({ b64_json: "eA==" })).toEqual(["data:image/png;base64,eA=="]);
    expect(collectCustomCallAssets({ urls: ["https://a/1.png", "https://a/2.png"] })).toEqual(["https://a/1.png", "https://a/2.png"]);
    expect(collectCustomCallAssets({ dataUrl: "data:image/png;base64,eA==" })).toEqual(["data:image/png;base64,eA=="]);
  });
  it("垃圾输入=空", () => {
    expect(collectCustomCallAssets(null)).toEqual([]);
    expect(collectCustomCallAssets({ nothing: 1 })).toEqual([]);
    expect(collectCustomCallAssets(["", "  "])).toEqual([]);
    expect(collectCustomCallAssets("<html><title>Sign in</title></html>")).toEqual([]);
    expect(collectCustomCallAssets("success")).toEqual([]);
  });

  it("用户直接 return 原始响应时，兼容常见 data/output/result 外壳", () => {
    expect(collectCustomCallAssets({ data: [{ url: "https://a/openai.png" }] })).toEqual(["https://a/openai.png"]);
    expect(collectCustomCallAssets({ output: ["https://a/replicate-1.png", "https://a/replicate-2.png"] })).toEqual([
      "https://a/replicate-1.png",
      "https://a/replicate-2.png",
    ]);
    expect(collectCustomCallAssets({ data: { result: { video_url: "https://a/nested.mp4" } } })).toEqual([
      "https://a/nested.mp4",
    ]);
  });
});

describe("缺文档时的返回诊断", () => {
  it("文本模型可以直接 return OpenAI 兼容原始响应", () => {
    expect(collectCustomCallText({ choices: [{ message: { content: "真实回答" } }] })).toBe("真实回答");
  });

  it("图片模型不能把普通 content 文本当成成功产物", async () => {
    await expect(run("return { content: 'not an image' }")).rejects.toThrow(/没有返回产物/);
  });

  it("只拿到异步任务 ID 时指出需要 poll，而不是只说没有产物", async () => {
    await expect(run("return { id: 'task-123', status: 'queued' }")).rejects.toThrow(/task-123.*poll|poll.*task-123/i);
  });

  it("错地址返回 200 HTML 时指出地址或鉴权问题，不能显示试跑成功", async () => {
    await expect(run("return '<html><title>Sign in</title></html>'")).rejects.toThrow(/HTML.*地址|地址.*HTML/);
  });
});

describe("references 便捷视图（键名对齐 archetypeInput 标准键）", () => {
  it("投影 first/last/数组三类", () => {
    const view = referencesViewFromParams({
      first_frame_url: "https://a/f.png",
      last_frame_url: "https://a/l.png",
      reference_image_urls: ["https://a/1.png"],
      reference_video_urls: ["https://a/v.mp4"],
      reference_audio_urls: [],
    });
    expect(view.firstFrame).toBe("https://a/f.png");
    expect(view.lastFrame).toBe("https://a/l.png");
    expect(view.images).toEqual(["https://a/1.png"]);
    expect(view.videos).toEqual(["https://a/v.mp4"]);
    expect(view.audios).toEqual([]);
  });
  it("reference_images 兜底 images（非档案模型的老键）", () => {
    expect(referencesViewFromParams({ reference_images: ["https://a/1.png"] }).images).toEqual(["https://a/1.png"]);
  });
});

describe("失败姿态", () => {
  it("语法错误=人话+不执行", async () => {
    await expect(run("this is not js ((")).rejects.toThrow(/语法错误/);
  });
  it("空产出=人话报错", async () => {
    await expect(run("return null")).rejects.toThrow(/没有返回产物/);
  });
  it("脚本抛错带 apiKey → 消息脱敏", async () => {
    const err = await run(`throw new Error('bad key sk-secret-123 rejected')`).catch((e) => e);
    expect(err).toBeInstanceOf(CustomCallScriptError);
    expect(String(err.message)).not.toContain("sk-secret-123");
    expect(String(err.message)).toContain("•••");
  });
  it("当前试跑填写的第二密钥会注入 config，且错误消息不得泄漏它", async () => {
    const err = await runCustomCallScript({
      vendor,
      model,
      apiKey: "sk-secret-123",
      customConfig: { api_secret: "secondary-secret-456", region: "cn-east-1" },
      script: `if (config.region !== 'cn-east-1') throw new Error('missing region')
throw new Error('rejected ' + config.api_secret)`,
      prompt: "p",
      params: {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CustomCallScriptError);
    expect(String(err.message)).not.toContain("secondary-secret-456");
    expect(String(err.message)).toContain("•••");
  });
  it("超时中断 sleep 中的脚本", async () => {
    const err = await run("await sleep(60000)\nreturn 'x'", {}, 120).catch((e) => e);
    expect(String(err.message)).toMatch(/超时/);
  }, 10000);
});
