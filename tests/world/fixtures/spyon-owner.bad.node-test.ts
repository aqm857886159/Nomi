// 反例：spyOn 主人命名空间。主人命名空间已被冻结，做不出来。
import { expect, it, vi } from "vitest";
import * as repository from "../../../electron/projects/repository";

it("spyOn(projectRepository, 'saveProject')", () => {
  vi.spyOn(repository, "saveProject");
  expect(true).toBe(true);
});
