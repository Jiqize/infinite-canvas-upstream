import { create } from "zustand";

export type TencentCutoutConfig = { secretId: string; secretKey: string; bucket: string; region: string; token?: string };
// 云密钥仅保存在内存，不进入 localStorage、画布或配置导出。
export const useTencentCutoutStore = create<{
    config: TencentCutoutConfig | null;
    open: boolean;
    setConfig: (config: TencentCutoutConfig | null) => void;
    setOpen: (open: boolean) => void;
}>((set) => ({ config: null, open: false, setConfig: (config) => set({ config }), setOpen: (open) => set({ open }) }));
