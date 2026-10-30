/**
 * 一张声明卡 → 目录里的 vendor / model / mapping 三种行。**登记门只有这一扇**。
 *
 * ── 为什么它住在 catalog/ 而不是 MCP 那一侧 ──────────────────────────────────────────
 * 「把一份声明写进目录」是目录自己的事。放在工具面里 = 第二个写目录的地方，而写目录这件事
 * 已经有一扇事务门（`mutateCatalog`：全有或全无，`apply*Upsert` 归一，没有第二条写路）。
 * 三个生产者（应用内 LLM / 外部 AI 经 MCP / 人手改一份文件）最终都该落在这一扇门上
 * （方案 §7）；本刀先把外部 AI 这条接上，另两条各自的驱动器不动。
 *
 * ── 地址与鉴权放法：什么时候可以由卡决定 ─────────────────────────────────────────────
 * 卡上的 `provider` 块带着 baseUrl / authType / authHeader / authScheme —— 这几格属于
 * 「key 发往哪里、怎么放」，`check:credential-origin` 盯着它们。判据只有一条，而且是**绑定**
 * 而不是「谁在说话」：
 *   · 这条连接**还没有** `credentialBinding`（新家，或从来没存过 key）→ 卡可以写，因为没有
 *     任何一把已存的密钥会因此改变去向；用户按下保存的那一刻才产生绑定（`applyApiKeyUpsert`）。
 *   · 这条连接**已经有**绑定 → 卡只能复述那个 origin。想改地址只有一条路：回贴 key 页重存一次
 *     密钥（§6.1）。这里主动拒，而不是等 `assertNoCredentialBindingRewrite` 在更深处抛一句
 *     看不懂的话。
 * 2026-09-21 实测的 K1 正是这条判据被写反的样子：分支只判「有没有传地址」，不判「有没有 key」，
 * 于是一条**根本没有 key** 的连接被告知 "already holds a key"。
 */
import { resolveConnectionVendorKey } from "./connectionVendorKey";
import { mutateCatalog, readCatalog } from "./catalogStore";
import { readCredentialBinding } from "./credentialBinding";
import type { ProviderAdapterDraft } from "../providerAdapter/types";
import type { Vendor } from "./types";

export type DeclaredRegistrationInput = {
  card: ProviderAdapterDraft;
  /** 已存连接的 id；不给就从卡的 baseUrl 派生（与内置种子同一个派生器）。 */
  vendorKey?: string;
  /** 新建连接的显示名；不给就用 vendorKey。 */
  vendorName?: string;
  now?: () => string;
};

export type DeclaredRegistrationResult = {
  vendorKey: string;
  vendorName: string;
  /** 这一刀写进去的模型与模式（登记成功 ≠ 跑得通，后者只有一次真实试跑能证明）。 */
  models: Array<{ modelKey: string; kind: string; taskKinds: string[] }>;
  mappings: number;
  /** 这条连接现在有没有可用的 key。没有不算失败——卡是卡，key 是 key（§4 顺序解耦）。 */
  hasApiKey: boolean;
  boundOrigin: string | null;
};

export class DeclaredOriginRewriteError extends Error {
  readonly boundOrigin: string;
  readonly declaredOrigin: string;
  constructor(boundOrigin: string, declaredOrigin: string) {
    super(
      `This connection's saved key is bound to ${boundOrigin}; a declaration cannot send it to ${declaredOrigin}. Where a saved key goes is decided by the user on Nomi's credential page.`,
    );
    this.name = "DeclaredOriginRewriteError";
    this.boundOrigin = boundOrigin;
    this.declaredOrigin = declaredOrigin;
  }
}

import { projectDeclaredModel, assertDeclaredReplacementOwnership, assertNeutralDeclarationParameters, capabilityFactDigest } from "../providerAdapter/promotionMeta";
export { mappingRowFromDeclaredMode, DeclaredRouteConflictError, type DeclaredRouteConflict } from "../providerAdapter/promotionMeta";

const originOf = (url: string): string => new URL(url).origin;

/**
 * 整份覆盖：这张卡列出的模型与模式就是这次登记的全部。**不做增量合并**——AI 最擅长的是重写
 * 整个文件，而「改一个字段」这种操作在这条路上根本不存在（方案 §10 的代价那一段）。
 * 卡上没提到的既有模型不动（那是别的卡或用户自己接的），只有同名模型被整行改写。
 */
export function registerDeclaredProvider(input: DeclaredRegistrationInput): DeclaredRegistrationResult {
  const card = input.card;
  const declaredOrigin = originOf(card.provider.baseUrl);
  // #831：身份 = 域名 + 连接名。只按 hostname 推导会让同一中转站的第二条连接覆盖第一条
  // （用户那句「保存之后第一条连接的名字和 Key 没了」就是这么来的）。
  const vendorKey = resolveConnectionVendorKey({
    baseUrl: card.provider.baseUrl,
    name: input.vendorName ?? "",
    catalogVendorKey: String(input.vendorKey || "").trim(),
    vendors: readCatalog().vendors,
  });
  if (!vendorKey) throw new Error("Unable to derive a connection id from the declared base URL");
  const now = input.now || (() => new Date().toISOString());

  // Compile every model before entering the write transaction (all-or-nothing).
  const projections = card.models.map((model) => { assertNeutralDeclarationParameters(model); return projectDeclaredModel(model, vendorKey); });
  return mutateCatalog((tx, state) => {
    const existing = state.vendors.find((vendor) => vendor.key === vendorKey);
    const binding = readCredentialBinding(existing as Vendor | undefined);
    if (binding?.origin && binding.origin !== declaredOrigin) {
      throw new DeclaredOriginRewriteError(binding.origin, declaredOrigin);
    }
    // One verdict for the whole card before the first write, so a refusal names every conflict.
    const settled = assertDeclaredReplacementOwnership(vendorKey, card.models.map((model, index) => ({
      modelKey: model.modelKey,
      oldMeta: state.models.find((row) => row.vendorKey === vendorKey && row.modelKey === model.modelKey)?.meta,
      mappings: state.mappings.filter((row) => row.vendorKey === vendorKey && row.modelKey === model.modelKey),
      projection: projections[index],
    })));
    tx.upsertVendor({
      ...(existing || {}),
      key: vendorKey,
      name: input.vendorName?.trim() || existing?.name || vendorKey,
      enabled: true,
      baseUrlHint: card.provider.baseUrl,
      authType: card.provider.authType,
      ...(card.provider.authHeader ? { authHeader: card.provider.authHeader } : {}),
      ...(card.provider.authScheme ? { authScheme: card.provider.authScheme } : {}),
      ...(card.provider.authQueryParam ? { authQueryParam: card.provider.authQueryParam } : {}),
      ...(card.provider.providerKind ? { providerKind: card.provider.providerKind } : {}),
      ...(card.assetIngestion ? { assetIngestion: card.assetIngestion } : {}),
    });

    const models: DeclaredRegistrationResult["models"] = [];
    let mappings = 0;
    for (const [index, model] of card.models.entries()) {
      const { projection, keptRoutes } = settled[index];
      const existingModel = state.models.find(
        (row) => row.vendorKey === vendorKey && row.modelKey === model.modelKey,
      );
      const sourceCard = JSON.parse(JSON.stringify({ ...card, models: [model] }));
      const meta = { ...(existingModel?.meta && typeof existingModel.meta === "object" ? existingModel.meta : {}), ...projection.meta };
      delete meta.declarationCapabilityIssue;
      tx.upsertModel({
        ...(existingModel || {}),
        vendorKey,
        modelKey: model.modelKey,
        labelZh: model.labelZh,
        kind: projection.kind,
        enabled: true,
        meta: {
          ...meta,
          declarationSource: { version: 1, vendorKey, digest: capabilityFactDigest(sourceCard), card: sourceCard },
          // 「登记了」与「跑通了」是两件事，盘上分得开：`declared` = 卡收下了、静态校验过了；
          // 只有一次真实试跑（try_model）能把它推到 verified。不写 verified = 不替模型说话。
          adapter: { state: "declared", evidence: "self-check", source: "declaration-card", publicationModes: projection.taskKinds, updatedAt: now() },
        },
      });
      // Remove owned old routes and removed operations before upsert can inherit them.
      tx.deleteModelMappings(vendorKey, model.modelKey);
      for (const row of keptRoutes) tx.upsertMapping(row);
      for (const row of projection.mappings) { tx.upsertMapping(row); mappings += 1; }
      models.push({
        modelKey: model.modelKey,
        kind: model.kind,
        taskKinds: model.modes.map((mode) => mode.taskKind),
      });
    }

    const keyRecord = state.apiKeysByVendor[vendorKey];
    return {
      vendorKey,
      vendorName: input.vendorName?.trim() || existing?.name || vendorKey,
      models,
      mappings,
      hasApiKey: Boolean(keyRecord?.apiKey) && keyRecord?.enabled !== false,
      boundOrigin: binding?.origin ?? null,
    };
  });
}
