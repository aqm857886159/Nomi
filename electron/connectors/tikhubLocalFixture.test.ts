import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getTikhubTestOrigin, resolveShareVideo, TikhubConnectorError } from "./tikhubConnector";
import { imageEditGuardError } from "../catalog/taskParams";

const servers: http.Server[] = [];
const previousEnv = {
  e2e: process.env.NOMI_E2E,
  origin: process.env.NOMI_TIKHUB_TEST_ORIGIN,
};

async function startLocalServer(handler: (request: http.IncomingMessage, response: http.ServerResponse) => void): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

function useLocalOrigin(origin: string): string {
  process.env.NOMI_E2E = "1";
  process.env.NOMI_TIKHUB_TEST_ORIGIN = origin;
  return new URL(origin).host;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  if (previousEnv.e2e === undefined) delete process.env.NOMI_E2E;
  else process.env.NOMI_E2E = previousEnv.e2e;
  if (previousEnv.origin === undefined) delete process.env.NOMI_TIKHUB_TEST_ORIGIN;
  else process.env.NOMI_TIKHUB_TEST_ORIGIN = previousEnv.origin;
});

describe("TikHub local upstream contract", () => {
  it("N: refuses a malformed or non-E2E test origin before any network call", () => {
    process.env.NOMI_TIKHUB_TEST_ORIGIN = "http://127.0.0.1:43100";
    expect(() => getTikhubTestOrigin()).toThrow(/E2E/);

    process.env.NOMI_E2E = "1";
    process.env.NOMI_TIKHUB_TEST_ORIGIN = "not a URL";
    expect(() => getTikhubTestOrigin()).toThrow(/无效/);
  });

  it("keeps the runtime-fixed image understanding path open for its real reference frames", () => {
    expect(imageEditGuardError(
      "image_to_prompt",
      { extras: { referenceImages: ["nomi-local://project/frame.png"] } },
      false,
      "本地拆解视觉模型",
    )).toBeNull();
  });

  it("resolves the same share-link result through a local HTTP upstream", async () => {
    const requests: string[] = [];
    const server = http.createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        code: 200,
        data: { original_video_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture.mp4` },
      }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const host = `127.0.0.1:${(server.address() as { port: number }).port}`;
    process.env.NOMI_E2E = "1";
    process.env.NOMI_TIKHUB_TEST_ORIGIN = `http://${host}`;

    const result = await resolveShareVideo("https://v.douyin.com/local-fixture/", "fixture-key", {
      resolveHost: async () => host,
    });

    expect(result).toMatchObject({
      platform: "douyin",
      playUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture.mp4`,
    });
    expect(requests).toEqual([expect.stringContaining("fetch_video_high_quality_play_url")]);
  });

  it("E: closes the real resolver boundary on upstream 401 and 404", async () => {
    const origin = await startLocalServer((_request, response) => {
      response.statusCode = 401;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ code: 401, message: "fixture auth failure" }));
    });
    const host = useLocalOrigin(origin);
    await expect(resolveShareVideo("https://v.douyin.com/local-fixture/", "bad-key", {
      resolveHost: async () => host,
      failover: async () => null,
    })).rejects.toMatchObject({ kind: "auth", status: 401 });

    const notFoundOrigin = await startLocalServer((_request, response) => {
      response.statusCode = 404;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ code: 404, message: "fixture not found" }));
    });
    const notFoundHost = useLocalOrigin(notFoundOrigin);
    await expect(resolveShareVideo("https://v.douyin.com/local-fixture/", "fixture-key", {
      resolveHost: async () => notFoundHost,
      failover: async () => null,
    })).rejects.toMatchObject({ kind: "not-found", status: 404 });
  });

  it("B: rejects a successful envelope that contains no playable URL", async () => {
    const requests: string[] = [];
    const origin = await startLocalServer((request, response) => {
      requests.push(request.url || "");
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ code: 200, data: {} }));
    });
    const host = useLocalOrigin(origin);
    await expect(resolveShareVideo("https://v.douyin.com/local-fixture/", "fixture-key", {
      resolveHost: async () => host,
      failover: async () => null,
    })).rejects.toMatchObject({ kind: "no-play-url" });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain("fetch_one_video_by_share_url");
  });

  it("T/N: turns timeout/network failures and an invalid test origin into fail-closed errors", async () => {
    const origin = await startLocalServer(() => {});
    const host = useLocalOrigin(origin);
    await expect(resolveShareVideo("https://v.douyin.com/local-fixture/", "fixture-key", {
      resolveHost: async () => host,
      fetchJson: async () => { throw new TikhubConnectorError("upstream", "fixture timeout"); },
      failover: async () => null,
    })).rejects.toMatchObject({ kind: "no-route" });

    process.env.NOMI_TIKHUB_TEST_ORIGIN = "https://not-loopback.example.test";
    await expect(resolveShareVideo("https://v.douyin.com/local-fixture/", "fixture-key", {
      resolveHost: async () => "api.tikhub.io",
    })).rejects.toMatchObject({ kind: "bad-response" });
  });
});
