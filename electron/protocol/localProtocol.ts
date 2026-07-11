import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { resolveProjectRelativePath } from "../projects/repository";

export function registerLocalProtocol(): void {
  protocol.handle("nomi-local", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "asset") {
        return new Response("Unsupported nomi-local host", { status: 404 });
      }
      // 解码与 localAssetUrl 的「逐段 encodeURIComponent」对称：先按 "/" 切段、再逐段 decode。
      // （此前先整体 decode 再 split，文件名若含被编码的 %2F 会让段边界错位 → 路径错位 404。）
      const segments = url.pathname
        .replace(/^\/+/, "")
        .split("/")
        .map((seg) => {
          try {
            return decodeURIComponent(seg);
          } catch {
            return seg;
          }
        });
      const [projectId, ...relativeParts] = segments;
      const relativePath = relativeParts.join("/");
      const filePath = resolveProjectRelativePath(projectId, relativePath);
      const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
      // canvas.toDataURL() 需要 CORS 头，否则 crossOrigin='anonymous' 加载的图片会污染画布
      // 导致九宫格/裁切等操作静默失败（SecurityError 被吞掉）。
      const corsHeaders = new Headers(fileResponse.headers);
      corsHeaders.set("Access-Control-Allow-Origin", "*");
      corsHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(fileResponse.body, { status: fileResponse.status, headers: corsHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : "local asset not found";
      return new Response(message, { status: 404 });
    }
  });
}
