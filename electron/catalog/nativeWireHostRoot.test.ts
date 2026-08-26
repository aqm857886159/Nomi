import { describe, expect, it } from "vitest";
import { hostRootJoin } from "../ai/requestPipeline";
import { listNativeWireProfiles } from "./nativeWireProfiles";

// ---------------------------------------------------------------------------
// 「原生端点从主机根拼」的**全矩阵**回归网兜（P2 结构保证，不是自觉）。
//
// 病史：hostRootBase 只剥一层尾部 /vN，于是火山官方口径的 baseUrl `https://ark…/api/v3`
// 被剥成 `…/api`，再拼自带 /api/v3 前缀的原生路径 → `…/api/api/v3/…`。探针拿它和
// 「查无此路由」哨兵比，两者同样 404 同样签名 → 恒判 exists:false → 原生报文全线失联：
// Seedream 改图降级成 chat/completions 多模态（它不是聊天模型 → 「没有图生图」），
// Seedance 图生视频同样降级。**一个拼接 bug 打掉一整族原生能力**，本地看不出来。
//
// 因此这里断言的是**每个** profile 的**每条** op 路径 × **每种**用户可能填的 baseUrl 形态：
// 新增 profile / 新增 taskKind 不进矩阵就会红（下面 expectedRoot 的穷举断言会漏项报错）。
// ---------------------------------------------------------------------------

/** 用户实际会填进来的 baseUrl 形态 → 该形态下原生路径应落在哪个根上。 */
const BASE_URL_CASES: Array<{ label: string; baseUrl: string; expectedRoot: string }> = [
  // 内置种子/官方文档口径（裸主机）。
  { label: "裸主机", baseUrl: "https://ark.cn-beijing.volces.com", expectedRoot: "https://ark.cn-beijing.volces.com" },
  // 官方文档给的完整 base，也是 providerPresets 里火山那条 —— 这条正是当初炸掉的形态。
  { label: "带 /api/v3", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", expectedRoot: "https://ark.cn-beijing.volces.com" },
  { label: "带 /api/v3 且尾斜杠", baseUrl: "https://ark.cn-beijing.volces.com/api/v3/", expectedRoot: "https://ark.cn-beijing.volces.com" },
  // 中转把地址填成 OpenAI 兼容命名空间：/v1 要被剥掉，原生路径从主机根走。
  { label: "中转 /v1", baseUrl: "https://relay.example.com/v1", expectedRoot: "https://relay.example.com" },
  // 中转挂在子路径下：子路径必须保留，只剥版本段。
  { label: "中转子路径 /codex/v1", baseUrl: "https://relay.example.com/codex/v1", expectedRoot: "https://relay.example.com/codex" },
  // 中转自己也把方舟原生代理在子路径下。
  { label: "中转子路径 /ark/api/v3", baseUrl: "https://relay.example.com/ark/api/v3", expectedRoot: "https://relay.example.com/ark" },
  { label: "带端口", baseUrl: "https://relay.example.com:8443/v1", expectedRoot: "https://relay.example.com:8443" },
];

/** 一个 profile 里所有会被真正发出去的路径（create 各 taskKind + query + 探针路径）。 */
function nativePathsOf(profile: ReturnType<typeof listNativeWireProfiles>[number]): Array<{ what: string; path: string }> {
  const paths: Array<{ what: string; path: string }> = [{ what: "probePath", path: profile.probePath }];
  for (const [taskKind, op] of Object.entries(profile.create)) {
    if (op?.path) paths.push({ what: `create.${taskKind}`, path: op.path });
  }
  if (profile.query?.path) paths.push({ what: "query", path: profile.query.path });
  return paths;
}

describe("原生端点（pathFrom:host-root）拼接矩阵", () => {
  const profiles = listNativeWireProfiles();

  it("矩阵非空（有 profile 可测）", () => {
    expect(profiles.length).toBeGreaterThan(0);
  });

  for (const profile of profiles) {
    describe(profile.archetypeId, () => {
      const paths = nativePathsOf(profile);

      it("create/query/probe 路径都声明了（不为空）", () => {
        expect(paths.length).toBeGreaterThan(1);
        for (const { what, path } of paths) expect(path, what).toMatch(/^\//);
      });

      it("每条 create op 都带 pathFrom:host-root（漏标 = 用 baseUrl 拼 = 打不中原生端点）", () => {
        for (const [taskKind, op] of Object.entries(profile.create)) {
          expect(op?.pathFrom, `${profile.archetypeId}.create.${taskKind}`).toBe("host-root");
        }
        if (profile.query) expect(profile.query.pathFrom, `${profile.archetypeId}.query`).toBe("host-root");
      });

      for (const { label, baseUrl, expectedRoot } of BASE_URL_CASES) {
        it(`${label}：每条路径恰好落在 ${expectedRoot}`, () => {
          for (const { what, path } of paths) {
            const url = hostRootJoin(baseUrl, path);
            expect(url, `${profile.archetypeId} ${what} @ ${label}`).toBe(`${expectedRoot}${path}`);
            // 双保险：任何重复段（/api/api、/v3/v3、/v1/v1）都是这族 bug 的指纹。
            expect(url, `${profile.archetypeId} ${what} @ ${label} 出现重复段`).not.toMatch(/\/([^/]+)\/\1(\/|$)/);
          }
        });
      }
    });
  }
});

describe("hostRootJoin 基本性质", () => {
  it("绝对 URL 原样返回", () => {
    expect(hostRootJoin("https://ark.cn-beijing.volces.com/api/v3", "https://cdn.example.com/x.png")).toBe(
      "https://cdn.example.com/x.png",
    );
  });

  it("按段边界折叠，不做子串匹配（/api 不吃 /apixyz）", () => {
    expect(hostRootJoin("https://h.example.com/api/v3", "/apixyz/v3/go")).toBe("https://h.example.com/api/apixyz/v3/go");
  });

  it("base 与 path 完全无重叠时原样拼", () => {
    expect(hostRootJoin("https://h.example.com/v1", "/api/v3/images/generations")).toBe(
      "https://h.example.com/api/v3/images/generations",
    );
  });
});
