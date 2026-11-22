// 测试世界的全局启动：在主进程里取出「主人存盘文件名」（产品里已有的两张表），交给每个测试进程的写盘锁。
// 为什么不在 setup 里直接 import：setup 文件和测试共用模块图，先加载产品模块会让后面测试里的 vi.mock / vi.resetModules 落空。
// 主进程只在这里加载一次，测试进程里只收到一份名字数组。
import type { TestProject } from "vitest/node";
import { OWNER_FILE_NAMES } from "../world/ownerFiles";

declare module "vitest" {
  export interface ProvidedContext {
    worldOwnerFileNames: string[];
  }
}

export default function setup(project: TestProject): void {
  project.provide("worldOwnerFileNames", [...OWNER_FILE_NAMES].sort());
}
