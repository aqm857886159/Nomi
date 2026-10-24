// 唯一读法（#1213）：先合同、再通用规则；通用规则核媒体类型、排除回显的参考地址、排除缩略图 / 尾帧，
// 说出用的是哪条规则；状态问共享词表，认不出不当失败。
import { describe, expect, it } from "vitest";
import { findResultUrlByGenericRule, readTaskResponse, requestEchoUrls } from "./taskResultReading";
import { classifyUpstreamTaskStatus } from "../shared/taskStatus";

const MP4 = "https://cdn.example.test/out.mp4";

describe("共享状态词表", () => {
  it("各家真实写法都认得（大小写不敏感）", () => {
    for (const word of ["SUCCESS", "succeeded", "completed", "done", "finished", "COMPLETED", "SUCCEEDED"]) expect(classifyUpstreamTaskStatus(word)).toBe("succeeded");
    for (const word of ["NOT_START", "SUBMITTED", "QUEUED", "IN_QUEUE", "pending", "waiting", "THROTTLED"]) expect(classifyUpstreamTaskStatus(word)).toBe("queued");
    for (const word of ["IN_PROGRESS", "processing", "generating", "RUNNING", "in-progress"]) expect(classifyUpstreamTaskStatus(word)).toBe("running");
    for (const word of ["FAILURE", "failed", "fail", "error", "rejected", "expired"]) expect(classifyUpstreamTaskStatus(word)).toBe("failed");
    for (const word of ["cancelled", "CANCELED"]) expect(classifyUpstreamTaskStatus(word)).toBe("cancelled");
  });

  it("认不出 / 空 → unknown（绝不当失败）", () => {
    expect(classifyUpstreamTaskStatus("marinating")).toBe("unknown");
    expect(classifyUpstreamTaskStatus("UNKNOWN")).toBe("unknown");
    expect(classifyUpstreamTaskStatus("")).toBe("unknown");
    expect(classifyUpstreamTaskStatus(undefined)).toBe("unknown");
  });
});

describe("readTaskResponse：先合同、再通用规则", () => {
  it("合同读得到就用合同（rule=contract）", () => {
    const reading = readTaskResponse({ response: { status: "succeeded", content: { video_url: MP4 } }, responseMapping: { status: "status", video_url: "content.video_url" }, statusMapping: undefined, wantedKind: "video" });
    expect(reading).toMatchObject({ status: "succeeded", assetUrls: [MP4], rule: "contract" });
  });

  it("合同读不到、上游说成了 → 通用规则在响应里找到地址，并说出路径", () => {
    const reading = readTaskResponse({ response: { code: "success", data: { status: "SUCCESS", result_url: MP4 } }, responseMapping: { video_url: "data[*].url" }, statusMapping: undefined, wantedKind: "video" });
    expect(reading).toMatchObject({ status: "succeeded", assetUrls: [MP4], rule: "generic:data.result_url" });
  });

  it("进行中的响应里出现的地址不拿去落盘", () => {
    const reading = readTaskResponse({ response: { status: "processing", url: MP4 }, responseMapping: null, statusMapping: undefined, wantedKind: "video" });
    expect(reading).toMatchObject({ status: "running", assetUrls: [], rule: "none" });
  });

  it("上游说成了却哪里都没有地址 → succeeded + 空（由取回层交「可找回」，不判失败）", () => {
    expect(readTaskResponse({ response: { status: "completed", id: "x" }, responseMapping: null, statusMapping: undefined, wantedKind: "video" })).toMatchObject({ status: "succeeded", assetUrls: [], rule: "none" });
  });
});

describe("通用规则的三道筛", () => {
  it("按期望媒体类型核扩展名：要视频不接一张图", () => {
    expect(findResultUrlByGenericRule({ status: "succeeded", url: "https://cdn.example.test/a.png" }, "video")).toBeNull();
    expect(findResultUrlByGenericRule({ status: "succeeded", url: "https://cdn.example.test/a.png", video_url: MP4 }, "video")?.urls).toEqual([MP4]);
  });

  it("排除本次请求回显的参考地址", () => {
    const echo = requestEchoUrls({ image_url: "https://refs.example.test/cat.mp4", nested: [{ url: "https://refs.example.test/b.mp4" }] });
    expect(echo.has("https://refs.example.test/cat.mp4")).toBe(true);
    expect(findResultUrlByGenericRule({ status: "succeeded", url: "https://refs.example.test/cat.mp4" }, "video", echo)).toBeNull();
    expect(findResultUrlByGenericRule({ status: "succeeded", output: { url: MP4 }, input: { url: "https://refs.example.test/b.mp4" } }, "video", echo)?.urls).toEqual([MP4]);
  });

  // 带空格的参考链接：发出去的参考是参数层序列化后的写法（空格 → %20），上游回显的也是它；extras 里存的是原样写法。
  it("带空格的参考：上游回显序列化后的写法也认得是回显，不当产物", () => {
    const echo = requestEchoUrls({ referenceVideoUrls: ["https://refs.example.test/Windows ref.mp4"] });
    expect(findResultUrlByGenericRule({ status: "succeeded", url: "https://refs.example.test/Windows%20ref.mp4" }, "video", echo)).toBeNull();
    expect(findResultUrlByGenericRule({ status: "succeeded", output: { url: MP4 }, input: { url: "https://refs.example.test/Windows%20ref.mp4" } }, "video", echo)?.urls).toEqual([MP4]);
  });

  it("排除缩略图 / 封面 / 尾帧 / 参考字段", () => {
    expect(findResultUrlByGenericRule({ thumbnail_url: "https://cdn.example.test/t.mp4", content: { last_frame_url: "https://cdn.example.test/l.mp4" }, reference_urls: ["https://cdn.example.test/r.mp4"] }, "video")).toBeNull();
  });

  it("同一张列表里的兄弟一起取（多产物），别处的地址不搭车", () => {
    const found = findResultUrlByGenericRule({ data: { result: { videos: [{ url: ["https://cdn.example.test/1.mp4"] }, { url: ["https://cdn.example.test/2.mp4"] }] }, poster: "https://cdn.example.test/p.mp4" } }, "video");
    expect(found).toEqual({ urls: ["https://cdn.example.test/1.mp4", "https://cdn.example.test/2.mp4"], path: "data.result.videos.*.url.*" });
  });

  it("被当字符串二次嵌套的 JSON 也认（KIE 的 resultJson）", () => {
    expect(findResultUrlByGenericRule({ data: { state: "success", resultJson: JSON.stringify({ resultUrls: [MP4] }) } }, "video")?.urls).toEqual([MP4]);
  });

  it("已知形状：同步接口的 b64_json 解成 data: 地址", () => {
    const found = findResultUrlByGenericRule({ data: [{ b64_json: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64") }] }, "image");
    expect(found?.path).toBe("known-shape");
    expect(found?.urls[0]).toMatch(/^data:image\/png;base64,/);
  });
});
