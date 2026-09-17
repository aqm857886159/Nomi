/**
 * 本地转写的**进度回传通道**。
 *
 * 为什么需要它：`runTask` 那条链是「发请求 → 拿结果」的同步形状，中途没有进度参数——
 * 对云端转写这没问题（几秒就回来了），但本地转写第一次用要先下几百 MB、之后按段跑几分钟。
 * 一条没有进度的几分钟等待在用户那里和「卡死了」长得一模一样。
 *
 * 为什么不把进度硬塞进 `TaskRequest`：那是一个会被序列化、会被缓存、会被外部 Agent 构造的
 * 数据结构，往里塞回调就等于给它开一个不可序列化的口子。这里用一张**按 nodeId 绑定的登记表**：
 * 发起方（拆解）在 `runTask` 前后注册/注销自己的接收器，本地引擎按请求里的 nodeId 找到它。
 * 没注册接收器就是没人要进度（如外部 Agent 调的转写），静默丢弃即可。
 *
 * 纪律：注册必须配 `finally` 注销。忘了注销 = 一个永远不会被调用的闭包挂在 Map 上，
 * 以及下一次同 nodeId 的任务把进度报给上一次的窗口。
 */
import type { LocalSpeechProgress } from "./localSpeechTranscribe";

type Sink = (progress: LocalSpeechProgress) => void;

const sinks = new Map<string, Sink>();

export function registerLocalSpeechProgressSink(key: string, sink: Sink): () => void {
  const id = String(key || "").trim();
  if (!id) return () => undefined;
  sinks.set(id, sink);
  return () => {
    if (sinks.get(id) === sink) sinks.delete(id);
  };
}

export function emitLocalSpeechProgress(key: string, progress: LocalSpeechProgress): void {
  const sink = sinks.get(String(key || "").trim());
  if (!sink) return;
  try {
    sink(progress);
  } catch {
    // 接收器自己炸了不许把转写带下水——进度是附带信息，不是任务的一部分。
  }
}

/** 测试用：清空登记表，避免用例之间互相串。 */
export function resetLocalSpeechProgressSinksForTests(): void {
  sinks.clear();
}
