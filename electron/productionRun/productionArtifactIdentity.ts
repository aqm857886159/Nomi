import crypto from "node:crypto";

/** Job ids intentionally contain a namespace separator (`job:run:node`), but artifact ids are
 * public deep-link identifiers. Keep the mapping stable, collision-resistant, and URL-safe. */
export function artifactIdentifierForJob(jobId: string): string {
  const base = jobId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "job";
  const suffix = crypto.createHash("sha256").update(jobId).digest("hex").slice(0, 10);
  return `artifact-job-${base}-${suffix}`;
}

/** 一单交回几份就有几个产物号：第 1 份沿用这一单原来的号（旧账、深链照旧认），第 k 份（k ≥ 2）在后面接 `-k`。 */
export function artifactIdentifierForOutput(jobId: string, outputIndex: number): string {
  return outputIndex === 0 ? artifactIdentifierForJob(jobId) : `${artifactIdentifierForJob(jobId)}-${outputIndex + 1}`;
}
