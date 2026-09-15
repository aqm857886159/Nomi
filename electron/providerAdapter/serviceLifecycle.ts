/**
 * 一个验证批次最晚多久必须有结论。**单一真相源**：以前这个数字在 `service.ts` 里
 * 复制了四份（默认值 + 三处 `?? 5 * 60_000` 兜底），而会话层的 deadline 又必须从它派生
 * （integrationSessionTerminal.ts），四份里漏改一份就会让两层的判据对不上。
 */
export const PROVIDER_ADAPTER_BATCH_TIMEOUT_MS = 5 * 60_000;

export type AdapterWaitReason = "cancelled" | "deadline" | "step_timeout" | "terminal";

export class AdapterWaitError extends Error {
  constructor(
    readonly reason: AdapterWaitReason,
    readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = "AdapterWaitError";
  }
}

export function deadlineFrom(startedAt: string, timeoutMs: number): string {
  const parsed = Date.parse(startedAt);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + timeoutMs).toISOString();
}

export function deadlineExpired(deadlineAt: string | undefined, now: string): boolean {
  if (!deadlineAt) return false;
  const deadline = Date.parse(deadlineAt);
  const current = Date.parse(now);
  return Number.isFinite(deadline) && Number.isFinite(current) && deadline <= current;
}

export async function awaitAdapterStep<T>(input: {
  signal: AbortSignal;
  deadlineAt?: string;
  now: string;
  timeoutMs: number;
  step: string;
  operation: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  if (input.signal.aborted) {
    throw new AdapterWaitError("cancelled", input.step, `${input.step} cancelled`);
  }
  const nowMs = Date.parse(input.now);
  const deadlineMs = input.deadlineAt ? Date.parse(input.deadlineAt) : Number.POSITIVE_INFINITY;
  const remainingMs = Number.isFinite(nowMs) && Number.isFinite(deadlineMs)
    ? Math.max(0, deadlineMs - nowMs)
    : Number.POSITIVE_INFINITY;
  if (remainingMs <= 0) {
    throw new AdapterWaitError("deadline", input.step, `${input.step} stopped because the adapter run deadline was reached`);
  }
  const timeoutMs = Math.max(0, Math.min(input.timeoutMs, remainingMs));
  const timeoutReason: AdapterWaitReason = remainingMs <= input.timeoutMs ? "deadline" : "step_timeout";
  const timeoutMessage = timeoutReason === "deadline"
    ? `${input.step} stopped because the adapter run deadline was reached`
    : `${input.step} timed out after ${input.timeoutMs} ms`;

  const operationController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new AdapterWaitError(timeoutReason, input.step, timeoutMessage);
      reject(error);
      operationController.abort(error);
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      const error = new AdapterWaitError("cancelled", input.step, `${input.step} cancelled`);
      reject(error);
      operationController.abort(error);
    };
    input.signal.addEventListener("abort", abortListener, { once: true });
  });
  const operation = Promise.resolve().then(() => input.operation(operationController.signal));
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) input.signal.removeEventListener("abort", abortListener);
  }
}
