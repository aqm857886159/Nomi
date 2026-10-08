import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Class guard: the raw reader skips the enabled gate, so its callers are a closed, justified list.
// Adding a consumer here must be a deliberate act, not a copy of the nearest decrypt call.
const ALLOWED_RAW_READERS: Record<string, string> = {
  "catalog/secrets.ts": "defines it; apiKeyDecryptStatus checks credentialRecordCounts first, then reads",
  "ai/onboarding/vendorHealth.ts": "re-validating a pending save is the one intentional probe of an unusable record",
  "catalog/validateCandidateCredential.ts": "revalidatePendingCredential exists to validate a record that is not yet usable",
  "providerAdapter/serviceCatalog.ts": "copies key material into an isolated candidate record; nothing is sent",
  "integrationCertification/integrationSession.ts": "the user's explicit 继续验证 certifies a saved key before it is enabled",
};

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full, out); }
    else if (/.(ts|tsx)$/.test(entry.name) && !/.test.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("raw stored-key reads stay a closed list", () => {
  it("only the justified files may call decryptStoredApiKeyRecord", () => {
    const users = walk(electronDir)
      .filter((file) => fs.readFileSync(file, "utf8").includes("decryptStoredApiKeyRecord"))
      .map((file) => path.relative(electronDir, file).split(path.sep).join("/"))
      .sort();
    expect(users).toEqual(Object.keys(ALLOWED_RAW_READERS).sort());
  });
});
