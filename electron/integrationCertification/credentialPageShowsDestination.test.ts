// 贴 key 页必须把「这把 key 要去哪」摆在用户眼前——**包括私网地址**。
//
// 为什么这条测试值一个自己的家：本刀的整条不变量是「密钥只去用户亲眼确认过的那个 origin」
// （§6.1）。「亲眼确认」是用户那一侧的前提：他看不到地址，保存那一下就不是确认，而不变量在
// 他身上就不成立。方案 §3 发现 10 说这条对 LAN 用户是破的（`safeHandoffOrigin` 剥私网 origin），
// Q11 因此拍板「显示」。
//
// 2026-09-18 实测的结论与那条发现**不一致**，所以这里把事实钉下来，而不是照着发现去改代码：
//   · 真正**收密钥的那一页**（MCP URL elicitation 的一次性本机页）显示的是
//     `descriptor.display.baseUrl`，它直接来自会话 config，**没有任何私网剥离**——LAN 用户看得见。
//   · `safeHandoffOrigin` 剥掉的是**另一样东西**：交接单里那条把 Nomi GUI 叫到前台、预填设置面板的
//     导航提示。那里的剥离是**承重的**：`handoffQueue.normalizeDisplayOrigin` 对私网 origin 直接抛
//     「Private handoff origin requires authorization」（它自己的注释写着：交接单同时是导航提示，
//     私网目标不许从这条队列夹带进去）。把它改成「照原样显示」会让本地 ComfyUI / LAN 中转
//     **连安全页都打不开**。
//
// 所以 Q11 在收密钥那一页上**本来就已经成立**；要动的那个剥离属于另一条边界（交接队列的安全判定），
// 不在本刀范围内。这条测试保证「已经成立」这件事不会被将来某次改动悄悄拿走。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCredentialElicitationStore, withCredentialElicitationTicket } from "./credentialElicitation";
import { handleIntegrationCredentialHttpRequest } from "./credentialElicitationHttp";
import { safeHandoffOrigin } from "./integrationHandoffOrigin";

const LAN_BASE_URL = "http://192.168.1.20:8000/v1";

async function renderCredentialPage(baseUrl: string): Promise<{ status: number; html: string }> {
  const store = createCredentialElicitationStore({
    originResolver: () => "http://127.0.0.1:45999",
    now: () => Date.now(),
  } as never);
  const ticketed = withCredentialElicitationTicket(
    { id: "integration-lan", kind: "http-api-provider", config: { name: "LAN relay", baseUrl, authType: "bearer" } } as never,
    store as never,
  ) as { credentialEntry?: { url?: string } };
  const token = new URL(String(ticketed.credentialEntry?.url)).searchParams.get("t");
  let status = 0;
  let html = "";
  const res = {
    writeHead: (code: number) => { status = code; return res; },
    end: (chunk?: string) => { html = String(chunk ?? ""); },
    setHeader: () => res,
  };
  await handleIntegrationCredentialHttpRequest(
    { method: "GET", url: `/integration-credential?t=${token}` } as never,
    res as never,
    { store, testCredential: async () => 0, saveCredential: async () => undefined, locale: () => "zh-CN" } as never,
  );
  return { status, html };
}

describe("贴 key 页把「这把 key 要去哪」摆出来", () => {
  beforeEach(() => {
    vi.stubEnv("NOMI_CAPABILITY_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "nomi-credential-page-")));
  });

  it("私网（LAN 中转 / 本地 ComfyUI）地址也原样显示——否则「亲眼确认」在这些用户身上不成立", async () => {
    const { status, html } = await renderCredentialPage(LAN_BASE_URL);
    expect(status).toBe(200);
    expect(html).toContain("192.168.1.20:8000");
  });

  it("【阳性对照】公网地址同样显示（这条判据不是「一律显示什么都行」）", async () => {
    const { html } = await renderCredentialPage("https://api.relay.example/v1");
    expect(html).toContain("api.relay.example");
  });

  it("safeHandoffOrigin 剥的是另一样东西：GUI 导航提示，不是收密钥那一页", () => {
    // 公网 origin 进得了交接单；私网的被剥成空对象——而这正是 handoffQueue 的要求，
    // 不是收密钥那一页的行为。两者混为一谈会把「用户看不见地址」这个结论安到错误的地方。
    expect(safeHandoffOrigin("https://api.relay.example/v1")).toEqual({ origin: "https://api.relay.example" });
    expect(safeHandoffOrigin(LAN_BASE_URL)).toEqual({});
  });
});
