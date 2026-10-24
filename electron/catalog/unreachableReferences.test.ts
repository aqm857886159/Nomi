// L3 第三闸：这条 wire 的 body 到底读不读得到本次携带的参考素材。
// 判据 derive 自 body 引用的 {{request.params.X}}，不 hardcode 任何 vendor 键名。
import { describe, expect, it } from "vitest";
import { unreachableReferenceLabels } from "./taskParams";
import { NEWAPI_VIDEO_CREATE_OP } from "./newapiTransport";
import { VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";

const FIRST = "https://cdn.example.com/first.png";
const LAST = "https://cdn.example.com/last.png";
const ROLE = "https://cdn.example.com/role-1.png";
const ROLE_2 = "https://cdn.example.com/role-2.png";
const VIDEO = "https://cdn.example.com/move.mp4";

const nativeI2vBody = VOLCENGINE_VIDEO_MODELS[0].mappings.find((m) => m.taskKind === "image_to_video")?.create.body;

describe("unreachableReferenceLabels", () => {
  it("通用中转最小模板：首帧发得出，尾帧/角色图/参考视频发不出（此前是静默丢）", () => {
    const labels = unreachableReferenceLabels(
      {
        extras: {
          firstFrameUrl: FIRST,
          lastFrameUrl: LAST,
          referenceImageUrls: [ROLE],
          referenceVideoUrls: [VIDEO],
        },
      },
      NEWAPI_VIDEO_CREATE_OP.body,
    );
    expect(labels).not.toContain("首帧");
    expect(labels.sort()).toEqual(["参考视频", "尾帧", "角色参考图"].sort());
  });

  it("火山原生报文：首/尾帧、角色图、参考视频全都发得出 → 零拦截", () => {
    const labels = unreachableReferenceLabels(
      {
        extras: {
          firstFrameUrl: FIRST,
          lastFrameUrl: LAST,
          referenceImageUrls: [ROLE],
          referenceVideoUrls: [VIDEO],
          // 档案投影：渲染层把当前模式的 snake input 打好放这里，原生 body 读的就是这些键。
          archetypeInput: {
            volcengine_first_role_image_content: { type: "image_url", image_url: { url: FIRST }, role: "first_frame" },
            volcengine_last_role_image_content: { type: "image_url", image_url: { url: LAST }, role: "last_frame" },
            volcengine_image_contents: [{ type: "image_url", image_url: { url: ROLE }, role: "reference_image" }],
            volcengine_video_contents: [{ type: "video_url", video_url: { url: VIDEO }, role: "reference_video" }],
          },
        },
      },
      nativeI2vBody,
    );
    expect(labels).toEqual([]);
  });

  it("没带任何参考 → 不拦（纯文生正常放行）", () => {
    expect(unreachableReferenceLabels({ extras: { duration: 5 } }, NEWAPI_VIDEO_CREATE_OP.body)).toEqual([]);
  });

  it("body 不引用任何参数（如纯静态 body）→ 不误伤", () => {
    expect(unreachableReferenceLabels({ extras: { lastFrameUrl: LAST } }, { model: "x" })).toEqual([]);
  });

  it("只带首帧走通用模板 → 放行（刚修好的那条路必须不被自己拦住）", () => {
    expect(unreachableReferenceLabels({ extras: { firstFrameUrl: FIRST } }, NEWAPI_VIDEO_CREATE_OP.body)).toEqual([]);
  });

  // ── 画布**连线**来的参考（此前第三闸对这一路整个空转：carried 恒空 → 直接 early-return []）──
  // 上面几条喂的全是**手动上传**键（referenceImageUrls/referenceVideoUrls…）；连线来的参考落在
  // referenceImages + 档案投影 archetypeInput.{image_urls,video_urls} 上，旧实现一个都不认。
  // 用户连了参考图、通用中转模板发不出、闸门不吭声 → 生成成功、扣费成功、跟参考图无关。

  it("连线多张参考图走通用中转：第 1 张发得出，第 2 张发不出 → 拦住（旧实现静默丢）", () => {
    const labels = unreachableReferenceLabels(
      { extras: { referenceImages: [ROLE, ROLE_2], archetypeInput: { image_urls: [ROLE, ROLE_2] } } },
      NEWAPI_VIDEO_CREATE_OP.body,
    );
    expect(labels).toEqual(["参考图"]);
  });

  it("连线参考视频走通用中转 → 拦住（body 里根本没有视频位，运镜整个空转的那条）", () => {
    const labels = unreachableReferenceLabels(
      { extras: { archetypeInput: { video_urls: [VIDEO] } } },
      NEWAPI_VIDEO_CREATE_OP.body,
    );
    expect(labels).toEqual(["参考视频"]);
  });

  it("连线单张参考图走通用中转 → 放行（聚合进 image_url，不能被自己拦住）", () => {
    expect(
      unreachableReferenceLabels(
        { extras: { referenceImages: [ROLE], archetypeInput: { image_urls: [ROLE] } } },
        NEWAPI_VIDEO_CREATE_OP.body,
      ),
    ).toEqual([]);
  });

  it("连线多张参考图 + body 真发得出数组 → 零误伤（修完不能反过来误拦原生通道）", () => {
    expect(
      unreachableReferenceLabels(
        { extras: { referenceImages: [ROLE, ROLE_2], archetypeInput: { image_urls: [ROLE, ROLE_2] } } },
        { model: "x", image_urls: "{{request.params.image_urls}}" },
      ),
    ).toEqual([]);
  });

  // 带空格的参考链接：参数层把参考链接换成序列化后的写法（Windows 文件名的空格 → %20）；第三闸拿携带的原样地址去比，
  // 两边按同一个序列化比——发得出的不能因为写法变了被误判成发不出，发不出的照样拦。
  it("带空格的参考链接：发得出的照常放行，发不出的照常拦", () => {
    const spaced = (name: string) => `https://cdn.example.com/Windows ${name}.png`;
    const reachableEverywhere = unreachableReferenceLabels(
      {
        extras: {
          firstFrameUrl: spaced("first"),
          lastFrameUrl: spaced("last"),
          referenceImageUrls: [spaced("role")],
          archetypeInput: {
            volcengine_first_role_image_content: { type: "image_url", image_url: { url: spaced("first") }, role: "first_frame" },
            volcengine_last_role_image_content: { type: "image_url", image_url: { url: spaced("last") }, role: "last_frame" },
            volcengine_image_contents: [{ type: "image_url", image_url: { url: spaced("role") }, role: "reference_image" }],
          },
        },
      },
      nativeI2vBody,
    );
    expect(reachableEverywhere).toEqual([]);
    expect(unreachableReferenceLabels({ extras: { firstFrameUrl: spaced("first") } }, NEWAPI_VIDEO_CREATE_OP.body)).toEqual([]);
    expect(unreachableReferenceLabels(
      { extras: { firstFrameUrl: spaced("first"), lastFrameUrl: spaced("last") } },
      NEWAPI_VIDEO_CREATE_OP.body,
    )).toEqual(["尾帧"]);
  });

  it("没登记过的新参考键也要被看见（回退「参考素材」，绝不因没登记就放过）", () => {
    expect(
      unreachableReferenceLabels(
        { extras: { archetypeInput: { some_future_ref_url: "https://cdn.example.com/new.bin" } } },
        NEWAPI_VIDEO_CREATE_OP.body,
      ),
    ).toEqual(["参考素材"]);
  });
});
