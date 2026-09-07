// 影子期的**机器判据**（方案 §4.1 / §8.1 规则 O6：开发期不可达）。
//
// P1 禁的是「同一件事有两条用户走得到的路」。阶段 1 新通路用户走不到，所以用户仍然只有一条路。
// 但「走不到」必须是可验的，不能是一句承诺——承诺会在下一个人手快接了根线的时候悄悄失效，
// 而那一刻起我们就有两条活路径了，谁都不会注意到。
//
// 手法与同目录外的 `projectAgentHost/projectAgentCutoverStructure.test.ts:40`
// （断言 `main.ts` 不含 `registerAgentChatV2Ipc`）同源——那条断言证明了这个手法在本仓行得通。
// 切换 PR 会把本文件整个删掉：那时新通路**应该**在 `main.ts` 里。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("agent lane shadow period", () => {
  it("keeps the new lane unreachable: no IPC registration, no preload surface, no bridge field", () => {
    expect(source("electron/main.ts")).not.toContain("registerAgentLaneIpc");
    expect(source("electron/preload.ts")).not.toContain("nomi:agent-lane:");
    expect(source("src/desktop/bridge.ts")).not.toContain("agentLane");
  });

  it("keeps the old path untouched: the shadow slice adds files, it does not edit the live one", () => {
    // 旧通路仍然是用户唯一走得到的那条。它的三个 owner 文件里不许出现新通路的任何符号——
    // 一旦出现，就说明有人开始「两边都改一点」，那正是并行版的第一天。
    for (const file of [
      "electron/projectAgentHost/projectAgentIpc.ts",
      "electron/harness/runtime/pi/run.mts",
      "src/workbench/ai/v4/useAgentPanelV4Data.ts",
    ]) {
      expect(source(file)).not.toContain("agentLane");
      expect(source(file)).not.toContain("laneViewModel");
    }
  });

  it("keeps the renderer lane client dependency-injected, so nothing reaches window by accident", () => {
    const client = source("src/workbench/ai/lane/laneClient.ts");
    // `window` 只在一个地方出现，就是那个解析器；其余全部走参数注入。
    // 这条同时是「今天就能被真正测到」的保证：桥是参数，测试不用假装自己是浏览器。
    expect(client.match(/nomiDesktop/g)?.length).toBe(2);
    expect(client).toContain("resolveLaneBridge");
  });
});
