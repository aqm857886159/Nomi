import { describe, expect, it } from "vitest";
import { strToU8, Zip, ZipPassThrough, zipSync, type Zippable } from "fflate";
import { crc32 } from "node:zlib";

import { SKILL_PACKAGE_MAX_TOTAL_BYTES } from "./skillPackage";
import { inspectSkillZipImportPayload, parseSkillZipPackage } from "./skillZipImport";

const SKILL_MD = `---
name: brand.promo
description: Brand video method
---

# Brand video
Body.`;

function archiveOf(tree: Zippable): Buffer {
  return Buffer.from(zipSync(tree, { level: 6 }));
}

function archiveWithDuplicateEntries(entries: Array<{
  name: string;
  content: string;
  os?: number;
  attrs?: number;
}>): Buffer {
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) failure = error;
    if (chunk) chunks.push(chunk);
    if (final) finished = true;
  });
  for (const entry of entries) {
    const stream = new ZipPassThrough(entry.name);
    stream.os = entry.os;
    stream.attrs = entry.attrs;
    zip.add(stream);
    stream.push(strToU8(entry.content), true);
  }
  zip.end();
  if (failure) throw failure;
  if (!finished) throw new Error("test ZIP did not finish synchronously");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function mutateCentralUint32(archive: Buffer, fileName: string, fieldOffset: number, value: number): Buffer {
  const mutated = Buffer.from(archive);
  for (let offset = 0; offset <= mutated.length - 46; offset += 1) {
    if (mutated.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = mutated.readUInt16LE(offset + 28);
    const name = mutated.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === fileName) {
      mutated.writeUInt32LE(value >>> 0, offset + fieldOffset);
      return mutated;
    }
  }
  throw new Error(`central directory entry not found: ${fileName}`);
}

function readCentralUint32(archive: Buffer, fileName: string, fieldOffset: number): number {
  for (let offset = 0; offset <= archive.length - 46; offset += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === fileName) return archive.readUInt32LE(offset + fieldOffset);
  }
  throw new Error(`central directory entry not found: ${fileName}`);
}

function addUnicodePathAlias(
  archive: Buffer,
  rawName: string,
  alias: string,
  occurrence = 0,
): Buffer {
  let seen = 0;
  for (let offset = 0; offset <= archive.length - 46; offset += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const rawNameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
    if (rawNameBytes.toString("utf8") !== rawName || seen++ !== occurrence) continue;

    const aliasBytes = Buffer.from(alias, "utf8");
    const unicodePath = Buffer.alloc(9 + aliasBytes.byteLength);
    unicodePath.writeUInt16LE(0x7075, 0);
    unicodePath.writeUInt16LE(5 + aliasBytes.byteLength, 2);
    unicodePath.writeUInt8(1, 4);
    unicodePath.writeUInt32LE(crc32(rawNameBytes), 5);
    aliasBytes.copy(unicodePath, 9);
    const insertAt = offset + 46 + nameLength + extraLength;
    const mutated = Buffer.concat([
      archive.subarray(0, insertAt),
      unicodePath,
      archive.subarray(insertAt),
    ]);
    mutated.writeUInt16LE(extraLength + unicodePath.byteLength, offset + 30);

    let endOfCentralDirectory = -1;
    for (let cursor = mutated.length - 22; cursor >= 0; cursor -= 1) {
      if (mutated.readUInt32LE(cursor) === 0x06054b50) {
        endOfCentralDirectory = cursor;
        break;
      }
    }
    if (endOfCentralDirectory < 0) throw new Error("end of central directory not found");
    const centralDirectorySize = mutated.readUInt32LE(endOfCentralDirectory + 12);
    mutated.writeUInt32LE(centralDirectorySize + unicodePath.byteLength, endOfCentralDirectory + 12);
    return mutated;
  }
  throw new Error(`central directory entry occurrence not found: ${rawName}#${occurrence}`);
}

async function parse(archive: Buffer, fileName = "package.zip") {
  return parseSkillZipPackage({ fileName, bytes: archive }, 123);
}

describe("main-owned Skill ZIP import", () => {
  it("preserves a complete knowledge package under one optional wrapper", async () => {
    const result = await parse(archiveOf({
      "package/SKILL.md": strToU8(SKILL_MD),
      "package/references/camera.md": strToU8("camera reference"),
      "package/assets/templates/shot.yaml": strToU8("shot: close-up"),
    }));
    expect(result).toEqual({
      ok: true,
      pkg: {
        version: "nomi-skill-v1",
        exportedAt: 123,
        dirName: "brand.promo",
        files: {
          "SKILL.md": SKILL_MD,
          "references/camera.md": "camera reference",
          "assets/templates/shot.yaml": "shot: close-up",
        },
      },
    });
  });

  it.each(["../SKILL.md", "/SKILL.md", "pkg/../../SKILL.md", "C:/SKILL.md"])(
    "rejects a raw traversal or absolute path before wrapper stripping: %s",
    async (entryName) => {
      const result = await parse(archiveOf({ [entryName]: strToU8(SKILL_MD) }));
      expect(result.ok).toBe(false);
    },
  );

  it("rejects traversal and forbidden directories hidden by Unicode Path aliases", async () => {
    const traversal = addUnicodePathAlias(
      archiveOf({ "../SKILL.md": strToU8(SKILL_MD) }),
      "../SKILL.md",
      "SKILL.md",
    );
    await expect(parse(traversal)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Unsupported Skill ZIP path"),
    });

    const forbidden = addUnicodePathAlias(
      archiveOf({
        "SKILL.md": strToU8(SKILL_MD),
        "scripts/": [new Uint8Array(), { os: 3, attrs: (0o040755 << 16) | 0x10 }],
      }),
      "scripts/",
      "references/",
    );
    await expect(parse(forbidden)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Unsupported Skill ZIP path"),
    });
  });

  it("rejects raw duplicates hidden behind distinct Unicode Path aliases", async () => {
    let duplicate = archiveWithDuplicateEntries([
      { name: "SKILL.md", content: SKILL_MD },
      { name: "references/shared.md", content: "first" },
      { name: "references/shared.md", content: "second" },
    ]);
    duplicate = addUnicodePathAlias(duplicate, "references/shared.md", "references/first.md", 0);
    duplicate = addUnicodePathAlias(duplicate, "references/shared.md", "references/second.md", 1);
    await expect(parse(duplicate)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("duplicate or colliding"),
    });
  });

  it("rejects raw/effective directory type disagreement", async () => {
    const mismatch = addUnicodePathAlias(
      archiveOf({
        "SKILL.md": strToU8(SKILL_MD),
        "references/raw-dir/": [new Uint8Array(), { os: 3, attrs: (0o040755 << 16) | 0x10 }],
      }),
      "references/raw-dir/",
      "references/file.txt",
    );
    await expect(parse(mismatch)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("raw/effective entry type mismatch"),
    });
  });

  it("rejects exact duplicate and case-colliding central-directory entries", async () => {
    const duplicate = archiveWithDuplicateEntries([
      { name: "SKILL.md", content: SKILL_MD },
      { name: "SKILL.md", content: "second" },
    ]);
    await expect(parse(duplicate)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("duplicate or colliding"),
    });

    const caseCollision = archiveWithDuplicateEntries([
      { name: "SKILL.md", content: SKILL_MD },
      { name: "references/Camera.md", content: "first" },
      { name: "references/camera.md", content: "second" },
    ]);
    await expect(parse(caseCollision)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("duplicate or colliding"),
    });
  });

  it("rejects symlinks, special entries, and empty forbidden directories", async () => {
    const symlink = archiveOf({
      "SKILL.md": strToU8(SKILL_MD),
      "references/link.md": [strToU8("../SKILL.md"), { os: 3, attrs: 0o120777 << 16 }],
    });
    await expect(parse(symlink)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("symbolic link"),
    });

    const fifo = archiveOf({
      "SKILL.md": strToU8(SKILL_MD),
      "references/pipe.txt": [strToU8("pipe"), { os: 3, attrs: 0o010644 << 16 }],
    });
    await expect(parse(fifo)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("special entry"),
    });

    const forbiddenDir = archiveOf({
      "SKILL.md": strToU8(SKILL_MD),
      "scripts/": [new Uint8Array(), { os: 3, attrs: (0o040755 << 16) | 0x10 }],
    });
    await expect(parse(forbiddenDir)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Unsupported Skill ZIP path"),
    });
  });

  it("rejects a file/directory hierarchy collision", async () => {
    const collision = archiveOf({
      "SKILL.md": strToU8(SKILL_MD),
      "references.md": strToU8("file"),
      "references.md/nested.txt": strToU8("nested"),
    });
    await expect(parse(collision)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("conflicts with nested path"),
    });
  });

  it("checks CRC against the actual streamed bytes", async () => {
    const archive = archiveOf({ "SKILL.md": strToU8(SKILL_MD) });
    const badCrc = mutateCentralUint32(archive, "SKILL.md", 16, 0x12345678);
    await expect(parse(badCrc)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("CRC mismatch"),
    });
  });

  it.each([1, 4, 16])(
    "rejects deflate data with a forged compressed size (+%i)",
    async (extraBytes) => {
      const archive = archiveOf({ "SKILL.md": strToU8(SKILL_MD) });
      const compressedSize = readCentralUint32(archive, "SKILL.md", 20);
      const forged = mutateCentralUint32(
        archive,
        "SKILL.md",
        20,
        compressedSize + extraBytes,
      );
      await expect(parse(forged)).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining("compressed data mismatch"),
      });
    },
  );

  it("rejects forged sizes and actual expanded output above the per-file limit", async () => {
    const oversizedBody = `# ok\n${"a".repeat(1024 * 1024)}`;
    const archive = archiveOf({ "SKILL.md": strToU8(oversizedBody) });
    const forgedSmall = mutateCentralUint32(archive, "SKILL.md", 24, 5);
    const result = await parse(forgedSmall);
    expect(result.ok).toBe(false);
  });

  it("bounds both file count and total central-directory entry count", async () => {
    const tooManyFiles: Zippable = { "SKILL.md": strToU8(SKILL_MD) };
    for (let index = 0; index < 256; index += 1) {
      tooManyFiles[`references/${index}.txt`] = strToU8("x");
    }
    await expect(parse(archiveOf(tooManyFiles))).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("file count"),
    });

    const tooManyEntries: Zippable = { "SKILL.md": strToU8(SKILL_MD) };
    for (let index = 0; index < 512; index += 1) {
      tooManyEntries[`references/${index}/`] = new Uint8Array();
    }
    await expect(parse(archiveOf(tooManyEntries))).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("entry count"),
    });
  });

  it("rejects invalid UTF-8 after bounded streaming", async () => {
    const archive = archiveOf({
      "SKILL.md": strToU8(SKILL_MD),
      "references/bad.txt": new Uint8Array([0xff, 0xfe, 0xfd]),
    });
    await expect(parse(archive)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("not valid UTF-8"),
    });
  });

  it("rejects a forged or oversized raw IPC envelope", () => {
    expect(inspectSkillZipImportPayload({
      kind: "zip",
      fileName: "package.zip",
      bytes: new Uint8Array(SKILL_PACKAGE_MAX_TOTAL_BYTES + 1),
    })).toMatchObject({ kind: "invalid", error: expect.stringContaining("compressed size") });
    expect(inspectSkillZipImportPayload({
      kind: "zip",
      fileName: "../package.zip",
      bytes: new Uint8Array([1]),
    })).toMatchObject({ kind: "invalid", error: expect.stringContaining("file name") });
  });
});
