// 薄名单里每种方式的比例 / 时长（`modeFacts`）和起草准入层说的是**同一个答案**——全目录逐模型、逐方式核（2026-11-15）。
//
// 为什么是类级：薄名单这一行是模型起草前唯一读到的「这种方式能写什么」。它要是和准入层各答各的，
// 模型照着名单写、准入层再拒，就是 11-15 P18 那一圈（首帧镜头写比例 → 被拒 → 猜）换个地方重演。
// 判据：名单说 `no aspectRatio` → 准入层拒任何比例；名单列出的每一个值 → 准入层收（或只因「同比例有几档尺寸」要求挑档）；
// 名单说 `no durationSec` → 准入层拒时长；范围 / 档位 → 两端或每一档都收。
import { describe, expect, it } from "vitest";

import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import { agentModelEntriesFromCatalog } from "../catalog/agentModelEntriesFromCatalog";
import { modelSpecRow } from "../shared/agentCapabilities/modelSpecProjection";
import { ContractCompilationError, type PlanCandidate } from "./executionContract";
import { admitAuthoredDuration } from "./generationAuthoredDuration";
import { parameterFieldForControl } from "./modelAdmissionSchema";
import { catalogAvailabilityFor } from "./modelSpecRead";
import { projectSemanticAspectRatio } from "./semanticAspectRatio";

const state = applyBuiltinSeeds(
  { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as never,
  "2026-11-15T00:00:00.000Z",
).state;
const entries = agentModelEntriesFromCatalog(state).map((row) => row.entry);

const candidateWith = (vendor: string, modelId: string, parameters: Record<string, unknown>): PlanCandidate => ({
  candidateId: "c", revision: 1, moduleId: "generation.single-shot", providerId: vendor, modelId, mode: "text_to_video",
  prompt: "p", parameters,
} as unknown as PlanCandidate);

/** `t2v: aspectRatio 16:9|auto, durationSec 4-15; first: no aspectRatio, ...` → 每种方式一份事实。 */
function factsByMode(modeFacts: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const group of modeFacts.split("; ")) {
    const [modes, facts] = group.split(": ");
    for (const mode of modes!.split(",")) out.set(mode, facts!.split(", "));
  }
  return out;
}

const refused = (run: () => unknown): ContractCompilationError | null => {
  try { run(); return null; } catch (error) {
    if (error instanceof ContractCompilationError) return error;
    throw error;
  }
};

describe("薄名单的 modeFacts 与起草准入层同一个答案", () => {
  const generative = entries.filter((entry) => (entry.kind === "video" || entry.kind === "image") && entry.modes.length > 0);

  it("目录里真的有这一类（视频、图片、只收自动的方式、没有时长的方式）", () => {
    const rows = generative.map((entry) => modelSpecRow(entry).modeFacts ?? "");
    expect(generative.length).toBeGreaterThan(100);
    expect(rows.every(Boolean)).toBe(true);
    expect(rows.some((row) => row.includes("no aspectRatio"))).toBe(true);
    expect(rows.some((row) => row.includes("no durationSec"))).toBe(true);
    expect(rows.some((row) => /durationSec \d+-\d+/.test(row))).toBe(true);
  });

  it("全目录逐方式：名单写的每一个比例 / 时长，准入层都按同一句话收或拒", () => {
    const mismatches: string[] = [];
    for (const entry of generative) {
      const facts = factsByMode(modelSpecRow(entry).modeFacts!);
      for (const mode of entry.modes) {
        const schema = Object.fromEntries(mode.params.map((control) => [control.key, parameterFieldForControl(control)]));
        const where = `${entry.vendor}/${entry.modelId} ${mode.modeId}`;
        const lines = facts.get(mode.modeId) ?? [];
        const ratio = lines.find((line) => line.includes("aspectRatio"))!;
        const ratioWith = (value: string) => refused(() => projectSemanticAspectRatio(candidateWith(entry.vendor ?? "", entry.modelId, { aspectRatio: value }), schema));
        if (ratio === "no aspectRatio") {
          if (!ratioWith("16:9") || !ratioWith("9:16")) mismatches.push(`${where}: 名单说没有比例，准入层却收`);
        } else {
          for (const value of ratio.replace("aspectRatio ", "").split("|")) {
            const error = ratioWith(value);
            // 同一个比例有几档像素尺寸：准入层要调用方挑档（parameters.<键>），这不是「不收这个比例」。
            if (error && !error.rejection?.path.startsWith("parameters.")) mismatches.push(`${where}: 名单列了 ${value}，准入层拒：${error.message}`);
          }
        }
        if (entry.kind !== "video") continue;
        const duration = lines.find((line) => line.includes("durationSec"));
        const durationWith = (value: number) => refused(() => admitAuthoredDuration(candidateWith(entry.vendor ?? "", entry.modelId, { duration: value }), schema));
        if (duration === undefined) {
          // 名单不说时长 = 这个方式一个参数都没声明；准入层对它也判不了（放行）。
          if (mode.params.length > 0) mismatches.push(`${where}: 有参数表却没写时长事实`);
          continue;
        }
        if (duration === "no durationSec") {
          if (!durationWith(5)) mismatches.push(`${where}: 名单说没有时长，准入层却收`);
          continue;
        }
        const written = duration.replace("durationSec ", "");
        const range = written.match(/^(\d*)-(\d*)$/);
        const values = range ? [range[1], range[2]].filter(Boolean).map(Number) : written.split("|").map(Number);
        for (const value of values) {
          if (durationWith(value)) mismatches.push(`${where}: 名单列了 ${value} 秒，准入层拒`);
        }
      }
    }
    expect(mismatches, mismatches.slice(0, 10).join("\n")).toEqual([]);
  });

  it("薄名单还是薄的：加了 modeFacts，全目录与只看视频都不超过原来的 1.5 倍（任务书停点）", () => {
    // 按生产接线带上可用性（两面都由目录注入）——模型真读到的那一行就是这个长度。
    const rows = entries.map((entry) => modelSpecRow(entry, catalogAvailabilityFor(entry.vendor, entry.modelId, state)));
    const without = (list: typeof rows) => JSON.stringify({ models: list.map(({ modeFacts: _facts, ...row }) => row) }).length;
    const withFacts = (list: typeof rows) => JSON.stringify({ models: list }).length;
    const video = rows.filter((row) => row.kind === "video");
    expect(withFacts(rows) / without(rows)).toBeLessThan(1.5);
    expect(withFacts(video) / without(video)).toBeLessThan(1.5);
  });

  it("Seedance 2.5（火山）：文生可选比例，首帧 / 首尾帧只收自动 → 名单写 no aspectRatio（P18 那两镜）", () => {
    const seedance = entries.find((entry) => entry.vendor === "volcengine" && entry.modelId === "doubao-seedance-2-5-260628");
    expect(seedance).toBeDefined();
    const facts = factsByMode(modelSpecRow(seedance!).modeFacts!);
    expect(facts.get("t2v")?.[0]).toMatch(/^aspectRatio .*9:16/);
    expect(facts.get("first")?.[0]).toBe("no aspectRatio");
    expect(facts.get("firstlast")?.[0]).toBe("no aspectRatio");
  });
});
