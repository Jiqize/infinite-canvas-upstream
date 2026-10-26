import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { imageToDataUrl, uploadImage, resolveImageUrl } from "@/services/image-storage";
import { removeTencentBackground } from "@/services/api/tencent-cutout";
import { useTencentCutoutStore } from "@/stores/use-tencent-cutout-store";
import { recordCanvasGeneration } from "@/services/generation-gallery";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { decodeChannelModel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeToolbarItem, CanvasPluginAi, CanvasPluginHost } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type PluginHostParams = {
    projectId: string;
    projectTitle?: string;
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    theme: CanvasTheme;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
};

/**
 * Plugin node host capabilities: expose host-side AI generation, canvas access, and panel controls
 * through plugin-callable host/ai objects. Loads installed remote plugins on mount and returns renderers for plugin panels and toolbars.
 */
export function usePluginHost(params: PluginHostParams) {
    const { t } = useTranslation();
    const projectRef = useRef(params.projectId);
    projectRef.current = params.projectId;
    const titleRef = useRef(params.projectTitle);
    titleRef.current = params.projectTitle;
    const { effectiveConfig, isAiConfigReady, openConfigDialog, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps } = params;

    // Host capabilities available to plugin nodes; methods receive nodeId and are not bound to a specific node.
    const pluginAi = useMemo<CanvasPluginAi>(() => {
        // 插件传入的图片地址（data URL 或任意图片地址）统一转成 data URL 再发送
        const toDataUrls = (refs: string[] | undefined, signal?: AbortSignal) => Promise.all((refs || []).filter(Boolean).map((src) => (src.startsWith("data:") ? src : imageToDataUrl({ url: src }, { signal }))));
        // Convert plugin reference images (data URLs or URLs) into the ReferenceImage[] expected by the host generation API.
        const toReferences = async (refs: string[] | undefined, signal?: AbortSignal): Promise<ReferenceImage[]> => (await toDataUrls(refs, signal)).map((src, index) => ({ id: `plugin-ref-${index}`, name: `ref-${index}.png`, type: src.match(/^data:([^;,]+)/)?.[1] || "image/png", dataUrl: src }));
        // Open the configuration dialog and throw when AI is not configured, allowing the plugin to handle the error.
        const ensureReady = (config: AiConfig) => {
            if (!isAiConfigReady(config, config.model)) {
                openConfigDialog(true);
                throw new Error(t("canvas.plugins.aiConfigRequired"));
            }
        };
        return {
            generateImage: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "image"), count: String(options?.count || 1), ...(options?.background ? { background: options.background } : {}), ...(options?.model ? { model: options.model } : {}), ...(options?.size ? { size: options.size } : {}) };
                ensureReady(config);
                const references = await toReferences(options?.references, options?.signal);
                const items = references.length ? await requestEdit(config, prompt, references, { signal: options?.signal }) : await requestGeneration(config, prompt, { signal: options?.signal });
                const images = await Promise.all(items.map(async (item) => {
                    try {
                        return await imageToDataUrl({ dataUrl: item.dataUrl }, { signal: options?.signal });
                    } catch (error) {
                        if (options?.signal?.aborted) throw error;
                        return item.dataUrl;
                    }
                }));
                return { images };
            },
            generateVideo: async (prompt, options) => {
                const config = {
                    ...buildGenerationConfig(effectiveConfig, undefined, "video"),
                    ...(options?.model ? { model: options.model } : {}),
                    ...(options?.size ? { size: options.size } : {}),
                    ...(options?.seconds ? { videoSeconds: options.seconds } : {}),
                };
                ensureReady(config);
                const file = await storeGeneratedVideo(await requestVideoGeneration(config, prompt, await toReferences(options?.references, options?.signal), { signal: options?.signal }));
                return { url: file.url, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
            },
            generateText: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "text"), ...(options?.model ? { model: options.model } : {}) };
                ensureReady(config);
                const images = await toDataUrls(options?.images, options?.signal);
                // 带图时 user 消息改为「文本 + 图片」多段内容；不带图时保持纯文本
                const userContent: AiTextMessage["content"] = images.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt;
                const messages: AiTextMessage[] = [...(options?.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: userContent }];
                const text = await requestImageQuestion(config, messages, (delta) => options?.onDelta?.(delta), { signal: options?.signal });
                return { text };
            },
            // List configured models for a capability; labels use the model name without the channel prefix.
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
        };
    }, [effectiveConfig, isAiConfigReady, openConfigDialog, t]);

    const media = useMemo<NonNullable<CanvasPluginHost["media"]>>(() => ({
        saveImage: async (source, signal) => {
            const image = await uploadImage(source, { signal });
            if (!image.storageKey) throw new Error("图片未能保存到本地，请检查图片地址的跨域权限。");
            return { ...image, storageKey: image.storageKey };
        },
        resolveImage: async (image) => {
            const url = await resolveImageUrl(image.storageKey, image.url || "");
            if (!url) throw new Error("本地图片已不可用，请重新接入原图。");
            return imageToDataUrl({ url });
        },
        removeBackground: async (source, mode, signal) => {
            const result = await removeTencentBackground(await imageToDataUrl({ url: source }, { signal }), mode, signal);
            const url = URL.createObjectURL(result.image);
            try { return { image: await imageToDataUrl({ url }, { signal }), warning: result.warning }; }
            finally { URL.revokeObjectURL(url); }
        },
        configureCutout: () => useTencentCutoutStore.getState().setOpen(true),
        cutoutReady: () => Boolean(useTencentCutoutStore.getState().config),
        recordGeneration: (image, details) => recordCanvasGeneration({ id: image.storageKey, kind: "image", createdAt: Date.now(), ...details, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType, projectId: params.projectId, projectTitle: projectRef.current === params.projectId ? titleRef.current : undefined }),
    }), [params.projectId]);

    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            getNode: (id) => projectRef.current === params.projectId ? nodesRef.current.find((node) => node.id === id) || null : null,
            getNodes: () => nodesRef.current,
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            // 同步 ref 后再更新 React，确保紧接着的 applyOps 读取到刚保存的任务状态。
            updateNode: (nodeId, patch) => {
                if (projectRef.current !== params.projectId) return;
                nodesRef.current = nodesRef.current.map((node) => node.id === nodeId ? { ...node, ...patch } : node);
                setNodes(nodesRef.current);
            },
            updateMetadata: (nodeId, patch) => {
                if (projectRef.current !== params.projectId) return;
                nodesRef.current = nodesRef.current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node);
                setNodes(nodesRef.current);
            },
            applyOps: (ops) => applyAgentOps(ops),
            ai: pluginAi,
            media,
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
        }),
        [applyAgentOps, pluginAi, media, params.projectId],
    );

    const renderPluginPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(pluginHost, panelNode, theme, viewportRef.current.k);
            return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [pluginHost, theme],
    );

    // Build the node toolbar from plugin items and a host-provided interaction/move toggle when enabled.
    const buildNodeToolbarItems = useCallback(
        (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
            const definition = getNodeDefinition(node.type);
            const ctx = buildNodeContext(pluginHost, node, theme, viewportRef.current.k);
            const custom = definition?.toolbar?.(ctx) || [];
            // Show the interaction/move toggle only for nodes with content that are not forced into an interactive state.
            if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return custom;
            const interactive = Boolean(node.metadata?.interactive);
            const toggle: CanvasNodeToolbarItem = {
                id: "node-interaction-toggle",
                title: t(interactive ? "canvas.plugins.interactiveTitle" : "canvas.plugins.movableTitle"),
                label: t(interactive ? "canvas.plugins.move" : "canvas.plugins.interact"),
                icon: interactive ? "✋" : "🖐",
                active: interactive,
                onClick: () => pluginHost.updateMetadata(node.id, { interactive: !interactive }),
            };
            return [toggle, ...custom];
        },
        [pluginHost, t, theme],
    );

    // Load installed remote plugins on startup.
    useEffect(() => {
        void ensurePluginsLoaded();
    }, []);

    return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}
