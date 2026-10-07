/**
 * 对等测试共用的 Electron 桩工厂。
 *
 * 为什么不用 `tests/stubs/electron.ts`（vitest 的全局 alias）：那份的 `safeStorage.isEncryptionAvailable()`
 * 返回 false，于是 `upsertModelCatalogVendorApiKey` 在「系统安全存储不可用」上抛——
 * 而对等矩阵必须存进一把**真密文**的钥匙（2026-09-21 实测：`enc:'plain'` 只算 needs_resave，
 * 主进程能跑、渲染层判不可用，画布上会冒出一句假的「模型当前不可用」）。
 *
 * 每个测试文件各自 `vi.mock("electron", () => electronStub())`——`vi.mock` 的工厂被提升，
 * 不能引用外层变量，所以工厂本身必须自给自足。
 */
export function electronStub(root: string): Record<string, unknown> {
  const noop = (): undefined => undefined;
  return {
    app: {
      getPath: () => root,
      getAppPath: () => process.cwd(),
      getName: () => "nomi",
      getVersion: () => "0.0.0-test",
      on: noop,
      whenReady: () => Promise.resolve(),
      quit: noop,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    ipcMain: { handle: noop, on: noop, removeHandler: noop },
    BrowserWindow: class { static getAllWindows(): unknown[] { return []; } },
    shell: { openExternal: async () => undefined, openPath: async () => "" },
    net: { request: noop },
    protocol: { handle: noop, registerSchemesAsPrivileged: noop },
    webContents: { getAllWebContents: () => [] },
    session: { defaultSession: undefined },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    crashReporter: { start: noop },
  };
}
