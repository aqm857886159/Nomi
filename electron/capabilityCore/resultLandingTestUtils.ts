// 同步供应商「答了、本机落地失败」的真实失败形状（2026-10-28）：每一种都由生产里的那个生产者造出来，不手拼。
// 用法：测试文件自己 mock `projectAssetStore.importRemoteAsset`，让结果落地门（`localizeTaskAsset`，用真的）
// 落盘那一步按这些形状失败——正证据只有落地门挂得上，测试也只能经它拿到。

import { hardenedFetch } from "../hardenedFetch";
import { generatedMediaKindMismatchError, generatedMediaValidationError } from "../assets/generatedMediaDecode";

/** 同步供应商回答里的结果地址（签名直链的形状）。 */
export const SYNC_RESULT_URL = "https://cdn.provider.test/results/out.png?X-Amz-Signature=sig&Expires=1893456000";

/** 字节解码失败（2026-09-29 那次「供应商出了图、Nomi 读不出」的形状）：生产者挂 `output-unreadable`。 */
export function decodeFailed(): Error {
  return generatedMediaValidationError("decode_failed");
}

/** 类型不符（视频任务回来一张图）：生产者自己挂 `retrieval-download`。 */
export function kindMismatch(): Error {
  return generatedMediaKindMismatchError("video", "image");
}

/** 结果地址签名过期：hardenedFetch 真跑一次，结果 CDN 回 403（错误页）。不碰网络。 */
export async function download403(): Promise<Error> {
  const body = Buffer.alloc(1024, 0x3c);
  return hardenedFetch(SYNC_RESULT_URL, { allowContentTypes: ["image/", "application/octet-stream"] }, {
    isApplicationProxyActive: () => false,
    fetch: async () => new Response(body, { status: 403, headers: { "Content-Type": "application/xml", "Content-Length": String(body.length) } }),
  }).then(() => { throw new Error("expected the CDN to refuse"); }, (error: Error) => error);
}

/** 写盘失败：无码的系统错误（项目目录没有写权限）。 */
export function diskWriteFailed(): Error {
  return Object.assign(new Error("EACCES: permission denied, open '/project/assets/generated/out.png'"), { code: "EACCES", syscall: "open", errno: -13 });
}
