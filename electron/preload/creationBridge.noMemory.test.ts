import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));

import { creationBridge } from "./creationBridge";

const electronDir = path.resolve(__dirname, "..");

describe("项目记忆整份删除：渲染层看不到、主进程也没有对应通道", () => {
  it("预载桥上没有 memory 一节", () => {
    expect(Object.keys(creationBridge)).not.toContain("memory");
  });

  it("主进程入口和预载入口里没有 nomi:memory: 通道，也没有 memory 模块目录", () => {
    // 只读固定的几个文件（通道的登记处和桥的出口），不遍历仓库。
    for (const file of ["main.ts", "preload.ts", "preload/creationBridge.ts"]) {
      const source = fs.readFileSync(path.join(electronDir, file), "utf8");
      expect(source, file).not.toContain("nomi:memory:");
      expect(source, file).not.toContain("registerMemoryIpc");
    }
    expect(fs.existsSync(path.join(electronDir, "memory"))).toBe(false);
  });
});
