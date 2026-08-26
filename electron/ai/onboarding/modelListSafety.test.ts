import { afterEach, describe, expect, it } from "vitest";
import { describeNetworkError, rememberProxyStateForTests, resetProxyStateForTests, type ProxySource } from "../../systemProxy";
import { modelListErrorRedactor } from "./modelListSafety";

afterEach(resetProxyStateForTests);

describe("model-list diagnostics preserve prose around sanitized URLs", () => {
  const redact = modelListErrorRedactor("https://gateway.test/v1", {});

  it("preserves a proxy network diagnostic without a source suffix and its Chinese closing parenthesis", () => {
    const message = "网络请求失败：无法连接到该地址。（当前代理：http://127.0.0.1:7890）";
    expect(redact(message)).toBe(message);
  });

  it.each<{ source: ProxySource; label: string; url: string }>([
    { source: "custom", label: "应用内设置", url: "http://127.0.0.1:7890" },
    { source: "system", label: "系统设置", url: "http://[::1]:7890" },
    { source: "env", label: "环境变量", url: "https://proxy.test:8443" },
  ])("preserves the actual describeNetworkError source label for $source", ({ source, label, url }) => {
    rememberProxyStateForTests({ kind: "http", url, source });
    const message = describeNetworkError(new TypeError("fetch failed"));
    expect(message).toContain(`（当前代理：${url}（来源：${label}））`);
    const result = redact(message);
    expect(result).toBe(message);
    expect(redact(result)).toBe(message);
  });

  it.each([
    "http://127.0.0.1:7890?token=prefix（来源：private-tail）after",
    "http://private-user:prefix（来源：private-tail）after@127.0.0.1:7890",
    "http://127.0.0.1:7890#prefix（来源：private-tail）after",
  ])("does not publish source-shaped text inside unknown URL credentials: %s", (url) => {
    rememberProxyStateForTests({ kind: "http", url, source: "custom" });
    const result = redact(describeNetworkError(new TypeError("fetch failed")));
    for (const secret of ["private-user", "private-tail", "prefix", "after", "token="]) expect(result).not.toContain(secret);
    expect(redact(result)).toBe(result);
  });

  it("redacts a complete known Chinese-parenthesis key before preserving a real source suffix", () => {
    const secret = "prefix（来源：private-tail）after";
    const sanitize = modelListErrorRedactor("https://gateway.test/v1", { authorization: `Bearer ${secret}` });
    rememberProxyStateForTests({ kind: "http", url: "http://127.0.0.1:7890", source: "custom" });
    const message = `${describeNetworkError(new TypeError("fetch failed"))} ${secret}`;
    const result = sanitize(message);
    expect(result).toContain("（当前代理：http://127.0.0.1:7890（来源：应用内设置））");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("private-tail");
    expect(sanitize(result)).toBe(result);
  });

  it("does not treat a source label as proof that an invalid proxy address is safe", () => {
    const result = redact("（当前代理：http://127.0.0.1:invalid（来源：应用内设置））");
    expect(result).toContain("[invalid API address]");
    expect(result).not.toContain("http://127.0.0.1:invalid");
  });

  it.each([
    "Request failed (current proxy: http://127.0.0.1:7890).",
    "Current proxy [http://127.0.0.1:7890].",
    "当前代理：http://127.0.0.1:7890。",
    "Check http://127.0.0.1:7890, then retry.",
    "Current proxy [http://[::1]:7890].",
    "Request failed (https://gateway.test/models(example)).",
  ])("preserves URL-adjacent punctuation without adding a slash: %s", (message) => {
    expect(redact(message)).toBe(message);
  });

  it("strips unknown userinfo and query credentials while preserving the surrounding parentheses", () => {
    const result = redact("Request failed (https://private-user:private-pass@gateway.test/v1/models?api_key=unknown-secret). ");
    expect(result).toBe("Request failed (https://gateway.test/v1/models [REDACTED]). ");
    for (const secret of ["private-user", "private-pass", "unknown-secret", "api_key="]) expect(result).not.toContain(secret);
  });

  it.each(["prefix)secret-tail", "prefix]secret-tail", "prefix'secret-tail", "prefix\"secret-tail", "private-token.)"])(
    "redacts a complete known key before URL punctuation can split it: %s", (secret) => {
      const sanitize = modelListErrorRedactor("https://gateway.test/v1", { authorization: `Bearer ${secret}` });
      const result = sanitize(`Request failed (https://gateway.test/v1/models?api_key=${secret}).`);
      expect(result).toBe("Request failed (https://gateway.test/v1/models [REDACTED]).");
      expect(result).not.toContain("secret-tail");
      expect(result).not.toContain("private-token");
    },
  );

  it("preserves Chinese parentheses while removing encoded base-query and userinfo secrets", () => {
    const token = "secret /+?) remainder";
    const base = `https://private-user:private-pass@gateway.test/v1?tenant_secret=${encodeURIComponent(token)}`;
    const sanitize = modelListErrorRedactor(base, {});
    const result = sanitize(`请求失败（${base}）`);
    expect(result).toBe("请求失败（https://gateway.test/v1 [REDACTED]）");
    for (const secret of [token, encodeURIComponent(token), "private-user", "private-pass", "tenant_secret="]) expect(result).not.toContain(secret);
  });

  it("does not leak a key fragment crossing the final diagnostic length limit", () => {
    const token = "private-token-crossing-the-final-limit";
    const sanitize = modelListErrorRedactor("https://gateway.test/v1", { "X-Private": token });
    const result = sanitize(`${"x".repeat(490)}${token} (proxy http://127.0.0.1:7890).`);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(result).not.toContain("private-to");
  });

  it("keeps sanitized diagnostics safe and stable across repeated sanitization", () => {
    const secret = "prefix'secret-tail";
    const sanitize = modelListErrorRedactor("https://gateway.test/v1", { authorization: `Bearer ${secret}` });
    const first = sanitize(`请求失败（https://private-user:private-pass@gateway.test/v1/models?api_key=${secret}）。`);
    const repeated = sanitize(sanitize(first));
    expect(repeated).toBe("请求失败（https://gateway.test/v1/models [REDACTED]）。");
    expect(repeated).toBe(first);
    for (const value of [secret, "secret-tail", "private-user", "private-pass", "api_key="]) expect(repeated).not.toContain(value);
  });

  it.each(["https", ":", "https://private-user"])(
    "fails closed if replacing a known header value destroys URL detection: %s", (secret) => {
      const sanitize = modelListErrorRedactor("https://gateway.test/v1", { "X-Forwarded-Proto": secret });
      const message = "请求失败（https://private-user:private-pass@gateway.test/v1/models?token=unknown-secret） http://127.0.0.1:7890";
      const result = sanitize(message);
      expect(result).toBe("[REDACTED]");
      expect(sanitize(result)).toBe(result);
      for (const value of ["private-user", "private-pass", "unknown-secret", "token="]) expect(result).not.toContain(value);
    },
  );

  it.each(["?", "#"])("fails closed when a known header value hides a private URL delimiter: %s", (delimiter) => {
    const sanitize = modelListErrorRedactor("https://gateway.test/v1", { "X-Custom": delimiter });
    const result = sanitize(`rejected https://gateway.test/v1/models${delimiter}access_token=unknown-private-key`);
    expect(result).toBe("[REDACTED]");
    expect(result).not.toContain("unknown-private-key");
    expect(sanitize(result)).toBe(result);
  });
});
