import { describe, expect, it } from "vitest";
import { parseClipboardFilePaths } from "./clipboardFilePaths";

describe("parseClipboardFilePaths", () => {
  it("parses macOS file-url clipboard bytes", () => {
    const bytes = Buffer.from("file:///Users/test/Pictures/hero%20image.png\0", "utf8");

    expect(parseClipboardFilePaths("public.file-url", bytes)).toEqual([
      "/Users/test/Pictures/hero image.png",
    ]);
  });

  it("parses multiple macOS file URLs separated by NUL bytes", () => {
    const bytes = Buffer.from("file:///Users/test/a.png\0file:///Users/test/b.jpg\0", "utf8");

    expect(parseClipboardFilePaths("public.file-url", bytes)).toEqual([
      "/Users/test/a.png",
      "/Users/test/b.jpg",
    ]);
  });

  it("parses Linux text/uri-list and ignores comments and non-file URLs", () => {
    const bytes = Buffer.from(
      "# copied files\r\nfile:///tmp/a.png\r\nhttps://example.com/b.png\r\nfile:///tmp/a.png\r\n",
      "utf8",
    );

    expect(parseClipboardFilePaths("text/uri-list", bytes)).toEqual(["/tmp/a.png"]);
  });

  it("parses Windows FileNameW multi-string bytes", () => {
    const bytes = Buffer.from("C:\\Users\\test\\a.png\0D:\\Pictures\\b.jpg\0\0", "utf16le");

    expect(parseClipboardFilePaths("FileNameW", bytes)).toEqual([
      "C:\\Users\\test\\a.png",
      "D:\\Pictures\\b.jpg",
    ]);
  });

  it("preserves file URI drive paths on Windows and POSIX hosts", () => {
    const bytes = Buffer.from("file:///C:/Users/test/hero%20image.png\0", "utf8");
    const expected = process.platform === "win32"
      ? "C:\\Users\\test\\hero image.png"
      : "C:/Users/test/hero image.png";

    expect(parseClipboardFilePaths("public.file-url", bytes)).toEqual([expected]);
  });

  it("preserves file URI UNC authorities without treating them as remote URLs", () => {
    const bytes = Buffer.from("file://render-host/share/hero.png\0", "utf8");
    const expected = process.platform === "win32" ? "\\\\render-host\\share\\hero.png" : "//render-host/share/hero.png";

    expect(parseClipboardFilePaths("public.file-url", bytes)).toEqual([expected]);
  });

  it("returns no paths for unknown formats or relative values", () => {
    expect(parseClipboardFilePaths("text/plain", Buffer.from("file:///tmp/a.png"))).toEqual(["/tmp/a.png"]);
    expect(parseClipboardFilePaths("text/plain", Buffer.from("/tmp/b.png"))).toEqual(["/tmp/b.png"]);
    expect(parseClipboardFilePaths("FileNameW", Buffer.from("relative.png\0\0", "utf16le"))).toEqual([]);
    expect(parseClipboardFilePaths("unknown", Buffer.from("/tmp/c.png"))).toEqual([]);
  });
});
