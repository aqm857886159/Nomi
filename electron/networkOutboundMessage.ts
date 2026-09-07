/**
 * 出站被拒时的**人话**（P3：全绿 ≠ 用户看得懂）。
 *
 * 2026-09-06 真实验收里，这条路径抛的是裸字符串 `Refusing to fetch private/loopback DNS address`，
 * 一路被压成界面上的「生成失败」——用户面前既没有原因，也没有下一步，10 条已付费的视频看起来
 * 像是白花了。这里把每一种拒绝翻成「发生了什么 + 钱怎么样了 + 你现在该做什么」三段式。
 *
 * 与 networkOutboundPolicy 分家的理由：策略模块是纯判据（可在无 electron 的纯 Node 下直测），
 * 文案要过 desktopT（R15 可见文字国际化）。判据不认得语言，文案不认得网络。
 */
import { desktopT } from "./i18n";
import { tagNomiError } from "./shared/nomiErrorCodes";
import { coarseAddressLabel, type OutboundRefusalReason, type OutboundStage } from "./networkOutboundPolicy";

export type OutboundRefusalDescription = {
  reason: OutboundRefusalReason;
  hostname: string;
  observedAddress: string;
  syntheticResolver: boolean;
  /**
   * 哪一步被拦的。**这不是措辞差别，是钱的差别**：
   *  · `retrieval` = 提交已经成功、上游多半已出片、**钱已经付过**，丢的只是那一次下载 → 免费重取。
   *  · `submit`    = 请求**从未离开本机**（判据在 fetch 之前），供应商没被请求到、**没有计费**
   *                  → 修好网络后重新生成即可，不存在「找回」这回事（连 taskId 都还没有）。
   * 两者给同一句「已付费的任务没有丢」就是在骗人，且骗的方向相反：提交侧会让用户以为有东西可捞。
   */
  stage: OutboundStage;
};

/** RFC 2544 段落被 fake-ip 代理占用是既定事实；判「像不像 fake-ip」只看地址前缀。 */
function looksLikeFakeIp(address: string): boolean {
  return address.startsWith("198.18.") || address.startsWith("198.19.");
}

/**
 * 人话前面挂一段稳定机器码（`NOMI_ERR::outbound-blocked::`）。
 * 分类器按**码**认，不按这句中文认——人话会被 i18n 换成英文/改词，子串匹配当场断（那正是
 * nomiErrorCodes.ts 存在的理由）。展示端 stripNomiErrorCode 把标记剥掉，用户只看到人话。
 */
export function describeOutboundRefusal(input: OutboundRefusalDescription): string {
  // 码也按阶段分家：渲染层的 `outboundBlockedRecoverableMessage` 只把 `outbound-blocked` 判成
  // recoverable（有 taskId 就给「重新拉取结果」）。提交侧压根没有 taskId，共用一个码就会走到
  // 一颗按不动的按钮上，或者更糟——一句「钱已经付过」的假话。
  return input.stage === "submit"
    ? tagNomiError("outbound-blocked-submit", outboundRefusalSentence(input))
    : tagNomiError("outbound-blocked", outboundRefusalSentence(input));
}

function outboundRefusalSentence(input: OutboundRefusalDescription): string {
  if (input.stage === "submit") return submitRefusalSentence(input);
  if (input.reason === "unresolvable") {
    return desktopT("outbound.unresolvable", { host: input.hostname });
  }
  if (input.reason === "private-host") {
    return desktopT("outbound.privateHost", { host: input.hostname });
  }
  // The case the acceptance run hit: a public provider domain resolving into the benchmarking
  // range because a local fake-IP proxy answered the DNS query, but with no positive evidence of
  // that proxy, so the request stays blocked. Name the proxy explicitly - the user can act on it.
  if (looksLikeFakeIp(input.observedAddress)) {
    return desktopT("outbound.fakeIpBlocked", {
      host: input.hostname,
      address: coarseAddressLabel(input.observedAddress),
    });
  }
  return desktopT("outbound.privateAddress", {
    host: input.hostname,
    address: coarseAddressLabel(input.observedAddress),
  });
}

/**
 * 提交侧的人话。三段式的第二段（「钱怎么样了」）在这里是**确定事实**而不是推测：
 * 判据跑在 `fetchVendorWithBaseFallback` 之前，请求一个字节都没发出去。
 */
function submitRefusalSentence(input: OutboundRefusalDescription): string {
  if (input.reason === "unresolvable") {
    return desktopT("outbound.submitUnresolvable", { host: input.hostname });
  }
  if (input.reason === "private-host") {
    return desktopT("outbound.submitPrivateHost", { host: input.hostname });
  }
  if (looksLikeFakeIp(input.observedAddress)) {
    return desktopT("outbound.submitFakeIpBlocked", {
      host: input.hostname,
      address: coarseAddressLabel(input.observedAddress),
    });
  }
  return desktopT("outbound.submitPrivateAddress", {
    host: input.hostname,
    address: coarseAddressLabel(input.observedAddress),
  });
}
