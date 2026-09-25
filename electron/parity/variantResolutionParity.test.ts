/**
 * 「这一镜跑哪个变体」：画布 / 付费卡显示的，与宿主派发的，必须是同一个答案。
 *
 * 2026-09-26 真付费走查（PR #883 的 T4 / T5）：Agent 付费卡写着 Seedance 2.0「Fast」，宿主却按
 * `transportModelId: doubao-seedance-2.0`、`variantId: standard` 派发——卡上一个价，扣的是另一个。
 * 渲染层不看模型名、落到默认变体（fast）；宿主拿目录模型名反推变体，而目录行 `doubao-seedance-2.0`
 * 恰好就是 standard 变体的 key，于是永远推成 standard。两边各有一个 owner，答案相反。
 *
 * 这里不挑某一个模型：拿**真实内置目录**（`ensureBuiltinModelSeeds()` 种下来的那份）里每一条带变体的
 * 视频行，各走一遍渲染层与宿主的真实生产函数，逐条比。新接一个带变体的模型，这里自动覆盖到它。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), "nomi-variant-parity-"));
  return {
    app: {
      getPath: () => root, getAppPath: () => process.cwd(), getName: () => "nomi",
      getVersion: () => "0.0.0-test", on: () => undefined, whenReady: () => Promise.resolve(), quit: () => undefined,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
    BrowserWindow: class { static getAllWindows() { return []; } },
    shell: { openExternal: async () => undefined, openPath: async () => "" },
  };
});

import type { CatalogState } from "../catalog/types";
import type { PlanCandidate } from "../capabilityCore/executionContract";
import { normalizeVideoCandidate, videoCandidateForPlan } from "../capabilityCore/mcpGenerationVideoResolve";
import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { buildVideoModelCandidates, videoArchetypeIdFromMeta } from "../shared/videoCapabilities";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import type { VideoModelCandidate } from "../shared/videoCapabilities";
import { currentArchetypeVariant } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { projectSpendNode } from "../../src/workbench/ai/v4/spendCardDraft";
import { seedParityCatalog } from "./generationParityTestUtils";

type VariantRow = { vendorKey: string; modelKey: string; meta: unknown; candidates: VideoModelCandidate[] };

let rows: VariantRow[] = [];

beforeAll(async () => {
  const catalog: CatalogState = await seedParityCatalog([]);
  const videoModels = catalog.models.filter((model) => model.kind === "video");
  const candidates = buildVideoModelCandidates(videoModels.map((model) => ({
    provider: model.vendorKey, modelKey: model.modelKey, label: model.labelZh,
    archetypeId: videoArchetypeIdFromMeta(model.meta),
  })));
  rows = videoModels
    .filter((model) => (candidates.find((candidate) => candidate.provider === model.vendorKey && candidate.modelKey === model.modelKey)
      ?.archetype.variants?.length ?? 0) > 1)
    .map((model) => ({ vendorKey: model.vendorKey, modelKey: model.modelKey, meta: model.meta, candidates }));
});

function planCandidate(row: VariantRow, extra: Partial<PlanCandidate> = {}): PlanCandidate {
  const source = row.candidates.find((candidate) => candidate.provider === row.vendorKey && candidate.modelKey === row.modelKey)!;
  const defaultMode = source.archetype.modes.find((mode) => mode.id === source.archetype.defaultModeId) ?? source.archetype.modes[0]!;
  return {
    candidateId: "cand-1", revision: 1, moduleId: "generation.single-shot",
    providerId: row.vendorKey, modelId: row.modelKey,
    mode: modeTransportFor(defaultMode, source.archetype, source.provider) ?? "text_to_video", modeId: defaultMode.id,
    prompt: "一只橘猫在窗台上伸懒腰", parameters: {}, references: [],
    ...extra,
  } as PlanCandidate;
}

/** 画布节点 / 付费卡那一侧：一个刚落地、没存过变体的节点，显示的是哪个变体。 */
function rendererVariantId(row: VariantRow): string | undefined {
  const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, vendorKey: row.vendorKey, meta: row.meta });
  if (!archetype) return undefined;
  return currentArchetypeVariant(archetype, { modelKey: row.modelKey, archetype: { id: archetype.id, modeId: archetype.defaultModeId } })?.id;
}

describe("这一镜跑哪个变体：画布 / 付费卡 === 宿主派发（真实内置目录）", () => {
  it("目录里确实有带变体的视频行（否则下面的断言是空转）", () => {
    expect(rows.map((row) => `${row.vendorKey}/${row.modelKey}`)).toContain("apimart/doubao-seedance-2.0");
  });

  it("不指定变体时：画布显示的变体 === 宿主派发的变体，出站 model === 那个变体的 modelKey", () => {
    for (const row of rows) {
      const label = `${row.vendorKey}/${row.modelKey}`;
      const hostSelected = videoCandidateForPlan(planCandidate(row), row.candidates);
      const hostNormalized = normalizeVideoCandidate(planCandidate(row), row.candidates);
      const shown = rendererVariantId(row);
      expect(hostSelected?.candidate.variantId, `${label}：宿主派发的变体`).toBe(shown);
      const variant = hostSelected?.videoCandidate.archetype.variants?.find((item) => item.id === shown);
      expect(hostNormalized.transportModelId, `${label}：出站 model`).toBe(variant?.modelKey);
    }
  });

  it("付费卡那张生成框（projectSpendNode）读到的变体 === 宿主按同一镜候选派发的变体（指定或不指定都一样）", () => {
    for (const row of rows) {
      const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, vendorKey: row.vendorKey, meta: row.meta })!;
      const requests: Array<string | undefined> = [undefined, ...(archetype.variants ?? []).map((variant) => variant.id)];
      for (const variantId of requests) {
        const label = `${row.vendorKey}/${row.modelKey} variantId=${variantId ?? "（未指定）"}`;
        const host = videoCandidateForPlan(planCandidate(row, variantId ? { variantId } : {}), row.candidates);
        const node = projectSpendNode({
          shotId: "shot-1", index: 1, prompt: "p", providerId: row.vendorKey, modelId: row.modelKey,
          modeId: archetype.defaultModeId, parameters: {}, price: { known: false },
          ...(variantId ? { variantId } : {}),
        });
        const shown = node ? currentArchetypeVariant(archetype, node.meta as Record<string, unknown>)?.id : undefined;
        expect(shown, label).toBe(host?.candidate.variantId);
      }
    }
  });
});
