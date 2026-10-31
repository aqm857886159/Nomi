/**
 * 画布上，本机在发请求之前拒绝的那几句，到创作者手里是哪张卡。
 *
 * 为什么一格要走全程，而不是对着裸文案测分类器：这几句都在主进程的运行入口（runTask）里、花钱之前抛出；
 * 画布的付费提交把「确定没离开本机」的失败统一包成结构化码 submission_not_sent，渲染层分类器先认这个码、后看文案。
 * 对着裸文案测 classifyGenerationError 测到的只是无界面那条路——画布上创作者看到的是另一张泛泛的
 * 「这次生成没有发出去」+ 重试，重试多少次都一样（2026-10-31 真窗实测：声明撤掉文生之后点生成）。
 * 所以这里：真目录 → 真 runTask（生产的 lazyCanvasTransport）→ 真提交出口 → 真 IPC 守卫 → 真分类器。
 *
 * 每一格都在发请求之前停下：断言一个网络请求都没有，并断言错误确实走过了提交箱的包装（否则这格测的不是这条路）。
 *
 * 两种带法：新写的拒绝句带机器码 `model-config`（不靠文案）；退役、类型不符是更早就有的专用签名，
 * 分类器把它们排在通用的 submission_not_sent 之前，同样要穿过这条包装链。
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTempDir } from "../../scripts/_test-temp.mjs";
import { relayDeclaration } from "../../tests/ux/_relayVideoFixture.mjs";
import { parseVendorErrorFromMessage } from "../../src/workbench/generationCanvas/runner/vendorErrorIpc";
import { classifyGenerationError } from "../../src/workbench/observability/classifyError";
import { mutateCatalog, readCatalog, upsertModelCatalogMapping, upsertModelCatalogModel, upsertModelCatalogVendor } from "../catalog/catalogStore";
import { registerDeclaredProvider } from "../catalog/declaredProviderRegistration";
import type { ProviderAdapterDraft } from "../providerAdapter/types";
import { replaceCustomCapabilityContractMeta } from "../shared/modelArchetypes";
import { matchNomiErrorCode, type NomiErrorCode } from "../shared/nomiErrorCodes";
import { runTaskIpcGuard } from "../tasks/taskIpcGuard";
import { CANVAS_TEST_PROJECT, setupCanvasShots } from "./canvasShotTestUtils";
import { lazyCanvasTransport } from "./canvasTransportProvider";

/** setupCanvasShots 的画布传输只认这一家。 */
const VENDOR = "acme";

let settingsDir = "";
const roots: string[] = [];
beforeEach(() => {
  settingsDir = makeTempDir("canvas-refusal-card-");
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of [settingsDir, ...roots.splice(0)]) fs.rmSync(root, { recursive: true, force: true });
});

function seedVendor(): void {
  upsertModelCatalogVendor({ key: VENDOR, name: "Acme", baseUrlHint: "https://acme.test/v1", authType: "none", providerKind: "openai-compatible" });
}

/** 一个只声明了图生视频的模型（声明卡经登记写进目录，和 AI 交卡同一条路）。 */
function seedFrameOnlyDeclaration(): string {
  const card = relayDeclaration("http://127.0.0.1:9", { frameOnly: true }) as ProviderAdapterDraft;
  card.provider.authType = "none";
  const registered = registerDeclaredProvider({ card, vendorKey: VENDOR });
  expect(registered.vendorKey, "夹具前提：声明登记在画布传输认得的那一家名下").toBe(VENDOR);
  return card.models[0].modelKey;
}

type Refusal = {
  label: string;
  /** 在目录里摆好这一格的前提，返回本次请求要用的 modelKey。 */
  seed: () => string;
  taskKind: string;
  /** 这一格确实撞上的那一句（防止前提摆歪、测到别的拒绝）。 */
  says: RegExp;
  /** 抛出的句子是否带机器码（专用签名那两格不带，靠分类器的次序）。 */
  code?: NomiErrorCode;
  card: { kind: string; primary: string };
};

const REFUSALS: Refusal[] = [
  {
    label: "声明撤掉的模式：创建门拒（Declaration does not publish taskKind）",
    seed: seedFrameOnlyDeclaration,
    taskKind: "text_to_video",
    says: /Declaration does not publish taskKind: text_to_video/,
    code: "model-config",
    card: { kind: "model-config", primary: "open-model-access" },
  },
  {
    label: "声明不完整：创建门拒（Incomplete declaration）",
    seed: () => {
      const modelKey = seedFrameOnlyDeclaration();
      // 新交卡的模型在设置里点了「恢复默认」（同一个写法）：合同没了，登记时写下的归属记录还在。
      mutateCatalog((tx, state) => {
        const model = state.models.find((row) => row.vendorKey === VENDOR && row.modelKey === modelKey)!;
        tx.upsertModel({ ...model, meta: replaceCustomCapabilityContractMeta(model.meta, {}) });
      });
      return modelKey;
    },
    taskKind: "image_to_video",
    says: /Incomplete declaration: .*Missing: customCapabilityContract/,
    code: "model-config",
    card: { kind: "model-config", primary: "open-model-access" },
  },
  {
    label: "已发布、但这一模式没有通道的视频模型：运行入口拒（no declared video route）",
    seed: () => {
      seedVendor();
      upsertModelCatalogModel({ vendorKey: VENDOR, modelKey: "clip-model", labelZh: "Clip", kind: "video", enabled: true });
      upsertModelCatalogMapping({
        vendorKey: VENDOR, modelKey: "clip-model", taskKind: "image_to_video", name: "frame only", enabled: true,
        create: { method: "POST", path: "/v1/videos", body: { prompt: "{{request.prompt}}" } },
      });
      return "clip-model";
    },
    taskKind: "text_to_video",
    says: /no declared video route/,
    code: "model-config",
    card: { kind: "model-config", primary: "open-model-access" },
  },
  {
    label: "目录里整条没有这一行：已退役（Model is retired）",
    seed: () => { seedVendor(); return "sora-2"; },
    taskKind: "text_to_image",
    says: /Model is retired: sora-2/,
    card: { kind: "model-retired", primary: "switch-model" },
  },
  {
    label: "登记的类型和这次要的对不上（Model kind mismatch）",
    seed: () => {
      seedVendor();
      upsertModelCatalogModel({ vendorKey: VENDOR, modelKey: "chat-only", labelZh: "Chat", kind: "text", enabled: true });
      return "chat-only";
    },
    taskKind: "text_to_image",
    says: /Model kind mismatch: chat-only \(registered=text, requested=image\)/,
    card: { kind: "model-kind-mismatch", primary: "fix-model-kind" },
  },
];

describe("画布路径：花钱之前就停下的拒绝，卡上说的是真原因", () => {
  it.each(REFUSALS)("$label", async (refusal) => {
    const modelKey = refusal.seed();
    const network = vi.spyOn(globalThis, "fetch");
    const fx = setupCanvasShots({ transport: lazyCanvasTransport() });
    roots.push(fx.root);

    // 渲染层会拿到的那句话：真提交出口失败 → 真 IPC 守卫编码 → 真分类器。
    const work = fx.runs.submit({
      projectId: CANVAS_TEST_PROJECT, nodeId: "node-1", runRecordId: "rr-1", vendor: VENDOR,
      request: { kind: refusal.taskKind, prompt: "a blue marble", extras: { nodeId: "node-1", projectId: CANVAS_TEST_PROJECT, modelKey, idempotencyKey: "k" } },
      gesture: fx.gesture, senderId: fx.senderId,
    });
    const message = await runTaskIpcGuard({}, async () => work).then(
      () => { throw new Error("expected the submission to be refused"); },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    // 这条错误确实走过了提交箱的包装（这正是裸文案分类测不到的那一层）。
    expect(parseVendorErrorFromMessage(message), "画布路径：被包成『确定没发出去』").toMatchObject({ code: "submission_not_sent", reason: "never_reached_network" });
    expect(network, "花钱之前就停下：一个网络请求都没有").not.toHaveBeenCalled();
    expect(message, "这一格撞上的就是它要测的那一句").toMatch(refusal.says);
    if (refusal.code) expect(matchNomiErrorCode(message), "新写的拒绝句带机器码").toBe(refusal.code);

    const report = classifyGenerationError(message);
    expect({ kind: report.kind, primary: report.primary }, "包装之后分类仍是真原因，动作指向真出口").toEqual(refusal.card);
    expect(report.providerMessage, "服务商根本没被请求到：不印『服务商原话』").toBeUndefined();
    expect(report.raw, "机器码标记不进给人看的技术详情").not.toContain("NOMI_ERR::");
    // 被拒的这一次没有改动目录里的模型行（拒绝不是修复）。
    expect(readCatalog().models.some((row) => row.vendorKey === VENDOR && row.modelKey === modelKey)).toBe(refusal.card.kind !== "model-retired");
  });
});
