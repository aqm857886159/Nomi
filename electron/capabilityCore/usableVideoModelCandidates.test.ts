// 这一组钉的是「什么时候读目录」，不是「怎么建候选」（后者由
// electron/shared/videoCapabilities/index.test.ts 管）。
//
// 2026-09-15：appIntegration 与 mcpStdioServer 各存了一份逐字相同的派生，两份都在
// 模块装配时算一次就定住。钥匙常常是进程起来之后才写进来的，于是那一刻还没钥匙的供应商
// 被永久判成不可用，要重启才认——mcp-l2 走查的 C9 就红在「刚接好 apimart 却只报得出
// dreamina」。第一条测试用「先没钥匙、后有钥匙」重演那个时序：缓存住结果它就红。
import { beforeEach, describe, expect, it, vi } from "vitest";

const readCatalog = vi.fn();
const availabilityUsable = vi.fn();

vi.mock("../catalog/catalogStore", () => ({ readCatalog: () => readCatalog() }));
vi.mock("../catalog/catalogModelAvailability", () => ({
  createCatalogAvailability: () => ({ of: (model: { modelKey: string }) => ({ usable: availabilityUsable(model) }) }),
}));

const videoModel = (modelKey: string, vendorKey = "apimart") => ({
  kind: "video" as const,
  vendorKey,
  modelKey,
  labelZh: modelKey,
  meta: {},
});

async function derive() {
  const { deriveUsableVideoModelCandidates } = await import("./usableVideoModelCandidates");
  return deriveUsableVideoModelCandidates();
}

beforeEach(() => {
  vi.resetModules();
  readCatalog.mockReset();
  availabilityUsable.mockReset();
});

describe("可用视频模型名单：每次问都重新算", () => {
  it("钥匙在进程起来之后才存进来 → 下一次问就该看见它（不是等重启）", async () => {
    readCatalog.mockReturnValue({ models: [videoModel("sora-2")] });
    availabilityUsable.mockReturnValue(false);
    expect(await derive()).toEqual([]);

    // 用户此刻在设置里接入了供应商：目录没变，变的是「能不能用」。
    availabilityUsable.mockReturnValue(true);
    const after = await derive();
    expect(after.map((candidate) => candidate.modelKey)).toEqual(["sora-2"]);
  });

  it("目录本身变了（新增一行模型）也是下一次问就看见", async () => {
    availabilityUsable.mockReturnValue(true);
    readCatalog.mockReturnValue({ models: [videoModel("sora-2")] });
    expect((await derive()).length).toBe(1);

    readCatalog.mockReturnValue({ models: [videoModel("sora-2"), videoModel("hailuo-02", "dreamina")] });
    expect((await derive()).map((candidate) => candidate.modelKey).sort()).toEqual(["hailuo-02", "sora-2"]);
  });

  it("每次调用都真的重读目录一次——没有任何一层缓存", async () => {
    readCatalog.mockReturnValue({ models: [] });
    availabilityUsable.mockReturnValue(true);
    const { deriveUsableVideoModelCandidates } = await import("./usableVideoModelCandidates");
    deriveUsableVideoModelCandidates();
    deriveUsableVideoModelCandidates();
    deriveUsableVideoModelCandidates();
    expect(readCatalog).toHaveBeenCalledTimes(3);
  });

  it("不可用的照样滤掉：可用性是唯一判据，不是「目录里有就报」", async () => {
    readCatalog.mockReturnValue({ models: [videoModel("sora-2"), videoModel("veo-3.1", "google")] });
    availabilityUsable.mockImplementation((model: { modelKey: string }) => model.modelKey === "sora-2");
    expect((await derive()).map((candidate) => candidate.modelKey)).toEqual(["sora-2"]);
  });

  it("非 video 的行不进这份名单", async () => {
    readCatalog.mockReturnValue({ models: [{ ...videoModel("sora-2"), kind: "image" }, videoModel("hailuo-02")] });
    availabilityUsable.mockReturnValue(true);
    expect((await derive()).map((candidate) => candidate.modelKey)).toEqual(["hailuo-02"]);
  });
});
