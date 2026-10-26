export type ImportFile = { file: File; path: string };

// 拖放权限只在 drop 事件中有效，先同步取得文件/目录入口，再异步遍历。
export async function readDroppedFiles(data: DataTransfer) {
    const items = Array.from(data.items).filter((item) => item.kind === "file");
    const roots = items.map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
    const fallback = Array.from(data.files);
    const files: ImportFile[] = [], errors: string[] = [];
    async function visit(entry: FileSystemEntry, parent = "") {
        const path = parent + entry.name;
        try {
            if (entry.isFile) {
                const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
                files.push({ file, path });
            } else if (entry.isDirectory) {
                const reader = (entry as FileSystemDirectoryEntry).createReader();
                // 浏览器分批返回目录内容，必须读到空批次，不能只取第一批。
                while (true) {
                    const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
                    if (!entries.length) break;
                    for (const child of entries) await visit(child, `${path}/`);
                }
            }
        } catch { errors.push(path); }
    }
    if (roots.length) {
        for (const root of roots) {
            if (root.entry) await visit(root.entry);
            else if (root.file) files.push({ file: root.file, path: root.file.name });
        }
    } else files.push(...fallback.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
    return { files, errors };
}
