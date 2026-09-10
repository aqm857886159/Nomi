import type { ProviderTrafficPolicy } from './providerTrafficPolicy';

type Lane = {
  active: number;
  starts: number[];
  cooldownUntil: number;
  limitedStreak: number;
  waiters: Set<() => void>;
};
export type TrafficLease = { release(succeeded?: boolean): void; rateLimited(retryAfterMs?: number): void };

/** Shared provider-account admission. Unknown dimensions impose no invented local cap. */
export class ProviderTrafficScheduler {
  private readonly lanes = new Map<string, Lane>();
  constructor(private readonly now: () => number = Date.now) {}

  async acquire(policy: ProviderTrafficPolicy, signal?: AbortSignal): Promise<TrafficLease> {
    let lane = this.lanes.get(policy.scope);
    if (!lane) {
      lane = { active: 0, starts: [], cooldownUntil: 0, limitedStreak: 0, waiters: new Set() };
      this.lanes.set(policy.scope, lane);
    }
    const wake = () => { for (const waiter of lane.waiters) waiter(); };
    for (;;) {
      signal?.throwIfAborted();
      const now = this.now();
      const minuteMs = 60 * 1000;
      lane.starts = lane.starts.filter((time) => time + minuteMs > now);
      const capacity = policy.inflight;
      const rateWait = policy.requestsPerMinute !== undefined && lane.starts.length >= policy.requestsPerMinute
        ? lane.starts[0] + minuteMs - now : 0;
      const waitMs = Math.max(0, lane.cooldownUntil - now, rateWait);
      if (waitMs === 0 && (capacity === undefined || lane.active < capacity)) break;
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => { if (timer) clearTimeout(timer); lane.waiters.delete(done); signal?.removeEventListener('abort', aborted); };
        const done = () => { cleanup(); resolve(); };
        const aborted = () => { cleanup(); reject(signal?.reason ?? new Error('Provider admission cancelled')); };
        lane.waiters.add(done);
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) aborted();
        else if (waitMs > 0) timer = setTimeout(done, waitMs);
      });
    }
    lane.active += 1;
    const started = this.now();
    if (policy.requestsPerMinute !== undefined) lane.starts.push(started);
    let released = false;
    let limited = false;
    return {
      rateLimited: (retryAfterMs) => {
        if (limited) return;
        limited = true;
        lane.limitedStreak += 1;
        // A generic 429 may describe RPM, tokens, or shared upstream load. It proves
        // cooldown is needed, but says nothing about an inflight connection limit.
        const elapsed = Math.max(Number.EPSILON, this.now() - started);
        const backoff = retryAfterMs ?? elapsed * 2 ** lane.limitedStreak;
        lane.cooldownUntil = Math.max(lane.cooldownUntil, this.now() + backoff);
        wake();
      },
      release: (succeeded = true) => {
        if (released) return;
        released = true;
        lane.active -= 1;
        if (succeeded && !limited && this.now() >= lane.cooldownUntil) {
          lane.limitedStreak = 0;
        }
        wake();
      },
    };
  }
}

export const providerTrafficScheduler = new ProviderTrafficScheduler();
