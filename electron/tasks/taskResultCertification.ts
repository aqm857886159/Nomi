import {
  certifyMediaArtifact,
  type CertificationMediaEvidence,
  type CertificationMediaKind,
} from "../providerAdapter/certificationMedia";

export async function certifyTaskOutputUrls(input: {
  urls: readonly string[];
  kind: Extract<CertificationMediaKind, "image" | "video" | "audio" | "model3d">;
  signal?: AbortSignal;
}): Promise<CertificationMediaEvidence[]> {
  if (!input.urls.length) throw new Error("Task output did not contain a certifiable media artifact");
  return Promise.all(input.urls.map((source) => certifyMediaArtifact({
    source,
    expectedKind: input.kind,
    ...(input.signal ? { signal: input.signal } : {}),
  })));
}
