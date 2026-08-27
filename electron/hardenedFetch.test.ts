import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hardenedFetch, type ResolvedHostAddress } from "./hardenedFetch";

let server: http.Server;
let baseUrl = "";
let redirectedTargetRequests = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/view" });
      res.end();
      return;
    }
    if (req.url === "/view") redirectedTargetRequests += 1;
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(Buffer.from([1, 2, 3]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

describe("hardenedFetch 私网边界", () => {
  it("默认继续拒绝 loopback", async () => {
    await expect(hardenedFetch(`${baseUrl}/view`)).rejects.toThrow("private/loopback");
  });

  it("只允许显式配置的精确 origin", async () => {
    await expect(hardenedFetch(`${baseUrl}/view`, { allowedPrivateOrigins: [baseUrl] })).resolves.toMatchObject({
      status: 200,
      contentType: "image/png",
    });
    await expect(
      hardenedFetch(`${baseUrl}/view`, { allowedPrivateOrigins: ["http://127.0.0.1:1"] }),
    ).rejects.toThrow("private/loopback");
  });

  it("私网显式授权仍在第一跳拒绝重定向，不访问跳转目标", async () => {
    redirectedTargetRequests = 0;
    await expect(
      hardenedFetch(`${baseUrl}/redirect`, { allowedPrivateOrigins: [baseUrl] }),
    ).rejects.toThrow(/redirect/i);
    expect(redirectedTargetRequests).toBe(0);
  });

  it("rejects DNS resolutions that include metadata/private addresses", async () => {
    const fetchImpl = vi.fn();
    await expect(hardenedFetch("https://media.example.test/a.png", {}, {
      resolveHost: async () => [{ address: "169.254.169.254", family: 4 }],
      fetch: fetchImpl,
    })).rejects.toThrow("private/loopback");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pins the validated DNS answer so fetch cannot resolve the hostname a second time", async () => {
    const resolveHost = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const dispatcher = { close: vi.fn(async () => {}) };
    const createPinnedDispatcher = vi.fn(() => dispatcher as never);
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBe(dispatcher);
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });

    await expect(hardenedFetch("https://media.example.test/a.png", {}, {
      resolveHost,
      createPinnedDispatcher,
      fetch: fetchImpl,
    })).resolves.toMatchObject({ status: 200 });
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(createPinnedDispatcher).toHaveBeenCalledWith("media.example.test", [{ address: "93.184.216.34", family: 4 }]);
    expect(dispatcher.close).toHaveBeenCalledTimes(1);
  });

  it("revalidates and repins every public redirect hop", async () => {
    const resolveHost = vi.fn(async (hostname: string): Promise<ResolvedHostAddress[]> => hostname === "one.example.test"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "169.254.169.254", family: 4 }]);
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://two.example.test/secret" },
    }));

    await expect(hardenedFetch("https://one.example.test/start", {}, {
      resolveHost,
      createPinnedDispatcher: () => ({ close: async () => {} }) as never,
      fetch: fetchImpl,
    })).rejects.toThrow("private/loopback");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolveHost).toHaveBeenCalledTimes(2);
  });
});
