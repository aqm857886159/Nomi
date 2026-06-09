// 把文档附件（docx/xlsx/csv/txt/md）抽成纯文本，注入 agent prompt（任何文本模型可用）。
// 在主进程跑（解析库重，不进渲染层 bundle）；图片/PDF 不走这里（它们走原生多模态）。
//
// 注意：localAssetFile 会链到 electron 包（projects/repository → app），在 vitest(Node)
// 里 import 会报「Electron failed to install」。故 readNomiLocalAsset 改动态 import，
// 让本模块的 eager 依赖图保持 electron-free——extractTextFromBytes 单测才能在 CI 跑（无 electron 运行时）。

const MAX_EXTRACTED_CHARS = 120_000;

function cap(text: string): string {
  return text.length > MAX_EXTRACTED_CHARS
    ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n…（内容过长，已截断）`
    : text;
}

async function extractDocx(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return String(result?.value ?? "");
}

async function extractXlsx(bytes: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheets: string[] = [];
  for (const name of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
    if (csv.trim()) sheets.push(`# ${name}\n${csv}`);
  }
  return sheets.join("\n\n");
}

export async function extractTextFromBytes(
  bytes: Buffer,
  contentType: string,
  fileName: string,
): Promise<string | null> {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const ct = (contentType || "").toLowerCase();
  try {
    if (ct.includes("word") || ext === "docx") return cap(await extractDocx(bytes));
    if (ct.includes("sheet") || ct.includes("excel") || ext === "xlsx" || ext === "xls") {
      return cap(await extractXlsx(bytes));
    }
    if (ext === "csv" || ct.includes("csv")) return cap(bytes.toString("utf8"));
    if (ct.startsWith("text/") || ["txt", "md", "markdown", "json"].includes(ext)) {
      return cap(bytes.toString("utf8"));
    }
    return null;
  } catch {
    return null;
  }
}

export async function extractTextFromLocalAsset(
  url: string,
  contentType: string,
  fileName: string,
): Promise<string | null> {
  const { readNomiLocalAsset } = await import("../assets/localAssetFile");
  const asset = readNomiLocalAsset(url);
  if (!asset) return null;
  return extractTextFromBytes(asset.bytes, contentType || asset.contentType, fileName || asset.fileName);
}
