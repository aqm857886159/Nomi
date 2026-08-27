import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { CertificationMediaError } from "../providerAdapter/certificationMedia";
import { certifyTaskOutputUrls } from "./taskResultCertification";

const png = fs.readFileSync(path.join(__dirname, "..", "providerAdapter", "__fixtures__", "certification-media", "valid.png"));

describe("certifyTaskOutputUrls", () => {
  it("routes task output through the same shared media certification boundary", async () => {
    await expect(certifyTaskOutputUrls({
      urls: [`data:image/png;base64,${png.toString("base64")}`],
      kind: "image",
      vendorBaseUrl: "http://127.0.0.1:8188",
    })).resolves.toHaveLength(1);
  });

  it("rejects a fake ftyp MP4 instead of treating a successful task status/download as verified", async () => {
    const fake = Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypisom"), 0, 0, 0, 0]);
    const error = await certifyTaskOutputUrls({
      urls: [`data:video/mp4;base64,${fake.toString("base64")}`],
      kind: "video",
      vendorBaseUrl: "http://127.0.0.1:8188",
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(CertificationMediaError);
  });
});
