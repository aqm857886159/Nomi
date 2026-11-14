/**
 * Run 提交门派发前的最后一步：让供应商适配器按批准时的合同再序列化一次，核对和批准时的请求体指纹一致。
 * 这一步之前什么都没写（Run 事件、账本、意图、信封、供应商都没碰）；序列化漂移和一般错误照旧零写入。
 * 唯一允许的耐久写入：确定拒收（`DefiniteSendRefusal`，如升级后方式要的输入没了）——作业落 needs_attention、带原话，
 * 而不是一直排队；然后原错误照抛。
 */
import { definiteSendRefusalOf } from "../shared/generationDefiniteSendRefusal";

export type JobRefusalPatch = { errorCode: string; errorMessage: string };

type Authorized = { providerIdempotencyKey: string; referenceUrls?: unknown; providerWirePayloadHash: string };

export function prepareProviderOrLandRefusal<C, A extends Authorized, P extends { providerRequestHash: string }>(
  adapter: { prepareAuthorization(input: { contract: C; providerIdempotencyKey: string; referenceUrls: A["referenceUrls"] }): P },
  contract: C,
  authorized: A,
  landNeedsAttention: (patch: JobRefusalPatch) => unknown,
): P {
  let prepared: P;
  try {
    prepared = adapter.prepareAuthorization({ contract, providerIdempotencyKey: authorized.providerIdempotencyKey, referenceUrls: authorized.referenceUrls });
  } catch (error) {
    const refusal = definiteSendRefusalOf(error);
    if (refusal) landNeedsAttention({ errorCode: refusal.code, errorMessage: refusal.message.slice(0, 512) });
    throw error;
  }
  if (prepared.providerRequestHash !== authorized.providerWirePayloadHash) {
    throw new Error("Provider wire payload no longer matches the approved authorization");
  }
  return prepared;
}
