import crypto from "node:crypto";

// 付费生成统一确认守卫——令牌（spend grant）核心。
// 方案：docs/plan/2026-06-21-spend-confirmation-gate.md（务实纵深 + 媒体生成/调试出口闸）。
//
// 不变量（红队结论钉死）：
// - 令牌只在主进程铸造与持有，渲染层只拿到不透明 grantId；
// - grantId 用 crypto.randomUUID（勿可猜的 Date.now+Math.random）；
// - 绑定 nodeIds + 每节点重试上限：重试天然落在本节点预算内，不放大；
// - 校验+消费在同一同步 tick 原子完成（先减再发请求），防并发 TOCTOU 一令牌烧两次；
// - 闸由调用方放在「缓存命中之后、真实 vendor 调用之前」，避免给免费缓存命中白烧预算。
//
// 信任边界（务实纵深，非密码学证明真人）：Nomi 的 AI 只能发 tool-call / 生成文本，
// 够不到 ipcRenderer 也 dispatch 不了真 click；只要铸令牌只挂在「真人确认按钮 onClick」、
// 删掉自动放行旁路、且本守卫在主进程硬拦所有 vendor 出口，AI 就触发不了未确认的付费生成。

type SpendGrant = {
  grantId: string;
  // nodeId → 剩余可发起的 vendor 请求次数（首发 + 自动重试共享，= maxAttemptsPerNode）。
  nodeBudgets: Map<string, number>;
  expiresAt: number;
};

const GRANTS = new Map<string, SpendGrant>();
// 令牌有效期：足够跑完一批生成，又不长期挂着。批量大可由调用方铸多颗或调大。
const DEFAULT_TTL_MS = 30 * 60 * 1000;
// 单节点默认可发起次数：1 次首发 + 最多 2 次自动重试（与 controller 重试预算对齐）。
const DEFAULT_MAX_ATTEMPTS_PER_NODE = 3;

function now(): number {
  return Date.now();
}

function purgeExpired(): void {
  const t = now();
  for (const [id, grant] of GRANTS) {
    if (grant.expiresAt <= t) GRANTS.delete(id);
  }
}

/**
 * 铸造一颗付费令牌。**只允许由「真实用户确认事件」的处理链调用**（铸令牌 IPC handler）。
 * @param nodeIds 本次确认要生成的节点 id 集合（空集 = 非节点付费，如 onboarding/调试，用占位 key）。
 * @returns 不透明 grantId。
 */
export function mintSpendGrant(options: {
  nodeIds: readonly string[];
  maxAttemptsPerNode?: number;
  ttlMs?: number;
}): string {
  purgeExpired();
  const grantId = crypto.randomUUID();
  const attempts = Math.max(1, Math.floor(options.maxAttemptsPerNode ?? DEFAULT_MAX_ATTEMPTS_PER_NODE));
  const nodeBudgets = new Map<string, number>();
  const ids = options.nodeIds.length > 0 ? options.nodeIds : [GENERIC_NODE_KEY];
  for (const id of ids) {
    const key = String(id || "").trim() || GENERIC_NODE_KEY;
    nodeBudgets.set(key, attempts);
  }
  GRANTS.set(grantId, { grantId, nodeBudgets, expiresAt: now() + (options.ttlMs ?? DEFAULT_TTL_MS) });
  return grantId;
}

/** 非节点付费（onboarding 拉模型 / 测连接 / mapping 调试）共用的占位 nodeId。 */
export const GENERIC_NODE_KEY = "__generic__";

export class SpendNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendNotAuthorizedError";
  }
}

/**
 * 校验并原子消费一次令牌额度。**所有持 apiKey 发 vendor 请求的出口在真正发请求前必须调它。**
 * 校验通过即同步扣减（无 await），扣到 0 删除该 node 预算、预算空则删整颗令牌——再发请求。
 * 失败抛 SpendNotAuthorizedError（调用方转成人话错误透传）。
 */
export function assertAndConsumeSpendGrant(grantId: string | undefined, nodeId: string | undefined): void {
  const id = String(grantId || "").trim();
  if (!id) throw new SpendNotAuthorizedError("此付费生成未经用户确认（缺少授权令牌），已拦截。");
  const grant = GRANTS.get(id);
  if (!grant) throw new SpendNotAuthorizedError("授权令牌无效或已用尽，请重新确认后再生成。");
  if (grant.expiresAt <= now()) {
    GRANTS.delete(id);
    throw new SpendNotAuthorizedError("授权令牌已过期，请重新确认后再生成。");
  }
  const key = String(nodeId || "").trim() || GENERIC_NODE_KEY;
  const remaining = grant.nodeBudgets.get(key);
  if (remaining === undefined) {
    // 令牌没授权这个节点：防「批准 A 借令牌生成 B」。
    throw new SpendNotAuthorizedError("授权令牌未覆盖该生成目标，已拦截。");
  }
  if (remaining <= 0) {
    throw new SpendNotAuthorizedError("该目标的生成次数已用尽（含重试），请重新确认。");
  }
  // —— 原子消费：以下同步执行，无 await，确保并发不超发 ——
  const next = remaining - 1;
  if (next <= 0) grant.nodeBudgets.delete(key);
  else grant.nodeBudgets.set(key, next);
  if (grant.nodeBudgets.size === 0) GRANTS.delete(id);
}

/** 测试辅助：清空全部令牌。 */
export function __resetSpendGrantsForTests(): void {
  GRANTS.clear();
}

/** 测试辅助：当前令牌数。 */
export function __spendGrantCountForTests(): number {
  return GRANTS.size;
}
