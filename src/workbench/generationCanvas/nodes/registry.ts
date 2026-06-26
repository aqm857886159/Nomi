import type { ComponentType } from "react";
import type { BillingModelKind } from "../../../api/desktopClient";

export type GenerationNodeRenderProps<TNode = unknown> = {
    node: TNode;
    selected: boolean;
    readOnly?: boolean;
    focusFlash?: boolean;
    /** 新落点（add/paste/Agent）一次性弹入动画；开项目已有节点不传（不齐闪）。 */
    appear?: boolean;
};

export type GenerationNodeComponent = ComponentType<
    GenerationNodeRenderProps<unknown>
>;
export type GenerationNodeExecutionKind = "image" | "video" | "text" | "audio" | "model3d";
export type GenerationNodeIconKey =
    | "text"
    | "character"
    | "scene"
    | "image"
    | "keyframe"
    | "video"
    | "shot"
    | "output"
    | "panorama"
    | "scene3d"
    | "model3d"
    | "whiteboard"
    | "audio";

export type GenerationNodePluginDefinition<TKind extends string = string> = {
    kind: TKind;
    label: string;
    menuLabel: string;
    component: () => Promise<{ default: GenerationNodeComponent }>;
    icon: GenerationNodeIconKey;
    defaultTitle?: string;
    defaultSize: { width: number; height: number };
    catalogKind: BillingModelKind;
    executionKind?: GenerationNodeExecutionKind;
    quickAdd?: boolean;
    agentCreatable?: boolean;
    providesImageReference?: boolean;
    promptPlaceholder?: string;
};

function defineGenerationNodePlugins<
    const TPlugins extends readonly [
        GenerationNodePluginDefinition,
        ...GenerationNodePluginDefinition[],
    ],
>(plugins: TPlugins): TPlugins {
    return plugins;
}

const loadBaseGenerationNode = () =>
    import("./BaseGenerationNode") as Promise<{
        default: GenerationNodeComponent;
    }>;

export const GENERATION_NODE_PLUGINS = defineGenerationNodePlugins([
    {
        kind: "text",
        label: "Text",
        menuLabel: "文本",
        component: loadBaseGenerationNode,
        icon: "text",
        defaultTitle: "文本",
        defaultSize: { width: 280, height: 200 },
        catalogKind: "text",
        executionKind: "text",
        quickAdd: true,
        agentCreatable: true,
        promptPlaceholder: "输入文本内容...",
    },
    {
        kind: "character",
        label: "Character",
        menuLabel: "角色",
        component: loadBaseGenerationNode,
        icon: "character",
        defaultTitle: "角色",
        defaultSize: { width: 300, height: 190 },
        catalogKind: "image",
        executionKind: "image",
        quickAdd: true,
        agentCreatable: true,
        providesImageReference: true,
        promptPlaceholder: "描述角色外观、服装、气质和可识别特征...",
    },
    {
        kind: "scene",
        label: "Scene",
        menuLabel: "场景",
        component: loadBaseGenerationNode,
        icon: "scene",
        defaultTitle: "场景",
        defaultSize: { width: 300, height: 190 },
        catalogKind: "image",
        executionKind: "image",
        quickAdd: true,
        agentCreatable: true,
        providesImageReference: true,
        promptPlaceholder: "描述场景环境、光线、构图和空间氛围...",
    },
    {
        kind: "image",
        label: "Image",
        menuLabel: "图片",
        component: loadBaseGenerationNode,
        icon: "image",
        defaultTitle: "图片",
        defaultSize: { width: 340, height: 280 },
        catalogKind: "image",
        executionKind: "image",
        quickAdd: true,
        agentCreatable: true,
        providesImageReference: true,
        promptPlaceholder: "描述这一帧的画面...",
    },
    {
        kind: "keyframe",
        label: "Keyframe",
        menuLabel: "关键帧",
        component: loadBaseGenerationNode,
        icon: "keyframe",
        defaultTitle: "关键帧",
        defaultSize: { width: 320, height: 220 },
        catalogKind: "image",
        executionKind: "image",
        quickAdd: true,
        providesImageReference: true,
        promptPlaceholder: "描述关键帧画面、动作瞬间和镜头状态...",
    },
    {
        kind: "video",
        label: "Video",
        menuLabel: "视频",
        component: loadBaseGenerationNode,
        icon: "video",
        defaultTitle: "视频",
        defaultSize: { width: 420, height: 340 },
        catalogKind: "video",
        executionKind: "video",
        quickAdd: true,
        agentCreatable: true,
        promptPlaceholder: "描述这一段视频的镜头、动作和节奏...",
    },
    {
        // 声音：配音生成（TTS，文→音）/ 转写（Whisper，音→文）/ 上传音频。渲染走 audio-strip（按 kind 强制，
        // 见 BaseGenerationNode renderKind 分发），生成类挂 composer（模式切换在 NodeGenerationComposer）。
        kind: "audio",
        label: "Audio",
        menuLabel: "声音",
        component: loadBaseGenerationNode,
        icon: "audio",
        defaultTitle: "声音",
        defaultSize: { width: 420, height: 80 },
        catalogKind: "audio",
        executionKind: "audio",
        quickAdd: true,
        agentCreatable: true,
        promptPlaceholder: "输入台词或旁白…",
    },
    {
        kind: "shot",
        label: "Shot",
        menuLabel: "镜头",
        component: loadBaseGenerationNode,
        icon: "shot",
        defaultTitle: "镜头",
        defaultSize: { width: 340, height: 230 },
        catalogKind: "text",
        quickAdd: true,
        promptPlaceholder: "记录镜头设计、调度、对白或拍摄说明...",
    },
    {
        kind: "output",
        label: "Output",
        menuLabel: "输出",
        component: loadBaseGenerationNode,
        icon: "output",
        defaultTitle: "输出",
        defaultSize: { width: 280, height: 170 },
        catalogKind: "text",
        quickAdd: true,
        promptPlaceholder: "整理最终输出说明或交付备注...",
    },
    {
        kind: "panorama",
        label: "Panorama",
        menuLabel: "全景图",
        component: loadBaseGenerationNode,
        icon: "panorama",
        defaultTitle: "全景图",
        defaultSize: { width: 480, height: 270 },
        catalogKind: "image",
        quickAdd: true,
        providesImageReference: true,
        promptPlaceholder: "上传或截取全景参考图...",
    },
    {
        kind: "scene3d",
        label: "3D Scene",
        menuLabel: "3D场景",
        component: loadBaseGenerationNode,
        icon: "scene3d",
        defaultTitle: "3D场景",
        defaultSize: { width: 480, height: 320 },
        catalogKind: "text",
        quickAdd: true,
        agentCreatable: false,
        providesImageReference: true,
        promptPlaceholder: "在3D场景中摆放模型并截图...",
    },
    {
        kind: "whiteboard",
        label: "Whiteboard",
        menuLabel: "画板",
        // 画板复用共享外壳 BaseGenerationNode(renderKind=whiteboard-card)，和其他节点同一套外壳；
        // body 在 whiteboard/WhiteboardCardBody（懒加载）。删了旧 WhiteboardCardNode 平行外壳。
        component: loadBaseGenerationNode,
        icon: "whiteboard",
        defaultTitle: "画板",
        defaultSize: { width: 320, height: 240 },
        catalogKind: "image",
        quickAdd: true,
        providesImageReference: true,
        promptPlaceholder: "在画板里绘制参考，再描述要生成的画面...",
    },
    {
        // 3D 模型：文生 / 图生 3D 生成节点（RunningHub 混元/HiTem/Meshy，输出 .glb）。是**生成节点**
        // （拿 composer），区别于 scene3d 编辑器节点。body 走 model3d-card（懒加载 Model3DViewer，
        // 复用 scene3d 的 R3F useGLTF 栈）。composer 挂载放行（不在 BaseGenerationNode 的 scene3d 排除名单）。
        kind: "model3d",
        label: "3D Model",
        menuLabel: "3D 模型",
        component: loadBaseGenerationNode,
        icon: "model3d",
        defaultTitle: "3D 模型",
        defaultSize: { width: 320, height: 300 },
        catalogKind: "model3d",
        executionKind: "model3d",
        quickAdd: true,
        agentCreatable: true,
        promptPlaceholder: "描述要生成的 3D 模型（外形、材质、风格）…",
    },
    {
        // 素材：导入图 / 文件树拖入 / 本地切图裁剪旋转衍生物。它就是一张图，不是生成节点：
        // 无 executionKind（不会生成）、无 composer（壳按 isAssetKind 关闭）、不可手动新建（quickAdd:false）、
        // 不进 agent 工具（agentCreatable 缺省 false）。仍可作参考被连线（providesImageReference）。
        kind: "asset",
        label: "Asset",
        menuLabel: "素材",
        component: loadBaseGenerationNode,
        icon: "image",
        defaultTitle: "素材",
        defaultSize: { width: 340, height: 280 },
        catalogKind: "image",
        quickAdd: false,
        providesImageReference: true,
    },
]);

export type GenerationNodePlugin = (typeof GENERATION_NODE_PLUGINS)[number];
export type GenerationNodeKind = GenerationNodePlugin["kind"];

export const GENERATION_NODE_KINDS = GENERATION_NODE_PLUGINS.map(
    (plugin) => plugin.kind,
) as [GenerationNodeKind, ...GenerationNodeKind[]];

export const GENERATION_NODE_PLUGIN_BY_KIND: Record<
    GenerationNodeKind,
    GenerationNodePlugin
> = Object.fromEntries(
    GENERATION_NODE_PLUGINS.map((plugin) => [plugin.kind, plugin]),
) as Record<GenerationNodeKind, GenerationNodePlugin>;
