import { describe, expect, it } from "vitest";

import { isPrivateHost } from "./networkHostPolicy";

describe("isPrivateHost", () => {
  it.each([
    "::ffff:127.0.0.1",
    "[::ffff:169.254.169.254]",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "64:ff9b:1::1",
    "100::1",
    "2002:7f00:1::",
    "3fff::1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
  ])("rejects special/private address %s", (address) => {
    expect(isPrivateHost(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "permits globally routable literal %s",
    (address) => expect(isPrivateHost(address)).toBe(false),
  );
});
