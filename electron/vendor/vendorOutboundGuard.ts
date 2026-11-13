/**
 * 提交侧的出站授权（付费那一步）：**这把 key 该不该去那儿**。
 *
 * 带用户密钥的请求，origin 必须等于贴 key 页上确认并保存的那一个（`catalog/credentialBinding.ts`）。
 * 判据挂在这里而不是校验器，是因为校验器只看得见「这一次收进来的卡」——旧数据、手改的 catalog 文件、
 * 未来第二个写入口都绕得过它；这一层是两条执行路（mapping 与 customCall 脚本）共用的最早边界。
 *
 * 这里**不按目的地地址判**（本机 / 局域网 / 代理合成地址都照发）：Nomi 是创作者自己电脑上的软件，
 * 接入地址是创作者自己选的；按本机解析出的地址拒绝，拦住的一直是开着代理正常生成的人
 * （2026-11-13 用户拍板删掉，见 docs/engineering/direction-checks/2026-11-13-outbound-address-layer-delete.md）。
 * 另一条留下的规则「带密钥遇跳转即停」在传输层（`credentialRedirectPolicy.ts`、`hardenedFetch`）。
 */
import { judgeCredentialDestination, readCredentialBinding } from "../catalog/credentialBinding";
import { tagNomiError } from "../shared/nomiErrorCodes";
import { codeDeclaredFallbackOrigins } from "./vendorBaseFallback";
import type { Vendor } from "../catalog/types";

export type SubmitDestinationInput = {
  // `key` 只用来查「代码里写死的官方备用域」；查不到 = 没有例外，不是放行，所以它可选。
  vendor: Pick<Vendor, "baseUrlHint">
    & Partial<Pick<Vendor, "key" | "credentialBinding" | "authType" | "authHeader" | "authQueryParam" | "authScheme">>;
  /** 已拼好鉴权 query 的最终 URL（判的就是真正要请求的那一个）。 */
  url: string;
  /** 这次请求**带着用户的密钥**吗（`collectRequestSecretValues` 说了算，不在这里重猜）。不带就不判。 */
  carriesCredential?: boolean;
};

/**
 * 允许出站 → 返回 `null`；被拦 → 返回**已挂机器码**（`NOMI_ERR::outbound-blocked-credential-origin::`）的事实串。
 * 调用方据此抛 `VendorRequestError`，码穿过 IPC 后由渲染层 `classifyGenerationError` 认出来。
 * 判据在 fetch 之前同步跑完：被拦时请求一个字节都没离开本机。
 */
export async function authorizeSubmitDestination(input: SubmitDestinationInput): Promise<string | null> {
  if (!input.carriesCredential) return null;
  // URL 解析不出来：调用方拼错了地址，交给 fetch 报「Invalid URL」，不假装成一次安全拒绝（行为同旧版）。
  if (!URL.canParse(input.url)) return null;
  const verdict = judgeCredentialDestination({
    binding: readCredentialBinding(input.vendor),
    url: input.url,
    codeDeclaredOrigins: codeDeclaredFallbackOrigins(String(input.vendor.key || "")),
    placement: input.vendor,
  });
  if (verdict.allowed) return null;
  // 码由 `tagNomiError` 挂，不手拼字面量——码表是 `shared/nomiErrorCodes.ts` 唯一 owner。
  // 人话里只放**这次的几个事实**（绑定的是哪个、要去哪个、变的是哪一样）；「怎么办」由渲染层
  // 的词表说，那边才有 i18n（这里写死中文 = 英文用户读到半句中文）。
  return tagNomiError(
    "outbound-blocked-credential-origin",
    `changed=${verdict.changed} bound=${verdict.boundOrigin} attempted=${verdict.attemptedOrigin}`,
  );
}
