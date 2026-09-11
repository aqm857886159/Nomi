// 「有一笔生成在等你点头」的**跨进程契约**。
//
// 为什么住在 `electron/shared/contracts/` 而不是 `electron/productionRun/`：
// 这份形状的两端各在一个进程里——主进程按目录算出它，渲染层的付费确认卡照着画。
// 渲染层不许 import `electron/` 的实现层（`check:boundaries` 的 `src-no-import-electron`），
// 而两侧各写一份类型就得再写一张两份之间的映射表，那正是 R14.1 要横扫的「同一语义两份定义」。
// 中立契约层是两边都认识、谁也不拥有实现的那一层。
/**
 * 一镜的价格。`known:false` = **这次算不出**（中转/自建端点没有价目是常态），
 * 卡上印的是「暂时算不出价格」而不是 `¥0` —— 三种可能（免费 / 算不出 / 真的零元）里，
 * 印 0 恰好是唯一会被读成「这次不花钱」的那一种。与 `productionRun/shotPricing.ts`
 * 的 `ShotPrice` 同形，那边是求值的家，这里是过线的形状。
 */
export type PendingSpendPrice = { known: true; amount: number } | { known: false };

/** 一镜在付费卡上的全部事实。绝不含 transportModelId、密钥或供应商 URL。 */
export type PendingSpendShot = Readonly<{
  shotId: string;
  /** 已落地的画布占位节点。卡体那张生成框绑的就是它（同一份 meta、同一个 store）。 */
  nodeId?: string;
  /** 1 基的镜序，翻页器上印的那个数。 */
  index: number;
  prompt: string;
  providerId: string;
  modelId: string;
  mode?: string;
  modeId?: string;
  parameters: Readonly<Record<string, unknown>>;
  price: PendingSpendPrice;
}>;

export type PendingSpendConfirm = Readonly<{
  projectId: string;
  runId: string;
  operationId: string;
  /** 幂等键的一半：改参数把它推进一版（`generation.revise` 的 commandId 用它）。 */
  planVersion: number;
  candidateRevision: number;
  /**
   * 付费门已经开着时它就是那道门的 id；还是草稿（没封印）时缺席。
   *
   * 卡**不看它**——用户在两档下看到的是同一张卡，改参数时价格照样原地刷新。
   * 它只在命令那一层有意义：有门就得先撤门再改，没门直接改。
   */
  gateId?: string;
  currency: string;
  shots: readonly PendingSpendShot[];
  /** 已知价格之和。`unknownShotCount > 0` 时它**不是**合计，卡上必须走「算不出」那一档。 */
  knownSubtotal: number;
  unknownShotCount: number;
}>;
