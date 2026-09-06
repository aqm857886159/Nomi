import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_ELICITATION_PATH,
  createCredentialElicitationStore,
  withCredentialElicitationTicket,
} from "./credentialElicitation";

const display = { name: "APIMart", baseUrl: "https://api.example.com", authType: "bearer" };

function makeStore(overrides: { origin?: string; now?: () => number; ttlMs?: number } = {}) {
  return createCredentialElicitationStore({
    originResolver: () => (overrides.origin === undefined ? "http://127.0.0.1:41234" : overrides.origin),
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.ttlMs ? { ttlMs: overrides.ttlMs } : {}),
  });
}

describe("credential elicitation ticket store", () => {
  it("mints a loopback URL carrying only an opaque token", () => {
    const ticket = makeStore().mint({ sessionId: "integration-1", display });
    expect(ticket).not.toBeNull();
    const url = new URL(ticket!.url);
    expect(url.origin).toBe("http://127.0.0.1:41234");
    expect(url.pathname).toBe(CREDENTIAL_ELICITATION_PATH);
    expect(url.searchParams.get("t")).toMatch(/^[a-f0-9]{64}$/);
    // No session identity, provider name, or anything else leaks into the URL itself.
    expect([...url.searchParams.keys()]).toEqual(["t"]);
    expect(ticket!.url).not.toContain("integration-1");
    expect(ticket!.elicitationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns null with no loopback origin so the caller degrades to the in-app handoff", () => {
    expect(makeStore({ origin: "" }).mint({ sessionId: "s", display })).toBeNull();
    expect(makeStore({ origin: "https://nomi.example.com" }).mint({ sessionId: "s", display })).toBeNull();
  });

  it("resolves without consuming, then redeems exactly once", () => {
    const store = makeStore();
    const ticket = store.mint({ sessionId: "integration-2", display })!;
    const token = new URL(ticket.url).searchParams.get("t")!;
    expect(store.resolve(token)?.sessionId).toBe("integration-2");
    expect(store.resolve(token)?.sessionId).toBe("integration-2");
    expect(store.redeem(token)?.sessionId).toBe("integration-2");
    expect(store.redeem(token)).toBeNull();
    expect(store.resolve(token)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("expires the ticket once its TTL passes", () => {
    let clock = 1_000;
    const store = makeStore({ now: () => clock, ttlMs: 5_000 });
    const token = new URL(store.mint({ sessionId: "s", display })!.url).searchParams.get("t")!;
    clock = 5_999;
    expect(store.resolve(token)).not.toBeNull();
    clock = 6_001;
    expect(store.resolve(token)).toBeNull();
    expect(store.redeem(token)).toBeNull();
  });

  it("rejects malformed tokens and invalidates an earlier ticket for the same session", () => {
    const store = makeStore();
    expect(store.resolve(undefined)).toBeNull();
    expect(store.resolve("../../etc/passwd")).toBeNull();
    expect(store.resolve("abc")).toBeNull();
    const first = new URL(store.mint({ sessionId: "s", display })!.url).searchParams.get("t")!;
    const second = new URL(store.mint({ sessionId: "s", display })!.url).searchParams.get("t")!;
    expect(first).not.toBe(second);
    expect(store.resolve(first)).toBeNull();
    expect(store.resolve(second)).not.toBeNull();
  });
});

describe("withCredentialElicitationTicket (dispatch seam)", () => {
  const projection = {
    id: "integration-7",
    kind: "http-api-provider",
    config: { name: "APIMart", baseUrl: "https://api.example.com", authType: "bearer" },
  };

  it("attaches a ticket for an HTTP provider and echoes the display fields the page needs", () => {
    const attached = withCredentialElicitationTicket(projection, makeStore());
    expect(attached.credentialEntry?.display).toEqual({
      name: "APIMart",
      baseUrl: "https://api.example.com",
      authType: "bearer",
    });
    expect(attached.credentialEntry?.sessionId).toBe("integration-7");
    expect(attached.id).toBe("integration-7");
  });

  it("attaches nothing for a ComfyUI session, a missing base URL, or no loopback origin", () => {
    expect(withCredentialElicitationTicket({ ...projection, kind: "comfyui-workflow" }, makeStore()).credentialEntry).toBeUndefined();
    expect(withCredentialElicitationTicket({ ...projection, config: { name: "x" } }, makeStore()).credentialEntry).toBeUndefined();
    expect(withCredentialElicitationTicket(projection, makeStore({ origin: "" })).credentialEntry).toBeUndefined();
  });
});
