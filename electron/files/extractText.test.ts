import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractTextFromBytes } from "./extractText";

describe("extractTextFromBytes (real libs)", () => {
  it("reads plain text + markdown + csv as utf8", async () => {
    expect(await extractTextFromBytes(Buffer.from("hello\nworld"), "text/plain", "a.txt")).toBe("hello\nworld");
    expect(await extractTextFromBytes(Buffer.from("# 标题"), "text/markdown", "b.md")).toBe("# 标题");
    expect(await extractTextFromBytes(Buffer.from("a,b\n1,2"), "text/csv", "d.csv")).toContain("a,b");
  });

  it("extracts real xlsx cell content", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Age"],
      ["Alice", 30],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "People");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const text = (await extractTextFromBytes(buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "data.xlsx")) || "";
    expect(text).toContain("People");
    expect(text).toContain("Alice");
    expect(text).toContain("Age");
  });

  it("returns null for unknown binary", async () => {
    expect(await extractTextFromBytes(Buffer.from([0, 1, 2, 3]), "application/octet-stream", "x.bin")).toBeNull();
  });

  it("caps overly long content", async () => {
    const long = "x".repeat(200_000);
    const out = (await extractTextFromBytes(Buffer.from(long), "text/plain", "big.txt")) || "";
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("已截断");
  });
});
