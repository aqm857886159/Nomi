import { describe, expect, it } from "vitest";
import { chatImageFallbackOperation, matchesImageRouteDisabledText } from "./imageRouteFallback";
import { NEWAPI_IMAGE_CREATE_OP, NEWAPI_IMAGE_EDIT_OP } from "./newapiTransport";
import { VendorRequestError } from "../vendor/vendorHttp";

// 2026-07-24 y7api.top 真实报错定案：POST /v1/images/generations 403
// "Image generation is not enabled for this group" —— one-api 令牌分组没开 images 路由，
// 同模型 chat 路由能出图。回退三条件（OpenAI images 端点 + 确定性拒绝 + 窄短语）缺一不回退。

function vendorError(httpStatus: number, upstreamMsg: string): VendorRequestError {
  return new VendorRequestError(`Provider request failed (HTTP ${httpStatus}) at y7api-top POST https://y7api.top/v1/images/generations: ${upstreamMsg}`, {
    vendorKey: "y7api-top",
    method: "POST",
    url: "https://y7api.top/v1/images/generations",
    httpStatus,
    upstreamMsg,
    category: httpStatus === 403 ? "auth" : httpStatus >= 500 ? "server" : "input",
    retryable: false,
  });
}

describe("chatImageFallbackOperation — 中转生图路由回退", () => {
  it("y7api 定案原话：403 + images/generations + t2i → 回退 chat 多模态 op", () => {
    const op = chatImageFallbackOperation(
      vendorError(403, "Image generation is not enabled for this group"),
      NEWAPI_IMAGE_CREATE_OP,
      "text_to_image",
    );
    expect(op).toBe(NEWAPI_IMAGE_EDIT_OP);
  });

  it("404/405（路由不存在）无需文案命中也回退", () => {
    expect(chatImageFallbackOperation(vendorError(404, "not found"), NEWAPI_IMAGE_CREATE_OP, "text_to_image")).toBe(NEWAPI_IMAGE_EDIT_OP);
    expect(chatImageFallbackOperation(vendorError(405, ""), NEWAPI_IMAGE_CREATE_OP, "image_edit")).toBe(NEWAPI_IMAGE_EDIT_OP);
  });

  it("403 但原话是密钥/配额类 → 不回退（那不是路由问题，换路由只会串因）", () => {
    expect(chatImageFallbackOperation(vendorError(403, "invalid api key"), NEWAPI_IMAGE_CREATE_OP, "text_to_image")).toBeNull();
    expect(chatImageFallbackOperation(vendorError(403, "quota exceeded"), NEWAPI_IMAGE_CREATE_OP, "text_to_image")).toBeNull();
  });

  it("超时/普通 Error/5xx → 绝不重发（可能已扣费，守「重试不包付费提交」）", () => {
    expect(chatImageFallbackOperation(new Error("timeout"), NEWAPI_IMAGE_CREATE_OP, "text_to_image")).toBeNull();
    expect(chatImageFallbackOperation(vendorError(500, "Image generation is not enabled for this group"), NEWAPI_IMAGE_CREATE_OP, "text_to_image")).toBeNull();
  });

  it("非 OpenAI images 端点（kie 等自家路径）→ 永不误回退", () => {
    const kieOp = { ...NEWAPI_IMAGE_CREATE_OP, path: "/api/v1/jobs/createTask" };
    expect(chatImageFallbackOperation(vendorError(403, "Image generation is not enabled for this group"), kieOp, "text_to_image")).toBeNull();
  });

  it("非图片 taskKind → 不回退", () => {
    expect(chatImageFallbackOperation(vendorError(403, "Image generation is not enabled for this group"), NEWAPI_IMAGE_CREATE_OP, "text_to_video")).toBeNull();
  });
});

describe("matchesImageRouteDisabledText — 窄短语", () => {
  it("命中：分组/路由未开通类", () => {
    expect(matchesImageRouteDisabledText("Image generation is not enabled for this group")).toBe(true);
    expect(matchesImageRouteDisabledText("该分组未开通此模型无权限")).toBe(true);
  });
  it("不吞普通 403/无关文案", () => {
    expect(matchesImageRouteDisabledText("invalid api key")).toBe(false);
    expect(matchesImageRouteDisabledText("insufficient balance")).toBe(false);
  });
});
