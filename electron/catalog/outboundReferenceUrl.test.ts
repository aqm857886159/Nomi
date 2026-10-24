import { describe, expect, it } from "vitest";
import {
  comparableReferenceUrl,
  comparableReferenceValues,
  serializeReferenceParams,
  serializeReferenceUrl,
} from "./outboundReferenceUrl";

// 全部内置 mapping 的类级覆盖在 outboundReferenceUrl.matrix.test.ts；这里钉序列化本身的形状与边界。
const RAW = "https://cdn.example.com/Windows ref.png";
const SERIALIZED = "https://cdn.example.com/Windows%20ref.png";

describe("serializeReferenceParams（参数层收口）", () => {
  it("用户报的形状：MiniMax-H3 图生视频的 image_urls 带 Windows 文件名空格 → 序列化后的写法", () => {
    expect(serializeReferenceParams({ image_urls: [RAW] })).toEqual({ image_urls: [SERIALIZED] });
  });

  it.each([
    ["字符串", { first_frame_url: RAW }, { first_frame_url: SERIALIZED }],
    ["数组", { reference_images: [RAW, RAW] }, { reference_images: [SERIALIZED, SERIALIZED] }],
    ["[{url, role}]", { image_with_roles: [{ url: RAW, role: "first_frame" }] }, { image_with_roles: [{ url: SERIALIZED, role: "first_frame" }] }],
    [
      "嵌套的 archetypeInput 参数袋",
      { archetypeInput: { image_urls: [RAW], mode: "i2v" }, prompt: "一个镜头" },
      { archetypeInput: { image_urls: [SERIALIZED], mode: "i2v" }, prompt: "一个镜头" },
    ],
  ])("值形状：%s", (_name, input, expected) => {
    expect(serializeReferenceParams(input)).toEqual(expected);
  });

  it("键的驼峰 / 下划线写法都认（键表只写了一种写法也一样）", () => {
    // 共享键表里是 mask_url / first_frame_url；驼峰与大写连字符写法按同一个键认。
    expect(serializeReferenceParams({ maskUrl: RAW, "FIRST-FRAME-URL": RAW })).toEqual({ maskUrl: SERIALIZED, "FIRST-FRAME-URL": SERIALIZED });
  });

  it("参考值被上游推导抄到表外的键（参考键形态投影按请求体读的键落位）也按同一条参考换写法", () => {
    // Wan 3.0 的请求体读 audio：headless 只带 reference_audio_urls 时，投影把这条音频参考落到 audio 上（键不在表里）。
    expect(serializeReferenceParams({ reference_audio_urls: [RAW], audio: RAW, callback_url: "https://hooks.example.com/a b" })).toEqual({
      reference_audio_urls: [SERIALIZED],
      audio: SERIALIZED,
      callback_url: "https://hooks.example.com/a b",
    });
  });

  it("不是参考的键原样：提示词、回调地址里的空格不动", () => {
    const input = { prompt: "see https://cdn.example.com/a b.png", callback_url: "https://hooks.example.com/a b", negative_prompt: "blur" };
    expect(serializeReferenceParams(input)).toEqual(input);
  });

  it("幂等：已编码的、带签名查询串的、data: / blob: / nomi-local:// / ComfyUI 输入文件名都原样", () => {
    const signed = "https://cdn.example.com/a%20b.png?X-Amz-Signature=abc%2F123&X-Amz-Date=20261025T000000Z";
    const input = {
      image_urls: [SERIALIZED, signed],
      first_frame_url: "data:image/png;base64,AA==",
      last_frame_url: "blob:https://app.example.com/0b1c",
      reference_images: ["nomi-local://project/assets/Windows ref.png", "ComfyUI_00001_.png"],
    };
    expect(serializeReferenceParams(input)).toEqual(input);
    expect(serializeReferenceParams(serializeReferenceParams({ image_urls: [RAW] }))).toEqual({ image_urls: [SERIALIZED] });
  });

  it("首尾空白去掉、中文路径按 UTF-8 编码", () => {
    expect(serializeReferenceParams({ image_urls: [`  ${RAW}\n`, "https://cdn.example.com/图 1.png"] })).toEqual({
      image_urls: [SERIALIZED, "https://cdn.example.com/%E5%9B%BE%201.png"],
    });
  });

  it("解析不了的参考地址在发出去之前失败，报出是哪个参数", () => {
    expect(() => serializeReferenceParams({ image_urls: [SERIALIZED, "https://[bad"] })).toThrow(/image_urls\[1\]/);
  });

  it("不改入参（返回新对象）", () => {
    const input = { image_urls: [RAW], archetypeInput: { first_frame_url: RAW } };
    const snapshot = structuredClone(input);
    serializeReferenceParams(input);
    expect(input).toEqual(snapshot);
  });
});

describe("comparableReferenceUrl / comparableReferenceValues（比较两边用同一个序列化）", () => {
  it("原样和序列化后的写法比较时相等", () => {
    expect(comparableReferenceUrl(RAW)).toBe(comparableReferenceUrl(SERIALIZED));
    expect(serializeReferenceUrl(RAW)).toBe(comparableReferenceUrl(RAW));
  });

  it("解析不了的不抛、原样返回（发不发得出去不由比较改判）", () => {
    expect(comparableReferenceUrl("https://[bad")).toBe("https://[bad");
    expect(comparableReferenceValues({ a: ["https://[bad", RAW] })).toEqual({ a: ["https://[bad", SERIALIZED] });
  });
});
