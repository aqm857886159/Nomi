/**
 * 生成请求链 S0：拿供应商官方文档里的字段当标尺，量「画布 runTask」和「Run 目录 provider」两条路
 * 真正发出去的请求体。
 *
 * 标尺：tests/fixtures/vendor-official/apimart/<modelKey>.json（每条事实带官方原句 quote、来源页 source、抓取日 fetchedAt）。
 * 矩阵：每个内置 APIMart 图片/视频模型 × 原型模式 × 两条路 × 参考图数 {0, 1, 每槽上限合计}。
 * 六条断言：
 *   officialKeys    参考相关的键都是官方文档里有的键，参考图没被悄悄丢掉
 *   oneKeyPerUrl    同一张参考图只出现在一个键里
 *   exclusivePairs  官方说互斥的两组键不同时出现
 *   roleEnum        image_with_roles 里的 role 取值在官方枚举内
 *   countCap        每个键的张数不超过官方上限（含「张数 + n ≤ 15」这类联合上限）
 *   samePath        画布和 Run 两条路发出的请求体一致（同拒也算一致）
 *
 * 今天红的格子写在 officialWire.known-red.json（只许减不许增）：
 * 表里有但这格其实绿了，同样判红——修好一格就必须同提交把它从表里删掉。
 * 本片只加测试，不改生产代码。
 *
 * 双键探针（预测 P1：带 first/last 帧或角色的模式，画布路会把同一张图既放 image_urls 又放 image_with_roles）扩到全部模式的结果：
 * 在 745b3c5b4 上，画布路双键的格子是 Seedance 2.0 首尾帧（1/2 张）、Seedance 2.5 首帧和首尾帧（1 张；2 张因 Run 路拒发先红在复现 1）、
 * Wan 3.0 首帧和首尾帧（1 张；2 张同理）、Wan 2.7 参考（1 张）；其余模式没有双键。这就是 known-red 里复现 3 的出处。
 */
/// <reference types="vite/client" />
import { afterAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "nomi-official-wire-")));
});
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => {
    throw new Error(`no renderer bridge in official-wire matrix: ${operation}`);
  },
}));

import { getArchetypeById, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { videoArchetypeIdFromMeta } from "../shared/videoCapabilities";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { placeUploadedImages } from "../../src/workbench/generationCanvas/nodes/controls/referenceList";
import { driveEngineA, driveEngineB, installFetchCapture, seedParityCatalog } from "./generationParityTestUtils";

import knownRedTable from "./officialWire.known-red.json";

type Fact = { source: string; fetchedAt: string; quote: string };
type KeyFact = Fact & { shape: string; max: number | null; maxPlusN?: number; roles?: string[] };
type ModeFact = {
  why?: string;
  noReference?: Fact;
  referenceKeys: Record<string, KeyFact>;
  exclusive?: Array<Fact & { a: string[]; b: string[] }>;
  oneImage?: Fact & { key: string; meaning: string };
  wireModel?: string;
  maxUnpublished?: boolean;
};
type ModelFixture = { modelKey: string; fetchedAt: string; modes: Record<string, ModeFact> };
type KnownRed = {
  repros: Record<string, string>;
  cells: Array<{ cell: string; assertion: string; repro: number }>;
};

const ASSERTIONS = ["officialKeys", "oneKeyPerUrl", "exclusivePairs", "roleEnum", "countCap", "samePath"] as const;
type AssertionName = (typeof ASSERTIONS)[number];

// 官方夹具目录：tests/fixtures/vendor-official/apimart/*.json（新增夹具文件自动进来）。
const fixtureModules = import.meta.glob<{ default: ModelFixture }>("../../tests/fixtures/vendor-official/apimart/*.json", { eager: true });
const fixtures = new Map<string, ModelFixture>(Object.values(fixtureModules).map((m) => [m.default.modelKey, m.default] as const));
const knownRed = knownRedTable as KnownRed;

const REF_KEY_RE = /^(image_urls|image_with_roles|first_frame_image|last_frame_image|video_urls|audio_urls|input_urls|image|images|mask(_.*)?|reference_.*|ref_.*)$/;
const REF = "https://assets.example.com/ref/";
const refUrl = (i: number) => `${REF}img-${i}.png`;

const capture = installFetchCapture();
const catalog = await seedParityCatalog(["apimart"]);
afterAll(() => capture.restore());

type Wire = Record<string, unknown> | string | null | undefined;
const isRefused = (w: Wire): boolean => !(w && typeof w === "object" && "model" in w);

/** 一个键里装了哪些参考图 URL（按出现顺序）。 */
function urlsOfKey(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : (v as { url?: string })?.url)).filter((u): u is string => typeof u === "string");
}

type Violation = { assertion: AssertionName; detail: string };

function judgeBody(body: Record<string, unknown>, mode: ModeFact, n: number): Violation[] {
  const out: Violation[] = [];
  const present = Object.keys(body).filter((k) => REF_KEY_RE.test(k) && urlsOfKey(body[k]).length + (Array.isArray(body[k]) ? 0 : 1) > 0);
  const official = mode.referenceKeys;

  // 1 officialKeys
  for (const k of present) {
    if (!(k in official)) out.push({ assertion: "officialKeys", detail: `发了官方页没有的参考键 ${k}` });
  }
  if (mode.wireModel && body.model !== mode.wireModel) {
    out.push({ assertion: "officialKeys", detail: `官方页要求 model=${mode.wireModel}，实发 ${String(body.model)}` });
  }
  const placed = new Set(present.flatMap((k) => urlsOfKey(body[k])));
  const officialTotal = Object.values(official).reduce((s, f) => s + (f.max ?? 99), 0);
  if (Object.keys(official).length > 0 && n > 0 && placed.size < Math.min(n, officialTotal)) {
    out.push({ assertion: "officialKeys", detail: `${n} 张参考图只带出 ${placed.size} 张` });
  }
  if (mode.oneImage && n === 1 && !urlsOfKey(body[mode.oneImage.key]).includes(refUrl(1))) {
    out.push({ assertion: "officialKeys", detail: `官方页说单图走 ${mode.oneImage.key}，实际不在里面` });
  }

  // 2 oneKeyPerUrl
  const seen = new Map<string, string[]>();
  for (const k of present) for (const u of urlsOfKey(body[k])) seen.set(u, [...(seen.get(u) ?? []), k]);
  for (const [u, keys] of seen) {
    if (keys.length > 1) out.push({ assertion: "oneKeyPerUrl", detail: `${u.replace(REF, "")} 同时出现在 ${keys.join(" + ")}` });
  }

  // 3 exclusivePairs
  for (const pair of mode.exclusive ?? []) {
    const hitA = pair.a.filter((k) => present.includes(k));
    const hitB = pair.b.filter((k) => present.includes(k));
    if (hitA.length && hitB.length) {
      out.push({ assertion: "exclusivePairs", detail: `官方说互斥的 ${hitA.join(",")} 与 ${hitB.join(",")} 同时出现` });
    }
  }

  // 4 roleEnum
  for (const k of present) {
    const fact = official[k];
    if (!fact?.roles || !Array.isArray(body[k])) continue;
    for (const item of body[k] as Array<{ role?: string }>) {
      if (item && typeof item === "object" && !fact.roles.includes(String(item.role))) {
        out.push({ assertion: "roleEnum", detail: `role「${String(item.role)}」不在官方枚举 ${fact.roles.join("/")}` });
      }
    }
  }

  // 5 countCap
  for (const k of present) {
    const fact = official[k];
    if (!fact) continue;
    const count = urlsOfKey(body[k]).length;
    if (fact.max !== null && count > fact.max) out.push({ assertion: "countCap", detail: `${k} 发了 ${count} 张，官方上限 ${fact.max}` });
    if (fact.maxPlusN !== undefined) {
      const wantedImages = typeof body.n === "number" ? body.n : 1;
      if (count + wantedImages > fact.maxPlusN) {
        out.push({ assertion: "countCap", detail: `${k} ${count} 张 + n=${wantedImages} 超过官方联合上限 ${fact.maxPlusN}` });
      }
    }
  }
  return out;
}

type Archetype = ReturnType<typeof specializeArchetypeForVendor>;
type Mode = Archetype["modes"][number];

type Cell = {
  id: string;
  modelKey: string;
  kind: "image" | "video";
  modeId: string;
  taskKind: string;
  n: number;
};

function buildCells() {
  const cells: Array<{ cell: Cell; row: (typeof catalog.models)[number]; mode: Mode; archetype: Archetype }> = [];
  const rows = catalog.models.filter((m) => m.vendorKey === "apimart" && (m.kind === "video" || m.kind === "image"));
  for (const row of rows) {
    const archId = videoArchetypeIdFromMeta(row.meta) ?? (row.meta as { archetypeId?: string } | null)?.archetypeId;
    const base = archId ? getArchetypeById(archId) : null;
    if (!base) continue;
    const archetype = specializeArchetypeForVendor(base, "apimart");
    for (const mode of archetype.modes) {
      const imgSlots = mode.slots.filter((s: { kind: string }) => ["first_frame", "last_frame", "image_ref"].includes(s.kind));
      const cap = imgSlots.reduce((s: number, slot: { kind: string; max?: number }) => s + (slot.max ?? (slot.kind === "image_ref" ? 3 : 1)), 0);
      const sizes = imgSlots.length ? [0, 1, cap] : [0];
      for (const n of [...new Set(sizes)]) {
        cells.push({
          cell: {
            id: `${row.modelKey}|${mode.id}|n=${n}`,
            modelKey: row.modelKey,
            kind: row.kind as "image" | "video",
            modeId: mode.id,
            taskKind: modeTransportFor(mode, archetype, "apimart") ?? "",
            n,
          },
          row,
          mode,
          archetype,
        });
      }
    }
  }
  return cells;
}

async function runCanvas(entry: ReturnType<typeof buildCells>[number]): Promise<Wire> {
  const { cell, row, mode, archetype } = entry;
  const urls = Array.from({ length: cell.n }, (_, i) => refUrl(i + 1));
  const node = {
    ...createGenerationNode({ id: "n", kind: cell.kind, prompt: "一个镜头" }),
    meta: {
      modelKey: row.modelKey,
      modelVendor: "apimart",
      vendor: "apimart",
      archetype: { id: archetype.id, modeId: mode.id },
      ...(cell.n ? { referenceImageUrls: urls } : {}),
    },
  } as never;
  try {
    const req = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
    const rec = await driveEngineA(capture, { vendorKey: "apimart", kind: req.kind, prompt: req.prompt, extras: req.extras as never });
    return (rec.request?.body ?? rec.failure) as Wire;
  } catch (e) {
    return `THROW ${(e as Error).message}`;
  }
}

async function runCatalog(entry: ReturnType<typeof buildCells>[number]): Promise<Wire> {
  const { cell, row, mode } = entry;
  const urls = Array.from({ length: cell.n }, (_, i) => refUrl(i + 1));
  try {
    const placed = placeUploadedImages(mode, urls);
    const refs: Array<{ assetId: string; contentHash: string; version: number; kind: "image"; role: string }> = [];
    mode.slots.forEach((slot: { kind: string }, i: number) =>
      (placed.bySlot[i] ?? []).forEach((u: string) =>
        refs.push({
          assetId: u,
          contentHash: `h-${refs.length}`,
          version: 1,
          kind: "image",
          role: slot.kind === "first_frame" ? "first_frame" : slot.kind === "last_frame" ? "last_frame" : "reference",
        }),
      ),
    );
    const rec = await driveEngineB(capture, {
      vendorKey: "apimart",
      modelId: row.modelKey,
      mode: cell.taskKind,
      ...(cell.kind === "video" ? { modeId: mode.id } : {}),
      prompt: "一个镜头",
      parameters: {},
      references: refs as never,
      referenceUrls: Object.fromEntries(refs.map((r) => [spendReferenceKey(r as never), r.assetId])),
    });
    return (rec.request?.body ?? rec.failure) as Wire;
  } catch (e) {
    return `THROW ${(e as Error).message}`;
  }
}

function judgeCell(entry: ReturnType<typeof buildCells>[number], canvas: Wire, run: Wire): Violation[] {
  const fx = fixtures.get(entry.cell.modelKey)?.modes[entry.cell.modeId];
  if (!fx) return [{ assertion: "officialKeys", detail: "没有官方夹具" }];
  const out: Violation[] = [];
  for (const [label, wire] of [["画布", canvas], ["Run", run]] as const) {
    if (isRefused(wire)) continue;
    out.push(...judgeBody(wire as Record<string, unknown>, fx.noReference ? { referenceKeys: {} } : fx, entry.cell.n).map((v) => ({ ...v, detail: `${label}：${v.detail}` })));
  }
  const refusedC = isRefused(canvas);
  const refusedR = isRefused(run);
  if (refusedC !== refusedR) {
    out.push({ assertion: "samePath", detail: `${refusedC ? "画布拒发" : "Run 拒发"}，另一条路发出去了` });
  } else if (!refusedC && JSON.stringify(canvas) !== JSON.stringify(run)) {
    const c = canvas as Record<string, unknown>;
    const r = run as Record<string, unknown>;
    const diff = [...new Set([...Object.keys(c), ...Object.keys(r)])].filter((k) => JSON.stringify(c[k]) !== JSON.stringify(r[k]));
    out.push({ assertion: "samePath", detail: `两条路请求体不同：${diff.join(", ")}` });
  }
  return out;
}

const cells = buildCells();
const dumpPath = process.env.NOMI_OFFICIAL_WIRE_DUMP;
const dump: Array<{ cell: string; violations: Violation[] }> = [];
const redByCell = new Map<string, string[]>();
for (const r of knownRed.cells) redByCell.set(r.cell, [...(redByCell.get(r.cell) ?? []), r.assertion]);

describe("官方字段矩阵：夹具", () => {
  it("每个内置 APIMart 图片/视频模型和每个原型模式都有官方夹具，夹具里没有多余模式", () => {
    const wanted = new Map<string, Set<string>>();
    for (const { cell } of cells) wanted.set(cell.modelKey, (wanted.get(cell.modelKey) ?? new Set()).add(cell.modeId));
    const missing: string[] = [];
    for (const [model, modes] of wanted) {
      const fx = fixtures.get(model);
      for (const m of modes) if (!fx?.modes[m]) missing.push(`${model}/${m}`);
    }
    const extra: string[] = [];
    for (const [model, fx] of fixtures) for (const m of Object.keys(fx.modes)) if (!wanted.get(model)?.has(m)) extra.push(`${model}/${m}`);
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("每条官方事实都有官方页地址、抓取日期和原句", () => {
    const bad: string[] = [];
    const check = (where: string, f: Partial<Fact> | undefined) => {
      if (!f || !/^https:\/\/docs\.apimart\.ai\//.test(f.source ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(f.fetchedAt ?? "") || !(f.quote ?? "").trim()) bad.push(where);
    };
    for (const fx of fixtures.values()) {
      for (const [modeId, mode] of Object.entries(fx.modes)) {
        const base = `${fx.modelKey}/${modeId}`;
        if (mode.noReference) check(`${base}/noReference`, mode.noReference);
        else if (Object.keys(mode.referenceKeys).length === 0) bad.push(`${base}: 既无参考键也没声明不带参考`);
        for (const [k, f] of Object.entries(mode.referenceKeys)) check(`${base}/${k}`, f);
        (mode.exclusive ?? []).forEach((f, i) => check(`${base}/exclusive[${i}]`, f));
        if (mode.oneImage) check(`${base}/oneImage`, mode.oneImage);
      }
    }
    expect(bad).toEqual([]);
  });

  it("known-red 表里每条的复现编号都登记过，且不指向不存在的格子", () => {
    const ids = new Set(cells.map((c) => c.cell.id));
    const bad = knownRed.cells.filter((r) => !knownRed.repros[String(r.repro)] || !ids.has(r.cell) || !(ASSERTIONS as readonly string[]).includes(r.assertion));
    expect(bad).toEqual([]);
  });

  it("评判器自检：造一个红的请求体，六条断言各自能抓到", () => {
    const mode: ModeFact = {
      referenceKeys: {
        image_urls: { shape: "string[]", max: 2, source: "", fetchedAt: "", quote: "" },
        image_with_roles: { shape: "role-array", max: null, roles: ["first_frame"], source: "", fetchedAt: "", quote: "" },
      },
      exclusive: [{ a: ["image_urls"], b: ["image_with_roles"], source: "", fetchedAt: "", quote: "" }],
    };
    const body = {
      image_urls: [refUrl(1), refUrl(2), refUrl(3)],
      image_with_roles: [{ url: refUrl(1), role: "reference" }],
      mask: refUrl(9),
    };
    const got = new Set(judgeBody(body, mode, 3).map((v) => v.assertion));
    expect([...got].sort()).toEqual(["countCap", "exclusivePairs", "officialKeys", "oneKeyPerUrl", "roleEnum"]);
  });
});

describe("官方字段矩阵：模型 × 模式 × 两条路 × 参考图数", () => {
  for (const entry of cells) {
    it(entry.cell.id, async () => {
      const canvas = await runCanvas(entry);
      const run = await runCatalog(entry);
      const violations = judgeCell(entry, canvas, run);
      if (dumpPath) dump.push({ cell: entry.cell.id, violations });
      const actual = [...new Set(violations.map((v) => v.assertion))].sort();
      const expected = [...new Set(redByCell.get(entry.cell.id) ?? [])].sort();
      if (expected.length === 0) {
        expect(violations, "这格应该绿；红的原因见 detail").toEqual([]);
      } else {
        expect(actual, `known-red 登记的红断言和实际不一致（修好了就从 officialWire.known-red.json 删掉；多红了不许新增）\n${violations.map((v) => `${v.assertion}: ${v.detail}`).join("\n")}`).toEqual(expected);
      }
    }, 60_000);
  }
});

afterAll(() => {
  if (dumpPath) writeFileSync(dumpPath, JSON.stringify(dump, null, 1));
});
