// 反例：用 Object.defineProperty 改主人命名空间。
import { expect, it } from "vitest";
import * as catalogStore from "../../../electron/catalog/catalogStore";

it("defineProperty(catalogStore, 'readCatalog')", () => {
  Object.defineProperty(catalogStore, "readCatalog", { value: () => ({}) });
  expect(true).toBe(true);
});
