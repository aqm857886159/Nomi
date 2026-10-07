/**
 * 「模型清单」对等（只测、不修）：用户在设置页藏起来 / 手排过的那份顺序，
 * Agent 与外部 MCP 看到的清单认不认。
 *
 * 两处：
 *   · 用户那一份 —— `electron/settings/modelBoxPreferenceSettings.ts` 落盘的 `model-box-preference.json`
 *     （渲染层的节点下拉、分镜行、批量「统一模型」都从它派生）。
 *   · Agent / MCP 那一份 —— `electron/catalog/modelCatalogListing.ts:183 deriveModelListing`
 *     （`dispatcher.ts:390 models.list` 的底层）。
 *
 * 今天红：`deriveModelListing` 全文不读这份偏好。用户镜头里是「我把重复的那几家藏了，
 * 跟 Agent 说用 seedream，它挑了一条我藏掉的，建出来的节点自己的下拉里反而找不到这个模型」。
 *
 * **不要求两边条数相同**：agent 清单刻意保留没配 key 的行（`core.ts:293-296`，理由正当——
 * 它要能对用户说「kie 没配 key」）。要求的是「藏没藏」与「排在哪」这两件事有同一个答案。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pinParitySettingsRoot } from "./parityElectronMock";

const testRoot = vi.hoisted(() => {
  const nodeFs = require("node:fs") as typeof import("node:fs");
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  return nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-parity-listing-"));
});

vi.mock("electron", async () => {
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(testRoot);
});

import { seedParityCatalog } from "./generationParityTestUtils";

/** 用户藏掉的两行 + 手排到最前的那一行（都是真实内置目录里的模型）。 */
const HIDDEN = ["z-image-turbo", "gpt-image-2"];
const ORDER_FIRST = "gpt-image-2.5-flare";

type Listing = { modelKey: string; vendor: string; hidden?: boolean };
let listing: Listing[] = [];
let restoreSettingsRoot: (() => void) | undefined;

beforeAll(async () => {
  // getSettingsRoot() intentionally honors NOMI_SETTINGS_DIR for real/e2e runs.
  // Pin it here as well so another test worker cannot redirect this fixture's
  // catalog/settings writes into a shared process-level root.
  restoreSettingsRoot = pinParitySettingsRoot(testRoot);
  await seedParityCatalog(["apimart"]);
  const { writeModelBoxPreferenceSettings, readModelBoxPreferenceSettings } = await import("../settings/modelBoxPreferenceSettings");
  writeModelBoxPreferenceSettings({ hiddenModelIds: HIDDEN, modelOrder: [ORDER_FIRST, ...HIDDEN] });
  const saved = readModelBoxPreferenceSettings();
  expect(saved.hiddenModelIds, "偏好没有落盘 = 这场对比是空的").toEqual(HIDDEN);

  const { deriveModelListing } = await import("../catalog/modelCatalogListing");
  const { readCatalog } = await import("../catalog/catalogStore");
  listing = deriveModelListing(readCatalog()) as unknown as Listing[];
});

afterAll(() => {
  restoreSettingsRoot?.();
});

describe("模型清单 · 设置页偏好 vs Agent/MCP 清单", () => {
  it("keeps the catalog and preference fixture under its isolated settings root", async () => {
    const { modelBoxPreferenceSettingsPath } = await import("../settings/modelBoxPreferenceSettings");
    const { catalogPath } = await import("../catalog/catalogFileAccess");
    expect(modelBoxPreferenceSettingsPath()).toContain(testRoot);
    expect(catalogPath()).toContain(testRoot);
  });

  it("Agent 清单确实是从同一份目录派生的（有行，且包含被藏的那几个模型）", () => {
    expect(listing.length).toBeGreaterThan(0);
    for (const hidden of HIDDEN) {
      expect(listing.some((row) => row.modelKey === hidden), `${hidden} 不在目录里，这条试金石失效`).toBe(true);
    }
  });

  it.fails("用户藏起来的模型，Agent 清单上要标着 hidden（今天红：B1）", () => {
    const leaked = listing.filter((row) => HIDDEN.includes(row.modelKey) && row.hidden !== true)
      .map((row) => `${row.vendor}/${row.modelKey}`);
    expect(leaked).toEqual([]);
  });

  it.fails("用户手排到第一位的模型，在 Agent 清单里也排第一（今天红：B1）", () => {
    expect(listing[0]?.modelKey).toBe(ORDER_FIRST);
  });
});
