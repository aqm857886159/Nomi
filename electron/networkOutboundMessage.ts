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
import { coarseAddressLabel, type OutboundRefusalReason } from "./networkOutboundPolicy";

export type OutboundRefusalDescription = {
  reason: OutboundRefusalReason;
  hostname: string;
  observedAddress: string;
  syntheticResolver: boolean;
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
  return tagNomiError("outbound-blocked", outboundRefusalSentence(input));
}

function outboundRefusalSentence(input: OutboundRefusalDescription): string {
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
