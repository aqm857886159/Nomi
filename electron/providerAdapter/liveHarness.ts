import { app } from "electron";
import { writeJsonFileAtomic } from "../jsonFile";
import { readCatalog } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import type { BillingModelKind } from "../catalog/types";
import type { ProviderAdapterRun } from "./types";
import type { ConnectionCertificationService } from "../integrationCertification/service";
import { redactAdapterSecrets } from "./redaction";

type LiveConfig = {
  invocationId: string;
  sourceVendorKey: string;
  vendorName: string;
  baseUrl: string;
  providerKind?: "openai-compatible" | "openai-responses" | "anthropic";
  models: Array<{ modelKey: string; labelZh?: string; kind: BillingModelKind }>;
  maxMs?: number;
  quit?: boolean;
};

const TERMINAL: ReadonlySet<ProviderAdapterRun["stage"]> = new Set([
  "completed",
  "partial",
  "failed",
  "needs_ai",
  "cancelled",
  "timed_out",
  "stale",
]);

export function isLiveAdapterTerminalStage(stage: ProviderAdapterRun["stage"]): boolean {
  return TERMINAL.has(stage);
}

export function liveHarnessEnabled(env: Record<string, string | undefined>): boolean {
  return env.NOMI_E2E === "1"
    && Boolean(env.NOMI_PROVIDER_ADAPTER_LIVE_CONFIG)
    && Boolean(env.NOMI_PROVIDER_ADAPTER_LIVE_OUTPUT);
}

export function liveAdapterSummary(run: Omit<ProviderAdapterRun, "connectionFingerprint">): Record<string, unknown> {
  return {
    id: run.id,
    vendorKey: run.vendorKey,
    vendorName: run.vendorName,
    selectedModelKeys: run.selectedModelKeys,
    stage: run.stage,
    repairAttempt: run.repairAttempt,
    models: run.models,
    sourceUrls: run.sourceUrls,
    activeRevision: run.activeRevision,
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function parseLiveConfig(raw: string): LiveConfig {
  const parsed = JSON.parse(raw) as LiveConfig;
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(parsed.invocationId) || !parsed.sourceVendorKey || !/^https?:\/\//i.test(parsed.baseUrl) || !Array.isArray(parsed.models) || parsed.models.length === 0) {
    throw new Error("Invalid live provider-adapter config");
  }
  return parsed;
}

export function liveHarnessIdempotencyKey(input: {
  invocationId: string;
  sourceVendorKey: string;
  models: Array<{ modelKey: string }>;
}): string {
  return `live-harness:${input.invocationId}:${input.sourceVendorKey}:${input.models.map((model) => model.modelKey).sort().join(",")}`;
}

export async function runLiveProviderAdapterHarnessFromEnv(service: ConnectionCertificationService): Promise<void> {
  if (!liveHarnessEnabled(process.env)) return;
  const rawConfig = process.env.NOMI_PROVIDER_ADAPTER_LIVE_CONFIG;
  const outputPath = process.env.NOMI_PROVIDER_ADAPTER_LIVE_OUTPUT;
  if (!rawConfig || !outputPath) return;
  let shouldQuit = false;
  try {
    const config = parseLiveConfig(rawConfig);
    shouldQuit = config.quit === true;
    const catalog = readCatalog();
    const sourceKey = decryptApiKeyRecord(catalog.apiKeysByVendor[config.sourceVendorKey]);
    if (!sourceKey) throw new Error("The configured source vendor has no usable encrypted API key");
    const run = await service.startHttp({
      entryPoint: "programmatic-session",
      idempotencyKey: liveHarnessIdempotencyKey(config),
      connection: {
        vendorName: config.vendorName,
        baseUrl: config.baseUrl,
        apiKey: sourceKey,
        authType: config.providerKind === "anthropic" ? "x-api-key" : "bearer",
        providerKind: config.providerKind || "openai-compatible",
        models: config.models,
      },
    });
    const deadline = Date.now() + (config.maxMs ?? 15 * 60_000);
    let current = run;
    while (!isLiveAdapterTerminalStage(current.stage) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      current = service.get(run.id) || current;
    }
    if (!isLiveAdapterTerminalStage(current.stage)) throw new Error("Live provider-adapter verification timed out");
    writeJsonFileAtomic(outputPath, { ok: true, run: liveAdapterSummary(current) });
  } catch (error) {
    writeJsonFileAtomic(outputPath, {
      ok: false,
      error: redactAdapterSecrets(error instanceof Error ? error.message : String(error)),
    });
  } finally {
    if (shouldQuit) setTimeout(() => app.quit(), 100);
  }
}
