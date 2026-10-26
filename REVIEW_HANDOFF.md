# 批量平铺实现交付

拖入升级：文件夹节点支持多文件/目录拖放追加，drop 阻止向外层画布传播，目录读取支持分批及部分失败保留。3 项定向测试通过；浏览器合成拖放事件验证追加和节点数不变，已移除测试新增项。Finder 原生目录拖放待用户试用，无新增计费调用。

最新功能：同一插件新增 flatlay:folder「文件夹图片」独立节点；批量节点增加正面/背面切换、两套独立预设和任务视图标识。目录图片保存 storageKey，单条连线拆成独立输入。12 项平铺测试通过，浏览器验证两张嵌套目录图片、非图片过滤、重复选择去重及正背设置；无新增计费请求。试用画布保留原单图连线并增加文件夹连线，当前读取 3 条（原图 1 条及导入测试图 2 条），未实际执行此批次。

界面更新：图片/设置/记录三个页签，固定底部生成、模型摘要与透明底开关；新节点默认 460×560，试用节点已手动调整到该尺寸。插件已重新构建并热加载，页面凭据与已有结果保留。深浅主题、记录查看、提示词滚动和空白拖动已检查；本次没有追加计费调用。

当前实测：此工作树运行于 localhost:3000。用户授权读取 MindFrame 本地腾讯配置并实际试用，凭据已填入页面会话内存，未输出或写入代码。腾讯桶原无 CORS；获得用户单独确认后，仅添加 localhost:3000 的 PUT/GET/DELETE 及指定签名头规则，已回读确认。一次 Sunburst 生成斜领卫衣白底成功；首次去底被 CORS 拦截，配置后仅重试 GoodsMatting 成功，未重复生图。透明 PNG 为 1024×1536，真实 alpha 校验通过；临时对象列表 0 且无分页截断。画布结果保存在 `http://localhost:3000/canvas/1GGmWxBhn_MPU_ZIfk1W5`。本次只验收单图、手动目标及去底重试，不代表多图队列或自动识别已通过真实验收。

- 工作树：`/Users/lianglei/Projects/git/new-infinite-canvas.codex-worktrees/flatlay-canvas`
- 分支：`codex/flatlay-canvas`，基于 `feat/node-pack` 的 `cf2417c`。未提交、推送或合并。
- 试用步骤：[插件 README](plugins/canvas/flatlay/README.md)。实现依据：[实施说明](docs/research/flatlay-implementation-brief.md)。

已实现专用批量节点：逐图识别或手动填写目标，沿用用户的预设提示词，只生成单件正面白底图；可选腾讯商品/通用抠图生成透明底。白底与透明底均为普通图片节点，支持已有导出入口。逐张执行、失败继续、无自动重试；去底失败保留白底，重试复用已存白底；新批次保留旧结果。

腾讯适配位于 `web/src/services/api/tencent-cutout.ts`，复用官方浏览器 SDK 签名，原生 fetch 执行临时上传、处理和清理。凭据只留当前页面内存，支持导入 MindFrame JSON，不读取旧项目真实密钥。需用户账号开通数据万象并配置桶 CORS；未替用户修改云权限。

验证：`bun test plugins/canvas/flatlay/src/logic.test.ts` 为 10 项通过；在 web 目录运行 `bun test ./src/services/api/tencent-cutout.test.ts` 为 7 项通过。模拟网络验证了签名请求路径、无重试、取消、清理失败提示和透明度检查，没有实际外部生成或腾讯调用。

依项目要求没有运行语法/类型检查或构建，插件尚未生成浏览器可加载的 bundle。未做浏览器交互、真实素材质量、腾讯 CORS/权限/计费与云端对象清理验收。运行中的插件通过 pluginKeepMounted 避免视口裁剪；删除节点或离开页面导致卸载时停止后续处理，刷新后需手动继续。停止不能保证撤销已发生的模型费用；临时对象清理失败会提示对象路径，网络中断时无法保证云端无遗留。

Web 依赖已安装。仓库已有 antd peer dependency 冲突，安装时使用 `--legacy-peer-deps --ignore-scripts`；锁文件仅保留本次 SDK 及其新增依赖，未做无关依赖升级。

CHANGELOG 与 pending-test 已更新；TODO 原有事项无关，无需迁移；正式功能文档保留到用户验收后更新。主工作区不承载本次代码改动。
