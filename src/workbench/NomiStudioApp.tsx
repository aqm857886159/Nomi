import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ProjectLibraryPage from "./library/ProjectLibraryPage";
import { ToastHost } from "../ui/toast";
import { FilePreviewPanel } from "./explorer/FilePreviewPanel";
import { WorkbenchAssistantDock } from "./ai/WorkbenchAssistantDock";
import {
    createLocalProject,
    deleteLocalProject,
    useLocalProjects,
    type LocalProjectSummary,
} from "./library/localProjectStore";
import {
    buildStoryDocument,
    type TryNowExample,
} from "./library/tryNowExamples";
import type { WorkbenchProjectPersistenceService } from "./project/projectPersistenceService";
import { useWorkspaceEvents } from "./useWorkspaceEvents";
import { cn } from "../utils/cn";
import { toast } from "../ui/toast";
import { setDesktopActiveProjectId } from "../desktop/activeProject";
import { getDesktopBridge } from "../desktop/bridge";
import { listWorkbenchModelCatalogModels } from "./api/modelCatalogApi";
import { buildStudioUrl } from "../utils/appRoutes";
import { openWorkspaceFromLibrary } from "./library/openWorkspaceFlow";

type AppView = "library" | "studio";
type ProjectPersistenceModule = typeof import("./project/projectPersistenceService");

const WorkbenchShell = React.lazy(() => import("./WorkbenchShell"));
const OnboardingFloatingPanel = React.lazy(() =>
    import("../ui/onboarding/OnboardingFloatingPanel").then((module) => ({
        default: module.OnboardingFloatingPanel,
    })),
);
const GenerationCanvas = React.lazy(
    () => import("./generationCanvasV2/components/GenerationCanvas"),
);
function GenerationCanvasLoading(): JSX.Element {
    return (
        <div
            className={cn("w-full h-full bg-workbench-bg")}
            aria-label='生成画布加载中'
        />
    );
}

function readProjectIdFromSearch(search: string): string | null {
    try {
        const value = new URLSearchParams(search).get("projectId");
        return value && value.trim() ? value.trim() : null;
    } catch {
        return null;
    }
}

export default function NomiStudioApp(): JSX.Element {
    const navigate = useNavigate();
    const location = useLocation();
    const [view, setView] = React.useState<AppView>("library");
    const { projects, refreshProjects } = useLocalProjects();
    const [activeProject, setActiveProject] =
        React.useState<LocalProjectSummary | null>(null);
    const [modelCatalogOpened, setModelCatalogOpened] = React.useState(false);
    const hydratingProjectRef = React.useRef(false);
    const activeProjectIdRef = React.useRef<string | null>(null);
    const initialHydrationAttemptedRef = React.useRef(false);
    const projectPersistenceModuleRef =
        React.useRef<ProjectPersistenceModule | null>(null);
    const projectPersistenceServiceRef =
        React.useRef<WorkbenchProjectPersistenceService | null>(null);
    const routeProjectId = React.useMemo(
        () => readProjectIdFromSearch(location.search),
        [location.search],
    );
    const activeProjectPersistenceKey = activeProject
        ? `${activeProject.id}\u0000${activeProject.name}`
        : "";

    React.useEffect(() => {
        document.documentElement.dataset.theme = "light";
        document.documentElement.setAttribute(
            "data-mantine-color-scheme",
            "light",
        );
    }, []);

    React.useEffect(() => {
        const handleOpenModelCatalog = () => setModelCatalogOpened(true);
        window.addEventListener(
            "nomi-open-model-catalog",
            handleOpenModelCatalog,
        );
        return () =>
            window.removeEventListener(
                "nomi-open-model-catalog",
                handleOpenModelCatalog,
            );
    }, []);

    const ensureProjectPersistenceService = React.useCallback(async () => {
        let module = projectPersistenceModuleRef.current;
        if (!module) {
            module = await import("./project/projectPersistenceService");
            projectPersistenceModuleRef.current = module;
        }
        let service = projectPersistenceServiceRef.current;
        if (!service) {
            service = module.createWorkbenchProjectPersistenceService({
                setActiveProject,
                setView,
                onSaveError: (error) => {
                    console.error("project save error", error);
                    toast("项目保存失败，请检查本地磁盘权限", "error");
                },
            });
            projectPersistenceServiceRef.current = service;
        }
        return { module, service };
    }, []);

    React.useEffect(() => {
        setDesktopActiveProjectId(activeProject?.id);
    }, [activeProject?.id]);

    const hydrateProject = React.useCallback(
        async (projectId: string, options: { replaceUrl?: boolean } = {}) => {
            const { module, service } = await ensureProjectPersistenceService();
            hydratingProjectRef.current = true;
            try {
                const hydrated = await service.hydrateProject(projectId);
                if (!hydrated) return false;
                activeProjectIdRef.current = hydrated.id;
                setActiveProject(hydrated);
                setView("studio");
                const migrationDiag =
                    module.consumeCategoryMigrationDiagnostic();
                if (
                    migrationDiag &&
                    (migrationDiag.migratedNodes > 0 ||
                        migrationDiag.categoriesSeeded)
                ) {
                    toast(
                        `项目已升级到目录树：${migrationDiag.migratedNodes} 个节点已归类`,
                        "success",
                    );
                }
                navigate(buildStudioUrl(hydrated.id), {
                    replace: options.replaceUrl ?? false,
                });
            } finally {
                hydratingProjectRef.current = false;
            }
            return true;
        },
        [ensureProjectPersistenceService, navigate],
    );

    const openProject = React.useCallback(
        (projectId: string) => {
            void hydrateProject(projectId);
        },
        [hydrateProject],
    );

    const openWorkspaceFolder = React.useCallback(async () => {
        await openWorkspaceFromLibrary({
            bridge: getDesktopBridge(),
            hydrateProject,
            refreshProjects,
            confirmInitialize: async (rootPath) =>
                window.confirm(
                    `将此文件夹初始化为 Nomi 项目？\n\n${rootPath}\n\nNomi 会创建 .nomi/，并把生成的图片、视频保存到 assets/ 和 exports/。`,
                ),
            showMessage: (message, tone) => toast(message, tone || "error"),
        });
    }, [hydrateProject, refreshProjects]);

    const newProject = React.useCallback(() => {
        // 「新建项目」：直接在默认位置建项目，不弹文件夹选择器。
        // 桌面端 createLocalProject 经 IPC 落到 ~/Documents/Nomi Projects 的自动文件夹，
        // Web 端落 localStorage。要绑定自选目录走「打开文件夹」。
        try {
            const project = createLocalProject();
            refreshProjects();
            void hydrateProject(project.id);
        } catch (error) {
            console.error("new project error", error);
            toast("新建项目失败，请检查本地磁盘权限", "error");
        }
    }, [hydrateProject, refreshProjects]);

    /**
     * Try-Now hero handler (C6). Creates a fresh project, hydrates it,
     * stuffs the example story into the creation workbench document, then
     * dispatches a storyboard request so the demo runs end-to-end with a
     * single click. We delay the storyboard event until after the project
     * has hydrated and the creation editor has mounted, otherwise the
     * canvas-assistant listener might not be attached yet.
     */
    const tryExample = React.useCallback(
        async (example: TryNowExample) => {
            // 模型预检（P0-9 / I-2）：示例靠 Agent「拆镜头」跑起来，需要文本模型。
            // 没配就先引导去模型接入，别让最显眼的「30 秒体验」静默失败在 Agent 调用上。
            const textModels = await listWorkbenchModelCatalogModels({
                kind: "text",
                enabled: true,
            }).catch(() => []);
            if (textModels.length === 0) {
                toast("先接入一个文本模型，就能一键体验示例", "info");
                window.dispatchEvent(
                    new CustomEvent("nomi-open-model-catalog", {
                        detail: { intent: "model-integration" },
                    }),
                );
                return;
            }
            // 示例同样不强迫选文件夹：直接在默认位置建项目（桌面端落
            // ~/Documents/Nomi Projects，Web 端落 localStorage），让「30 秒体验」
            // 真的一键就跑。要自定义目录用户可后续走「打开文件夹」。
            let projectId: string | null = null;
            try {
                const project = createLocalProject(example.projectName);
                projectId = project.id;
                refreshProjects();
            } catch (error) {
                console.error("try-now project error", error);
                toast("新建示例项目失败，请检查本地磁盘权限", "error");
                return;
            }
            const hydrated = await hydrateProject(projectId);
            if (!hydrated) return;
            const doc = buildStoryDocument(example.story, example.projectName);
            const { useWorkbenchStore } = await import("./workbenchStore");
            const store = useWorkbenchStore.getState();
            store.setWorkbenchDocument(doc);
            store.setWorkspaceMode("creation");
            // Allow the creation editor + canvas assistant panel to mount before
            // dispatching, so the storyboard listener actually picks up the event.
            window.setTimeout(() => {
                void import(
                    "./generationCanvasV2/agent/storyboardLauncher"
                ).then(({ requestStoryboardPlanning }) => {
                    requestStoryboardPlanning({
                        storyText: example.story,
                        source: `library-try-now:${example.id}`,
                    });
                });
            }, 200);
        },
        [hydrateProject, refreshProjects],
    );

    const deleteProject = React.useCallback(
        (project: LocalProjectSummary) => {
            const confirmed = window.confirm(
                `确定删除「${project.name}」吗？项目文件夹和本地资源会一起删除。`,
            );
            if (!confirmed) return;
            try {
                deleteLocalProject(project.id);
                if (activeProjectIdRef.current === project.id) {
                    activeProjectIdRef.current = null;
                    setActiveProject(null);
                    setView("library");
                    navigate(buildStudioUrl(), { replace: true });
                }
                toast("项目已删除", "success");
            } catch (error: unknown) {
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : "项目删除失败";
                console.error(message);
                toast(message, "error");
            }
        },
        [navigate],
    );

    React.useEffect(() => {
        if (initialHydrationAttemptedRef.current) return;
        initialHydrationAttemptedRef.current = true;
        if (!routeProjectId) return;
        let cancelled = false;
        hydratingProjectRef.current = true;
        void ensureProjectPersistenceService()
            .then(({ service }) => service.hydrateInitialProject(projects))
            .then((hydrated) => {
                if (cancelled) return;
                if (hydrated) {
                    activeProjectIdRef.current = hydrated.id;
                    setActiveProject(hydrated);
                    setView("studio");
                    navigate(buildStudioUrl(hydrated.id), { replace: true });
                } else {
                    if (routeProjectId)
                        navigate(buildStudioUrl(), { replace: true });
                }
            })
            .catch((error: unknown) => {
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : "项目恢复失败";
                console.error(message);
            })
            .finally(() => {
                if (!cancelled) hydratingProjectRef.current = false;
            });
        return () => {
            cancelled = true;
            hydratingProjectRef.current = false;
        };
    }, [
        ensureProjectPersistenceService,
        navigate,
        projects,
        routeProjectId,
    ]);

    React.useEffect(() => {
        if (
            !initialHydrationAttemptedRef.current ||
            hydratingProjectRef.current
        )
            return;
        if (!routeProjectId || routeProjectId === activeProjectIdRef.current)
            return;
        void hydrateProject(routeProjectId, { replaceUrl: true }).then((ok) => {
            if (!ok) navigate(buildStudioUrl(), { replace: true });
        });
    }, [hydrateProject, navigate, routeProjectId]);

    React.useEffect(() => {
        if (!activeProject?.id) return;
        let disposed = false;
        let unbind: (() => void) | undefined;
        void ensureProjectPersistenceService().then(({ service }) => {
            if (disposed) return;
            unbind = service.bindProjectPersistence({
                project: activeProject,
                isHydrating: () => hydratingProjectRef.current,
                canPersist: () =>
                    activeProjectIdRef.current === activeProject.id,
                onSaved: (saved) => {
                    setActiveProject(saved);
                },
                onSaveError: (error) => {
                    console.error("project save error", error);
                    toast("项目保存失败，请检查本地磁盘权限", "error");
                },
            });
        });
        return () => {
            disposed = true;
            unbind?.();
        };
    }, [
        activeProject,
        activeProjectPersistenceKey,
        ensureProjectPersistenceService,
    ]);

    useWorkspaceEvents(view === "studio" ? activeProject?.id : null, (type) => {
        if (
            type === "canvas.updated" ||
            type === "timeline.updated" ||
            type === "creation.updated"
        ) {
            void hydrateProject(activeProject!.id);
        }
    });

    const backToLibrary = React.useCallback(() => {
        setView("library");
        navigate(buildStudioUrl(), { replace: false });
    }, [navigate]);

    const handleRenameProject = React.useCallback(
        (newName: string) => {
            if (!activeProject) return;
            const trimmed = newName.trim() || "未命名 Nomi 项目";
            if (trimmed === activeProject.name) return;
            const renamed: LocalProjectSummary = {
                ...activeProject,
                name: trimmed,
            };
            // Update React state so AppBar reflects the new name immediately
            setActiveProject(renamed);
            // Persist the new name with the current in-memory canvas/timeline/document
            // state (NOT a re-read from disk — that would be stale). This updates the
            // project file on disk AND publishes the new summary so the project library
            // card refreshes via SWR.
            void ensureProjectPersistenceService()
                .then(async ({ service }) => {
                    const { readCurrentWorkbenchProjectPayload } =
                        await import("./project/workbenchProjectSession");
                    return service.persistProject(
                        renamed,
                        readCurrentWorkbenchProjectPayload(),
                    );
                })
                .catch((error: unknown) => {
                    console.error("project rename save error", error);
                    toast("项目重命名保存失败", "error");
                });
        },
        [activeProject, ensureProjectPersistenceService],
    );

    if (view === "library") {
        return (
            <>
                <ProjectLibraryPage
                    projects={projects}
                    onOpenProject={openProject}
                    onDeleteProject={deleteProject}
                    onNewProject={() => void newProject()}
                    onOpenFolder={() => void openWorkspaceFolder()}
                    onTryExample={(example) => void tryExample(example)}
                />
                <ToastHost />
            </>
        );
    }

    return (
        <div
            className={cn("nomi-studio-app w-full h-screen min-h-0 bg-nomi-bg")}
            aria-label='Nomi Studio'>
            <WorkbenchShell
                generation={
                    <React.Suspense fallback={<GenerationCanvasLoading />}>
                        <GenerationCanvas />
                    </React.Suspense>
                }
                projectId={activeProject?.id ?? null}
                projectName={activeProject?.name}
                onBackToLibrary={backToLibrary}
                onOpenModelCatalog={() => setModelCatalogOpened(true)}
                onRenameProject={handleRenameProject}
            />

            <OnboardingFloatingPanel
                opened={modelCatalogOpened}
                onClose={() => setModelCatalogOpened(false)}
                // position='right'
                // size={560}
                // zIndex={4000}
                // withinPortal
            />

            <FilePreviewPanel />

            <WorkbenchAssistantDock />

            <ToastHost />
        </div>
    );
}
