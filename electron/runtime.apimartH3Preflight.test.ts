import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeEach(() => {
  mockedUserDataRoot = makeTempDir("nomi-runtime-apimart-h3-preflight-");
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const spend = await import("./spendGrant");
  spend.__resetSpendGrantsForTests();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function seedApimartH3(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.ensureBuiltinModelSeeds();
  store.upsertModelCatalogVendorApiKey("apimart", { apiKey: "sk-test" });
}

describe("runTask MiniMax H3 preflight", () => {
  it("rejects mixed frame/reference input before local asset upload, vendor fetch, or spend", async () => {
    await seedApimartH3();
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const { runTask } = await import("./runtime");
    const { __spendGrantCountForTests, mintSpendGrant } = await import("./spendGrant");
    const grantId = mintSpendGrant({ nodeIds: ["h3-node"], maxAttemptsPerNode: 1 });

    const error = await runTask({
      vendor: "apimart",
      request: {
        kind: "image_to_video",
        prompt: "把办公室里的画面动起来",
        extras: {
          modelKey: "MiniMax-H3",
          nodeId: "h3-node",
          grantId,
          firstFrameUrl: "nomi-local://first-frame",
          referenceImages: ["nomi-local://reference-image"],
        },
      },
    }).catch((value) => value as Error);

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/首尾帧.*参考素材/);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(__spendGrantCountForTests()).toBe(1);
  }, 15_000);

  it("preserves a valid UI first-frame projection without synthesizing image_urls", async () => {
    await seedApimartH3();
    const fetchFn = vi.fn(async (_input: unknown, _init?: { body?: string }) => new Response(JSON.stringify({ code: 200, data: [{ task_id: "h3-task" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const { runTask } = await import("./runtime");
    const { mintSpendGrant } = await import("./spendGrant");
    const result = await runTask({
      vendor: "apimart",
      request: {
        kind: "image_to_video",
        prompt: "让首帧里的办公室动起来",
        extras: {
          modelKey: "MiniMax-H3",
          nodeId: "h3-node",
          grantId: mintSpendGrant({ nodeIds: ["h3-node"], maxAttemptsPerNode: 1 }),
          firstFrameUrl: "https://cdn.example.com/first.png",
          archetypeInput: { first_frame_image: "https://cdn.example.com/first.png" },
        },
      },
    });

    expect(result.status).toBe("queued");
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body || "{}")) as Record<string, unknown>;
    expect(body.first_frame_image).toBe("https://cdn.example.com/first.png");
    expect(body).not.toHaveProperty("image_urls");
  }, 15_000);
});
