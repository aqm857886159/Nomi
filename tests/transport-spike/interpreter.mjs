// 描述符解释器：把「声明式 Transport 描述符 + canonical 参数 + key」编译成一个 HTTP 请求。
// 这是"通用方法"的核心——所有家共用这一个解释器，差异全在描述符数据里。

function setByPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

// requestMap: [{ to:"image_size", from:"size" } | { to:"x", value:1 } | { to:"rf", from:"responseFormat", map:{b64:"base64"} }]
function applyRequestMap(map, params) {
  const body = {};
  for (const rule of map || []) {
    let val;
    if ("value" in rule) val = rule.value;
    else { val = params[rule.from]; if (rule.map && val in rule.map) val = rule.map[val]; }
    if (val === undefined || val === null) continue;
    setByPath(body, rule.to, val);
  }
  return body;
}

function applyAuth(headers, auth, key) {
  if (auth === "bearer") headers["authorization"] = `Bearer ${key}`;
  else if (auth === "key") headers["authorization"] = `Key ${key}`;            // fal
  else if (typeof auth === "string" && auth.startsWith("header:")) headers[auth.slice(7)] = key; // x-goog-api-key 等
  else headers["authorization"] = `Bearer ${key}`;
}

export function buildRequest(d, params, key) {
  const headers = { "content-type": "application/json" };
  applyAuth(headers, d.auth, key);
  Object.assign(headers, d.extraHeaders || {});
  const url = (d.endpoint || "").replace("{model}", encodeURIComponent(params.model || d.defaultModel || ""));

  let body;
  if (d.transport === "chat-modalities") {
    body = {
      model: params.model || d.defaultModel,
      messages: [{ role: "user", content: params.prompt }],
      modalities: d.modalities || ["image", "text"],
      ...(d.imageConfigKey ? { [d.imageConfigKey]: { aspect_ratio: params.aspectRatio } } : {}),
    };
  } else {
    // images-sync 与 async-task 都靠 requestMap 声明式构造（差异在 poll，与建请求无关）
    body = applyRequestMap(d.requestMap, params);
  }
  return { url, method: "POST", headers, body };
}
