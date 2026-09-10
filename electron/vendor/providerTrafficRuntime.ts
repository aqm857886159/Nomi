import { AsyncLocalStorage } from 'node:async_hooks';
import type { Model, Vendor } from '../catalog/types';
import type { TaskResult } from '../runtime';
import { resolveProviderTrafficPolicy, type ProviderTrafficPolicy } from './providerTrafficPolicy';
import { providerTrafficScheduler, type TrafficLease } from './providerTrafficScheduler';
import { providerAdmissionSignal } from './providerTaskAdmission';
import { createTaskCache } from '../tasks/taskCache';

type TaskResponse = { vendor: string; result: TaskResult };
type TrackedTask = {
  lease: TrafficLease; response: TaskResponse; interval: number; nextQuery: number;
  query?: Promise<TaskResponse>; timer?: ReturnType<typeof setTimeout>; finished?: boolean;
};
type Admission = { policy: ProviderTrafficPolicy; lease?: TrafficLease };
const admission = new AsyncLocalStorage<Admission>();
const tasks = new Map<string, TrackedTask>();
const completed = createTaskCache<TaskResponse>();

/** Called at the existing shared paid-submit boundary; cache hits never acquire a slot. */
export async function ensureProviderTaskAdmission(url: string): Promise<void> {
  const entry = admission.getStore();
  if (!entry || entry.lease || new URL(url).pathname !== entry.policy.submissionPath) return;
  entry.lease = await providerTrafficScheduler.acquire({ ...entry.policy, scope: `${entry.policy.scope}:tasks`, requestsPerMinute: undefined }, providerAdmissionSignal());
  providerAdmissionSignal()?.throwIfAborted();
}

/** Release only on normalized upstream terminal evidence, never a local polling timeout. */
export function finishProviderTrafficTask(taskId: string, status: string): void {
  if (status !== 'succeeded' && status !== 'failed') return;
  const tracked = tasks.get(taskId);
  if (!tracked) return;
  tracked.lease.release(status === 'succeeded');
  tracked.finished = true;
  if (tracked.timer) clearTimeout(tracked.timer);
  if (!tracked.query) tasks.delete(taskId);
}

/** UI and lifecycle monitoring share both in-flight query and the provider's polling interval. */
export async function queryProviderTrafficTask(taskId: string, query: () => Promise<TaskResponse>): Promise<TaskResponse> {
  const tracked = tasks.get(taskId);
  if (!tracked) return completed.get(taskId) ?? query();
  if (tracked.query) return tracked.query;
  if (Date.now() < tracked.nextQuery) return tracked.response;
  tracked.nextQuery = Date.now() + tracked.interval;
  const pending = Promise.resolve().then(query).then((response) => {
    tracked.response = response;
    if (tracked.finished) completed.set(taskId, response);
    return response;
  }).finally(() => {
    tracked.query = undefined;
    if (tracked.finished) tasks.delete(taskId);
  });
  tracked.query = pending;
  return pending;
}

function monitor(taskId: string, tracked: TrackedTask, query: () => Promise<TaskResponse>): void {
  const schedule = () => {
    if (!tasks.has(taskId) || tracked.finished) return;
    tracked.timer = setTimeout(() => {
      // A query failure is not provider completion. Keep the paid task and permit;
      // foreground reads see the same query error and retain their existing recovery UI.
      void queryProviderTrafficTask(taskId, query).catch(() => undefined).finally(schedule);
    }, Math.max(0, tracked.nextQuery - Date.now()));
    tracked.timer.unref();
  };
  schedule();
}

export async function withProviderTaskTraffic(
  vendor: Vendor, model: Model, work: () => Promise<TaskResult>, query: (taskId: string) => Promise<TaskResponse>,
): Promise<TaskResult> {
  if (!vendor.baseUrlHint) return work();
  const meta = vendor.meta && typeof vendor.meta === 'object' ? vendor.meta as Record<string, unknown> : {};
  const policy = resolveProviderTrafficPolicy({ baseUrl: vendor.baseUrlHint, model: model.modelAlias || model.modelKey, kind: model.kind,
    accountTier: typeof meta.accountTier === 'string' ? meta.accountTier : undefined });
  // Connection quotas belong to HTTP, including synchronous audio and complete text streams.
  if (policy.inflightUnit !== 'task') return work();
  if (!policy.pollIntervalMs || !policy.submissionPath) throw new Error('Provider task concurrency contract requires a sourced poll interval');
  const entry: Admission = { policy };
  try {
    const result = await admission.run(entry, work);
    if (entry.lease && (result.status === 'queued' || result.status === 'running')) {
      const tracked: TrackedTask = { lease: entry.lease, response: { vendor: vendor.key, result }, interval: policy.pollIntervalMs, nextQuery: Date.now() + policy.pollIntervalMs };
      tasks.set(result.id, tracked);
      monitor(result.id, tracked, () => query(result.id));
    } else entry.lease?.release(result.status !== 'failed');
    return result;
  } catch (error) {
    const structured = error && typeof error === 'object' && 'structured' in error ? error.structured as { category?: string; retryAfterMs?: number } : undefined;
    if (structured?.category === 'quota') entry.lease?.rateLimited(structured.retryAfterMs);
    entry.lease?.release(false);
    throw error;
  }
}
