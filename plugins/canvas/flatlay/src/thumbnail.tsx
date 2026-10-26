import { useEffect, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";

export function Thumbnail({ input, ctx }: { input: { url: string; storageKey?: string; title: string }; ctx: CanvasNodeContext }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let active = true;
        void ctx.media?.resolveImage(input).then((value) => { if (active) setUrl(value); }).catch(() => { if (active) setUrl(""); });
        return () => { active = false; };
    }, [input.storageKey, input.url, ctx.media]);
    return url ? <img src={url} alt={input.title} draggable={false} className="fl-thumbnail" /> : <span className="fl-thumbnail fl-empty-thumb">原图</span>;
}

