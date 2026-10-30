// Local OpenAI-compatible HTTP bridge (http://127.0.0.1:1239/v1) that exposes:
//   - Antigravity CLI (`antigravity-cli`)
//   - Codex CLI (`codex-cli`)
//   - Claude Code (`claude-code`)
// as standard `/v1/chat/completions` + `/v1/models` endpoints with native OpenAI tool_calls SSE support.
"use strict";

const http = module.require("node:http");
const { spawn } = module.require("node:child_process");
const fs = module.require("node:fs");
const os = module.require("node:os");
const path = module.require("node:path");
const crypto = module.require("node:crypto");

const PORT = Number(process.env.NOMI_CLI_BRIDGE_PORT || 1239);
const HOST = "127.0.0.1";

function resolveBin(candidates) {
  for (const c of candidates) {
    if (c && path.isAbsolute(c) && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

const home = os.homedir();
const AGY_BIN = resolveBin([
  path.join(home, "AppData", "Local", "agy", "bin", "agy.exe"),
  path.join(home, ".local", "bin", "agy.exe"),
  "agy.exe",
]);
const CODEX_JS = resolveBin([
  path.join(home, "AppData", "Roaming", "npm", "node_modules", "@openai", "codex", "bin", "codex.js"),
]);
const CLAUDE_EXE = resolveBin([
  path.join(home, "AppData", "Roaming", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
  path.join(home, ".local", "bin", "claude.exe"),
]);

const CLI_MODELS = [
  { id: "antigravity-cli", cli: "agy", cliModel: "gemini-3.8-flash-high", label: "Antigravity CLI" },
  { id: "codex-cli", cli: "codex", cliModel: "gpt-6.1-sol", label: "Codex CLI" },
  { id: "claude-code", cli: "claude", cliModel: "claude-sonnet-5-5-medium", label: "Claude Code" },
];

function extractBridgeText(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => {
    if (typeof part === "string") return part;
    if (part && part.type === "text" && typeof part.text === "string") return part.text;
    throw Object.assign(new Error("bridge_unsupported_content: this existing CLI bridge accepts text only"), { statusCode: 400 });
  }).join("\n");
  throw Object.assign(new Error("bridge_unsupported_content: this existing CLI bridge accepts text only"), { statusCode: 400 });
}

function buildCliPrompt(messages, tools) {
  const parts = [];
  parts.push("CRITICAL DIRECTIVE: You are an API language model powering the Nomi filmmaking workbench. You MUST NEVER execute your own local terminal/command tools or shell commands. DO NOT use bash or local tools. Speak directly in natural language to the user, and if you need to perform an action on Nomi's storyboard/canvas, emit ONLY the specified <nomi_tool_calls> block.");
  const hasTools = Array.isArray(tools) && tools.length > 0;

  if (hasTools) {
    const compactTools = tools.map((t) => {
      const fn = t.function || t;
      return {
        name: fn.name,
        description: fn.description ? String(fn.description).slice(0, 260) : undefined,
        parameters: fn.parameters,
      };
    });
    parts.push([
      "### TOOL CALLING PROTOCOL (CRITICAL)",
      "You are the Nomi AI assistant connected to the Nomi workbench.",
      "You have access to the following Nomi workbench tools:",
      "```json",
      JSON.stringify(compactTools),
      "```",
      "If you need to invoke one or more Nomi tools to fulfill the user's request, output ONLY a `<nomi_tool_calls>` JSON block in this exact format (and no other text):",
      "<nomi_tool_calls>",
      '[{"name": "tool_name", "arguments": {"key": "value"}}]',
      "</nomi_tool_calls>",
      "Preserve authored titles and explicit language instructions. Generation-prompt language does not change conversation language.",
      "If you do NOT need to call any tool (or all tool steps are complete), respond directly to the user in the user's requested language without `<nomi_tool_calls>`.",
    ].join("\n"));
  }

  for (const msg of messages || []) {
    if (!msg || typeof msg !== "object") continue;
    const role = msg.role || "user";
    let text = extractBridgeText(msg.content);
    if (role === "system" || role === "developer") {
      parts.push(`[SYSTEM INSTRUCTIONS]\n${text}`);
    } else if (role === "user") {
      parts.push(`[USER]\n${text}`);
    } else if (role === "assistant") {
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments,
        }));
        text += `\n[CALLED TOOLS]: ${JSON.stringify(calls)}`;
      }
      parts.push(`[ASSISTANT]\n${text}`);
    } else if (role === "tool") {
      parts.push(`[TOOL RESULT (${msg.tool_call_id || msg.name || "tool"})]\n${text}`);
    }
  }

  return parts.join("\n\n");
}

function parseResponseForToolCalls(rawText) {
  let text = String(rawText || "").trim();
  const tagMatch = /<nomi_tool_calls>\s*([\s\S]*?)\s*<\/nomi_tool_calls>/i.exec(text);
  let candidateJson = tagMatch ? tagMatch[1].trim() : null;
  if (!candidateJson && text.startsWith("[") && text.endsWith("]")) {
    candidateJson = text;
  }
  if (candidateJson) {
    candidateJson = candidateJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed = null;
    try {
      parsed = JSON.parse(candidateJson);
    } catch {
      try {
        let repaired = candidateJson.replace(/}\s*}\s*}\s*,\s*{/g, "}},{");
        repaired = repaired.replace(/}\s*}\s*}\s*\]\s*}\s*\]/g, "}]}]");
        repaired = repaired.replace(/,\s*([\]}])/g, "$1");
        parsed = JSON.parse(repaired);
      } catch { /* Invalid model JSON remains ordinary text; no tool invocation is inferred. */ }
    }
    if (parsed) {
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const valid = arr.filter((item) => item && typeof item === "object" && typeof item.name === "string");
      if (valid.length > 0) {
        return {
          toolCalls: valid.map((item, idx) => ({
            index: idx,
            id: `call_${crypto.randomBytes(6).toString("hex")}`,
            type: "function",
            function: {
              name: item.name,
              arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
            },
          })),
          content: "",
        };
      }
    }
  }
  const cleanContent = text.replace(/<\/?nomi_tool_calls>/gi, "").trim();
  return { toolCalls: null, content: cleanContent };
}

function runCodexCli(prompt, cliModel, signal, terminateTree) {
  return new Promise((resolve, reject) => {
    const args = [CODEX_JS, "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--json"];
    if (cliModel) args.push("-m", cliModel);
    args.push("-");

    const child = spawn(process.execPath, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      try { terminateTree(child); } catch (error) { reject(error); return; }
      reject(new Error("bridge_aborted"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (error) => { signal?.removeEventListener("abort", onAbort); reject(error); });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      const messages = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "item.completed" && ev.item && ev.item.type === "agent_message" && typeof ev.item.text === "string") {
            messages.push(ev.item.text);
          }
        } catch { /* Non-JSON CLI progress is not a response event. */ }
      }
      if (messages.length > 0) return resolve(messages.join("\n"));
      if (code !== 0) return reject(new Error(`Codex CLI exited with ${code}: ${stderr || stdout}`));
      resolve(stdout.trim());
    });

    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}

async function runAgyCli(prompt, cliModel, signal, terminateTree) {
  const { makeTempDir, cleanupTestTemp } = await import("./_test-temp.mjs");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const tmpDir = makeTempDir("nomi-agy-chat-");
    const args = [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--disable-slash-commands",
      "--dangerously-skip-permissions",
      "--print-timeout", "180s",
    ];
    if (cliModel && cliModel !== "auto") args.push("--model", cliModel);

    const child = spawn(AGY_BIN, args, { cwd: tmpDir, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let text = "";
    let finalResponse = "";
    let promptSent = false;

    const onAbort = () => {
      try { terminateTree(child); } catch (error) { reject(error); return; }
      reject(new Error("bridge_aborted"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    const handleLine = (line) => {
      if (!line.trim()) return;
      try {
        const ev = JSON.parse(line);
        if (ev.event === "init" && !promptSent) {
          promptSent = true;
          child.stdin.end(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n", "utf8");
        } else if (ev.event === "step_update" && ev.step_update) {
          if (ev.step_update.step_type === "agent_response" && typeof ev.step_update.text_delta === "string") {
            text += ev.step_update.text_delta;
          }
        } else if (ev.event === "result" && ev.result) {
          if (typeof ev.result.response === "string") {
            finalResponse = ev.result.response;
          }
        }
      } catch { /* Non-JSON CLI progress is not a response event. */ }
    };

    child.stdout.on("data", (d) => {
      buffer += d.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      try { cleanupTestTemp(tmpDir); } catch (error) { reject(error); return; }
      reject(err);
    });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      handleLine(buffer);
      try { cleanupTestTemp(tmpDir); } catch (error) { reject(error); return; }
      const out = (finalResponse || text).trim();
      if (out) return resolve(out);
      if (code !== 0) return reject(new Error(`Antigravity CLI exited with ${code}: ${stderr}`));
      resolve("");
    });
  });
}

async function runClaudeCli(prompt, cliModel, signal, terminateTree) {
  signal?.throwIfAborted();
  // A native Claude failure is returned unchanged; it never selects another provider.
    if (!fs.existsSync(CLAUDE_EXE)) throw new Error("claude_not_found");
    const text = await new Promise((resolve, reject) => {
      const args = ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence"];
      if (cliModel) args.push("--model", cliModel);
      const child = spawn(CLAUDE_EXE, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        try { terminateTree(child); } catch (error) { reject(error); return; }
        reject(new Error("claude_timeout"));
      }, 15000);
      const onAbort = () => {
        clearTimeout(timer);
        try { terminateTree(child); } catch (error) { reject(error); return; }
        reject(new Error("bridge_aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
      child.on("error", (e) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed && !parsed.is_error && typeof parsed.result === "string" && parsed.result.trim()) {
            return resolve(parsed.result.trim());
          }
          return reject(new Error(parsed?.result || `claude_exit_${code}`));
        } catch {
          if (code === 0 && stdout.trim()) return resolve(stdout.trim());
          return reject(new Error(stderr || stdout || `claude_exit_${code}`));
        }
      });
      child.stdin.write(prompt, "utf8");
      child.stdin.end();
    });
    return text;
}

async function loadCliProcessTree() { return import("./lib/processTree.mjs"); }

async function executeCliModel(modelId, messages, tools, signal) {
  signal?.throwIfAborted();
  const selected = CLI_MODELS.find(model => model.id === String(modelId || "").trim());
  if (!selected) throw Object.assign(new Error("bridge_model_unknown"), { statusCode: 400 });
  const prompt = buildCliPrompt(messages, tools);
  const { killProcessTree } = await loadCliProcessTree();
  signal?.throwIfAborted();
  const reply = selected.cli === "codex" ? await runCodexCli(prompt, selected.cliModel, signal, killProcessTree)
    : selected.cli === "claude" ? await runClaudeCli(prompt, selected.cliModel, signal, killProcessTree)
    : await runAgyCli(prompt, selected.cliModel, signal, killProcessTree);
  if (typeof reply !== "string" || !reply.trim()) throw new Error("bridge_empty_response");
  return reply;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = (req.url || "").split("?")[0];
  if (req.method === "GET" && (url === "/v1/models" || url === "/models")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        object: "list",
        data: CLI_MODELS.map((m) => ({
          id: m.id,
          object: "model",
          created: 1700000000,
          owned_by: m.cli,
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        })),
      })
    );
    return;
  }

  if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
    let bodyRaw = "";
    req.on("data", (chunk) => { bodyRaw += chunk.toString("utf8"); });
    req.on("end", async () => {
      let body;
      try { body = JSON.parse(bodyRaw || "{}"); } catch { res.writeHead(400); res.end(JSON.stringify({error:{message:"bridge_invalid_json"}})); return; }
      if (!body || typeof body !== "object" || Array.isArray(body)) { res.writeHead(400); res.end(JSON.stringify({error:{message:"bridge_invalid_body"}})); return; }
      const modelId = typeof body.model === "string" ? body.model.trim() : "";
      const stream = Boolean(body.stream);
      const ac = new AbortController();
      res.on("close", () => { if (!res.writableEnded) ac.abort(); });

      try {
        const rawReply = await executeCliModel(modelId, body.messages || [], body.tools || [], ac.signal);
        const { toolCalls, content } = parseResponseForToolCalls(rawReply);
        const completionId = `chatcmpl-${crypto.randomBytes(8).toString("hex")}`;
        const created = Math.floor(Date.now() / 1000);

        if (!stream) {
          const message = toolCalls
            ? { role: "assistant", content: null, tool_calls: toolCalls }
            : { role: "assistant", content: content || rawReply };
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              id: completionId,
              object: "chat.completion",
              created,
              model: modelId,
              choices: [{ index: 0, message, finish_reason: toolCalls ? "tool_calls" : "stop" }],
            })
          );
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const sendChunk = (delta, finishReason = null) => {
          const payload = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: modelId,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        sendChunk({ role: "assistant", content: "" }, null);
        if (toolCalls) {
          sendChunk({ tool_calls: toolCalls }, null);
          sendChunk({}, "tool_calls");
        } else {
          sendChunk({ content: content || rawReply }, null);
          sendChunk({}, "stop");
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = err?.statusCode === 400 ? 400 : 500;
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { message: msg, type: status === 400 ? "invalid_request_error" : "server_error" } }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Not found" } }));
});

server.listen(PORT, HOST, () => {
  console.log(`[local-cli-bridge] listening on http://${HOST}:${PORT}/v1 (Antigravity CLI, Codex CLI, Claude Code)`);
});
