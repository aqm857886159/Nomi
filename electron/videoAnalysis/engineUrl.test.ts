import { describe, expect, it } from "vitest";

import { normalizeLoopbackEngineUrl } from "./engineUrl";

describe("normalizeLoopbackEngineUrl", () => {
  it.each([
    ["http://127.0.0.1:8931", "http://127.0.0.1:8931"],
    ["http://localhost:8931/", "http://localhost:8931"],
    ["http://[::1]:8931", "http://[::1]:8931"],
  ])("accepts an explicit loopback HTTP origin: %s", (input, expected) => {
    expect(normalizeLoopbackEngineUrl(input)).toBe(expected);
  });

  it.each([
    "https://127.0.0.1:8931",
    "http://0.0.0.0:8931",
    "http://127.0.0.2:8931",
    "http://localhost.evil.example:8931",
    "http://127.0.0.1.example:8931",
    "http://user:pass@127.0.0.1:8931",
    "http://127.0.0.1:8931/api",
    "http://127.0.0.1:8931/?token=secret",
    "http://127.0.0.1:8931/#fragment",
    "file:///tmp/e-cut.sock",
    "not a url",
  ])("rejects a non-origin or non-loopback engine URL: %s", (input) => {
    expect(() => normalizeLoopbackEngineUrl(input)).toThrow(/loopback|origin|HTTP|URL/i);
  });
});
