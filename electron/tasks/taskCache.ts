import { BoundedCache } from "../shared/boundedCache";
import type { CachedTask } from "../taskTypes";
/** Shared async-generation cache owner; a live entry represents work still awaiting a terminal result. */
export const taskCache = new BoundedCache<string, CachedTask>({ maxEntries: 200, ttlMs: 60 * 60 * 1000 });
export function hasInFlightTasks(): boolean { return taskCache.size > 0; }
