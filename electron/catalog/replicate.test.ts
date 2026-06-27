import { describe, expect, it } from "vitest";
import {
  REPLICATE_VENDOR_SEED,
  REPLICATE_DECOMPOSE_MODEL,
  REPLICATE_DECOMPOSE_PREDICTIONS_PATH,
  DECOMPOSE_LAYERS_DEFAULT,
  clampDecomposeLayers,
  buildDecomposeInput,
  parseDecomposeOutput,
} from "./replicate";

describe("replicate vendor seed", () => {
  it("裸 baseUrl 到 /v1 + bearer", () => {
    expect(REPLICATE_VENDOR_SEED.key).toBe("replicate");
    expect(REPLICATE_VENDOR_SEED.baseUrl).toBe("https://api.replicate.com/v1");
    expect(REPLICATE_VENDOR_SEED.authType).toBe("bearer");
  });
  it("本地图吞入走文件 API multipart，取 urls.get", () => {
    const ing = REPLICATE_VENDOR_SEED.assetIngestion as { strategy: string; endpoint: string; urlPath: string; fileField: string };
    expect(ing.strategy).toBe("upload-multipart");
    expect(ing.endpoint).toBe("https://api.replicate.com/v1/files");
    expect(ing.urlPath).toBe("urls.get");
    expect(ing.fileField).toBe("content");
  });
});

describe("clampDecomposeLayers", () => {
  it("夹在 [2,8]，非法回退默认", () => {
    expect(clampDecomposeLayers(1)).toBe(2);
    expect(clampDecomposeLayers(99)).toBe(8);
    expect(clampDecomposeLayers(6)).toBe(6);
    expect(clampDecomposeLayers(undefined)).toBe(DECOMPOSE_LAYERS_DEFAULT);
    expect(clampDecomposeLayers("x")).toBe(DECOMPOSE_LAYERS_DEFAULT);
    expect(clampDecomposeLayers(4.6)).toBe(5);
  });
});

describe("buildDecomposeInput", () => {
  it("按实测契约构造 body（image/num_layers/description/output_format/go_fast）", () => {
    const body = buildDecomposeInput("https://x/a.png", 6);
    expect(body.input.image).toBe("https://x/a.png");
    expect(body.input.num_layers).toBe(6);
    expect(body.input.description).toBe("auto");
    expect(body.input.output_format).toBe("png");
    expect(body.input.go_fast).toBe(true);
  });
  it("num_layers 越界被夹", () => {
    expect(buildDecomposeInput("u", 0).input.num_layers).toBe(2);
    expect(buildDecomposeInput("u", 20).input.num_layers).toBe(8);
  });
  it("提交端点指向官方模型 predictions", () => {
    expect(REPLICATE_DECOMPOSE_MODEL).toBe("qwen/qwen-image-layered");
    expect(REPLICATE_DECOMPOSE_PREDICTIONS_PATH).toBe("/models/qwen/qwen-image-layered/predictions");
  });
});

describe("parseDecomposeOutput", () => {
  it("string[] → 过滤空串", () => {
    expect(parseDecomposeOutput(["https://a", "", "https://b"])).toEqual(["https://a", "https://b"]);
  });
  it("单 string → 包成数组", () => {
    expect(parseDecomposeOutput("https://only")).toEqual(["https://only"]);
  });
  it("空 / 非法 → []", () => {
    expect(parseDecomposeOutput(null)).toEqual([]);
    expect(parseDecomposeOutput(undefined)).toEqual([]);
    expect(parseDecomposeOutput(123)).toEqual([]);
    expect(parseDecomposeOutput("")).toEqual([]);
  });
});
