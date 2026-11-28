/** Only pre-admission cancellation. Inputs, queues and accepted operations remain owned by pi. */
export function createLaneInputAdmission(parentSignal?: AbortSignal) {
  let pending = new AbortController();
  return {
    capture: (signal?: AbortSignal): AbortSignal => {
      const signals = [pending.signal, ...(parentSignal ? [parentSignal] : []), ...(signal ? [signal] : [])];
      return signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
    },
    cancel: () => {
      pending.abort(new Error('agent_lane_input_cancelled'));
      pending = new AbortController();
    },
  };
}

export async function awaitWithAbortSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return work;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
