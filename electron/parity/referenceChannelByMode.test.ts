/**
 * NEW-1 的行为对照：**参考图落哪条 wire 通道，由用户选的档案模式决定**。
 *
 * Seedance 2.5 的 i2v mapping 同时声明 `image_urls`（全能参考）与 `image_with_roles`
 * （首帧 / 首尾帧）——两条**互斥**。手动路由档案模式回答（`archetypeMeta.ts` 的合并槽），
 * Run 路此前只看「body 里有没有 image_with_roles」，于是**任何**参考图都被塞进
 * `image_with_roles`，包括用户明明选的是「全能参考」的那一批。
 *
 * 这三条在修复前的状态（`git stash` 掉 referenceChannels.ts 那一刀即可复验）：
 *   · first  → image_with_roles  ✅ 恰好蒙对
 *   · omni   → image_with_roles  ❌ 应为 image_urls
 *   · 无模式 → image_with_roles  ❌ 应为 image_urls（= 手动路逐字节相同，对等矩阵基准）
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-parity-refchan-")));
});

vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import { driveEngineB, installFetchCapture, seedParityCatalog, type FetchCapture } from "./generationParityTestUtils";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { combineChannelForMode, referenceCombineChannelFor } from "../shared/videoCapabilities/referenceChannels";

const REFERENCE = "https://assets.example.com/parity/character-a.png";
const SEEDANCE_I2V_BODY = {
  image_urls: "{{request.params.image_urls}}",
  image_with_roles: "{{request.params.image_with_roles}}",
};

let capture: FetchCapture;

beforeAll(async () => {
  capture = installFetchCapture();
  await seedParityCatalog(["apimart"]);
}, 60_000);

afterAll(() => { capture?.restore(); });

async function bodyFor(modeId: string | undefined, role: "first_frame" | "reference"): Promise<Record<string, unknown>> {
  const reference = { assetId: REFERENCE, contentHash: "refchan-0", version: 1, kind: "image" as const, role };
  const record = await driveEngineB(capture, {
    vendorKey: "apimart",
    modelId: "doubao-seedance-2.5",
    mode: "image_to_video",
    ...(modeId ? { modeId } : {}),
    prompt: "镜头缓缓推近，人物转身",
    parameters: {},
    references: [reference],
    referenceUrls: { [spendReferenceKey(reference)]: REFERENCE },
  });
  if (!record.request) throw new Error(`没有出站报文: ${JSON.stringify(record.failure)}`);
  return record.request.body as Record<string, unknown>;
}

describe("参考通道由档案模式决定（NEW-1）", () => {
  it("纯函数：模式声明了合并槽、且 body 真引用它 → 用合并槽", () => {
    expect(referenceCombineChannelFor({
      meta: { archetypeId: "seedance-2.5-apimart" },
      kind: "video",
      modeId: "first",
      createBody: SEEDANCE_I2V_BODY,
    })).toEqual({ key: "image_with_roles", flat: false, roleSlots: [{ kind: "first_frame", role: "first_frame" }] });
  });

  it("纯函数：同一条 body，模式换成全能参考 → 不合并（扁平族键）", () => {
    expect(referenceCombineChannelFor({
      meta: { archetypeId: "seedance-2.5-apimart" },
      kind: "video",
      modeId: "omni",
      createBody: SEEDANCE_I2V_BODY,
    })).toBeNull();
  });

  it("纯函数：没有模式 → 不合并（手动 headless 路也从不填对象形态键）", () => {
    expect(referenceCombineChannelFor({
      meta: { archetypeId: "seedance-2.5-apimart" },
      kind: "video",
      createBody: SEEDANCE_I2V_BODY,
    })).toBeNull();
  });

  it("纯函数：模式声明了合并槽、但这条渠道的 body 不引用它 → 发不出去，退回扁平族键", () => {
    expect(referenceCombineChannelFor({
      meta: { archetypeId: "seedance-2.5-apimart" },
      kind: "video",
      modeId: "first",
      createBody: { image_urls: "{{request.params.image_urls}}" },
    })).toBeNull();
  });

  it("纯函数：合并槽是唯一读点（flat 声明照样带出来）", () => {
    expect(combineChannelForMode({ combineSlotsInto: { key: "image_urls", flat: true } }))
      .toEqual({ key: "image_urls", flat: true, roleSlots: [] });
    expect(combineChannelForMode({})).toBeNull();
  });

  it("首帧模式：出站走 image_with_roles，带上角色", async () => {
    const body = await bodyFor("first", "first_frame");
    expect(body.image_with_roles).toEqual([{ url: REFERENCE, role: "first_frame" }]);
    expect(body.image_urls).toBeUndefined();
  }, 60_000);

  it("全能参考模式：出站走 image_urls（今天红——Run 路把它也塞进了 image_with_roles）", async () => {
    const body = await bodyFor("omni", "reference");
    expect(body.image_urls).toEqual([REFERENCE]);
    expect(body.image_with_roles).toBeUndefined();
  }, 60_000);

  it("没有模式：出站走 image_urls，与手动路逐字节相同（今天红）", async () => {
    const body = await bodyFor(undefined, "reference");
    expect(body.image_urls).toEqual([REFERENCE]);
    expect(body.image_with_roles).toBeUndefined();
  }, 60_000);
});
