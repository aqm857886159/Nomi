// Mock new-api 网关（Issue #8 自动 E2E 用，零依赖 node http）。
// 按 new-api 官方文档形状返回，让我们在**没有真实付费中转**的情况下，对着忠实 mock 验证
// Nomi 自己写的代码：onboarding 拉取/分类/保存 + 节点生成的路由/轮询/解析。
// 真实 vendor 字段的细微差异由防御式 extractAssetUrl + issue reporter 跑探测脚本确认。
//
// 端点（doc.newapi.pro / newapi.ai）：
//   GET  /v1/models                     → {object:list, data:[{id,object:model}]}（混合图/视频/文本 id）
//   POST /v1/images/generations         → **同步** {created, data:[{url}]}
//   POST /v1/video/generations          → **异步** {task_id, status:processing}
//   GET  /v1/video/generations/{id}     → 前几次 processing，之后 {status:succeeded, data:[{url}]}
//   GET  /asset/img.png | /asset/vid.mp4 → 小资产字节（供 runtime 下载本地化）
//
// 用法：NEWAPI_MOCK_PORT=8799 node tests/transport-spike/newapi-mock.mjs
import http from "node:http";

const PORT = Number(process.env.NEWAPI_MOCK_PORT || 8799);
const VIDEO_POLLS_BEFORE_DONE = Number(process.env.NEWAPI_MOCK_VIDEO_POLLS || 1);

// 1x1 PNG（透明）字节，作图片/视频资产占位（runtime 只需下载成功）。
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

const MODELS = [
  "dall-e-3", "flux-1.1-pro", "gpt-image-1", // 图片
  "kling-v1", "cogvideox", // 视频
  "gpt-4o", "deepseek-chat", // 文本
];

const videoTasks = new Map(); // task_id → { polls }

function send(res, status, obj, headers = {}) {
  const body = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { "Content-Type": Buffer.isBuffer(obj) ? "application/octet-stream" : "application/json", ...headers });
  res.end(body);
}

function base(req) {
  return `http://localhost:${PORT}`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  let bodyChunks = [];
  req.on("data", (c) => bodyChunks.push(c));
  req.on("end", () => {
    const rawBody = Buffer.concat(bodyChunks).toString("utf8");
    let body = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }

    // 资产
    if (path === "/asset/img.png" || path === "/asset/vid.mp4") {
      return send(res, 200, PNG_1x1);
    }
    // 模型列表
    if (path === "/v1/models" && req.method === "GET") {
      return send(res, 200, { object: "list", data: MODELS.map((id) => ({ id, object: "model" })) });
    }
    // 图片：同步
    if (path === "/v1/images/generations" && req.method === "POST") {
      if (!body.model || !body.prompt) return send(res, 400, { error: { message: "model and prompt required" } });
      return send(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ url: `${base(req)}/asset/img.png`, revised_prompt: body.prompt }] });
    }
    // 视频：异步提交
    if (path === "/v1/video/generations" && req.method === "POST") {
      if (!body.model || !body.prompt) return send(res, 400, { error: { message: "model and prompt required" } });
      const taskId = `vtask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      videoTasks.set(taskId, { polls: 0 });
      return send(res, 201, { id: `gen_${taskId}`, object: "video", model: body.model, created_at: Math.floor(Date.now() / 1000), task_id: taskId, status: "processing" });
    }
    // 视频：轮询
    const vMatch = path.match(/^\/v1\/video\/generations\/(.+)$/);
    if (vMatch && req.method === "GET") {
      const taskId = vMatch[1];
      const task = videoTasks.get(taskId);
      if (!task) return send(res, 404, { error: { message: "task not found" } });
      task.polls += 1;
      if (task.polls <= VIDEO_POLLS_BEFORE_DONE) {
        return send(res, 200, { task_id: taskId, status: "processing" });
      }
      return send(res, 200, { task_id: taskId, status: "succeeded", data: [{ url: `${base(req)}/asset/vid.mp4` }] });
    }

    return send(res, 404, { error: { message: `mock: no route ${req.method} ${path}` } });
  });
});

server.listen(PORT, () => {
  console.log(`[newapi-mock] listening http://localhost:${PORT} (video done after ${VIDEO_POLLS_BEFORE_DONE} poll)`);
});
