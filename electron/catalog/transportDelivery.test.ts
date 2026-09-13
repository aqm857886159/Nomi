import { describe, expect, it } from "vitest";
import {
  assertTransportDeliveryContract,
  modeDeliveryDefect,
  resolveModeDelivery,
} from "./transportDelivery";
import { NEWAPI_DELIVERY_CONTRACTS, newapiTransportFor } from "./newapiTransport";

const query = { method: "GET", path: "/v1/video/generations/{{task_id}}" };
const statusMapping = { succeeded: ["succeeded"], failed: ["failed"] };

describe("交付形状是契约声明的事实，不是 kind 的常量", () => {
  it("没有显式声明时按存量事实推断：有 query 即异步", () => {
    expect(resolveModeDelivery({})).toBe("synchronous");
    expect(resolveModeDelivery({ query })).toBe("asynchronous");
    expect(resolveModeDelivery({ delivery: "asynchronous", query, statusMapping })).toBe("asynchronous");
  });

  it("声明异步却没有查询端点 = 缺陷（这正是 09-11 群反馈那句报错的根因）", () => {
    expect(modeDeliveryDefect({ delivery: "asynchronous" }))
      .toBe("declares asynchronous delivery but has no query operation");
    expect(modeDeliveryDefect({ delivery: "asynchronous", query }))
      .toBe("declares asynchronous delivery but has no status mapping");
    expect(modeDeliveryDefect({ delivery: "asynchronous", query, statusMapping })).toBeNull();
  });

  it("声明同步却带着轮询端点也是缺陷（两份真相源）", () => {
    expect(modeDeliveryDefect({ delivery: "synchronous", query }))
      .toBe("declares synchronous delivery but also carries a query operation");
    expect(modeDeliveryDefect({ delivery: "synchronous" })).toBeNull();
  });

  it("传输配方层还多管一件事：异步必须声明「任务不要了怎么办」，没有第三种叫丢掉", () => {
    expect(() => assertTransportDeliveryContract("probe", { delivery: "asynchronous", query, statusMapping }))
      .toThrow(/abandon disposition/);
    expect(() => assertTransportDeliveryContract("probe", {
      delivery: "asynchronous", query, statusMapping, abandon: { via: "poll-to-completion" },
    })).not.toThrow();
    expect(() => assertTransportDeliveryContract("probe", {
      delivery: "asynchronous", query, statusMapping, abandon: { via: "cancel-operation", cancel: { method: "DELETE", path: "/v1/tasks/{{task_id}}" } },
    })).not.toThrow();
  });

  it("new-api 每一格都自己声明，且每一格都过得了这条不变量", () => {
    for (const [taskKind, contract] of Object.entries(NEWAPI_DELIVERY_CONTRACTS)) {
      expect(() => assertTransportDeliveryContract(taskKind, contract)).not.toThrow();
    }
    // 视频是任务制（new-api 公开契约只给了 create + query，没有取消端点 → 只能轮询到底）。
    expect(NEWAPI_DELIVERY_CONTRACTS.text_to_video.delivery).toBe("asynchronous");
    expect(NEWAPI_DELIVERY_CONTRACTS.text_to_video.abandon.via).toBe("poll-to-completion");
    // 图片/改图/配音按 new-api 文档是同步返回结果。**这一格以前是按 kind 写死的**。
    expect(NEWAPI_DELIVERY_CONTRACTS.text_to_image.delivery).toBe("synchronous");
    expect(NEWAPI_DELIVERY_CONTRACTS.image_edit.delivery).toBe("synchronous");
    expect(NEWAPI_DELIVERY_CONTRACTS.text_to_audio.delivery).toBe("synchronous");
  });

  it("配方产出的每条 wire 都带着自己的声明（改图不再靠别人手工撒 async）", () => {
    const image = newapiTransportFor("image");
    expect(image.delivery).toBe("synchronous");
    expect(image.edit?.delivery).toBe("synchronous");
    const video = newapiTransportFor("video");
    expect(video.delivery).toBe("asynchronous");
    expect(video.query).toBeTruthy();
    expect(video.imageToVideo?.delivery).toBe("asynchronous");
    expect(video.imageToVideo?.query, "图生视频没有自己的轮询端点 —— 它会永远停在 pending").toBeTruthy();
    expect(newapiTransportFor("audio").delivery).toBe("synchronous");
  });
});
