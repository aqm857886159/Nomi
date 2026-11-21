import type { ApprovalDecidedBy, ApprovalReceiptState, HumanApprovalChallengeV1 } from "./approvalReceipt";

// 收据库的只读投影：一张挑战 / 收据此刻落在哪一档。只被 `approvalReceipt.ts#readDecisionRecord` 调——
// 库的状态、摘要和验签都由它传进来，这里不读盘、不写库、不验签名之外的东西。
// 拆出来是为了收据库文件不超体积门岗；判「还问不问人、还签不签」的仍是生成门主人（概念 spend.approval-decision）。

/** 按挑战或收据去查一笔批准；两种令牌都只认主进程签过、登记过的。 */
export type ApprovalDecisionRef = { challengeToken: string } | { receiptToken: string };

/**
 * 一笔批准此刻的样子：`pending` 还在等人；`approved-unused` 有人（或策略）批了、还没花；`used` 已经花掉，
 * 不能再放行任何东西；`rejected` / `expired` 不生效；`unknown` 不是这里签的。`decidedBy` 是收据里签名覆盖的那一栏。
 */
export type ApprovalDecisionRecord = {
  state: "pending" | "approved-unused" | "used" | "rejected" | "expired" | "unknown";
  decidedBy?: ApprovalDecidedBy;
  receiptId?: string;
};

/**
 * 只读：一张挑战 / 收据此刻落在哪一档（等人 / 批了没用 / 用掉了 / 拒了 / 过期 / 不认识）。不写库。
 * 「用没用掉」只有收据库知道，所以由它出；判「还问不问人、还签不签」的是生成门主人
 * （`runOwnedGenerationGateAuthority.ts`），别处只读这个结论。
 */
export function decisionRecordOf(
  state: Pick<ApprovalReceiptState, "challenges" | "receipts">,
  ref: ApprovalDecisionRef,
  at: number,
  digest: (value: unknown) => string,
  signed: (token: string, kind: "challenge") => Pick<HumanApprovalChallengeV1, "challengeId">,
): ApprovalDecisionRecord {
  const fromReceipt = (token: string): ApprovalDecisionRecord => {
    const record = state.receipts[digest(token)];
    if (!record || record.token !== token) return { state: "expired" };
    const facts = { decidedBy: record.receipt.decidedBy, receiptId: record.receipt.receiptId };
    if (record.consumedAt) return { state: "used", ...facts };
    if (!(at < Date.parse(record.receipt.expiresAt))) return { state: "expired", ...facts };
    return { state: "approved-unused", ...facts };
  };
  if ("receiptToken" in ref) {
    const record = typeof ref.receiptToken === "string" ? state.receipts[digest(ref.receiptToken)] : undefined;
    return record && record.token === ref.receiptToken ? fromReceipt(ref.receiptToken) : { state: "unknown" };
  }
  let challengeId: string;
  try {
    challengeId = signed(ref.challengeToken, "challenge").challengeId;
  } catch {
    return { state: "unknown" };
  }
  const record = state.challenges[challengeId];
  if (!record || record.token !== ref.challengeToken) return { state: "unknown" };
  if (record.status === "accepted" && record.receiptToken) return fromReceipt(record.receiptToken);
  if (record.status === "rejected") return { state: "rejected" };
  if (record.status === "expired" || !(at < Date.parse(record.challenge.expiresAt))) return { state: "expired" };
  return { state: "pending" };
}
