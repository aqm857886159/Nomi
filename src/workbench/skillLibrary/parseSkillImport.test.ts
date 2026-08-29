import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import {
  packageFromEnvelope,
  packageFromMarkdown,
  parseSkillImportFile,
  readFrontmatterName,
} from "./parseSkillImport";

const SKILL_MD = `---
name: brand.promo
description: Brand video method
---

# Brand video
Body.`;

describe("standard Skill import normalization", () => {
  it("reads the standard frontmatter name and accepts a bare SKILL.md", () => {
    expect(readFrontmatterName(SKILL_MD)).toBe("brand.promo");
    const parsed = packageFromMarkdown("ignored.md", SKILL_MD);
    expect(parsed).toEqual({
      ok: true,
      payload: { dirName: "brand.promo", files: { "SKILL.md": SKILL_MD } },
    });
  });

  it("passes raw ZIP bytes to main without renderer decompression", async () => {
    const archive = zipSync({
      "package/SKILL.md": strToU8(SKILL_MD),
      "package/references/camera.md": strToU8("camera reference"),
    });
    const file = new File([archive], "package.zip", { type: "application/zip" });
    const parsed = await parseSkillImportFile(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.payload.kind !== "zip") return;
    expect(parsed.payload.fileName).toBe("package.zip");
    expect(parsed.payload.bytes).toEqual(archive);
  });

  it("leaves malformed ZIP validation to the main-process authority", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]);
    const file = new File([bytes], "broken.zip", { type: "application/zip" });
    await expect(parseSkillImportFile(file)).resolves.toEqual({
      ok: true,
      payload: { kind: "zip", fileName: "broken.zip", bytes },
    });
  });

  it("rejects an empty or oversized raw archive before IPC", async () => {
    const empty = new File([], "empty.zip", { type: "application/zip" });
    await expect(parseSkillImportFile(empty)).resolves.toEqual({ ok: false, reason: "empty" });

    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.zip", {
      type: "application/zip",
    });
    await expect(parseSkillImportFile(oversized)).resolves.toEqual({ ok: false, reason: "tooBig" });
  });

  it("keeps existing exported envelopes compatible for main-process validation", () => {
    const envelope = {
      version: "nomi-skill-v1",
      exportedAt: 123,
      dirName: "brand-promo",
      files: { "SKILL.md": SKILL_MD },
    };
    expect(packageFromEnvelope(envelope)).toEqual({ ok: true, payload: envelope });
  });
});
