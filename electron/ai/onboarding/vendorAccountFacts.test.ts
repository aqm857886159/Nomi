import { beforeEach, describe, expect, it, vi } from "vitest";
import { appFetch } from "../../appFetch";
import { resolveVendorReadTarget } from "./vendorHealth";
import { readVendorAccountFacts } from "./vendorAccountFacts";

vi.mock("../../appFetch", () => ({ appFetch: vi.fn() }));
vi.mock("./vendorHealth", () => ({ resolveVendorReadTarget: vi.fn() }));

const target = {
  baseUrl: "https://api.apimart.ai", providerKind: "openai-compatible" as const, headers: { Authorization: "Bearer fixture" },
  query: {}, fingerprint: "fixture",
};
let generation = 0;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveVendorReadTarget).mockReturnValue({ ...target, fingerprint: String(++generation) });
});

function serve(key: unknown, account: unknown, usage: unknown) {
  vi.mocked(appFetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(target.baseUrl);
    expect(init?.method).toBe("GET");
    const body = url.pathname === "/v1/balance" ? key : url.pathname === "/v1/user/balance" ? account : usage;
    if (url.pathname === "/v1/usage") {
      expect(url.searchParams.get("scope")).toBe("account");
      expect(Number(url.searchParams.get("end")) - Number(url.searchParams.get("start"))).toBe(604800);
    }
    return body instanceof Response ? body : Response.json(body);
  });
}

describe("read-only account information", () => {
  it("keeps account zero, an unlimited token, and billed usage separate; shares concurrent and cached reads", async () => {
    serve({ success: true, unlimited_quota: true, remain_credits: -1 }, { success: true, remain_credits: 0, remain_balance: 999 },
      { success: true, data: { total: { credits: 2.5, requests: 1 } } });
    const [first, second] = await Promise.all([readVendorAccountFacts("apimart"), readVendorAccountFacts("apimart", true)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ keyState: "valid", accountCredits: 0, keyUnlimited: true, keyCredits: null, usageCredits: 2.5, usageRequests: 1 });
    expect(await readVendorAccountFacts("apimart")).toEqual(first);
    expect(appFetch).toHaveBeenCalledTimes(3);
    await readVendorAccountFacts("apimart", true);
    expect(appFetch).toHaveBeenCalledTimes(6);
  });

  it("does not turn business errors, missing units or an unavailable usage service into zero", async () => {
    serve({ success: true, remain_credits: 0 }, { success: false, remain_credits: 123 }, new Response(null, { status: 503 }));
    expect(await readVendorAccountFacts("apimart")).toMatchObject({
      keyState: "valid", keyCredits: 0, accountCredits: null, usageRequests: null, usageCredits: null,
    });
  });

  it("keeps authentication rejection distinct from a transient read failure", async () => {
    serve(new Response(null, { status: 401 }), { success: false }, { success: false });
    expect((await readVendorAccountFacts("apimart"))?.keyState).toBe("invalid");
    for (const status of [403, 503]) {
      serve(new Response(null, { status }), { success: false }, { success: false });
      expect((await readVendorAccountFacts("apimart", true))?.keyState).toBe("unknown");
    }
  });

  it("never requests credits from a user's relay and discards responses after a key changes", async () => {
    vi.mocked(resolveVendorReadTarget).mockReturnValueOnce({ ...target, baseUrl: "https://relay.example/v1" });
    expect(await readVendorAccountFacts("apimart")).toBeNull();
    expect(await readVendorAccountFacts("openai")).toBeNull();
    expect(appFetch).not.toHaveBeenCalled();
    serve({ success: true }, { success: true, remain_credits: 50 }, { success: true });
    vi.mocked(resolveVendorReadTarget).mockReturnValueOnce({ ...target, fingerprint: "old" }).mockReturnValue({ ...target, fingerprint: "new" });
    expect(await readVendorAccountFacts("apimart")).toBeNull();
    expect((await readVendorAccountFacts("apimart"))?.accountCredits).toBe(50);
    expect(appFetch).toHaveBeenCalledTimes(6);
  });
});
