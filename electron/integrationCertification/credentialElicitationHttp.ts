import type http from "node:http";
import { desktopT } from "../i18n";
import {
  CREDENTIAL_ELICITATION_PATH,
  type CredentialElicitationDescriptor,
  type CredentialElicitationStore,
} from "./credentialElicitation";

// The loopback page behind an MCP URL-mode elicitation (spec 2025-11-25 §URL Mode Elicitation for
// Sensitive Data). Served by the same 127.0.0.1 server this process already runs — no second listener.
//
// Three rules this file exists to keep:
//  1. The key is read from the request body and handed straight to the trusted credential writer. It is
//     never logged, never put in a response body, and never returned to the MCP layer.
//  2. Every outbound string passes through `scrub`, so even a third-party error message that happened to
//     quote the submitted key cannot leave this boundary.
//  3. GET renders; only POST /save consumes the single-use ticket.

const MAX_BODY = 32 * 1024;

export type CredentialElicitationHttpDeps = {
  store: CredentialElicitationStore;
  /** Trusted credential write (IntegrationSessionService.saveCredential, owner "nomi"). Throws on failure. */
  saveCredential: (sessionId: string, apiKey: string) => void | Promise<void>;
  /** Optional live probe for the "test connection" button. Resolves to the discovered model count. */
  testCredential?: (sessionId: string, apiKey: string) => Promise<number>;
};

/** Remove any occurrence of the submitted secret from an outbound string. Belt to the braces above. */
export function scrub(text: string, secret: string): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join("[redacted]");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pageHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    // No remote anything: the page is entirely self-contained, and can only talk back to this origin.
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
}

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("credential_body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#f6f6f5;color:#1b1b19}
main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e2e1dd;border-radius:12px;padding:24px}
h1{margin:0 0 8px;font-size:18px;font-weight:650}
p.lede{margin:0 0 20px;color:#6b6a66;font-size:13px}
dl{margin:0 0 18px;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
dt{color:#6b6a66}
dd{margin:0;overflow-wrap:anywhere}
label{display:block;font-size:13px;margin-bottom:6px;font-weight:550}
input{width:100%;padding:9px 11px;font:inherit;border:1px solid #d4d3ce;border-radius:8px;background:#fff;color:inherit}
input:focus{outline:2px solid #3c6df0;outline-offset:1px}
.row{display:flex;gap:10px;margin-top:16px}
button{flex:1;padding:9px 14px;font:inherit;font-weight:550;border-radius:8px;border:1px solid #d4d3ce;background:#fff;color:inherit;cursor:pointer}
button.primary{background:#1b1b19;border-color:#1b1b19;color:#fff}
button[disabled]{opacity:.5;cursor:default}
#status{margin-top:14px;font-size:13px;min-height:19px}
#status.err{color:#b3261e}
#status.ok{color:#1a7f46}
@media (prefers-color-scheme:dark){
body{background:#161615;color:#eceae4}
main{background:#1f1f1e;border-color:#33322f}
p.lede,dt{color:#a3a19a}
input{background:#161615;border-color:#3d3c38;color:inherit}
button{background:#262625;border-color:#3d3c38}
button.primary{background:#eceae4;border-color:#eceae4;color:#161615}
}`;

function renderPage(descriptor: CredentialElicitationDescriptor, token: string): string {
  const t = (key: Parameters<typeof desktopT>[0], values?: Record<string, string | number>) => escapeHtml(desktopT(key, values));
  // Copy is passed to the client as data (JSON) rather than spliced into the inline script, so no
  // translation string can ever be interpreted as code.
  const copy = {
    keyRequired: desktopT("integration.credentialPage.keyRequired"),
    testing: desktopT("integration.credentialPage.testing"),
    testOk: desktopT("integration.credentialPage.testOk"),
    testFailed: desktopT("integration.credentialPage.testFailed"),
    test: desktopT("integration.credentialPage.test"),
    saving: desktopT("integration.credentialPage.saving"),
    saved: desktopT("integration.credentialPage.saved"),
    saveFailed: desktopT("integration.credentialPage.saveFailed"),
    save: desktopT("integration.credentialPage.save"),
    path: CREDENTIAL_ELICITATION_PATH,
    token,
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${t("integration.credentialPage.title")}</title><style>${STYLE}</style></head>
<body><main>
<h1>${t("integration.credentialPage.title")}</h1>
<p class="lede">${t("integration.credentialPage.lede")}</p>
<dl>
<dt>${t("integration.credentialPage.providerLabel")}</dt><dd>${escapeHtml(descriptor.display.name)}</dd>
<dt>${t("integration.credentialPage.baseUrlLabel")}</dt><dd>${escapeHtml(descriptor.display.baseUrl)}</dd>
</dl>
<label for="key">${t("integration.credentialPage.keyLabel")}</label>
<input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="${t("integration.credentialPage.keyPlaceholder")}">
<div class="row">
<button id="test" type="button">${t("integration.credentialPage.test")}</button>
<button id="save" type="button" class="primary">${t("integration.credentialPage.save")}</button>
</div>
<p id="status" role="status"></p>
</main>
<script id="copy" type="application/json">${JSON.stringify(copy).replace(/</g, "\\u003c")}</script>
<script>
(function(){
  var C = JSON.parse(document.getElementById('copy').textContent);
  var key = document.getElementById('key');
  var status = document.getElementById('status');
  var test = document.getElementById('test');
  var save = document.getElementById('save');
  function fill(template, values){ return template.replace(/\\{\\{(\\w+)\\}\\}/g, function(_, n){ return String(values[n]); }); }
  function say(text, kind){ status.textContent = text; status.className = kind || ''; }
  function busy(on){ test.disabled = on; save.disabled = on; }
  function post(route, body){
    return fetch(C.path + route, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      .then(function(r){ return r.json().catch(function(){ return { ok:false, reason:'invalid_response' }; }); });
  }
  test.addEventListener('click', function(){
    if (!key.value) { say(C.keyRequired, 'err'); return; }
    busy(true); say(C.testing);
    post('/test', { t: C.token, apiKey: key.value }).then(function(res){
      busy(false);
      if (res && res.ok) say(fill(C.testOk, { count: res.count }), 'ok');
      else say(fill(C.testFailed, { reason: (res && res.reason) || '' }), 'err');
    }).catch(function(){ busy(false); say(fill(C.testFailed, { reason: 'network' }), 'err'); });
  });
  save.addEventListener('click', function(){
    if (!key.value) { say(C.keyRequired, 'err'); return; }
    busy(true); say(C.saving);
    post('/save', { t: C.token, apiKey: key.value }).then(function(res){
      key.value = '';
      if (res && res.ok) {
        say(C.saved, 'ok');
        // A tab the MCP client opened cannot always be closed by script; the message above is the
        // reliable signal, window.close() is the nicety when the browser allows it.
        setTimeout(function(){ try { window.close(); } catch (e) { /* user closes it */ } }, 800);
        return;
      }
      busy(false);
      say(fill(C.saveFailed, { reason: (res && res.reason) || '' }), 'err');
    }).catch(function(){ busy(false); say(fill(C.saveFailed, { reason: 'network' }), 'err'); });
  });
})();
</script></body></html>`;
}

function expiredPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(desktopT("integration.credentialPage.title"))}</title><style>${STYLE}</style></head>
<body><main><h1>${escapeHtml(desktopT("integration.credentialPage.title"))}</h1>
<p class="lede">${escapeHtml(desktopT("integration.credentialPage.expired"))}</p></main></body></html>`;
}

function parseRequest(body: string): { token: unknown; apiKey: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    throw new Error("invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
  const record = parsed as Record<string, unknown>;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey : "";
  if (!apiKey.trim()) throw new Error("key_required");
  return { token: record.t, apiKey };
}

/**
 * Handle the credential-elicitation routes. Returns false when the request is for some other path, so
 * the host server can go on to its own routing.
 */
export async function handleIntegrationCredentialHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: CredentialElicitationHttpDeps,
): Promise<boolean> {
  const parsed = new URL(req.url || "/", "http://127.0.0.1");
  if (parsed.pathname !== CREDENTIAL_ELICITATION_PATH && !parsed.pathname.startsWith(`${CREDENTIAL_ELICITATION_PATH}/`)) {
    return false;
  }
  const route = parsed.pathname.slice(CREDENTIAL_ELICITATION_PATH.length);

  if (route === "" && (req.method === "GET" || req.method === "HEAD")) {
    const token = parsed.searchParams.get("t") || "";
    const descriptor = deps.store.resolve(token);
    const html = descriptor ? renderPage(descriptor, token) : expiredPage();
    res.writeHead(descriptor ? 200 : 410, pageHeaders());
    res.end(req.method === "HEAD" ? undefined : html);
    return true;
  }

  if ((route === "/test" || route === "/save") && req.method === "POST") {
    let apiKey = "";
    try {
      const body = await readBody(req);
      const request = parseRequest(body);
      apiKey = request.apiKey;
      // /test must not burn the ticket — a user may test several keys before saving.
      const descriptor = route === "/test" ? deps.store.resolve(request.token) : deps.store.redeem(request.token);
      if (!descriptor) throw new Error("expired");
      if (route === "/test") {
        if (!deps.testCredential) throw new Error("test_unavailable");
        const count = await deps.testCredential(descriptor.sessionId, apiKey);
        res.writeHead(200, jsonHeaders());
        res.end(JSON.stringify({ ok: true, count }));
        return true;
      }
      await deps.saveCredential(descriptor.sessionId, apiKey);
      res.writeHead(200, jsonHeaders());
      res.end(JSON.stringify({ ok: true }));
      return true;
    } catch (error) {
      const raw = error instanceof Error ? error.message : "unknown";
      res.writeHead(400, jsonHeaders());
      res.end(JSON.stringify({ ok: false, reason: scrub(raw, apiKey).slice(0, 240) }));
      return true;
    }
  }

  res.writeHead(405, jsonHeaders());
  res.end(JSON.stringify({ ok: false, reason: "method_not_allowed" }));
  return true;
}
