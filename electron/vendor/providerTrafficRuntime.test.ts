import { describe, expect, it, vi } from 'vitest';
import { ensureProviderTaskAdmission, finishProviderTrafficTask, queryProviderTrafficTask, withProviderTaskTraffic } from './providerTrafficRuntime';
import { providerTrafficScheduler } from './providerTrafficScheduler';
import { cancelProviderAdmission, withProviderAdmissionOwner } from './providerTaskAdmission';
import type { Model, Vendor } from '../catalog/types';
import type { TaskResult } from '../runtime';
const vendor = { key: 'minimax', baseUrlHint: 'https://api.minimaxi.com' } as Vendor;
const model = { modelKey: 'MiniMax-H3', kind: 'video' } as Model;
const result = (id: string, status: TaskResult['status']): TaskResult => ({ id, status, kind: 'text_to_video', assets: [], raw: {} });

describe('task lifecycle permit boundary', () => {
  it('does not treat a local unknown-status failure as upstream completion, and releases when upstream eventually terminates', async () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockResolvedValue({ release, rateLimited: vi.fn() });
    const query = vi.fn(async () => ({ vendor: 'minimax', result: result('unknown-h3', 'failed') }));
    try {
      await withProviderTaskTraffic(vendor, model, async () => {
        await ensureProviderTaskAdmission('https://api.minimaxi.com/v2/video_generation');
        return result('unknown-h3', 'running');
      }, query);
      await vi.advanceTimersToNextTimerAsync();
      expect(release).not.toHaveBeenCalled();
      query.mockImplementationOnce(async () => {
        finishProviderTrafficTask('unknown-h3', 'succeeded');
        return { vendor: 'minimax', result: result('unknown-h3', 'succeeded') };
      });
      await vi.advanceTimersToNextTimerAsync();
      expect(release).toHaveBeenCalledExactlyOnceWith(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { finishProviderTrafficTask('unknown-h3', 'failed'); acquire.mockRestore(); vi.useRealTimers(); }
  });
  it('delivers a terminal result to foreground after the background query consumed upstream completion', async () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockResolvedValue({ release, rateLimited: vi.fn() });
    const terminal = { vendor: 'minimax', result: { ...result('background-h3', 'succeeded'), assets: [{ type: 'video' as const, url: 'nomi-local://completed.mp4' }] } };
    const query = vi.fn(async () => { finishProviderTrafficTask('background-h3', 'succeeded'); return terminal; });
    try {
      await withProviderTaskTraffic(vendor, model, async () => {
        await ensureProviderTaskAdmission('https://api.minimaxi.com/v2/video_generation');
        return result('background-h3', 'running');
      }, query);
      await vi.advanceTimersToNextTimerAsync();
      expect(release).toHaveBeenCalledExactlyOnceWith(true);
      const lostContext = vi.fn(async () => { throw new Error('pending task cache already consumed'); });
      expect(await queryProviderTrafficTask('background-h3', lostContext)).toEqual(terminal);
      expect(lostContext).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { finishProviderTrafficTask('background-h3', 'failed'); acquire.mockRestore(); vi.useRealTimers(); }
  });
  it('shares foreground/background queries and retains capacity after query errors until upstream termination', async () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockResolvedValue({ release, rateLimited: vi.fn() });
    let settle!: (value: { vendor: string; result: TaskResult }) => void;
    const query = vi.fn(() => new Promise<{ vendor: string; result: TaskResult }>((resolve) => { settle = resolve; }));
    try {
      await withProviderTaskTraffic(vendor, model, async () => {
        await ensureProviderTaskAdmission('https://api.minimaxi.com/v2/video_generation');
        return result('shared-h3', 'running');
      }, query);
      await vi.advanceTimersToNextTimerAsync();
      const foreground = queryProviderTrafficTask('shared-h3', query);
      expect(query).toHaveBeenCalledTimes(1);
      settle({ vendor: 'minimax', result: result('shared-h3', 'running') });
      await foreground;
      expect(release).not.toHaveBeenCalled();
      query.mockImplementationOnce(async () => { throw new Error('upstream temporarily unavailable'); });
      await vi.advanceTimersToNextTimerAsync();
      expect(query).toHaveBeenCalledTimes(2);
      expect(release).not.toHaveBeenCalled();
      finishProviderTrafficTask('shared-h3', 'failed');
      expect(release).toHaveBeenCalledExactlyOnceWith(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { finishProviderTrafficTask('shared-h3', 'failed'); acquire.mockRestore(); vi.useRealTimers(); }
  });
  it('does not acquire for cache hits, and does not release task slots on HTTP acceptance or local query failure', async () => {
    const release = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockResolvedValue({ release, rateLimited: vi.fn() });
    try {
      await withProviderTaskTraffic(vendor, model, async () => result('cache', 'succeeded'), vi.fn());
      expect(acquire).not.toHaveBeenCalled();
      await withProviderTaskTraffic(vendor, model, async () => {
        await ensureProviderTaskAdmission('https://api.minimaxi.com/v2/video_generation');
        return result('live-h3', 'queued');
      }, vi.fn());
      expect(acquire.mock.calls[0][0]).toMatchObject({ inflight: 30, requestsPerMinute: undefined });
      expect(release).not.toHaveBeenCalled();
      const query = vi.fn(async () => ({ vendor: 'minimax', result: result('live-h3', 'failed') }));
      const response = await queryProviderTrafficTask('live-h3', query);
      expect(response.result.status).toBe('queued'); // official interval protects from duplicate immediate polling
      expect(query).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      finishProviderTrafficTask('live-h3', 'succeeded');
      expect(release).toHaveBeenCalledWith(true);
    } finally { finishProviderTrafficTask('live-h3', 'failed'); acquire.mockRestore(); }
  });
  it('cancels waiting admission only for its IPC owner before any paid work', async () => {
    const entered = vi.fn();
    const acquire = vi.spyOn(providerTrafficScheduler, 'acquire').mockImplementation((_policy, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    try {
      const work = withProviderAdmissionOwner(7, 'request', () => withProviderTaskTraffic(vendor, model, async () => {
        await ensureProviderTaskAdmission('https://api.minimaxi.com/v2/video_generation'); entered(); return result('cancelled', 'queued');
      }, vi.fn()));
      const rejected = expect(work).rejects.toThrow('cancelled');
      expect(cancelProviderAdmission(8, 'request')).toBe(false);
      expect(cancelProviderAdmission(7, 'request')).toBe(true);
      await rejected;
      expect(entered).not.toHaveBeenCalled();
    } finally { acquire.mockRestore(); }
  });
});
