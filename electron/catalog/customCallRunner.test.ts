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
  CustomCallScriptError,
  referencesViewFromParams,
  runCustomCallScript,
} from "./customCallRunner";
import type { Model, Vendor } from "./types";

const vendor = { key: "custom-x", name: "X", baseUrlHint: "https://relay.example/v1", enabled: true, authType: "bearer" } as unknown as Vendor;
const model = { vendorKey: "custom-x", modelKey: "m1", labelZh: "m1", kind: "image", enabled: true, createdAt: "", updatedAt: "" } as unknown as Model;

function run(
  script: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
  customConfig: Record<string, string> = {},
  signal?: AbortSignal,
) {
  return runCustomCallScript({
    vendor,
    model,
    apiKey: "sk-secret-123",
    customConfig,
    script,
    prompt: "p",
    params,
    taskKind: "image_to_video",
    modeId: "firstlast",
    timeoutMs,
    signal,
  });
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

  it("taskKind/modeId 注入的是只读任务上下文，而不是供应商猜测", async () => {
    const outcome = await run(`if (taskKind !== 'image_to_video') throw new Error('task kind: ' + taskKind)
if (modeId !== 'firstlast') throw new Error('mode: ' + modeId)
return 'https://relay.example/out.mp4'`);
    expect(outcome.assets).toEqual(["https://relay.example/out.mp4"]);
  });

  it("脚本只能看到契约能力，看不到 Node、Electron 或浏览器网络全局", async () => {
    const outcome = await run(`return { text: [typeof process, typeof require, typeof fetch, typeof window].join(',') }`);
    expect(outcome.text).toBe("undefined,undefined,undefined,undefined");
  });

  it("不能通过动态 import 绕过能力边界", async () => {
    await expect(run(`await import('node:fs')\nreturn 'https://relay.example/escaped.png'`)).rejects.toThrow();
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
  it("两张普通参考图保持原角色、顺序和数量，不隐式产生首帧", () => {
    const view = referencesViewFromParams({
      reference_image_urls: ["https://a/1.png", "https://a/2.png"],
    });
    expect(view.firstFrame).toBeUndefined();
    expect(view.images).toEqual(["https://a/1.png", "https://a/2.png"]);
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
  it("脚本能读取主进程解密的 custom config，错误与 cause 都不泄漏", async () => {
    const secret = 'secondary secret: a"b c';
    const err = await run(
      "if (config.signingKey !== 'secondary secret: a\\\"b c') throw new Error('missing config')\n" +
        "throw new Error('rejected ' + JSON.stringify(config.signingKey))",
      {},
      undefined,
      { signingKey: secret },
    ).catch((error) => error);
    expect(err).toBeInstanceOf(CustomCallScriptError);
    expect(JSON.stringify({ message: err.message, cause: err.causeError?.message })).not.toContain(secret);
    expect(JSON.stringify({ message: err.message, cause: err.causeError?.message })).not.toContain('a\\\\"b c');
  });
  it("超时中断 sleep 中的脚本", async () => {
    const err = await run("await sleep(60000)\nreturn 'x'", {}, 120).catch((e) => e);
    expect(String(err.message)).toMatch(/超时/);
  }, 10000);
  it("标准 TimeoutError 信号不依赖墙钟越界也归类为超时", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("deadline", "TimeoutError"));
    const err = await run("return 'x'", {}, 60_000, {}, controller.signal).catch((e) => e);
    expect(String(err.message)).toMatch(/超时/);
  });
});
