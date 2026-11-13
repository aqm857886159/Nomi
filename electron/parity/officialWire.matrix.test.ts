/**
 * 生成请求链 S0：拿供应商官方文档里的字段当标尺，量「画布 runTask」和「Run 目录 provider」两条路
 * 真正发出去的请求体。
 *
 * 标尺：tests/fixtures/vendor-official/apimart/<modelKey>.json（每条事实带官方原句 quote、来源页 source、抓取日 fetchedAt）。
 * 矩阵：每个内置 APIMart 图片/视频模型 × 原型模式 × 两条路 × 参考图数 {0, 1, 每槽上限合计}。
 * 官方协议断言：
 *   officialKeys    参考相关的键都是官方文档里有的键，参考图没被悄悄丢掉
 *   oneKeyPerUrl    同一张参考图只出现在一个键里
 *   exclusivePairs  官方说互斥的两组键不同时出现
 *   roleEnum        image_with_roles 里的 role 取值在官方枚举内
 *   countCap        每个键的张数不超过官方上限（含「张数 + n ≤ 15」这类联合上限）
 *   shape / modeMeaning / dependencies  字段形状、模式语义及依赖
 *   samePath        画布和 Run 两条路发出的请求体一致（同拒也算一致）
 *
 * 已知红格在 officialWire.known-red.json，按结构化原因及出现次数双向冻结：
 * 表里有但这格其实绿了，同样判红——修好一格就必须同提交把它从表里删掉。
 * fixtureGaps 单列“无官方夹具”的模型模式，原因同样双向冻结；这些格子没量过。
 * 本片只加测试，不改生产代码。
 *
 * 双键探针（预测 P1：带 first/last 帧或角色的模式，画布路会把同一张图既放 image_urls 又放 image_with_roles）扩到全部模式的结果：
 * 在 745b3c5b4 上，画布路双键的格子是 Seedance 2.0 首尾帧（1/2 张）、Seedance 2.5 首帧和首尾帧（1 张；2 张因 Run 路拒发先红在复现 1）、
 * Wan 3.0 首帧和首尾帧（1 张；2 张同理）、Wan 2.7 参考（1 张）；其余模式没有双键。这就是 known-red 里复现 3 的出处。
 */
/// <reference types="vite/client" />
import { afterAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

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
import { effectiveArchetypeMode } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { driveEngineA, driveEngineB, installFetchCapture, seedParityCatalog } from "./generationParityTestUtils";

import knownRedTable from "./officialWire.known-red.json";
import bodiesSnapshot from "./officialWire.bodies.snapshot.json";

import { ASSERTIONS, judgeBody, judgePaths, isRefused, reasonSignatures, type Fact, type ModeFact, type ModelFixture, type Violation, type Wire } from "../../tests/parity/officialWireJudge";
type KnownRed = {
  repros: Record<string, string>;
  fixtureGaps: Array<{ modelMode: string; reason: Record<string, unknown> }>;
  cells: Array<{ cell: string; assertion: string; repro: number | string; reason: Record<string, unknown> }>;
};

// 官方夹具目录：tests/fixtures/vendor-official/apimart/*.json（新增夹具文件自动进来）。
const fixtureModules = import.meta.glob<{ default: ModelFixture }>("../../tests/fixtures/vendor-official/apimart/*.json", { eager: true });
const fixtures = new Map<string, ModelFixture>(Object.values(fixtureModules).map((m) => [m.default.modelKey, m.default] as const));
const knownRed = knownRedTable as KnownRed;
const missingFixtureReason = { key: "fixture", kind: "无官方夹具" };

const REF = "https://assets.example.com/ref/";
const refUrl = (i: number) => `${REF}img-${i}.png`;
const capture = installFetchCapture();
const catalog = await seedParityCatalog(["apimart"]);
afterAll(() => capture.restore());
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

function canvasNode(entry: ReturnType<typeof buildCells>[number]) {
  const { cell, row, mode, archetype } = entry;
  const urls = Array.from({ length: cell.n }, (_, i) => refUrl(i + 1));
  return {
    ...createGenerationNode({ id: "n", kind: cell.kind, prompt: "一个镜头" }),
    meta: {
      modelKey: row.modelKey,
      modelVendor: "apimart",
      vendor: "apimart",
      archetype: { id: archetype.id, modeId: mode.id },
      ...(cell.n ? { referenceImageUrls: urls } : {}),
    },
  } as never;
}

/**
 * 方式按输入现算（2026-11-12）：画布节点上存的方式只是偏好，这 n 张图放不下它时画布按别的方式发（没放图 → 文生；
 * 一张图放不进首尾帧 → 换成收得下的那种）。这种格子画布路根本不会以这个方式发，只量 Run 路（Agent 明说方式时照样要守官方字段）。
 */
function canvasSendsThisMode(entry: ReturnType<typeof buildCells>[number]): boolean {
  const node = canvasNode(entry) as { id: string };
  return effectiveArchetypeMode(entry.archetype, node as never, { nodes: [node as never], edges: [] }).mode.id === entry.mode.id;
}

async function runCanvas(entry: ReturnType<typeof buildCells>[number]): Promise<Wire> {
  const node = canvasNode(entry);
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
  if (!fx) return [{ assertion: "officialKeys", reason: missingFixtureReason, detail: "无官方夹具：没量过" }];
  const out: Violation[] = [];
  for (const [label, wire] of [["画布", canvas], ["Run", run]] as const) {
    if (wire === CANVAS_NOT_THIS_MODE || isRefused(wire)) continue;
    out.push(...judgeBody(wire as Record<string, unknown>, fx.noReference ? { referenceKeys: {} } : fx, entry.cell.n).map((v) => ({ ...v, reason: { path: label === "画布" ? "canvas" : "run", ...v.reason }, detail: `${label}：${v.detail}` })));
  }
  if (canvas !== CANVAS_NOT_THIS_MODE) out.push(...judgePaths(canvas, run));
  return out;
}

const CANVAS_NOT_THIS_MODE = "画布按输入换了方式，不以这格的方式发";

// 请求体字节护栏：每格两条路的请求体指纹（键排序后）。只许出现 `added` 里登记的新增键（键、值、路都对上），
// 不许少键、不许改值、不许多别的键。改动发出去的字节时 NOMI_UPDATE_OFFICIAL_WIRE_BODIES=1 重录（清空 added），差异在 PR 里逐条看。
type BodiesSnapshot = { note: string; added: Array<{ cell: string; path: "canvas" | "run"; key: string; value: unknown }>; bodies: Record<string, { canvas: string; run: string }> };
const BODIES_PATH = fileURLToPath(new URL("./officialWire.bodies.snapshot.json", import.meta.url));
const updateBodies = process.env.NOMI_UPDATE_OFFICIAL_WIRE_BODIES === "1";
const bodies = bodiesSnapshot as BodiesSnapshot;
const recordedBodies: BodiesSnapshot["bodies"] = {};
function canonicalWire(value: unknown): string {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return `[${value.map(canonicalWire).join(",")}]`;
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalWire((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const wireFingerprint = (wire: Wire): string => createHash("sha256").update(canonicalWire(JSON.parse(JSON.stringify(wire ?? null)))).digest("hex").slice(0, 16);
/** 当前请求体去掉登记的新增键后，和修前指纹比；登记的键必须在、值必须对。返回差异说明（空 = 符合）。 */
export function bodyDrift(cell: string, path: "canvas" | "run", wire: Wire, snapshot: BodiesSnapshot = bodies): string[] {
  const expected = snapshot.bodies[cell]?.[path];
  if (!expected) return [`${cell}/${path}: 快照里没有这一格`];
  const allowed = snapshot.added.filter((a) => a.cell === cell && a.path === path);
  let current: Wire = wire;
  const out: string[] = [];
  if (allowed.length) {
    if (!wire || typeof wire !== "object") return [`${cell}/${path}: 登记了新增键 ${allowed.map((a) => a.key)}，但请求没发出去`];
    const rest = { ...(wire as Record<string, unknown>) };
    for (const a of allowed) {
      if (canonicalWire(rest[a.key]) !== canonicalWire(a.value)) out.push(`${cell}/${path}: 登记新增 ${a.key}=${JSON.stringify(a.value)}，实际 ${JSON.stringify(rest[a.key])}`);
      delete rest[a.key];
    }
    current = rest as Wire;
  }
  if (wireFingerprint(current) !== expected) out.push(`${cell}/${path}: 请求体与快照指纹不同（多键 / 少键 / 改值）`);
  return out;
}

const cells = buildCells();
const dumpPath = process.env.NOMI_OFFICIAL_WIRE_DUMP;
const dump: Array<{ cell: string; violations: Violation[]; canvas: Wire; run: Wire }> = [];
const redByCell = new Map<string, typeof knownRed.cells>();
for (const r of knownRed.cells) redByCell.set(r.cell, [...(redByCell.get(r.cell) ?? []), r]);

describe("官方字段矩阵：夹具", () => {
  it("每个内置 APIMart 图片/视频模型模式的官方夹具或缺口登记逐项相符，夹具里没有多余模式", () => {
    const wanted = new Map<string, Set<string>>();
    for (const { cell } of cells) wanted.set(cell.modelKey, (wanted.get(cell.modelKey) ?? new Set()).add(cell.modeId));
    const missing: KnownRed["fixtureGaps"] = [];
    for (const [model, modes] of wanted) {
      const fx = fixtures.get(model);
      for (const m of modes) if (!fx?.modes[m]) missing.push({ modelMode: `${model}|${m}`, reason: missingFixtureReason });
    }
    const extra: string[] = [];
    for (const [model, fx] of fixtures) for (const m of Object.keys(fx.modes)) if (!wanted.get(model)?.has(m)) extra.push(`${model}/${m}`);
    const byMode = (a: KnownRed["fixtureGaps"][number], b: KnownRed["fixtureGaps"][number]) => a.modelMode.localeCompare(b.modelMode);
    expect({ missing: missing.sort(byMode), extra }).toEqual({ missing: [...knownRed.fixtureGaps].sort(byMode), extra: [] });
  });

  it("每条官方事实都有官方页地址、抓取日期和原句", () => {
    const bad: string[] = [];
    const factProperties = new Set(["noReference", "meaning", "aliases", "allowedCounts", "requiredFields", "intent", "oneImage", "outputCountKeys", "defaultRole", "advisory"]);
    const factArrays = new Set(["exclusive", "requires", "jointCaps", "roleCaps", "discriminators", "cases", "evidence"]);
    const check = (where: string, value: unknown, required = false): void => {
      if (!value || typeof value !== "object") return;
      if (required || "quote" in value) {
        const f = value as Fact;
        if (!/^https:\/\/docs\.apimart\.ai\//.test(f.source ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(f.fetchedAt ?? "") || !(f.quote ?? "").trim()) bad.push(where);
      }
      for (const [k, v] of Object.entries(value)) {
        if ((k === "referenceKeys" || k === "children") && v && typeof v === "object") {
          for (const [name, f] of Object.entries(v)) check(`${where}/${k}/${name}`, f, true);
        } else if (factArrays.has(k) && Array.isArray(v)) v.forEach((f, i) => check(`${where}/${k}/${i}`, f, true));
        else check(`${where}/${k}`, v, factProperties.has(k));
      }
    };
    for (const fx of fixtures.values()) {
      check(fx.modelKey, fx);
      for (const [modeId, mode] of Object.entries(fx.modes)) if (!mode.noReference && Object.keys(mode.referenceKeys).length === 0) bad.push(`${fx.modelKey}/${modeId}: 既无参考键也没声明不带参考`);
    }
    expect(bad).toEqual([]);
  });

  it("known-red 表里每条的复现编号都登记过，且有原因特征、不指向不存在的格子", () => {
    const ids = new Set(cells.map((c) => c.cell.id));
    const bad = knownRed.cells.filter((r) => !knownRed.repros[String(r.repro)] || !ids.has(r.cell) || !(ASSERTIONS as readonly string[]).includes(r.assertion) || !r.reason || Object.keys(r.reason).length === 0);
    expect(bad).toEqual([]);
  });

  it("请求体字节护栏自检：多一个未登记的键、少一个键、改值、登记键值不对都判红；只多登记的那个键判绿", () => {
    const body = { model: "m", prompt: "p", duration: 5 };
    const snap = (added: BodiesSnapshot["added"]) => ({ note: "", added, bodies: { c: { canvas: wireFingerprint(body), run: wireFingerprint(body) } } });
    expect(bodyDrift("c", "canvas", body, snap([]))).toEqual([]);
    expect(bodyDrift("c", "canvas", { ...body, aspect_ratio: "16:9" }, snap([]))).toHaveLength(1);
    expect(bodyDrift("c", "canvas", { model: "m", prompt: "p" }, snap([]))).toHaveLength(1);
    expect(bodyDrift("c", "canvas", { ...body, duration: 10 }, snap([]))).toHaveLength(1);
    const reg = snap([{ cell: "c", path: "canvas", key: "size", value: "16:9" }]);
    expect(bodyDrift("c", "canvas", { ...body, size: "16:9" }, reg)).toEqual([]);
    expect(bodyDrift("c", "canvas", { ...body, size: "1:1" }, reg)).toHaveLength(1);
    expect(bodyDrift("c", "canvas", body, reg)).toHaveLength(1);
    expect(bodyDrift("c", "run", { ...body, size: "16:9" }, reg)).toHaveLength(1);
    // 真快照：登记的新增全部落在 ref 方式，非 ref 格一条都没有。
    expect(bodies.added.filter((a) => !/\|ref\|/.test(a.cell))).toEqual([]);
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
    const gap = knownRed.fixtureGaps.find((g) => g.modelMode === `${entry.cell.modelKey}|${entry.cell.modeId}`);
    it(entry.cell.id + (gap ? "（无官方夹具：没量过）" : ""), async () => {
      const canvas = canvasSendsThisMode(entry) ? await runCanvas(entry) : CANVAS_NOT_THIS_MODE;
      const run = await runCatalog(entry);
      const violations = judgeCell(entry, canvas, run);
      if (dumpPath) dump.push({ cell: entry.cell.id, violations, canvas, run });
      if (updateBodies) recordedBodies[entry.cell.id] = { canvas: wireFingerprint(canvas), run: wireFingerprint(run) };
      else expect([...bodyDrift(entry.cell.id, "canvas", canvas), ...bodyDrift(entry.cell.id, "run", run)]).toEqual([]);
      const expected = [...(redByCell.get(entry.cell.id) ?? []), ...(gap ? [{ assertion: "officialKeys", reason: gap.reason }] : [])];
      expect(reasonSignatures(violations), `known-red 原因特征必须逐项相符；消失、新增或同名换因都要更新经复核的登记\n${violations.map((v) => `${v.assertion}: ${v.detail}`).join("\n")}`).toEqual(reasonSignatures(expected));
    }, 60_000);
  }
});

afterAll(() => {
  if (dumpPath) writeFileSync(dumpPath, JSON.stringify(dump, null, 1));
  if (updateBodies) writeFileSync(BODIES_PATH, `${JSON.stringify({ note: bodies.note, added: [], bodies: Object.fromEntries(Object.entries(recordedBodies).sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 1)}\n`);
});
