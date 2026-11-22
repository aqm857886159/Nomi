// 反例：vi.mock 换掉主人模块。
import { expect, it, vi } from "vitest";

vi.mock("../../../electron/catalog/catalogStore", () => ({ readCatalog: () => ({ vendors: [], models: [], mappings: [] }) }));

it("mock 了目录主人", async () => {
  const mod = await import("../../../electron/catalog/catalogStore");
  expect(typeof mod.readCatalog).toBe("function");
});
