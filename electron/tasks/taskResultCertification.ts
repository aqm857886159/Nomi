import { isPrivateHost } from "../networkHostPolicy";
import {
  certifyMediaArtifact,
  type CertificationMediaEvidence,
  type CertificationMediaKind,
} from "../providerAdapter/certificationMedia";

function allowedPrivateOrigin(baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && isPrivateHost(url.hostname) ? [url.origin] : [];
  } catch {
    return [];
  }
}

export async function certifyTaskOutputUrls(input: {
  urls: readonly string[];
  kind: Extract<CertificationMediaKind, "image" | "video" | "audio" | "model3d">;
  vendorBaseUrl: string;
  signal?: AbortSignal;
}): Promise<CertificationMediaEvidence[]> {
  if (!input.urls.length) throw new Error("Task output did not contain a certifiable media artifact");
  const privateOrigins = allowedPrivateOrigin(input.vendorBaseUrl);
  return Promise.all(input.urls.map((source) => certifyMediaArtifact({
    source,
    expectedKind: input.kind,
    ...(privateOrigins.length ? { allowedPrivateOrigins: privateOrigins } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  })));
}
