import { describe, expect, it, vi, afterEach } from 'vitest';
import { ProviderTrafficScheduler } from './providerTrafficScheduler';

afterEach(() => vi.useRealTimers());
describe('provider account admission', () => {
  it('admits all eight requests when the supplier publishes no lifecycle cap', async () => {
    const scheduler = new ProviderTrafficScheduler();
    const leases = await Promise.all(Array.from({ length: 8 }, () => scheduler.acquire({ scope: 'unknown' })));
    expect(leases).toHaveLength(8);
    leases.forEach((lease) => lease.release());
  });
  it('holds a supplier slot until terminal release, isolates suppliers and cancels queued work', async () => {
    const scheduler = new ProviderTrafficScheduler();
    const a = await scheduler.acquire({ scope: 'a', inflight: 1 });
    const controller = new AbortController();
    const queued = scheduler.acquire({ scope: 'a', inflight: 1 }, controller.signal);
    const cancelled = expect(queued).rejects.toThrow('cancelled');
    const b = await scheduler.acquire({ scope: 'b', inflight: 1 });
    controller.abort(new Error('cancelled'));
    await cancelled;
    a.release(); b.release();
    (await scheduler.acquire({ scope: 'a', inflight: 1 })).release();
  });
  it('honors the provider Retry-After and request window separately from task completion', async () => {
    vi.useFakeTimers();
    const scheduler = new ProviderTrafficScheduler();
    const lease = await scheduler.acquire({ scope: 'a', requestsPerMinute: 1 });
    lease.rateLimited(90_000); lease.release();
    const admitted = vi.fn();
    const next = scheduler.acquire({ scope: 'a', requestsPerMinute: 1 }).then((value) => { admitted(); value.release(); });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(admitted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    await next;
    expect(admitted).toHaveBeenCalledOnce();
  });
  it('does not turn a generic rate rejection into an invented inflight cap', async () => {
    vi.useFakeTimers();
    const scheduler = new ProviderTrafficScheduler();
    const initial = await scheduler.acquire({ scope: 'rate-only' });
    initial.rateLimited(1000);
    initial.release(false);
    const admitted = vi.fn();
    const pending = Promise.all(Array.from({ length: 8 }, () => scheduler.acquire({ scope: 'rate-only' }).then((lease) => { admitted(); return lease; })));
    await vi.advanceTimersByTimeAsync(999);
    expect(admitted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(admitted).toHaveBeenCalledTimes(8);
    (await pending).forEach((lease) => lease.release());
  });

});
