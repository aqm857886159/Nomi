/**
 * 独立进程那个宿主交给生成装配工厂的端口，取真的那一份来量。
 *
 * 这个宿主没有窗口、没有画布：派发前「落画布」这一步必须拒（Run 停在 landing_failed，请用户在 Nomi 里打开项目）。
 * 以前量这句话的测试是自己搭一个端口，没经过这个宿主；宿主里那一行被改成「不拒」时没有任何单测会红
 * （独立验收 2026-11-22 试出来的）。应用关着时这个宿主要是不拒，就会在没有画布可落的情况下把付费请求发出去。
 *
 * 做法：真的跑 `startMcpStdioServer`，只把工厂换成「记下宿主交来的端口，然后停在这里」。
 * 端口是宿主文件里写的那一份，一个字没重搭。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationHostPorts } from "./generationDomain";
import { LandingProjectNotOpenError } from "../productionRun/landingProjectAccess";

const STOP_AFTER_PORTS = "stop-after-capturing-host-ports";
const seen = vi.hoisted(() => ({ ports: undefined as unknown }));

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    app: { dock: { hide: () => undefined }, getLocale: () => "zh-CN", getPath: () => "/tmp/nomi-stdio-ports-test", isPackaged: false, on: () => undefined },
    safeStorage: { setUsePlainTextEncryption: () => undefined, isEncryptionAvailable: () => false },
    session: { defaultSession: {} },
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
  };
});
vi.mock("./generationDomain", () => ({
  createGenerationDomain: (ports: unknown) => {
    seen.ports = ports;
    throw new Error(STOP_AFTER_PORTS);
  },
}));
vi.mock("../productionRun/productionRunRuntime", () => ({ getProductionRunService: () => ({ repository: {} }) }));
vi.mock("../productionRun/artifactPreviewHttpServer", () => ({
  startArtifactPreviewHttpServer: async () => ({ close: async () => undefined }),
  withAssetPreview: (value: unknown) => value,
}));
vi.mock("../integrationCertification/credentialElicitationServer", () => ({ startCredentialElicitationServer: async () => undefined }));
vi.mock("../integrationCertification/integrationSessionRuntimeInstall", () => ({ installIntegrationSessionRuntime: () => undefined }));
vi.mock("../systemProxy", () => ({ applySystemProxy: async () => undefined }));
vi.mock("../proxySettings", () => ({ readProxyPrefs: () => ({}) }));
vi.mock("./modelSpecRead", async (importOriginal) => ({ ...await importOriginal<Record<string, unknown>>(), installCatalogRowLookup: () => undefined }));
vi.mock("./appIntegrationAuthorities", () => ({ createDefaultAuthorities: () => ({ projectRevisionResolver: () => 1 }) }));
vi.mock("../workspace/workspaceRepository", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  readWorkspaceProject: (projectId: string) => ({ id: projectId, name: "纸鹤" }),
}));
vi.mock("../runtimePaths", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getWorkspaceRepositoryDeps: () => ({}),
}));

// 宿主启动时会把 console.* 改到 stderr（stdout 是协议通道）；测试跑完换回来。
const consoleBefore = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };

beforeEach(() => { seen.ports = undefined; });
afterEach(() => { Object.assign(console, consoleBefore); });

async function portsHandedByStdioHost(): Promise<GenerationHostPorts> {
  const { startMcpStdioServer } = await import("./mcpStdioServer");
  await expect(startMcpStdioServer()).rejects.toThrow(STOP_AFTER_PORTS);
  expect(seen.ports, "宿主没有调生成装配工厂").toBeTruthy();
  return seen.ports as GenerationHostPorts;
}

describe("独立进程宿主交给工厂的端口", () => {
  it("没有渲染层：落画布必拒，并点名要打开哪个项目", async () => {
    const ports = await portsHandedByStdioHost();

    expect(ports.renderer).toBeNull();
    const landing = ports.landShots("project-1", [] as never);
    await expect(landing).rejects.toBeInstanceOf(LandingProjectNotOpenError);
    await expect(landing).rejects.toMatchObject({ projectId: "project-1", projectName: "纸鹤" });
  });
});
