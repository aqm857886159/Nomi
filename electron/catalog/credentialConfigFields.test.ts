import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_BEARING_VENDOR_FIELDS,
  VENDOR_CONFIG_FIELD_CLASSIFICATION,
  type VendorConfigFieldClass,
} from "./credentialConfigFields";
import type { Vendor } from "./types";

// 结构性预防 guard（P2 心脏）：让「凭据字段明文落盘」这类问题**整类不再复发**。
// 编译期约束在 credentialConfigFields.ts（Record<keyof Vendor> 强制穷尽）；本测试是 runtime 侧的
// 对偶——证明分级表与真实 Vendor 字段一一对齐，且被标为 credential-bearing 的字段确实经加密层落盘。

/**
 * 一份带 Vendor **全部**字段的样本。`satisfies Required<...>` 保证：给 Vendor 加新字段而不在这里
 * 补一项 → 编译红。它与 VENDOR_CONFIG_FIELD_CLASSIFICATION 的 Record<keyof Vendor> 两道并联，
 * 任何新字段都必须同时「被分级」+「被这份样本覆盖」，才谈得上通过。
 */
const SAMPLE_VENDOR = {
  key: "sample",
  name: "Sample",
  enabled: true,
  hasApiKey: false,
  credentialMaterialSaved: true,
  credentialVerificationPending: true,
  baseUrlHint: "https://relay.example/v1",
  authType: "bearer",
  authHeader: null,
  authScheme: "Key",
  authQueryParam: null,
  providerKind: "openai-compatible",
  network: { proxyUrl: "http://user:pass@127.0.0.1:7897" },
  assetIngestion: { strategy: "none" },
  // 凭据绑定：全是公开协议元数据。注意这里**没有** proxyUrl——绑定刻意不抄它（它带 user:pass@，
  // 属 credential-bearing 那一档），也没有「保存时走没走代理」那个布尔（Ponytail 2026-09-18：
  // 记了却没人判的字段就是这条不变量要杀的形状，已删）。
  credentialBinding: {
    origin: "https://relay.example",
    authType: "bearer",
    authHeader: "X-Key",
    authQueryParam: "key",
    authScheme: "Key",
    confirmedAt: "2026-09-18T00:00:00.000Z",
  },
  meta: { extraHeaders: { Authorization: "Bearer leaked-token" } },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} satisfies Required<Vendor>;

describe("vendor config field classification (structural prevention)", () => {
  it("classifies every Vendor field exactly once", () => {
    const sampleKeys = Object.keys(SAMPLE_VENDOR).sort();
    const classifiedKeys = Object.keys(VENDOR_CONFIG_FIELD_CLASSIFICATION).sort();
    // If these diverge, a new Vendor field was added without a credential classification
    // (or the sample was not updated) — the class boundary is no longer closed.
    expect(classifiedKeys).toEqual(sampleKeys);
  });

  it("marks only known credential-bearing fields, and only with supported classes", () => {
    const classes: VendorConfigFieldClass[] = ["credential-bearing", "non-credential"];
    for (const value of Object.values(VENDOR_CONFIG_FIELD_CLASSIFICATION)) {
      expect(classes).toContain(value);
    }
    // The proxy URL (may carry user:pass) and meta (carries extraHeaders → Authorization)
    // are the credential-bearing fields; everything else is public metadata.
    expect([...CREDENTIAL_BEARING_VENDOR_FIELDS].sort()).toEqual(["meta", "network"]);
  });

  it("keeps the fields that carry credentials in the encrypted set (regression tripwire)", () => {
    // A future field that can carry a secret MUST be added to CREDENTIAL_BEARING_VENDOR_FIELDS,
    // which routes it through the safeStorage tier (secrets.ts / networkConfigStore.ts). This
    // asserts the two known credential carriers stay classified so a silent downgrade is caught.
    expect(VENDOR_CONFIG_FIELD_CLASSIFICATION.network).toBe("credential-bearing");
    expect(VENDOR_CONFIG_FIELD_CLASSIFICATION.meta).toBe("credential-bearing");
  });
});
