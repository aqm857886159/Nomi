/**
 * 「取回的文字会进模型」那类入口（Agent 读文档网址、接入向导抓文档）被地址判据拒绝时的人话。
 *
 * 只有 `hardenedFetch` 的 `textEntersModelContext` 会走到这里；生成的提交、取回、下载都不按地址判
 * （2026-11-13 删掉那一层，见 docs/engineering/direction-checks/2026-11-13-outbound-address-layer-delete.md）。
 * 与 networkOutboundPolicy 分家的理由：策略模块是纯判据（可在无 electron 的纯 Node 下直测），
 * 文案要过 desktopT（R15 可见文字国际化）。
 */
import { desktopT } from "./i18n";
import { coarseAddressLabel, isBenchmarkingAddress, type OutboundRefusalReason } from "./networkOutboundPolicy";

export type OutboundRefusalDescription = {
  reason: OutboundRefusalReason;
  hostname: string;
  observedAddress: string;
};

export function describeOutboundRefusal(input: OutboundRefusalDescription): string {
  if (input.reason === "unresolvable") return desktopT("outbound.unresolvable", { host: input.hostname });
  if (input.reason === "private-host") return desktopT("outbound.privateHost", { host: input.hostname });
  // 198.18/15 是本机代理（fake-ip）给的合成地址、不是真的内网：没探测确认时拒绝，文字要说准这一点。
  const key = isBenchmarkingAddress(input.observedAddress) ? "outbound.syntheticAddress" : "outbound.privateAddress";
  return desktopT(key, {
    host: input.hostname,
    address: coarseAddressLabel(input.observedAddress),
  });
}
