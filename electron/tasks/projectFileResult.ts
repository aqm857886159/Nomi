// 「这次任务的结果只能落成项目文件吗」的唯一判据（2026-11-07 配音扣了钱存不进项目，docs/fixes/2026-11-07-tts-save-expected-kind.root-cause.json）。
//
// 大多数任务的结果是一个地址：有项目就取回落盘，没项目就把地址原样交回（unlocalizedTaskAsset）。
// 下面两类不一样——响应本身就是文件，没有地址可以先交出去，只能写进项目：
//   · 同步回字节的音频（配音 / 音乐 / 音效：音频、没有查询步、不是转写）；
//   · 声明「结果是文件流」的视频（mapping.result.mediaResponse）。
// 这两类没有项目号就**不发请求**：发出去钱就花了，结果却没有地方放。所有入口（tasks:run、画布单镜、
// Agent 的 try_model）都只问这一处，不各写各的。自定义调用脚本的 saveFile（customCallDispatch）和进程类的
// 本地下载（processOperation）还没接：同类、本次延后，见根因合同 residual_risks。
import { billingKindForTaskKind, type BillingModelKind, type Mapping, type ProfileKind } from "../catalog/types";

/** Audio with a query operation is an asynchronous generation task, not a synchronous TTS/STT response. */
export function usesSynchronousAudioRunner(wantedKind: BillingModelKind, mapping?: Mapping | null): boolean {
  return wantedKind === "audio" && !mapping?.query;
}

/** 结果只能写成项目文件（没有可以先交回的地址）。转写同步但只回文字，不在此列。 */
export function resultOnlyLandsAsProjectFile(kind: ProfileKind, mapping: Mapping | null | undefined): boolean {
  if (usesSynchronousAudioRunner(billingKindForTaskKind(kind), mapping)) return kind !== "transcribe";
  return Boolean(mapping?.result?.mediaResponse);
}
