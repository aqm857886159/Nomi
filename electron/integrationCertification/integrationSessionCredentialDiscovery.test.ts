/**
 * 「存好 key 之后还要自己手打 model id」（2026-09-12 真实接入验收 P0-2）的机器回归。
 *
 * 为什么测在 IPC 这一层而不是 service：propose 一直会发现模型，坏的从来不是发现本身，而是
 * **Nomi 自己的界面这道门根本没走那一步**——UI 存完 key 就收工，会话停在 draft、候选恒空。
 * 只测 service 的用例会全绿，而用户的处境一点没变。这条把「存 key 这一步就得把权威清单带回来」
 * 钉在那道门上。
 *
 * 同一条路的真实网络证据（DeepSeek 官方免费 GET /models）记在 PR 里；这里用桩，CI 不联网、不花钱。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-09-21：测试不许读写用户真实目录。这份文件此前经默认路径读到了**用户本人的**
// `~/.nomi/capability-core`（token / 签名密钥 / 接入会话 / handoff 队列都住那里）——
// 读到的是真人数据，写下去就是改真人数据，而且一台机器一个结果：`mcpOnboardingLoopback`
// 就是这么在这台机器上红、在别处绿的。给它一个本轮独有的空目录。
const capabilityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cred-discovery-cap-"));
beforeEach(() => {
  vi.stubEnv("NOMI_CAPABILITY_DIR", capabilityRoot);
});

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const harness = vi.hoisted(() => {
  class FakeWebContents {
    readonly id = 1;
    readonly mainFrame = { routingId: 7 };
    url = "file:///app/index.html";
    isDestroyed(): boolean {
      return false;
    }
    getURL(): string {
      return this.url;
    }
  }
  class FakeBrowserWindow {
    static byContents = new Map<FakeWebContents, FakeBrowserWindow>();
    static nextId = 1;
    readonly id = FakeBrowserWindow.nextId++;
    readonly webContents = new FakeWebContents();
    constructor() {
      FakeBrowserWindow.byContents.set(this.webContents, this);
    }
    isDestroyed(): boolean {
      return false;
    }
    once(): void {
      /* the probe never closes a window */
    }
    static fromWebContents(contents: FakeWebContents): FakeBrowserWindow | null {
      return FakeBrowserWindow.byContents.get(contents) ?? null;
    }
  }
  return { FakeBrowserWindow };
});

vi.mock("electron", async () => {
  const base = (await vi.importActual("electron")) as Record<string, unknown>;
  return {
    ...base,
    BrowserWindow: harness.FakeBrowserWindow,
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: () => undefined,
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    // 真机上 safeStorage 可用；默认桩返回 false 会让 saveCredential 在写库前就拒绝。
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, "utf-8"),
      decryptString: (value: Buffer) => value.toString("utf-8"),
    },
  };
});

import { setMainWindow } from "../appWindowRegistry";
import { createRuntimeIntegrationSessionService } from "./integrationSession";
import { registerIntegrationSessionIpc } from "./integrationSessionIpc";

const CREDENTIAL = "nomi:integration-session:credential";

type Projection = {
  id: string;
  revision: number;
  stage: string;
  candidates?: Array<{ modelKey: string; kind: string }>;
  blockingReason?: { code: string };
  credentialStatus?: string;
};

function install(
  discovered: Array<{ modelKey: string; label: string; kind: string; modes: string[] }> | Error,
  owner: "nomi" | "codex" = "nomi",
) {
  const window = new harness.FakeBrowserWindow();
  setMainWindow(window as never);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-credential-discovery-"));
  const discoverHttpModels = vi.fn(async () => {
    if (discovered instanceof Error) throw discovered;
    return discovered;
  });
  const service = createRuntimeIntegrationSessionService({
    filePath: path.join(dir, "sessions.json"),
    certification: { discoverHttpModels } as never,
    runTask: (async () => {
      throw new Error("unused");
    }) as never,
    fetchTaskResult: (async () => {
      throw new Error("unused");
    }) as never,
    mintSpendGrant: (() => {
      throw new Error("unused");
    }) as never,
  } as never);
  registerIntegrationSessionIpc(service);
  const session = service.begin(
    {
      kind: "http-api-provider",
      name: "Provider",
      baseUrl: `https://api.example-${path.basename(dir)}.test`,
      providerKind: "openai-compatible",
      authType: "bearer",
    },
    owner,
  );
  const event = { sender: window.webContents, senderFrame: { routingId: 7, url: window.webContents.getURL() } };
  const save = (apiKey: string) =>
    handlers.get(CREDENTIAL)?.(event, {
      sessionId: session.id,
      expectedRevision: session.revision,
      apiKey,
    }) as Promise<Projection>;
  return { discoverHttpModels, save, session };
}

describe("saving an onboarding key discovers models in the same step", () => {
  beforeEach(() => {
    handlers.clear();
    harness.FakeBrowserWindow.byContents.clear();
  });

  it("returns the provider's authoritative list, so nobody has to type a model id", async () => {
    const { discoverHttpModels, save } = install([
      { modelKey: "provider-flash", label: "provider-flash", kind: "text", modes: ["chat"] },
      { modelKey: "provider-pro", label: "provider-pro", kind: "text", modes: ["chat"] },
    ]);
    const projection = await save("sk-probe-key");
    expect(discoverHttpModels).toHaveBeenCalledTimes(1);
    expect(projection.stage).toBe("needs_selection");
    expect((projection.candidates || []).map((candidate) => candidate.modelKey)).toEqual([
      "provider-flash",
      "provider-pro",
    ]);
    // 凭据只走这道门，投影里一个字都不带。
    expect(JSON.stringify(projection)).not.toContain("sk-probe-key");
  });

  // 交接单那条路：MCP 客户端提出会话，用户在 Nomi 的安全页手填 key。写 key 的是 nomi，
  // 会话的 owner 是那个客户端——发现模型必须按**会话自己的身份**跑，否则 key 落地那一刻
  // 就是一句 owner mismatch（mcp-l2-journeys C7 实测过）。
  it("外部客户端提出的会话，用户在 Nomi 写完 key 一样就地发现模型", async () => {
    const { discoverHttpModels, save } = install([
      { modelKey: "relay-flash", label: "relay-flash", kind: "text", modes: ["chat"] },
    ], "codex");
    const projection = await save("sk-probe-key");
    expect(discoverHttpModels).toHaveBeenCalledTimes(1);
    expect(projection.stage).toBe("needs_selection");
    expect((projection.candidates || []).map((candidate) => candidate.modelKey)).toEqual(["relay-flash"]);
  });

  // 存 key 是用户亲手做的那件事；替他多读一次模型清单是我们加的那一步。
  // 后者失败不许把前者说成失败——2026-09-17 CI 的 mcp-l2-journeys C7 就是这么红的
  //（中转站没有 /models 接口 → 整条存 key 被判失败）。
  it("发现失败不把「key 已经存好」说成失败，只记一条阻塞原因", async () => {
    const { save } = install(new Error("中转站没有可用的 /models 接口"));
    const projection = await save("sk-probe-key");
    expect(projection.blockingReason?.code).toBe("model_discovery_unavailable");
    expect(projection.credentialStatus).toBe("ready");
  });

  it("says why when the provider lists nothing, instead of handing back a silently empty picker", async () => {
    const { save } = install([]);
    const projection = await save("sk-probe-key");
    expect(projection.candidates || []).toHaveLength(0);
    expect(projection.blockingReason?.code).toBe("model_discovery_empty");
  });
});
