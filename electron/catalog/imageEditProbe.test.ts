import { describe, it, expect } from "vitest";
import { classifyImageEditProbe, probeImageEditProtocol } from "./imageEditProbe";

describe("imageEditProbe 分类器（各站报错形状 → 端点存在性）", () => {
  it("2xx → 端点在（multipart）", () => {
    expect(classifyImageEditProbe(200, "")).toBe("openai-multipart-edits");
    expect(classifyImageEditProbe(201, "{}")).toBe("openai-multipart-edits");
  });

  it("400/422 且报错提到缺 image → 端点在", () => {
    expect(classifyImageEditProbe(400, `{"error":{"message":"Missing required parameter: 'image'."}}`)).toBe("openai-multipart-edits");
    expect(classifyImageEditProbe(400, "you must provide an image")).toBe("openai-multipart-edits");
    expect(classifyImageEditProbe(422, "image[] is required")).toBe("openai-multipart-edits");
    expect(classifyImageEditProbe(400, "图片不能为空")).toBe("openai-multipart-edits");
  });

  it("404/405/501 → 端点不在（null）", () => {
    expect(classifyImageEditProbe(404, "not found")).toBeNull();
    expect(classifyImageEditProbe(405, "method not allowed")).toBeNull();
    expect(classifyImageEditProbe(501, "not implemented")).toBeNull();
  });

  it("报错像「路由/模型不存在」→ null（即便 400）", () => {
    expect(classifyImageEditProbe(400, `{"error":"no such endpoint"}`)).toBeNull();
    expect(classifyImageEditProbe(400, "unknown path /v1/images/edits")).toBeNull();
    expect(classifyImageEditProbe(400, "无此接口")).toBeNull();
  });

  it("鉴权/服务端/歧义 400 → 保守 null（不误判成 multipart）", () => {
    expect(classifyImageEditProbe(401, "invalid api key")).toBeNull();
    expect(classifyImageEditProbe(403, "forbidden")).toBeNull();
    expect(classifyImageEditProbe(500, "internal error")).toBeNull();
    expect(classifyImageEditProbe(400, "prompt too long")).toBeNull(); // 没提 image
  });

  it("负信号里恰好含 image 也不误判成 present（先判 absent）", () => {
    expect(classifyImageEditProbe(404, "no such route for image edits")).toBeNull();
  });
});

describe("probeImageEditProtocol（注入 fetch，不触发真生成）", () => {
  const okResolver = (status: number, body: string) => async () => ({ status, text: async () => body });

  it("站有 edits 端点（400 缺 image）→ 探出 multipart，且请求发到 /v1/images/edits 且无 image[]", async () => {
    let sentUrl = "";
    let hadImage = true;
    const out = await probeImageEditProtocol({
      baseUrl: "https://relay.test/",
      apiKey: "sk-x",
      modelKey: "some-image-model",
      fetchImpl: async (url, init) => {
        sentUrl = url;
        hadImage = [...init.body.keys()].includes("image[]");
        return { status: 400, text: async () => "Missing required parameter: 'image'." };
      },
    });
    expect(out).toBe("openai-multipart-edits");
    expect(sentUrl).toBe("https://relay.test/v1/images/edits");
    expect(hadImage).toBe(false); // 故意不带图（探端点，非生成）
  });

  it("站无 edits 端点（404）→ null（交回智能默认）", async () => {
    const out = await probeImageEditProtocol({ baseUrl: "https://relay.test", modelKey: "m", fetchImpl: okResolver(404, "not found") });
    expect(out).toBeNull();
  });

  it("网络失败 → null（拿不准，不阻塞、不误判）", async () => {
    const out = await probeImageEditProtocol({ baseUrl: "https://relay.test", modelKey: "m", fetchImpl: async () => { throw new Error("ECONNRESET"); } });
    expect(out).toBeNull();
  });

  it("空 baseUrl → null（不发请求）", async () => {
    let called = false;
    const out = await probeImageEditProtocol({ baseUrl: "  ", modelKey: "m", fetchImpl: async () => { called = true; return { status: 200, text: async () => "" }; } });
    expect(out).toBeNull();
    expect(called).toBe(false);
  });
});
