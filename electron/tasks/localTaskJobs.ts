import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const ownerContext = new AsyncLocalStorage<number>();
export const withTaskOwner = <T>(owner: number, run: () => T): T => ownerContext.run(owner, run);
import type { TaskStatus } from "../shared/contracts/taskStatus";

type Job<T> = { id: string; projectId: string; owner?: number; controller: AbortController; settled: Promise<void>;
  status: Exclude<TaskStatus, "queued"> | "cancelled"; value?: T; urls?: string[]; error?: string; updatedAt: number;
  /** 正在进行的那一次导入（落盘前要异步等解码校验）。同一任务同一时刻只有这一个。 */
  committing?: Promise<void> };
export type LocalTaskResponse = { task_id: string; status: Job<unknown>["status"]; image_urls: string[]; error?: string };

/** One owner/cancellation/import boundary for in-process local providers. Never resumes a paid operation on restart. */
export class LocalTaskJobs<T> {
  private jobs = new Map<string, Job<T>>();
  private closedOwners = new Set<number>();
  private shuttingDown = false;
  start(projectId: string, work: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal): string {
    if (this.shuttingDown) throw new Error("LOCAL_TASK_SHUTTING_DOWN");
    if (externalSignal?.aborted) throw new Error("LOCAL_TASK_CANCELLED");
    const owner = ownerContext.getStore();
    if (owner !== undefined && this.closedOwners.has(owner)) throw new Error("LOCAL_TASK_OWNER_CLOSED");
    if (!projectId) throw new Error("LOCAL_TASK_PROJECT_REQUIRED");
    for (const [id, job] of this.jobs) if (job.status !== "running" && Date.now() - job.updatedAt > 3_600_000) this.jobs.delete(id);
    if ([...this.jobs.values()].filter((job) => job.status === "running").length >= 4 || this.jobs.size >= 256) {
      throw new Error("LOCAL_TASK_CAPACITY");
    }
    const id = "local-" + randomUUID();
    const job: Job<T> = { id, projectId, owner: ownerContext.getStore(), controller: new AbortController(),
      settled: Promise.resolve(), status: "running", updatedAt: Date.now() };
    this.jobs.set(id, job);
    const relay = () => job.controller.abort();
    if (externalSignal?.aborted) relay(); else externalSignal?.addEventListener("abort", relay, { once: true });
    job.settled = (async () => work(job.controller.signal))().then((value) => {
      if (job.controller.signal.aborted) job.status = "cancelled";
      else { job.value = value; job.status = "succeeded"; }
    }, (error: unknown) => {
      job.status = job.controller.signal.aborted ? "cancelled" : "failed";
      job.error = error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : "LOCAL_TASK_FAILED";
    }).finally(() => { job.updatedAt = Date.now(); externalSignal?.removeEventListener("abort", relay); });
    return id;
  }
  settled(id: string): Promise<void> { return this.jobs.get(id)?.settled ?? Promise.resolve(); }
  async query(id: string, projectId: string, materialize: (value: T) => Promise<string[]>): Promise<LocalTaskResponse> {
    const job = this.jobs.get(id);
    if (!job) return { task_id: id, status: "failed", image_urls: [], error: "LOCAL_TASK_EXPIRED" };
    if (job.owner !== ownerContext.getStore()) throw new Error("LOCAL_TASK_OWNER_MISMATCH");
    if (job.projectId !== projectId) throw new Error("LOCAL_TASK_PROJECT_MISMATCH");
    if (job.status === "succeeded" && !job.urls && !job.controller.signal.aborted) {
      // 导入要先异步等解码校验（主进程不能同步等 ffmpeg）。所以导入是单飞的：并发的第二次查询等同一次导入，
      // 取消也先等它落定（见 cancel）——导入和取消、两次查询之间仍然不会交错。
      // The caller must use an idempotent writer: a failed commit retains bytes for retry.
      job.committing ??= this.commit(job, materialize).finally(() => { job.committing = undefined; });
      await job.committing;
    }
    const status = job.controller.signal.aborted && !job.urls ? "cancelled" : job.status;
    return { task_id: id, status, image_urls: job.urls ?? [], ...(job.error ? { error: job.error } : {}) };
  }
  private async commit(job: Job<T>, materialize: (value: T) => Promise<string[]>): Promise<void> {
    if (job.value === undefined) throw new Error("LOCAL_TASK_OUTPUT_MISSING");
    const urls = await materialize(job.value);
    if (!urls.length || urls.some((url) => !url.startsWith("nomi-local://"))) throw new Error("LOCAL_TASK_IMPORT_FAILED");
    job.urls = urls; job.value = undefined;
  }
  async cancel(id: string, owner: number | undefined = ownerContext.getStore()): Promise<{ ok: boolean }> {
    const job = this.jobs.get(id);
    if (!job) return { ok: false };
    if (job.owner !== owner) throw new Error("LOCAL_TASK_OWNER_MISMATCH");
    // 导入进行中：等它落定。导成了就和「已导入」一样不可取消；导失败了（字节还在）照常取消。
    while (job.committing) await job.committing.catch(() => undefined);
    if (job.urls) return { ok: false };
    job.controller.abort(); await job.settled;
    job.status = "cancelled"; job.value = undefined;
    return { ok: true };
  }
  async cancelOwner(owner: number): Promise<void> {
    this.closedOwners.add(owner);
    await Promise.all([...this.jobs.values()].filter((job) => job.owner === owner && !job.urls).map((job) => this.cancel(job.id, owner)));
  }
  async cancelAll(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.jobs.values()].filter((job) => !job.urls).map((job) => this.cancel(job.id, job.owner)));
  }
}
