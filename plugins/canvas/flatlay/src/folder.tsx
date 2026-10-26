import { useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";
import type { FolderImage } from "./logic";
import { Thumbnail } from "./thumbnail";
import { readDroppedFiles, type ImportFile } from "./drop";

function FolderContent({ ctx }: CanvasNodeContentProps) {
    const current = useRef(ctx); current.current = ctx;
    const picker = useRef<HTMLInputElement>(null);
    const busy = useRef(false);
    const mounted = useRef(true);
    const [loading, setLoading] = useState(false);
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const [progress, setProgress] = useState("");
    const images = (ctx.node.metadata?.folderImages || []) as FolderImage[];
    const errors = (ctx.node.metadata?.folderErrors || []) as string[];
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const loadFolder = async (incoming: Promise<{ files: ImportFile[]; errors: string[] }>) => {
        if (busy.current) { setProgress("正在载入，请完成后继续拖入添加。"); return; }
        const media = current.current.media;
        if (!media) { setProgress("当前宿主不支持保存图片，请更新宿主。"); return; }
        busy.current = true; setLoading(true); setProgress("正在读取图片…");
        const next = [...((current.current.node.metadata?.folderImages || []) as FolderImage[])], failures: string[] = [];
        const folderNames = new Set<string>((current.current.node.metadata?.folderNames || []) as string[]);
        current.current.updateMetadata({ pluginKeepMounted: true, folderErrors: [] });
        let empty = false;
        try {
            const incomingFiles = await incoming;
            failures.push(...incomingFiles.errors);
            const selected = incomingFiles.files.filter(({ file }) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp|svg|heic|heif)$/i.test(file.name))
                .sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));
            empty = !selected.length;
            for (const [index, { file, path }] of selected.entries()) {
                if (!mounted.current || !current.current.getNode(ctx.node.id)) break;
                const id = `${path}:${file.size}:${file.lastModified}`;
                setProgress(`正在保存 ${index + 1} / ${selected.length}`);
                if (next.some((image) => image.id === id)) continue;
                const url = URL.createObjectURL(file);
                try {
                    const saved = await media.saveImage(url);
                    if (!mounted.current || !current.current.getNode(ctx.node.id)) break;
                    next.push({ ...saved, id, title: file.name, path });
                    folderNames.add(path.includes("/") ? path.split("/")[0] : "所选图片");
                    current.current.updateMetadata({ folderImages: [...next], folderNames: [...folderNames] });
                } catch { failures.push(path); }
                finally { URL.revokeObjectURL(url); }
            }
        } catch { failures.push("无法读取拖入的文件，请重新选择或拖入。"); } finally {
            busy.current = false;
            if (current.current.getNode(ctx.node.id)) current.current.updateMetadata({ pluginKeepMounted: false, folderErrors: failures });
            if (mounted.current) { setLoading(false); setProgress(empty && !failures.length ? "未发现可读取的图片，已有列表保持不变。" : `已载入 ${next.length} 张${failures.length ? `，${failures.length} 项读取失败` : ""}`); }
        }
    };
    const t = ctx.theme;
    return <div data-flatlay-node data-folder-node data-dragging={dragging || undefined} data-canvas-no-zoom style={{ color: t.node.text, "--fl-muted": t.node.muted, "--fl-line": t.node.stroke, "--fl-panel": t.node.panel, "--fl-accent": t.node.text } as import("react").CSSProperties}
        onDragEnter={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); e.stopPropagation(); dragDepth.current++; setDragging(true); }}
        onDragOver={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = busy.current ? "none" : "copy"; }}
        onDragLeave={(e) => { e.stopPropagation(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
        onDrop={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); e.stopPropagation(); dragDepth.current = 0; setDragging(false); if (busy.current) { setProgress("正在载入，请完成后继续拖入添加。"); return; } void loadFolder(readDroppedFiles(e.dataTransfer)); }}
        onMouseDown={(e) => { if (e.target instanceof Element && e.target.closest("button,input")) e.stopPropagation(); }}
        onPointerDown={(e) => { if (e.target instanceof Element && e.target.closest("button,input")) e.stopPropagation(); }}>
        <header className="fl-header"><div><div className="fl-title">文件夹图片</div><div className="fl-subtitle">一次载入 · 一条连线</div></div><span className="fl-count">{String(images.length).padStart(2, "0")}<small> 张</small></span></header>
        <input ref={picker} type="file" multiple accept="image/*" {...{ webkitdirectory: "" }} hidden onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; void loadFolder(Promise.resolve({ files: files.map((file) => ({ file, path: file.webkitRelativePath || file.name })), errors: [] })); }} />
        <div className="fl-section-heading"><span>本地图片集</span><button disabled={loading} onClick={() => picker.current?.click()}>{loading ? "载入中…" : images.length ? "＋ 添加文件夹" : "＋ 选择文件夹"}</button></div>
        <div className="fl-body" onWheel={(e) => e.stopPropagation()}>
            {!images.length && <div className="fl-empty"><span className="fl-empty-mark">▧</span><strong>拖入图片或文件夹</strong><p>支持多张图片和子文件夹。<br />也可以点击上方按钮选择文件夹。</p></div>}
            {images.map((image, index) => <div className="fl-input-row" key={image.id}><Thumbnail input={image} ctx={ctx} /><div className="fl-input-detail"><div className="fl-folder-name" title={image.title}>{image.title}</div><div className="fl-job-source" title={image.path}>{image.path}</div><div className="fl-help">{index + 1} · {image.width} × {image.height}</div></div><button aria-label={`移除 ${image.path}`} disabled={loading} onClick={() => ctx.updateMetadata({ folderImages: images.filter((item) => item.id !== image.id) })}>×</button></div>)}
            {errors.length > 0 && <div className="fl-job-message" role="alert">以下文件读取失败，已载入的图片仍可使用：{errors.map((path) => <div key={path}>{path}</div>)}</div>}
        </div>
        <footer className="fl-footer"><div className="fl-help">拖入此节点即可继续添加，保留已有图片。</div><div className="fl-help">连接右侧接口 → 批量平铺 → 更新上游</div><div className="fl-help">图片保存在画布本地；不会自动同步文件夹变动。</div>{progress && <div className="fl-help" role="status">{progress}</div>}</footer>
        {dragging && <div className="fl-drop-overlay"><strong>{loading ? "正在载入中" : "松开，添加到图片集"}</strong><span>{loading ? "请完成后继续添加" : "图片 / 文件夹 · 保留已有内容"}</span></div>}
    </div>;
}

export const folderDefinition: CanvasNodeDefinition = {
    type: "flatlay:folder", title: "文件夹图片", icon: "📂", defaultSize: { width: 380, height: 480 }, hidePanel: true,
    defaultMetadata: { folderImages: [], folderErrors: [], folderNames: [] },
    resource: (node) => { const images = (node.metadata?.folderImages || []) as FolderImage[]; return images.length ? { kind: "image", urls: images.map((image) => image.url) } : null; },
    Content: FolderContent,
};
