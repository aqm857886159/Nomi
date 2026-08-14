import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

import { runCustomCallScript } from "./customCallRunner";
import type { Model, Vendor } from "./types";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("没有文档时的真实 HTTP 试跑", () => {
  it("使用当前第二密钥和真实参考参数，识别嵌套响应，并从 transcript 脱敏所有凭证", async () => {
    const received: Array<{ url: string; secret: string; body: unknown }> = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      received.push({ url: req.url || "", secret: String(req.headers["x-secret"] || ""), body });
      res.setHeader("Content-Type", "application/json");
      // 私有平台常见：成功产物套在 data 数组里，同时把调试参数原样回显。
      res.end(JSON.stringify({
        data: [{ url: "https://cdn.private.example/result.png" }],
        debug: { echoedSecret: req.headers["x-secret"], echoedToken: body.token },
      }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const outcome = await runCustomCallScript({
      vendor: { key: "private", name: "Private", baseUrlHint: baseUrl, enabled: true } as Vendor,
      model: { vendorKey: "private", modelKey: "undocumented-edit", kind: "image", enabled: true } as Model,
      apiKey: "primary-key-123",
      customConfig: { api_secret: "secondary-secret-456", tenant_token: "tenant-token-789" },
      prompt: "keep the character",
      params: { reference_image_urls: ["https://cdn/input-a.png", "https://cdn/input-b.png"] },
      script: `return await request({
  method: 'POST',
  url: '/generate',
  headers: { 'Content-Type': 'application/json', 'X-Secret': config.api_secret },
  body: { prompt, images: references.images, token: config.tenant_token },
})`,
    });

    expect(received).toEqual([{
      url: "/generate",
      secret: "secondary-secret-456",
      body: {
        prompt: "keep the character",
        images: ["https://cdn/input-a.png", "https://cdn/input-b.png"],
        token: "tenant-token-789",
      },
    }]);
    expect(outcome.assets).toEqual(["https://cdn.private.example/result.png"]);
    expect(outcome.transcript).toHaveLength(1);
    expect(outcome.transcript[0].requestPreview).not.toContain("tenant-token-789");
    expect(outcome.transcript[0].responsePreview).not.toContain("secondary-secret-456");
    expect(outcome.transcript[0].responsePreview).not.toContain("tenant-token-789");
    expect(outcome.transcript[0].responsePreview).toContain("•••");
  });
});
