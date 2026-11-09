// 「这次任务的结果只能落成项目文件吗」的唯一判据（2026-11-07 配音扣了钱存不进项目，docs/fixes/2026-11-07-tts-save-expected-kind.root-cause.json；
// 2026-11-09 同类的另两处入口接上，docs/fixes/2026-11-09-a4d-deferred-entries.root-cause.json）。
//
// 大多数任务的结果是一个地址：有项目就取回落盘，没项目就把地址原样交回（unlocalizedTaskAsset）。
// 下面几类不一样——结果本身就是文件，没有地址可以先交出去，只能写进项目：
//   · 走自定义调用脚本、脚本用 saveFile 存字节（上游只给字节流时，Agent 读的脚本合同就教它这么写，customCallContract）。
//     脚本接管了传输，映射那几条规则对它不适用：不用 saveFile 的脚本交回的是地址；
//   · 映射声明了本机进程（即梦 CLI 下到本机目录、Codex 本机生图、Antigravity 回字节）；
//   · 同步回字节的音频（配音 / 音乐 / 音效：音频、没有查询步、不是转写）；
//   · 声明「结果是文件流」的视频（mapping.result.mediaResponse）。
// 这几类没有项目号就**不发请求、不起进程**：发出去钱就花了，结果却没有地方放。所有入口（tasks:run、画布单镜、
// Agent 的 try_model）都只问这一处，不各写各的；进程执行器自己也拒没有项目号的调用（processOperation）。
import { billingKindForTaskKind, type BillingModelKind, type Mapping, type ProfileKind } from "../catalog/types";

/** Audio with a query operation is an asynchronous generation task, not a synchronous TTS/STT response. */
export function usesSynchronousAudioRunner(wantedKind: BillingModelKind, mapping?: Mapping | null): boolean {
  return wantedKind === "audio" && !mapping?.query;
}

/**
 * 脚本里写了 saveFile 才算存文件：Agent 的脚本合同只教这一个名字。绕开它、直接调沙箱宿主内部函数的脚本
 * 这里看不出来（见根因合同 residual_risks）；只在注释里提到 saveFile 的脚本没项目时会被多拒，不会多花。
 */
const SCRIPT_SAVES_FILE = /\bsaveFile\b/;

/**
 * 结果只能写成项目文件（没有可以先交回的地址）。转写同步但只回文字，不在此列。
 * customCallScript 必填（不走脚本就传 undefined）：调用方得想清楚这次是不是脚本接管了传输，漏了编译不过。
 */
export function resultOnlyLandsAsProjectFile(kind: ProfileKind, mapping: Mapping | null | undefined, customCallScript: string | undefined): boolean {
  if (customCallScript) return SCRIPT_SAVES_FILE.test(customCallScript);
  if (mapping?.create?.process || mapping?.query?.process) return true;
  if (usesSynchronousAudioRunner(billingKindForTaskKind(kind), mapping)) return kind !== "transcribe";
  return Boolean(mapping?.result?.mediaResponse);
}
