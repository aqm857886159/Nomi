// 「这句失败是不是：模型那一侧去拉我们给的输入链接，拉不到」——全仓唯一的判据（不依赖 electron）。
//
// 为什么要单列一个共享判据：这件事有两个读者，必须是同一份——
//   · 主进程 `productionGenerationSubmission` 在提交被拒 / 任务失败时问它，答「是」就记下这条连接，之后参考素材走上传；
//   · 渲染层 `classifyGenerationError` 问它，答「是」就给「模型取不到参考图」那张卡，主按钮是要花钱的重试。
// 两边各写一份，就会出现「记了账却没有卡」或「有卡却没记账」。
//
// 判据是一张**原话表**，逐字比对：上游错误码，加服务商真实说过的整句。不按服务商写分支：同一句话换家说，仍然认。
//
// 为什么不写通用规则：这个判据全 App 的错误都会问，读的是别人写的文字，还同步跑在主进程和界面上。用正则猜过两轮，
// 宽了把审核、鉴权说成取不到参考图，窄了漏认，写错一个量词还能把整个 App 卡死。
// 认不出的代价只是卡片和以前一样，发送前的试探还在；认错的代价是把人引向要花钱的重试。所以三条规矩：
//   · 没有出处的不登记；
//   · 没说是输入的不收，哪怕是真话（`Failed to download file from <链接>`、`download image failed`、
//     `oss download error`：取结果失败也可能这么说）；
//   · 不用正则判句子。碰到新说法，查实出处，加一行。

/** 上游错误码（规范化后比较：小写，`-` 和空白当成 `_`）。也可能被原样带进错误文字（JSON 信封），所以文字里也比。 */
const REFUSAL_CODES: readonly string[] = [
  "file_download_error", // 一家模型聚合服务的错误码文档：下载不了输入文件时返回 422
  "invalid_image_url", // 一家模型 API 的开发者论坛：拉取图片链接超时或出错时的 400
  "image_download_failed", // 另一家模型聚合服务的 SDK 错误类型表
  "failed_to_download_image", // 同一家另一个 SDK 的错误码枚举
  // 一家云厂商模型平台的错误码文档
  "invalidurl.connectionrefused",
  "invalidurl.timeout",
  "badrequest.inputdownloadfailed",
];

/** 服务商说过的原话：一律小写，空白压成一个。 */
const REFUSAL_PHRASES: readonly string[] = [
  "input media url could not be fetched", // 用户反馈的原话
  "reference image download failed", // 一家模型 API 的图片与视频常见问题文档
  // 一家模型 API 的开发者论坛。后面跟着链接才算，光说下载超时可能是别的下载
  "timeout while downloading http",
  "error while downloading http",
  // 一家云厂商模型平台的错误码文档
  "failed to download multimodal content",
  "download the media resource timed out during the data inspection process",
  "unable to download the media resource during the data inspection process",
  "failed to find the requested media resource during the data inspection process",
  "don't have authorization to access the media resource during the data inspection process",
  "failed to download input files",
  "failed to download the input file",
  "please provide available url",
  "please check the request url is available",
];

/** 这个判据在主进程和渲染层都同步跑。只看开头这一段：服务商的报错不会更长。 */
const MAX_TEXT_LENGTH = 4000;

function normalizeCode(code: string | undefined): string {
  return String(code ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

export type ReferenceFetchRefusalInput = {
  /** 上游自己给的错误码（`VendorErrorStructured.upstreamCode`）；没有就不给。 */
  upstreamCode?: string;
  /** 失败的那句话：上游原话优先，没有就整句错误。 */
  text?: string;
};

export function isReferenceFetchRefusal(input: ReferenceFetchRefusalInput): boolean {
  if (REFUSAL_CODES.includes(normalizeCode(input.upstreamCode))) return true;
  const text = String(input.text ?? "").slice(0, MAX_TEXT_LENGTH).toLowerCase().replace(/\s+/g, " ");
  return [...REFUSAL_CODES, ...REFUSAL_PHRASES].some((phrase) => text.includes(phrase));
}
