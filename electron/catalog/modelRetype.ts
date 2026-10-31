/**
 * 「把这个模型的类型改对」——**一个领域操作，不是改一个字段**。
 *
 * 病根：中转接入时类型是按 id 关键词猜的（modelKindHeuristic.guessModelKind，猜不中默认 text），
 * 必然有猜错的。猜错之后模型不是报错、而是**消失**——生成侧每一层都按 kind 过滤（下拉选项 /
 * 运行前解析 / selectExecutableModel），于是图像模型被登记成文本后，图像节点的下拉里根本没有它。
 * 用户的原话就是「接入了模型但用不了」。
 *
 * 为什么不能只翻 kind 标签（这是本模块存在的全部理由）：
 * 调用通道（mapping）是接入时**按 kind 生成**的（draftShapeForKind），而文本模型**刻意不带任何
 * mapping**（chat 走 AI SDK 直连）。所以一个被误判成文本的图片模型，目录里是两个洞：
 *   ① kind 错了  ② 通道压根没建
 * 只补 ①，下一步就撞 selectTaskMapping 返回 null，换一个同样看不懂的错继续失败——等于把用户
 * 从一个坑挪到另一个坑。所以改类型 = 改 kind + 按新 kind 重建通道 + 重建该 kind 的参数控件，
 * 三件事在**一个事务**里做完（mutateCatalog：全成才落盘）。
 *
 * 通道形状复用 draftShapeForKind（与接入落库同一个真相源），不在这里另写一份 wire 模板（P1 无并行版）。
 *
 * 视频例外：协议要文档声明，不猜（用户 2026-10-30 拍板），所以改成视频只改对 kind 和身份，通道是 0 条。
 * 下一次运行在发请求前停下（findExecutableModel：还没发布），错误卡的主按钮是「去模型接入」，由 AI 接入补上声明。
 *
 * 谁能改（derived，不是 allowlist）：`model.onboarding.addedVia === "manual"`。
 * 推导链——guessModelKind 只在手动/中转拉取路被调用（onboardingIpc / catalogCommit），而这条路
 * committed 的模型正是 addedVia:"manual"，其通道也正是 draftShapeForKind 生成的。所以「会猜错的
 * 那批」与「能用 draftShapeForKind 安全重建的那批」是同一批。内置种子（kie/apimart/comfyui/
 * runninghub…）和 agent 路（按文档证据建 mapping）都不在内：对它们套通用模板会把手写/文档推导出来的
 * mapping 换成通用形状 = 破坏，所以直接拒绝，不「尽力而为」。
 */
import { mutateCatalog, readCatalog } from "./catalogStore";
import { draftShapeForKind, primaryTaskKindForModelKind } from "./catalogCommit";
import { nativeWireProfileForArchetype } from "./nativeWireProfiles";
import { isJsonRecord, type JsonRecord } from "../jsonUtils";
import type { BillingModelKind, Model } from "./types";

const RETYPEABLE_KINDS: BillingModelKind[] = ["text", "image", "video", "audio", "model3d"];

export type RetypeModelResult = {
  model: Model;
  /** 本次按新 kind 建了几条通道（3D/文本为 0——它们本就没有通道；视频为 0——协议要声明，不猜，见 draftShapeForKind）。 */
  rebuiltMappings: number;
};

/** 这个模型能不能改类型（纯判断，UI 据此决定给不给那个控件；理由见文件头）。 */
export function canRetypeModel(model: Pick<Model, "onboarding"> | undefined | null): boolean {
  return model?.onboarding?.addedVia === "manual";
}

export function retypeModelCatalogModel(payload: unknown): RetypeModelResult {
  const raw = (isJsonRecord(payload) ? payload : {}) as JsonRecord;
  const vendorKey = String(raw.vendorKey || "").trim();
  const modelKey = String(raw.modelKey || "").trim();
  const kind = String(raw.kind || "").trim() as BillingModelKind;
  if (!vendorKey || !modelKey) throw new Error("vendorKey and modelKey are required");
  if (!RETYPEABLE_KINDS.includes(kind)) throw new Error(`Unsupported model kind '${kind}'`);

  const state = readCatalog();
  const existing = state.models.find((m) => m.vendorKey === vendorKey && m.modelKey === modelKey);
  if (!existing) throw new Error(`Model not found: ${modelKey}`);
  // 拒绝而不是「尽力而为」：给内置/agent 路的模型套通用模板会静默破坏它们手写的通道，
  // 那比不改更糟（用户看到「已改」，实际把能用的弄坏了）。
  if (!canRetypeModel(existing)) throw new Error(`Model kind is not user-editable: ${modelKey}`);
  // 幂等：类型本来就对就什么都不做（错误卡上连点两次「改成图片」不该重复写盘）。
  if (existing.kind === kind) return { model: existing, rebuiltMappings: 0 };

  // 原生报文档案随模型走：接入时探测到这家提供某档案的原生端点就记在 meta.archetypeId 上。
  // 换 kind 后该档案未必有对应端点，draftShapeForKind 内部逐个 `if (create)` 判，取不到就退回
  // 这个 kind 的默认形状（视频没有默认通道）——所以这里原样传过去是安全的。
  const meta = isJsonRecord(existing.meta) ? existing.meta : undefined;
  const archetypeId = typeof meta?.archetypeId === "string" ? meta.archetypeId : undefined;
  const imageEditProtocol = isJsonRecord(meta?.imageOptions)
    ? (meta.imageOptions.imageEditProtocol as never)
    : undefined;
  const shape = draftShapeForKind(kind, modelKey, imageEditProtocol, nativeWireProfileForArchetype(archetypeId));
  const taskKind = primaryTaskKindForModelKind(kind);
  const label = existing.labelZh || modelKey;

  let rebuiltMappings = 0;
  const model = mutateCatalog((tx) => {
    // 1. kind + 该 kind 的参数控件。节点 UI 的参数完全读 model.meta.parameters——文本模型那份是空的，
    //    不一起重建的话「改成图片」之后节点上一个参数控件都没有（比例/尺寸全发不出去）。
    //    imageOptions 只在图片时挂：留着过期的 supportsReferenceImages 会让 UI 展示一个撞不到端点的能力。
    const updated = tx.upsertModel({
      vendorKey,
      modelKey,
      kind,
      meta: {
        ...(meta || {}),
        parameters: shape.modelFields.map((f) => ({
          key: String(f.key),
          label: String(f.displayName || f.key),
          type: f.type,
          ...(f.options ? { options: f.options } : {}),
          ...(f.default !== undefined ? { default: String(f.default) } : {}),
        })),
        ...(kind === "image"
          ? { imageOptions: { supportsReferenceImages: Boolean(shape.mappingEdit) } }
          : { imageOptions: undefined }),
      },
    });
    // 2. 通道。**只增不删**：generic mapping 是 (vendorKey, taskKind) 级、同 vendor 的其它模型共享，
    //    删掉会连坐（把别人的图片通道也删了）。重复 upsert 幂等——同 (vendor, taskKind, modelKey)
    //    命中既有行覆盖，不会堆垃圾。
    if (shape.mappingCreate) {
      tx.upsertMapping({
        vendorKey,
        taskKind,
        name: label,
        enabled: true,
        create: shape.mappingCreate,
        ...(shape.mappingQuery ? { query: shape.mappingQuery } : {}),
        ...(shape.mappingStatus ? { statusMapping: shape.mappingStatus } : {}),
      });
      rebuiltMappings += 1;
    }
    // 形状里带了图生视频才注册（runtime 按 taskKind 选通道，少这条视频节点一连首帧就被拒发）。
    // 现在 draftShapeForKind 对视频不给通道，这一支留给以后明确声明过协议的形状。
    if (shape.mappingImageToVideo && kind === "video") {
      tx.upsertMapping({
        vendorKey,
        taskKind: "image_to_video",
        modelKey,
        name: `${label} · 图生视频`,
        enabled: true,
        create: shape.mappingImageToVideo,
        ...(shape.mappingQuery ? { query: shape.mappingQuery } : {}),
        ...(shape.mappingStatus ? { statusMapping: shape.mappingStatus } : {}),
      });
      rebuiltMappings += 1;
    }
    // 改图是模型级能力（同 vendor 可同时有 chat 多模态与 JSON /images/edits），故按 modelKey 精确绑定。
    if (shape.mappingEdit && kind === "image") {
      tx.upsertMapping({
        vendorKey,
        taskKind: "image_edit",
        modelKey,
        name: `${label} · 改图`,
        enabled: true,
        create: shape.mappingEdit,
      });
      rebuiltMappings += 1;
    }
    return updated;
  });

  return { model, rebuiltMappings };
}
