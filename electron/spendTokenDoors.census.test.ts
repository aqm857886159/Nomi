// 令牌路付费口普查（2026-10-27，docs/plan/2026-10-27-browser-extract-grant.md ★3）：少接一个口就红。
//
// 数门不写第二个扫描器：用 scripts/door-map.mjs 的 doorsForTargets 数出全部 runTask / runWorkbenchTaskByVendor 门，
// 铸令牌的门用同一个函数数 mintSpendGrant / confirmSpendAndMintGrant；登记表与判定住在 scripts/spend-token-doors.mjs。
// 本测试只做「数门 → 判定 → 期望零条」，反例往纯判定里注入门（不改真源码，不怕和别的测试抢文件）。
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { doorsForTargets } from "../scripts/door-map.mjs";
import {
  MINT_SYMBOLS,
  SPEND_TOKEN_DOORS,
  SPEND_TOKEN_DOOR_SYMBOLS,
  judgeSpendTokenDoors,
} from "../scripts/spend-token-doors.mjs";

type Door = { kind: string; path: string; symbol: string };

const all = doorsForTargets([...SPEND_TOKEN_DOOR_SYMBOLS, ...MINT_SYMBOLS]) as Door[];
const doors = all.filter((door) => SPEND_TOKEN_DOOR_SYMBOLS.includes(door.symbol));
const mintDoors = all.filter((door) => MINT_SYMBOLS.includes(door.symbol));
const judge = (input: { doors?: Door[]; mintDoors?: Door[]; table?: typeof SPEND_TOKEN_DOORS }) =>
  judgeSpendTokenDoors({ doors: input.doors ?? doors, mintDoors: input.mintDoors ?? mintDoors, table: input.table, exists: existsSync });
const kinds = (findings: ReadonlyArray<{ kind: string; door: string }>) => findings.map((finding) => `${finding.kind} ${finding.door}`);

const EXTRACTION_RUN = "write|electron/browser/prompt/browserPromptExtractionRun.ts|runTask";

describe("令牌路付费口普查", () => {
  it("每一扇付费门都登记了令牌从哪来，表里没有过期的行，铸令牌的配对全在（零条）", () => {
    expect(doors.length).toBeGreaterThan(10);
    expect(judge({})).toEqual([]);
  });

  it("浏览器提取：自己问人、自己铸令牌（mints），旧的渲染层门已删，runWorkbenchTaskByVendor 只剩画布一扇", () => {
    expect(SPEND_TOKEN_DOORS.find((row) => row.door === EXTRACTION_RUN)?.role).toBe("mints");
    expect(mintDoors).toContainEqual({ kind: "write", path: "electron/browser/prompt/browserPromptExtractionRun.ts", symbol: "confirmSpendAndMintGrant" });
    expect(doors.filter((door) => door.symbol === "runWorkbenchTaskByVendor").map((door) => door.path)).toEqual([
      "src/workbench/generationCanvas/runner/catalogTaskActions.ts",
    ]);
  });

  describe("反例：少接一个口必须红", () => {
    it("(a) 新长出一个没登记的 runTask 调用方 → unregistered", () => {
      const stray = { kind: "write", path: "electron/someNewPaidDoor.ts", symbol: "runTask" };
      expect(kinds(judge({ doors: [...doors, stray] }))).toEqual(["unregistered write|electron/someNewPaidDoor.ts|runTask"]);
    });

    it("(b) 提取模块里拿掉铸令牌那一步（同文件不再有 confirmSpendAndMintGrant 写门）→ mints 行红", () => {
      const withoutMint = mintDoors.filter((door) => door.path !== "electron/browser/prompt/browserPromptExtractionRun.ts");
      expect(kinds(judge({ mintDoors: withoutMint }))).toEqual([`mints-without-mint ${EXTRACTION_RUN}`]);
    });

    it("(c) 表里留着一行代码里已经没有的门 → stale；登记表里删掉一扇门 → unregistered", () => {
      const gone = doors.filter((door) => !(door.path === "electron/tasks/comfyCandidateTest.ts" && door.symbol === "runTask"));
      expect(kinds(judge({ doors: gone }))).toEqual(["stale write|electron/tasks/comfyCandidateTest.ts|runTask"]);
      const missingRow = SPEND_TOKEN_DOORS.filter((row) => row.door !== EXTRACTION_RUN);
      expect(kinds(judge({ table: missingRow }))).toContain(`unregistered ${EXTRACTION_RUN}`);
    });

    it("(d) 修之前那扇渲染层门（runner 直接调 runWorkbenchTaskByVendor）：不登记就红，冒充 mints 也红，只有写明缺口才过", () => {
      const before = { kind: "write", path: "src/ui/browser/prompt/browserPromptExtractionRunner.ts", symbol: "runWorkbenchTaskByVendor" };
      const identity = "write|src/ui/browser/prompt/browserPromptExtractionRunner.ts|runWorkbenchTaskByVendor";
      expect(kinds(judge({ doors: [...doors, before] }))).toEqual([`unregistered ${identity}`]);
      const posingAsMints = [...SPEND_TOKEN_DOORS, { door: identity, role: "mints", test: "src/ui/browser/prompt/browserPromptExtractionRunner.test.ts", why: "假装自己铸了" }];
      expect(kinds(judge({ doors: [...doors, before], table: posingAsMints }))).toEqual([`mints-without-mint ${identity}`]);
      const honestGap = [...SPEND_TOKEN_DOORS, { door: identity, role: "known-gap", gap: "走 nomi:tasks:run 的令牌闸却无人铸令牌", owner: "协调另线", why: "修前现状" }];
      expect(judge({ doors: [...doors, before], table: honestGap })).toEqual([]);
    });

    it("(e) 渲染层的门没有「自带令牌」这个角色：想把 nomi:tasks:run 那一端登记成 renderer-one-shot → invalid-row（要么写 mints，要么写明缺口）", () => {
      const door = "write|electron/tasks/taskIpcHandlers.ts|runTask";
      expect(SPEND_TOKEN_DOORS.find((row) => row.door === door)?.role).toBe("free-local");
      const revived = SPEND_TOKEN_DOORS.map((row) => (row.door === door ? { ...row, role: "renderer-one-shot" } : row));
      expect(kinds(judge({ table: revived }))).toEqual([`invalid-row ${door}`]);
    });

    it("forwards 落不到 mints 行 → forwards-dangling", () => {
      const table = SPEND_TOKEN_DOORS.map((row) => row.door === "write|electron/main.ts|runTask" ? { ...row, to: "write|electron/capabilityCore/canvasTransportProvider.ts|runTask" } : row);
      expect(kinds(judge({ table }))).toEqual(["forwards-dangling write|electron/main.ts|runTask"]);
    });
  });
});
