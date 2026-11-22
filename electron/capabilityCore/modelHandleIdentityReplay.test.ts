// 回放：两轮真模型评测（2026-11-07、2026-11-15）里 Agent 写错模型身份的每一种写法，换成完整名字之后会怎样。
//
// 当时模型分两半写身份（`providerId` + `modelId`），「id 抄对、家配错」是拒收里最多的一类。
// 这里把当时写下的（家, id）原样拼成它今天会写的那一串，喂给真正的查表函数、用内置目录：
// 判据（设计卡 docs/plan/2026-11-15-agent-intent-landing.md ★9 第 2 条）——
//   0 次拒收；或一次拒收，且给出的「最像的几个」里有对的那个名字，原样抄回去就过（不会再拒第二次）。
// 「对的那个」：目录里有同一个 id 的，就是那一行（模型抄的就是它）；没有的，取当时拒收文字里给的最近那个。
// 不出网、不花钱：只读内置目录。
import { describe, expect, it } from "vitest";
import { agentModelEntriesFromCatalog } from "../catalog/agentModelEntriesFromCatalog";
import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import { resolveModelHandle } from "../shared/agentCapabilities/modelHandle";

const state = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-09-22T00:00:00.000Z").state;
const rows = agentModelEntriesFromCatalog(state).map((row) => row.entry);

type Case = Readonly<{ round: string; written: string; right: string; first?: boolean }>;
/** `first`：对的那个必须排第一（模型 id 一字不差、只是家写错了的那种）。 */
const CASES: readonly Case[] = [
  // 11-07：写下的（家, id）
  { round: "11-07", written: "doubao-seedream-4-5-251128@apimart", right: "doubao-seedream-4-5-251128@volcengine", first: true },
  { round: "11-07", written: "doubao-seedream-5-0-pro@volcengine", right: "doubao-seedream-5-0-pro@apimart", first: true },
  { round: "11-07", written: "doubao-seedance-2-5-260628@volcengine", right: "doubao-seedance-2-5-260628@volcengine" },
  { round: "11-07", written: "MAILAND/majicflus_v1@MAILAND", right: "MAILAND/majicflus_v1@modelscope", first: true },
  { round: "11-07", written: "bytedance/seedance-2@bytedance", right: "bytedance/seedance-2@kie", first: true },
  { round: "11-07", written: "doubao-seedance-2-0-260128@volcengine", right: "doubao-seedance-2-0-260128@volcengine" },
  { round: "11-07", written: "doubao-seedream-4.5@volcengine", right: "doubao-seedream-4.5@apimart", first: true },
  { round: "11-07", written: "agnes-video-2.5", right: "agnes-video-2.5@agnes" },
  { round: "11-07", written: "agnes-video-2.5-flash@apimart", right: "agnes-video-2.5-flash@agnes", first: true },
  // 11-15：写下的（家, id），以及当时拒收给的最近那个
  { round: "11-15", written: "bytedance/seedance-2@apimart", right: "bytedance/seedance-2@kie", first: true },
  { round: "11-15", written: "doubao-seedance-2-5@apimart", right: "doubao-seedance-2.5@apimart", first: true },
  { round: "11-15", written: "doubao-seedance-2-5-260628@apimart", right: "doubao-seedance-2-5-260628@volcengine", first: true },
  { round: "11-15", written: "doubao-seedream-4-5-251128@apimart", right: "doubao-seedream-4-5-251128@volcengine", first: true },
  { round: "11-15", written: "bytedance/seedance-2-5@bytedance", right: "bytedance/seedance-2-5@kie", first: true },
  { round: "11-15", written: "doubao-seedream-4-5@volcengine", right: "doubao-seedream-4-5-251128@volcengine" },
];

describe("写错身份的旧写法，换成完整名字后的回放", () => {
  it("目录里真有这些「对的那个」（前提没了这组断言就是空的）", () => {
    for (const item of CASES) expect(resolveModelHandle(rows, item.right), item.right).toMatchObject({ ok: true, handle: item.right });
  });

  for (const item of CASES) {
    it(`${item.round} · ${item.written}`, () => {
      const first = resolveModelHandle(rows, item.written);
      if (first.ok) {
        expect(first.handle).toBe(item.right);
        return;
      }
      // 一次拒收：给出的名字里有对的那个，抄回去就过。
      const offered = first.reason === "unknown" ? first.nearest : first.handles;
      expect(offered, "拒收没给下一步可抄的名字").toContain(item.right);
      if (item.first) expect(offered[0]).toBe(item.right);
      expect(resolveModelHandle(rows, item.right)).toMatchObject({ ok: true, handle: item.right });
    });
  }

  it("只写 id（不写家）时：目录里一家有就落到那一家，回执告诉 Agent 落成了谁", () => {
    for (const item of CASES) {
      const id = item.right.slice(0, item.right.lastIndexOf("@"));
      const carriers = rows.filter((row) => row.modelId === id);
      const lookup = resolveModelHandle(rows, id);
      if (carriers.length === 1) expect(lookup).toMatchObject({ ok: true, handle: item.right, via: "model_id" });
      else expect(lookup).toMatchObject({ ok: false, reason: "ambiguous" });
    }
  });
});
