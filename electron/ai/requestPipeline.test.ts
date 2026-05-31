import { describe, it, expect } from "vitest";
import {
  appendQueryParams,
  authHeaders,
  authQueryParams,
  buildHttpRequest,
  buildTemplateContext,
  extractTaskId,
  joinUrl,
  looksLikeLogicalError,
  renderTemplateString,
  renderTemplateValue,
} from "./requestPipeline";

// These tests lock down the SINGLE request-building pipeline shared by
// production (runtime.ts) and the onboarding wizard test-curl (tools.ts).
// Every drift bug we hit (param mismatch, 401, 422 "recordInfo is null")
// is a case where these two used to disagree — so this file is the contract.

describe("extractTaskId", () => {
  it("reads kie's data.taskId envelope (the 422 'recordInfo is null' root cause)", () => {
    const createResponse = { code: 200, msg: "success", data: { taskId: "kie-abc-123" } };
    expect(extractTaskId(createResponse)).toBe("kie-abc-123");
  });

  it("prefers an explicit response_mapping path when given", () => {
    const resp = { data: { task_id: "envelope", custom: { id: "explicit" } } };
    expect(extractTaskId(resp, "data.custom.id")).toBe("explicit");
  });

  it("falls back to top-level id/taskId/jobId", () => {
    expect(extractTaskId({ id: "top" })).toBe("top");
    expect(extractTaskId({ taskId: "t" })).toBe("t");
    expect(extractTaskId({ jobId: "j" })).toBe("j");
  });

  it("returns empty string when no id is present (so caller can use a fallback)", () => {
    expect(extractTaskId({ msg: "no id here" })).toBe("");
    expect(extractTaskId(null)).toBe("");
    expect(extractTaskId("string")).toBe("");
  });
});

describe("authHeaders", () => {
  it("bearer", () => {
    expect(authHeaders("bearer", "KEY")).toEqual({ Authorization: "Bearer KEY" });
  });
  it("x-api-key with custom header name", () => {
    expect(authHeaders("x-api-key", "KEY", "X-Custom")).toEqual({ "X-Custom": "KEY" });
  });
  it("x-api-key default header name", () => {
    expect(authHeaders("x-api-key", "KEY")).toEqual({ "X-API-Key": "KEY" });
  });
  it("none/query carry no header", () => {
    expect(authHeaders("none", "KEY")).toEqual({});
    expect(authHeaders("query", "KEY")).toEqual({});
  });
  it("no key → no header (avoids `Authorization: Bearer ` empty)", () => {
    expect(authHeaders("bearer", "")).toEqual({});
  });
});

describe("authQueryParams", () => {
  it("only emits for query auth", () => {
    expect(authQueryParams("query", "KEY", "api_key")).toEqual({ api_key: "KEY" });
    expect(authQueryParams("bearer", "KEY")).toEqual({});
  });
});

describe("template rendering", () => {
  const ctx = buildTemplateContext({
    request: { prompt: "a cat" },
    params: { aspect_ratio: "16:9", input_urls: ["http://x/y.png"] },
    model: { displayName: "GPT Image" },
    modelKey: "gpt-image-2",
    apiKey: "SECRET",
    providerMeta: { task_id: "T-1" },
  });

  it("exposes user_api_key AND account.* (the 401 fix — both names resolve)", () => {
    expect(renderTemplateString("{{user_api_key}}", ctx)).toBe("SECRET");
    expect(renderTemplateString("{{account.api_key}}", ctx)).toBe("SECRET");
    expect(renderTemplateString("Bearer {{user_api_key}}", ctx)).toBe("Bearer SECRET");
  });

  it("exposes modelKey and model_key (both placeholder styles used in catalog)", () => {
    expect(renderTemplateString("{{model.modelKey}}", ctx)).toBe("gpt-image-2");
    expect(renderTemplateString("{{model.model_key}}", ctx)).toBe("gpt-image-2");
  });

  it("resolves request + params + providerMeta paths", () => {
    expect(renderTemplateString("{{request.prompt}}", ctx)).toBe("a cat");
    expect(renderTemplateString("{{request.params.aspect_ratio}}", ctx)).toBe("16:9");
    expect(renderTemplateString("{{providerMeta.task_id}}", ctx)).toBe("T-1");
  });

  it("exact-match passthrough preserves arrays/objects (not stringified)", () => {
    expect(renderTemplateValue("{{request.params.input_urls}}", ctx)).toEqual(["http://x/y.png"]);
  });

  it("missing placeholder renders empty string inline", () => {
    expect(renderTemplateString("x={{request.params.nope}}", ctx)).toBe("x=");
  });
});

describe("joinUrl", () => {
  it("joins relative path", () => {
    expect(joinUrl("https://api.kie.ai", "/api/v1/jobs/createTask")).toBe("https://api.kie.ai/api/v1/jobs/createTask");
  });
  it("strips trailing slash on base", () => {
    expect(joinUrl("https://api.kie.ai/", "/x")).toBe("https://api.kie.ai/x");
  });
  it("passes through absolute path", () => {
    expect(joinUrl("https://api.kie.ai", "https://other.com/z")).toBe("https://other.com/z");
  });
  it("does not double-append when base already ends with path", () => {
    expect(joinUrl("https://api.example.com/v1", "/v1")).toBe("https://api.example.com/v1");
  });
});

describe("appendQueryParams", () => {
  it("appends and skips empty/null values", () => {
    expect(appendQueryParams("https://h/p", { taskId: "T", empty: "", nil: null })).toBe("https://h/p?taskId=T");
  });
});

describe("looksLikeLogicalError", () => {
  it("detects { code: 4xx } HTTP-200 envelopes", () => {
    expect(looksLikeLogicalError({ code: 422, msg: "bad" })).toBe(422);
    expect(looksLikeLogicalError({ code: "404" })).toBe(404);
  });
  it("ignores success codes", () => {
    expect(looksLikeLogicalError({ code: 200 })).toBeNull();
    expect(looksLikeLogicalError({ data: {} })).toBeNull();
  });
});

describe("buildHttpRequest — the create POST (kie text_to_image)", () => {
  const operation = {
    method: "POST",
    path: "/api/v1/jobs/createTask",
    headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
    body: { model: "{{model.modelKey}}", input: { prompt: "{{request.prompt}}", aspect_ratio: "{{request.params.aspect_ratio}}" } },
  };
  const context = buildTemplateContext({
    request: { prompt: "a dog" },
    params: { aspect_ratio: "1:1" },
    model: {},
    modelKey: "gpt-image-2",
    apiKey: "SECRET",
  });
  const built = buildHttpRequest({ baseUrl: "https://api.kie.ai", authType: "bearer", apiKey: "SECRET", context, operation });

  it("resolves the auth header (no empty Bearer)", () => {
    expect(built.headers.Authorization).toBe("Bearer SECRET");
  });
  it("builds the absolute url", () => {
    expect(built.url).toBe("https://api.kie.ai/api/v1/jobs/createTask");
  });
  it("renders the body template", () => {
    expect(built.body).toEqual({ model: "gpt-image-2", input: { prompt: "a dog", aspect_ratio: "1:1" } });
  });
  it("redacts secrets in preview", () => {
    expect(built.preview.headers.Authorization).toBe("[redacted]");
  });
});

describe("buildHttpRequest — auth header fallback + override semantics", () => {
  const context = buildTemplateContext({ request: {}, params: {}, model: {}, modelKey: "m", apiKey: "SECRET" });

  it("applies authHeaders when the mapping declares no Authorization header", () => {
    const built = buildHttpRequest({ baseUrl: "https://h", authType: "bearer", apiKey: "SECRET", context, operation: { method: "POST", path: "/p", body: { a: 1 } } });
    expect(built.headers.Authorization).toBe("Bearer SECRET");
  });

  it("a resolved mapping Authorization header overrides authHeaders", () => {
    const built = buildHttpRequest({
      baseUrl: "https://h",
      authType: "bearer",
      apiKey: "SECRET",
      context,
      operation: { method: "POST", path: "/p", headers: { Authorization: "Bearer {{user_api_key}}" }, body: { a: 1 } },
    });
    // Both resolve to the same value — the point is it's never empty.
    expect(built.headers.Authorization).toBe("Bearer SECRET");
  });
});

describe("buildHttpRequest — the query GET (kie recordInfo poll)", () => {
  const operation = {
    method: "GET",
    path: "/api/v1/jobs/recordInfo",
    headers: { Authorization: "Bearer {{user_api_key}}" },
    query: { taskId: "{{providerMeta.task_id}}" },
  };
  const context = buildTemplateContext({
    request: {},
    params: {},
    model: {},
    modelKey: "m",
    apiKey: "SECRET",
    providerMeta: { task_id: "kie-abc-123" },
  });
  const built = buildHttpRequest({ baseUrl: "https://api.kie.ai", authType: "bearer", apiKey: "SECRET", context, operation });

  it("renders the real task id into the query (not a fabricated fallback)", () => {
    expect(built.query).toEqual({ taskId: "kie-abc-123" });
    expect(appendQueryParams(built.url, built.query)).toBe("https://api.kie.ai/api/v1/jobs/recordInfo?taskId=kie-abc-123");
  });
  it("adds no Content-Type to a GET with no body", () => {
    expect(Object.keys(built.headers).some((k) => k.toLowerCase() === "content-type")).toBe(false);
  });
});
