import { describe, expect, it } from "vitest";
import { BoundedCache } from "../shared/boundedCache";

function makeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("task cache retention", () => {
  it("stores and reads back values", () => {
    const c = new BoundedCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.get("missing")).toBeUndefined();
  });

  it("expires entries past their TTL", () => {
    const clock = makeClock();
    const c = new BoundedCache<string, string>({ maxEntries: 10, ttlMs: 1000, clock: clock.now });
    c.set("k", "v");
    clock.advance(999);
    expect(c.get("k")).toBe("v");
    clock.advance(1);
    expect(c.get("k")).toBeUndefined();
    expect(c.size).toBe(0); // 过期即清
  });

  it("evicts the least-recently-used entry past maxEntries", () => {
    const c = new BoundedCache<string, number>({ maxEntries: 2, ttlMs: 100000 });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // 触碰 a → b 变成最久未用
    c.set("c", 3); // 超上限 → 淘汰 b
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("keeps the original deadline on hit and prunes expired entries on write", () => {
    const clock = makeClock();
    const cache = new BoundedCache<string, number>({ maxEntries: 2, ttlMs: 1000, clock: clock.now });
    cache.set("old", 1);
    clock.advance(500);
    cache.set("live", 2);
    expect(cache.get("old")).toBe(1);
    clock.advance(500);
    cache.set("new", 3);
    expect(cache.get("old")).toBeUndefined();
    expect(cache.get("live")).toBe(2);
    expect(cache.size).toBe(2);
  });

  it("delete removes an entry", () => {
    const c = new BoundedCache<string, number>({ maxEntries: 5, ttlMs: 1000 });
    c.set("a", 1);
    expect(c.delete("a")).toBe(true);
    expect(c.get("a")).toBeUndefined();
    expect(c.delete("a")).toBe(false);
  });
});
