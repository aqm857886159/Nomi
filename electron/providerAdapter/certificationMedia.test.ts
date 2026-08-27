import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CertificationMediaError,
  certifyMediaArtifact,
  type CertificationMediaDependencies,
  type CertificationMediaReasonCode,
} from "./certificationMedia";

const FIXTURES = path.join(__dirname, "__fixtures__", "certification-media");

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

function dataUrl(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function reasonOf(promise: Promise<unknown>): Promise<CertificationMediaError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CertificationMediaError);
    return error as CertificationMediaError;
  }
  throw new Error("Expected media certification to fail");
}

function minimalGlb(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}', "utf8");
  const paddedLength = Math.ceil(json.byteLength / 4) * 4;
  const totalLength = 12 + 8 + paddedLength;
  const bytes = Buffer.alloc(totalLength, 0x20);
  bytes.write("glTF", 0, "ascii");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(totalLength, 8);
  bytes.writeUInt32LE(paddedLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return bytes;
}

let server: http.Server;
let redirectTarget: http.Server;
let baseUrl = "";
let redirectTargetUrl = "";
let certificationRoot = "";

beforeAll(async () => {
  redirectTarget = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(fixture("valid.png"));
  });
  await new Promise<void>((resolve) => redirectTarget.listen(0, "127.0.0.1", resolve));
  redirectTargetUrl = `http://127.0.0.1:${(redirectTarget.address() as AddressInfo).port}`;

  server = http.createServer((request, response) => {
    switch (request.url) {
      case "/valid.png":
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(fixture("valid.png"));
        return;
      case "/html-as-png":
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(fixture("http-200-html.txt"));
        return;
      case "/xml-as-png":
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(fixture("http-200-xml.txt"));
        return;
      case "/wrong-content-type":
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end(fixture("valid.png"));
        return;
      case "/mime-mismatch":
        response.writeHead(200, { "Content-Type": "image/jpeg" });
        response.end(fixture("valid.png"));
        return;
      case "/corrupt.png":
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(Buffer.from(fixture("corrupt-image.base64").toString("ascii").trim(), "base64"));
        return;
      case "/oversize":
        response.writeHead(200, { "Content-Type": "image/png" });
        response.write(fixture("valid.png"));
        response.end(Buffer.alloc(256, 0x61));
        return;
      case "/slow":
        setTimeout(() => {
          response.writeHead(200, { "Content-Type": "image/png" });
          response.end(fixture("valid.png"));
        }, 100);
        return;
      case "/cross-origin":
        response.writeHead(302, { Location: `${redirectTargetUrl}/valid.png` });
        response.end();
        return;
      default:
        response.writeHead(404);
        response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => redirectTarget.close(() => resolve())),
  ]);
});

beforeEach(() => {
  certificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-certification-media-test-"));
});

afterEach(() => {
  expect(fs.readdirSync(certificationRoot), "certification run files must be cleaned").toEqual([]);
  fs.rmSync(certificationRoot, { recursive: true, force: true });
});

function deps(overrides: CertificationMediaDependencies = {}): CertificationMediaDependencies {
  return { certificationRoot, ...overrides };
}

describe("certifyMediaArtifact", () => {
  it.each([
    ["PNG", "image/png", "valid.png", 2, 2],
    ["JPEG", "image/jpeg", "valid.jpg", 2, 2],
    ["WebP", "image/webp", "valid.webp", 960, 720],
  ])("fully decodes valid %s data URLs", async (_label, contentType, fileName, width, height) => {
    const bytes = fixture(fileName);
    const evidence = await certifyMediaArtifact(
      { source: dataUrl(contentType, bytes), expectedKind: "image" },
      deps(),
    );

    expect(evidence).toMatchObject({
      kind: "image",
      contentType,
      byteLength: bytes.byteLength,
      metadata: { width, height },
    });
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toMatch(/data:|valid\.|nomi-certification-media-test/);
  });

  it.each([
    ["video", "video/mp4", "valid.mp4"],
    ["audio", "audio/wav", "valid.wav"],
  ] as const)("probes a valid short %s inside managed certification storage", async (kind, contentType, fileName) => {
    const bytes = fixture(fileName);
    const evidence = await certifyMediaArtifact(
      { source: { bytes, contentType }, expectedKind: kind },
      deps(),
    );

    expect(evidence.kind).toBe(kind);
    expect(evidence.metadata.durationSeconds).toBeGreaterThan(0);
    expect(evidence.metadata.streamCount).toBeGreaterThan(0);
    expect(JSON.stringify(evidence)).not.toContain(certificationRoot);
  });

  it("accepts the current stable 3D boundary: a structurally valid binary GLB", async () => {
    const evidence = await certifyMediaArtifact(
      { source: { bytes: minimalGlb(), contentType: "model/gltf-binary" }, expectedKind: "model3d" },
      deps(),
    );

    expect(evidence).toMatchObject({ kind: "model3d", contentType: "model/gltf-binary" });
  });

  it.each([
    ["HTML", "/html-as-png"],
    ["XML", "/xml-as-png"],
  ])("rejects HTTP 200 %s masquerading as image/png before decoder entry", async (_label, route) => {
    const decodeImage = vi.fn();
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: `${baseUrl}${route}`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
      },
      deps({ decodeImage }),
    ));

    expect(error.reasonCode).toBe("media_markup_masquerade");
    expect(decodeImage).not.toHaveBeenCalled();
    expect(`${error.message}${JSON.stringify(error.params)}`).not.toMatch(/temporarily unavailable|AccessDenied|signed URL|127\.0\.0\.1/);
  });

  it("rejects a non-media Content-Type even when the bytes are a valid PNG", async () => {
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: `${baseUrl}/wrong-content-type`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
      },
      deps(),
    ));
    expect(error.reasonCode).toBe("media_content_type_unsupported");
  });

  it("rejects declared MIME and magic-byte mismatch", async () => {
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: `${baseUrl}/mime-mismatch`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
      },
      deps(),
    ));
    expect(error.reasonCode).toBe("media_mime_mismatch");
    expect(error.params).toEqual({ declaredType: "image/jpeg", detectedType: "image/png" });
  });

  it("rejects a corrupt image header with a stable sanitized error", async () => {
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: `${baseUrl}/corrupt.png`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
      },
      deps(),
    ));
    expect(error.reasonCode).toBe("media_corrupt");
    expect(error.message).not.toContain("corrupt.png");
  });

  it("stops an oversize HTTP stream before materialization", async () => {
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: `${baseUrl}/oversize`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
        limits: { maxBytes: 32 },
      },
      deps(),
    ));
    expect(error.reasonCode).toBe("media_too_large");
    expect(fs.readdirSync(certificationRoot)).toEqual([]);
  });

  it("bounds HTTP acquisition time", async () => {
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: `${baseUrl}/slow`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
        limits: { fetchTimeoutMs: 20 },
      },
      deps(),
    ));
    expect(error.reasonCode).toBe("media_timeout");
    expect(error.params).toEqual({ stage: "fetch", timeoutMs: 20 });
  });

  it("rejects a cross-origin redirect and never grants the redirect target", async () => {
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: `${baseUrl}/cross-origin`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
      },
      deps(),
    ));
    expect(error.reasonCode).toBe("media_redirect_forbidden");
    expect(`${error.message}${JSON.stringify(error.params)}`).not.toContain(redirectTargetUrl);
  });

  it("allows an explicitly granted same-origin private artifact", async () => {
    const evidence = await certifyMediaArtifact(
      {
        source: `${baseUrl}/valid.png`,
        expectedKind: "image",
        allowedPrivateOrigins: [baseUrl],
      },
      deps(),
    );
    expect(evidence).toMatchObject({ kind: "image", contentType: "image/png" });
  });

  it("applies the same markup and MIME checks to data URLs", async () => {
    const decodeImage = vi.fn();
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: dataUrl("image/png", fixture("http-200-html.txt")),
        expectedKind: "image",
      },
      deps({ decodeImage }),
    ));
    expect(error.reasonCode).toBe("media_markup_masquerade");
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it("rejects malformed base64 data URLs instead of permissively decoding them", async () => {
    const error = await reasonOf(certifyMediaArtifact(
      { source: "data:image/png;base64,%%%%", expectedKind: "image" },
      deps(),
    ));
    expect(error.reasonCode).toBe("media_invalid_source");
  });

  it("bounds image decoder time and aborts the decoder seam", async () => {
    let decoderSignal: AbortSignal | undefined;
    const decodeImage: NonNullable<CertificationMediaDependencies["decodeImage"]> = (_bytes, _mime, signal) => {
      decoderSignal = signal;
      return new Promise(() => {});
    };
    const error = await reasonOf(certifyMediaArtifact(
      {
        source: { bytes: fixture("valid.png"), contentType: "image/png" },
        expectedKind: "image",
        limits: { decoderTimeoutMs: 20 },
      },
      deps({ decodeImage }),
    ));
    expect(error.reasonCode).toBe("media_timeout");
    expect(error.params).toEqual({ stage: "decode", timeoutMs: 20 });
    expect(decoderSignal?.aborted).toBe(true);
  });

  it("keeps reason codes stable and params free of raw URL, path, body, and signed query", async () => {
    const source = "https://cdn.example.test/private.png?X-Amz-Signature=secret";
    const error = await reasonOf(certifyMediaArtifact(
      { source, expectedKind: "image" },
      deps({ fetch: async () => { throw new Error(`body=<html>oops</html> path=/tmp/private source=${source}`); } }),
    ));
    expect(error.reasonCode).toBe("media_fetch_failed" satisfies CertificationMediaReasonCode);
    expect(`${error.message}${JSON.stringify(error.params)}`).not.toMatch(/secret|<html>|\/tmp|cdn\.example/);
  });
});
