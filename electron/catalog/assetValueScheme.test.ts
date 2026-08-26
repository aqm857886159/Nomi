import { describe, it, expect } from "vitest";
import {
  classifyAssetValue,
  describeAssetValue,
  isLocalizableAssetValue,
  parseInlineDataAsset,
  unreachableAssetValueError,
} from "./assetValueScheme";

// 真 PNG 头（≥12 字节，魔数嗅探要够长）。
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
// ISO-BMFF：4 字节 box size + "ftyp" + brand。
const MP4_BYTES = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from("ftypisom"), Buffer.from("mdat")]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

describe("classifyAssetValue", () => {
  it("认 nomi-local 与 data: 媒体内联为「要本地化」", () => {
    expect(classifyAssetValue("nomi-local://asset/p/a.png")).toBe("nomi-local");
    expect(classifyAssetValue(dataUrl("image/png", PNG_BYTES))).toBe("inline-data");
    expect(classifyAssetValue(dataUrl("video/mp4", MP4_BYTES))).toBe("inline-data");
    expect(classifyAssetValue("data:;base64,aGVsbG8=")).toBe("inline-data"); // 无声明 mime → 交给嗅探
    expect(isLocalizableAssetValue(dataUrl("image/png", PNG_BYTES))).toBe(true);
  });

  it("公网 URL 与普通字符串一律不碰（原样发给 vendor）", () => {
    expect(classifyAssetValue("https://cdn/a.png")).toBeNull();
    expect(classifyAssetValue("http://cdn/a.png")).toBeNull();
    expect(classifyAssetValue("images/nomi")).toBeNull();
    expect(classifyAssetValue("一段普通提示词")).toBeNull();
    expect(classifyAssetValue(42)).toBeNull();
    expect(classifyAssetValue(null)).toBeNull();
    expect(isLocalizableAssetValue("https://cdn/a.png")).toBe(false);
  });

  it("非媒体 data: 不当素材（别把一段 JSON/文案传去图床）", () => {
    expect(classifyAssetValue("data:text/plain,hello")).toBeNull();
    expect(classifyAssetValue("data:application/json;base64,e30=")).toBeNull();
    expect(classifyAssetValue("data:image/png")).toBeNull(); // 没有逗号 = 不是 data URI
  });

  it("blob:/file: 判为 unreachable（发出去必错）", () => {
    expect(classifyAssetValue("blob:file:///abc-123")).toBe("unreachable");
    expect(classifyAssetValue("file:///Users/me/a.png")).toBe("unreachable");
    expect(isLocalizableAssetValue("blob:file:///abc-123")).toBe(false);
  });

  it("裸文件系统路径与含空白的自由文本不判 unreachable（误杀比漏判更贵）", () => {
    // 自由文本里提到 file:// —— 判死会让一条正常生成整个失败。
    expect(classifyAssetValue("不支持 file:// 这种地址")).toBeNull();
    expect(classifyAssetValue("/Users/me/a.png")).toBeNull();
    expect(classifyAssetValue("C:\\Users\\me\\a.png")).toBeNull();
  });
});

describe("parseInlineDataAsset", () => {
  it("base64 载荷逐字节还原，contentType 走字节嗅探", () => {
    const asset = parseInlineDataAsset(dataUrl("image/png", PNG_BYTES));
    expect(asset?.bytes.equals(PNG_BYTES)).toBe(true);
    expect(asset?.contentType).toBe("image/png");
    expect(asset?.fileName.endsWith(".png")).toBe(true);
  });

  it("声明的 mime 说谎时以字节为准（视频被标成 image/png 不能进图片通道）", () => {
    const asset = parseInlineDataAsset(dataUrl("image/png", MP4_BYTES));
    expect(asset?.contentType).toBe("video/mp4");
    expect(asset?.fileName.endsWith(".mp4")).toBe(true);
  });

  it("嗅探认不出时退回声明的 mime", () => {
    const svg = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
    const asset = parseInlineDataAsset(svg);
    expect(asset?.contentType).toBe("image/svg+xml");
    expect(asset?.bytes.toString("utf8")).toContain("<svg");
  });

  it("文件名随内容变（同一请求里两张内联图不许重名 → 上传端点覆盖 = 两个参考塌成一张）", () => {
    const a = parseInlineDataAsset(dataUrl("image/png", PNG_BYTES));
    const b = parseInlineDataAsset(dataUrl("image/png", Buffer.concat([PNG_BYTES, Buffer.from("different")])));
    const again = parseInlineDataAsset(dataUrl("image/png", PNG_BYTES));
    expect(a?.fileName).not.toBe(b?.fileName);
    expect(a?.fileName).toBe(again?.fileName); // 同字节 → 同名（幂等）
  });

  it("坏载荷判死，不放一堆垃圾字节上路", () => {
    expect(parseInlineDataAsset("data:image/png;base64,")).toBeNull(); // 空载荷
    expect(parseInlineDataAsset("data:image/png;base64,!!!not base64!!!")).toBeNull();
    expect(parseInlineDataAsset("https://cdn/a.png")).toBeNull();
    expect(parseInlineDataAsset("data:text/plain,hi")).toBeNull(); // 非媒体
  });
});

describe("describeAssetValue / unreachableAssetValueError", () => {
  it("错误消息不把几 MB base64 糊到用户脸上", () => {
    const huge = dataUrl("image/png", Buffer.concat(Array.from({ length: 2000 }, () => PNG_BYTES)));
    const described = describeAssetValue(huge);
    expect(described.length).toBeLessThan(80);
    expect(described).toContain("data:image/png;base64,");
    expect(described).toContain("KB 内联素材");
    expect(describeAssetValue("https://cdn/a.png")).toBe("https://cdn/a.png");
  });

  it("unreachable 报错说清「为什么发不出去 + 怎么办」", () => {
    const message = unreachableAssetValueError("blob:file:///abc").message;
    expect(message).toContain("blob:");
    expect(message).toContain("服务商拉不到");
    expect(message).toContain("导入");
  });
});
