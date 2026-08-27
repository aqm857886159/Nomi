import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptApiKeyRecord: vi.fn(() => "relay-key-after-window"),
  probeNativeEndpoint: vi.fn(async () => ({ exists: false, detail: "not exposed" })),
}));

vi.mock("./secrets", () => ({ decryptApiKeyRecord: mocks.decryptApiKeyRecord }));
vi.mock("./nativeEndpointProbe", () => ({ probeNativeEndpoint: mocks.probeNativeEndpoint }));
vi.mock("./catalogStore", () => ({
  listModelCatalogMappings: () => [],
  listModelCatalogModels: () => [{
    modelKey: "doubao-seedance-2-0-260128",
    vendorKey: "custom-relay",
    labelZh: "Seedance 2",
    kind: "video",
    enabled: true,
    createdAt: "now",
    updatedAt: "now",
  }],
  listModelCatalogVendors: () => [{
    key: "custom-relay",
    name: "Custom relay",
    enabled: true,
    baseUrlHint: "https://relay.example/v1",
    authType: "bearer",
  }],
  readCatalog: () => ({
    version: 9,
    vendors: [],
    models: [],
    mappings: [],
    apiKeysByVendor: {
      "custom-relay": {
        vendorKey: "custom-relay",
        apiKey: "encrypted-keychain-payload",
        enc: "safeStorage",
        enabled: true,
        createdAt: "now",
        updatedAt: "now",
      },
    },
  }),
  upsertModelCatalogMapping: vi.fn(),
  upsertModelCatalogModel: vi.fn(),
}));

import { scheduleRelayNativeWireUpgrade } from "./relayNativeWireUpgrade";

describe("relay native-wire post-window maintenance", () => {
  it("does not resolve an encrypted relay credential until maintenance is explicitly scheduled", async () => {
    expect(mocks.decryptApiKeyRecord).not.toHaveBeenCalled();
    expect(mocks.probeNativeEndpoint).not.toHaveBeenCalled();

    scheduleRelayNativeWireUpgrade();

    await vi.waitFor(() => expect(mocks.probeNativeEndpoint).toHaveBeenCalledTimes(1));
    expect(mocks.decryptApiKeyRecord).toHaveBeenCalledTimes(1);
    expect(mocks.decryptApiKeyRecord).toHaveBeenCalledWith(expect.objectContaining({
      enc: "safeStorage",
      apiKey: "encrypted-keychain-payload",
    }));
    expect(mocks.probeNativeEndpoint).toHaveBeenCalledWith(
      "https://relay.example/v1",
      "/api/v3/contents/generations/tasks",
      "relay-key-after-window",
    );
  });
});
