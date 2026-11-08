import assert from 'node:assert/strict';

/**
 * 付费「一个模型一发」的共用循环：每个样本一结束就立刻写下回执（失败的那条也写），再轮到下一个。
 *
 * 为什么收成一处（2026-11-07）：音频新型号付费抽检第一次跑，中途一条失败直接抛出，前面已经付过钱的那几条
 * 任务号 / 状态 / 扣费全没留下——钱花了，证据丢了。回执先落、再判停不停，失败就再也吃不掉前面的结果。
 *
 * - `invoke(sample, note)`：发这一单。中途知道的事（受理拿到的任务号等）先 `note({...})` 记上——
 *   之后就算轮询超时抛出，这条回执里也有任务号，不会被当成「没下单」重下一次。
 * - `record(receipt, all)`：每条回执落定后立刻调用（写报告、追加到 jsonl）。它抛错就停：回执写不下去就不再花钱。
 * - `onFailure`：`stop` = 第一条失败就停（照旧不重试）；`continue` = 记下失败接着跑下一个（一问一个的抽检）。
 * - `from`：从某个样本接着跑；前面那些在已记录的一次里跑过，不再付钱。认不得的起点在下第一单之前就拒。
 */
export type SampleReceipt = { key: string; ok: boolean; at: string; error?: string } & Record<string, unknown>;

export type SampleOutcome = { ok: boolean; error?: string } & Record<string, unknown>;

export async function runSamplesWithReceipts<S>(
  samples: readonly S[],
  options: {
    keyOf: (sample: S) => string;
    onFailure: 'stop' | 'continue';
    from?: string;
    record?: (receipt: SampleReceipt, all: readonly SampleReceipt[]) => void | Promise<void>;
    now?: () => Date;
  },
  invoke: (sample: S, note: (fields: Record<string, unknown>) => void) => Promise<SampleOutcome>,
): Promise<{ receipts: SampleReceipt[]; stoppedAt?: SampleReceipt }> {
  const { keyOf, onFailure, from, record, now = () => new Date() } = options;
  const start = from ? samples.findIndex(sample => keyOf(sample) === from) : 0;
  assert.ok(start >= 0, `unknown resume sample: ${from}`);
  const receipts: SampleReceipt[] = [];
  for (const sample of samples.slice(start)) {
    const key = keyOf(sample);
    const noted: Record<string, unknown> = {};
    let receipt: SampleReceipt;
    try {
      const outcome = await invoke(sample, fields => { Object.assign(noted, fields); });
      receipt = { ...noted, ...outcome, key, at: now().toISOString() };
    } catch (error) {
      receipt = { ...noted, key, ok: false, error: String((error as Error)?.message ?? error).slice(0, 500), at: now().toISOString() };
    }
    receipts.push(receipt);
    await record?.(receipt, receipts.slice());
    if (!receipt.ok && onFailure === 'stop') return { receipts, stoppedAt: receipt };
  }
  return { receipts };
}
