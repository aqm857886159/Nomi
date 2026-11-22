// 冻结主人命名空间（D-test-world-owner-only C'）：测试时给主人模块末尾注入「自引用后 Object.freeze」。
// 冻住之后 `vi.spyOn(命名空间, …)` 和 `Object.defineProperty(命名空间, …)` 都抛，结构上做不出来；
// 只在 vitest 里装（vitest.config.ts 的 plugins），不进产品构建。
import path from "node:path";
import { isOwnerModule } from "./ownerModules";

const SCRIPT = /\.[cm]?[jt]sx?$/;

export function ownerFreezePlugin() {
  return {
    name: "nomi-world-freeze-owner-namespace",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?")[0];
      if (!SCRIPT.test(file) || file.includes("/node_modules/")) return null;
      if (!isOwnerModule(file, code)) return null;
      const self = `./${path.basename(file)}`;
      return {
        code: `${code}\nimport * as __nomiOwnerNamespace from ${JSON.stringify(self)};\nObject.freeze(__nomiOwnerNamespace);\n`,
        map: null,
      };
    },
  };
}
