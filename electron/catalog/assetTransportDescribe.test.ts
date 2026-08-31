// 设置页「素材上传通道」状态卡的数据源。这张卡的唯一价值是**说真话**——用户照它判断
// 「我的参考图/参考视频会不会跑到公网匿名图床上」。所以这里锁的是三件事：
//   1. 它读的是真解析器的第一名（不是另一套复刻的优先级）；
//   2. 没配 KIE 时视频**必须**如实报成 Nomi 公共 Relay（不能粉饰为私有）；
//   3. 配了 KIE 之后图片和视频都收敛到 KIE。
import { describe, expect, it } from "vitest";

import { describeAssetTransportChannels } from "./assetTransportDescribe";

const noVendors: Array<{ key?: string }> = [];
const describeWith = (keys: Record<string, string>, vendors: Array<{ key?: string }> = noVendors) =>
  describeAssetTransportChannels({ vendors, getApiKey: (key) => keys[key] ?? null });

const byKind = (rows: ReturnType<typeof describeAssetTransportChannels>, kind: string) =>
  rows.find((row) => row.kind === kind);

describe("describeAssetTransportChannels", () => {
  it("一个 key 都没有时：图片和视频先落到 Nomi 公共 Relay，并如实标 public-provider", () => {
    const rows = describeWith({});
    for (const kind of ["image", "video"]) {
      const row = byKind(rows, kind);
      expect(row?.vendorKey).toBe("nomi-relay");
      expect(row?.visibility).toBe("public-provider");
      expect(row?.host).toBe("nomi-asset-relay.2373272608.workers.dev");
    }
  });

  it("只配 apimart：图片走 apimart 私有链接，视频走 Nomi 公共 Relay（apimart 只收图）", () => {
    const rows = describeWith({ apimart: "key-apimart" });
    const image = byKind(rows, "image");
    expect(image?.vendorKey).toBe("apimart");
    expect(image?.visibility).toBe("provider-private");
    expect(image?.host).toBe("api.apimart.ai");
    expect(image?.ttlSeconds).toBe(72 * 60 * 60);

    const video = byKind(rows, "video");
    expect(video?.vendorKey).toBe("nomi-relay");
    expect(video?.visibility).toBe("public-provider");
  });

  it("配了 KIE：图片和视频都收敛到 KIE 的私有链接，视频不再出现在公共图床上", () => {
    const rows = describeWith({ kie: "key-kie", apimart: "key-apimart" });
    const image = byKind(rows, "image");
    expect(image?.vendorKey).toBe("kie");
    expect(image?.host).toBe("kieai.redpandaai.co");

    const video = byKind(rows, "video");
    expect(video?.vendorKey).toBe("kie");
    expect(video?.visibility).toBe("provider-private");
    expect(video?.ttlSeconds).toBe(24 * 60 * 60);
  });

  it("configured fal upload is shown as provider-public, not anonymous", () => {
    const rows = describeWith({ fal: "key-fal" }, [{ key: "fal" }]);
    const image = byKind(rows, "image");
    expect(image?.vendorKey).toBe("fal");
    expect(image?.visibility).toBe("public-provider");
  });

  it("描述 image / video / audio 三类，避免音频上传能力被错误归入视频", () => {
    expect(describeWith({}).map((row) => row.kind)).toEqual(["image", "video", "audio"]);
    expect(describeWith({}).map((row) => row.vendorKey)).toEqual(["nomi-relay", "nomi-relay", "nomi-relay"]);
  });
});
