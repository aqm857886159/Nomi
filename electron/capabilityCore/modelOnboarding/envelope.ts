/**
 * 接模型两个工具共用的返回信封（方案 §4.3）。
 *
 * 这份信封里最重要的一格是 `unverified`：它把「接好了吗」从一个模型要靠语气拿捏的问题，
 * 变成一个它手里有答案的问题。只要里面还有 `model_produces_output`，它就**不能**说「接好了」。
 * 这是 GitHub `issue_write` 那段「STOP — do not claim the operation succeeded」在本域的等价物，
 * 只是我们用结构表达，而不是靠一段大写祈使句（反方 prior-art 报告结论 5）。
 *
 * 自检**永远**消不掉 `model_produces_output`：自检证明的是「地址对、key 对、卡的形状自洽」，
 * 不是「点了一定能出片」。消掉它的唯一证据是用户在画布上真跑一次（§7）。
 */
export const UNVERIFIED_CLAIMS = [
  "endpoint_reachable",
  "credential_accepted",
  "model_id_exists",
  /** 卡本身过没过校验（旧名 `adapter_compiles`——那时它还是「我们编译出来的」）。 */
  "declaration_valid",
  /** 这家的上传通道真的能把一张本地图送进去吗。自检不打它（那会花钱或留垃圾）。 */
  "asset_upload_works",
  /** 唯一一条只有用户真跑一次才能消掉的。 */
  "model_produces_output",
] as const;
export type UnverifiedClaim = (typeof UNVERIFIED_CLAIMS)[number];

export type UnverifiedEntry = { claim: UnverifiedClaim; reason: string; evidenceWouldBe: string };

export type OnboardingStateId = "S11.0" | "S11.1" | "S11.3" | "S11.4" | "S11.5" | "S11.6";
export type OnboardingChange = { state: OnboardingStateId; summary: string };

export type BlastRadius = {
  modelsAppearing: number;
  modelsDisappearing: number;
  recordsDeleted: number;
  /**
   * 这一跳往外发了几次请求、花不花钱。
   *
   * 2026-09-21 之前 `billable` 的类型是字面量 `false`——那时这张工具面上确实没有花钱的动作。
   * 试跑（`nomi_try_model`）进来之后它不再成立：一次真实生成就是花钱。类型**必须**能说出
   * 这件事，否则信封会替我们撒一个不会报错的谎。真正的闸不在类型上，在
   * `spendGrant` → 渲染层报价确认卡那一条（模型调得动这个工具，但结不了账）。
   */
  outboundRequests: Array<{ origin: string; count: number; billable: boolean }>;
};

export type OnboardingNextActionKind =
  | "none" | "user_sees_key_page" | "user_sees_confirm_card" | "user_sees_spend_card" | "waiting_for_user" | "working";

export type OnboardingNextAction = {
  kind: OnboardingNextActionKind;
  /** 一句人话，与界面同源、模型可直接转述。 */
  userSees: string;
  waitWith?: "nomi_read target=setup waitMs";
  url?: string;
};

export type OnboardingResult = {
  ok: true;
  setupId?: string;
  vendorKey?: string;
  /** 重放同一跳返回同一个 changeId（按 `(setupId, action, canonicalJson(args))` 派生）。 */
  changeId?: string;
  state: unknown;
  unverified: UnverifiedEntry[];
  changes: OnboardingChange[];
  blastRadius: BlastRadius;
  nextAction: OnboardingNextAction;
};

export type OnboardingRejection = {
  /** 卡上的位置，如 `models[1].modes[0].query.path`。 */
  path: string;
  code:
    | "schema" | "same_origin" | "no_channel" | "async_without_query"
    | "reference_slot_missing" | "credential_rejected" | "endpoint_unreachable"
    | "model_not_listed" | "upload_strategy_unsupported";
  message: string;
  /** **卡上该字段自己声明的出处**，不是我们猜的（真实用户那一条：「你声明 A，文档第 N 节写 B」）。 */
  sourceUrl?: string;
};

export type OnboardingFailure = {
  ok: false;
  code:
    | "wrong_verb" | "needs_input" | "not_found" | "invalid_args" | "stale_fingerprint"
    | "declaration_rejected" | "credential_origin_mismatch" | "no_generic_contract" | "provider_failed"
    /** 已提交、钱已花、供应商还在处理：**不是失败**，不许重试（重试 = 再花一次）。 */
    | "still_processing"
    /** 提交那一步到点还没回、或写出后连接断了：**可能已提交、已扣费**，不许重试；与 `still_processing` 的区别是连任务号都不一定有。 */
    | "submission_unknown";
  message: string;
  useInstead?: string;
  /** 缺什么**一次列全**（09-10 实测 22 次失败里 9 次死在逐个抛）。 */
  needs?: string[];
  rejections?: OnboardingRejection[];
  /** 上游原文，截断但不改写（≤512）。 */
  evidence?: { status?: number; bodyExcerpt?: string };
  /** `still_processing` 时供应商给的任务号（`submission_unknown` 没有）。 */
  taskId?: string;
  nextAction: string;
};

const REASON: Record<UnverifiedClaim, { reason: string; evidenceWouldBe: string }> = {
  endpoint_reachable: {
    reason: "Nomi has not reached this base URL yet.",
    evidenceWouldBe: "a self-check that got an answer from the provider",
  },
  credential_accepted: {
    reason: "The provider has not accepted this key on any request yet.",
    evidenceWouldBe: "a self-check where the provider answered without an auth error",
  },
  model_id_exists: {
    reason: "Nomi has not seen this model id in the provider's own model list.",
    evidenceWouldBe: "the model id appearing in the provider's model list during a self-check",
  },
  declaration_valid: {
    reason: "No declaration card has passed validation for this provider yet.",
    evidenceWouldBe: "a submit_declaration call that came back without a rejected field",
  },
  asset_upload_works: {
    reason: "No local file has been sent through this provider's upload channel yet. The self-check deliberately does not try: it would either cost money or leave a file behind.",
    evidenceWouldBe: "the user's first generation that carries a reference image or video",
  },
  model_produces_output: {
    reason: "Nothing has actually been generated with this model. A self-check never proves this: it only checks the address, the key and the shape of the card.",
    evidenceWouldBe: "the user's first real generation on the canvas",
  },
};

/** claim 列表 → 信封里那一格。理由与「什么才算证据」是派生的，不逐处手写。 */
export function unverified(...claims: UnverifiedClaim[]): UnverifiedEntry[] {
  return [...new Set(claims)].map((claim) => ({ claim, ...REASON[claim] }));
}

/** 这一跳什么都没改。 */
export function noBlast(): BlastRadius {
  return { modelsAppearing: 0, modelsDisappearing: 0, recordsDeleted: 0, outboundRequests: [] };
}

/** 自检发出的免费请求。 */
export function freeRequests(origin: string): BlastRadius["outboundRequests"] {
  return origin ? [{ origin, count: 1, billable: false }] : [];
}

/** 试跑发出的那一次**要花钱**的请求。它是本域唯一能写 `billable: true` 的地方。 */
export function billableRequests(origin: string): BlastRadius["outboundRequests"] {
  return origin ? [{ origin, count: 1, billable: true }] : [];
}

/**
 * 「这家需要的东西，声明卡表达不了」——**唯一**的出口是人写调用脚本（方案 §5 末段）。
 *
 * 四类表达不了的：请求签名 / HMAC / OAuth 换 token；非 HTTP（gRPC / WebSocket / 流式媒体）；
 * SDK-only；超出「（上传初始化 →）create → query → result」的多请求编排；自定义编码。
 *
 * `nextAction` **不许**指向 OpenAI 兼容模板：那正是 09-11 那条「静默落回模板」在人话层的复发——
 * 把「这条路本来就不通」说成「用那个模板试试」，用户会一直试，而每一次都必然在同一堵墙上。
 * `noGenericContract.test.ts` 逐字核这一条。
 *
 * 住在信封这一层而不是某一个动作里：它是这张工具面的**错误词表**的一格，和 `unverified`
 * 一样属于「回什么」，不属于「做什么」。
 */
export function noGenericContractFailure(what: string): OnboardingFailure {
  return {
    ok: false,
    code: "no_generic_contract",
    message: `${what} needs something a declaration card cannot express: a request signature, a non-HTTP transport, an SDK, a custom encoding, or more request steps than (upload init ->) create -> query -> result.`,
    nextAction: "This provider is not reachable by declaring it. In Nomi, open Settings > that model > Call script and write the call by hand; that path is exactly for this case.",
  };
}
