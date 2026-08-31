import { describe, expect, it } from "vitest";
import { normalizeProviderProxyUrl, providerDispatcher, providerProxyUrl } from "./providerNetwork";

describe("provider-specific network routes", () => {
  it("normalizes supported HTTP and SOCKS routes while leaving blank routes absent", () => {
    expect(normalizeProviderProxyUrl(" 127.0.0.1:7897 ")).toBe("http://127.0.0.1:7897");
    expect(normalizeProviderProxyUrl("socks5://127.0.0.1:7897")).toBe("socks5://127.0.0.1:7897");
    expect(providerProxyUrl({ network: { proxyUrl: "" } })).toBeUndefined();
  });

  it("rejects unsupported provider routes before any request can be sent", () => {
    expect(() => normalizeProviderProxyUrl("ftp://127.0.0.1:21")).toThrow("Invalid provider proxy URL");
  });

  it("creates an isolated dispatcher only for a configured provider", async () => {
    expect(providerDispatcher({})).toBeUndefined();
    const dispatcher = providerDispatcher({ network: { proxyUrl: "http://127.0.0.1:7897" } });
    expect(dispatcher).toEqual(
      expect.objectContaining({ dispatch: expect.any(Function) }),
    );
    await dispatcher?.close();
  });
});
