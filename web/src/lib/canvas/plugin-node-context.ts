import { createPluginStorage, emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { getNodeDefinition, getNodePluginId } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";

// Assemble host capabilities, node data, theme, and scale into the context injected into plugin nodes.
export function buildNodeContext(host: CanvasPluginHost, node: CanvasNodeData, theme: CanvasTheme, scale: number, isSelected = false, upstreamNodes?: CanvasNodeData[]): CanvasNodeContext {
    const storage = createPluginStorage(getNodePluginId(node.type));
    return {
        node,
        theme,
        scale,
        isSelected,
        updateMetadata: (patch) => host.updateMetadata(node.id, patch),
        updateNode: (patch) => host.updateNode(node.id, patch),
        getNode: (id) => host.getNode(id),
        getNodes: () => host.getNodes(),
        getConnections: () => host.getConnections(),
        getUpstream: () => upstreamNodes ?? host.getUpstream(node.id),
        getDownstream: () => host.getDownstream(node.id),
        getResource: (id) => {
            const target = host.getNode(id);
            return (target && getNodeDefinition(target.type)?.resource?.(target)) || null;
        },
        applyOps: (ops) => host.applyOps(ops),
        emit: (event, payload) => emitCanvasEvent(event, payload),
        on: (event, handler) => onCanvasEvent(event, handler),
        ai: host.ai,
        media: host.media,
        openPanel: () => host.openPanel(node.id),
        openNodePanel: (nodeId) => host.openPanel(nodeId),
        closePanel: () => host.closePanel(),
        storage,
    };
}
