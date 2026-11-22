// 反例：vi.doMock 换掉主人模块（和 vi.mock 是两条路，锁要两条都拦）。
import { expect, it, vi } from "vitest";

it("doMock 了项目主人", () => {
  vi.doMock("../../../electron/projects/repository", () => ({ saveProject: async () => ({}) }));
  expect(true).toBe(true);
});
