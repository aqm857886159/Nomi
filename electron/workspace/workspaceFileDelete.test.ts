import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
  trashed: [] as string[],
  broadcast: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => mocks.handlers.set(channel, handler) },
  shell: {
    trashItem: async (target: string) => {
      mocks.trashed.push(target);
      fs.rmSync(target, { force: true });
    },
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedUiSender: () => undefined }));
vi.mock("../assets/assetEvents", () => ({ broadcastAssetsUpdated: mocks.broadcast }));

import { registerWorkspaceFileDeleteIpc } from "./workspaceFileDelete";

const roots: string[] = [];

function projectRoot(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-workspace-file-delete-test-"));
  roots.push(root);
  for (const relativePath of files) {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(root, relativePath), "x");
  }
  return root;
}

function deleteFiles(root: string, relativePaths: string[]): Promise<unknown> {
  registerWorkspaceFileDeleteIpc({ readProject: () => ({ lastKnownRootPath: root }), childWindowProject: () => undefined });
  const handler = mocks.handlers.get("nomi:workspace:delete-files");
  if (!handler) throw new Error("delete-files handler was not registered");
  return handler({ sender: {} }, { projectId: "p1", relativePaths });
}

beforeEach(() => {
  mocks.handlers.clear();
  mocks.trashed.length = 0;
  mocks.broadcast.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace delete-files", () => {
  it("trashes the file with its sidecar and tells every list the project's assets changed", async () => {
    const root = projectRoot(["assets/imported/a.png", "assets/imported/a.png.meta"]);

    await expect(deleteFiles(root, ["assets/imported/a.png"])).resolves.toEqual({ ok: true, deletedCount: 1, failedCount: 0 });

    expect(mocks.trashed.map((target) => path.relative(root, target).split(path.sep).join("/"))).toEqual(["assets/imported/a.png", "assets/imported/a.png.meta"]);
    // 删除和写入走同一个信号：素材库两个页签与「所有项目」清单都靠它刷新，调用方不必各自手动重拉。
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).toHaveBeenCalledWith("p1");
  });

  it("does not announce a change when nothing was deleted", async () => {
    const root = projectRoot([]);

    await expect(deleteFiles(root, ["assets/imported/missing.png"])).resolves.toEqual({ ok: false, deletedCount: 0, failedCount: 1 });

    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
