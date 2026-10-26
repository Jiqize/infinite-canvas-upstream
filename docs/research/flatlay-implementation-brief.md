# 批量服装平铺：实施说明

## 工作树与范围

- 目录：`/Users/lianglei/Projects/git/new-infinite-canvas.codex-worktrees/flatlay-canvas`
- 分支：`codex/flatlay-canvas`
- 基线：当前使用分支 `feat/node-pack` 的 `cf2417c`，不包含魔搭实验。
- 开始编辑前检查 `pwd` 与 `git status -sb`，两者必须与上述目录/分支相符。
- 已实现批量节点、宿主存图与腾讯服务适配，并安装 Web 依赖。17 个定向行为测试通过；未构建、启动浏览器或调用计费接口，未提交、推送或合并。

确定的交付方向：批量平铺节点，逐图识别或填写目标服装，复用画布模型生成单件正面白底立体平铺图，再通过腾讯云数据万象生成透明 PNG。白底和透明底都是普通图片节点，保留输入对应关系和旧结果。没有背面生成、正背拼图、拆图或批次后台页面。

## 腾讯实现已找到

已直接读取这两个工作区的相关源码：

- `/Users/lianglei/Projects/git/fabrie-copy`
- `/Users/lianglei/.codex/worktrees/miniframe/fabrie-copy`，当前 HEAD 为 `7e55295`。

核心文件：

| 文件（相对上述项目根目录） | 已确认用途 |
| --- | --- |
| `apps/local-api/src/tencentMatting.ts` | 使用官方 `cos-nodejs-sdk-v5`；包含商品 GoodsMatting、通用 AIPicMatting、人像 AIPortraitMatting 的模式映射、上传、签名请求、结果读取与临时对象清理 |
| `apps/local-api/src/cutoutSettings.ts` | 设置文件优先、环境变量回退；配置 SecretId / SecretKey / Bucket / Region / 可选 APPID；前端回读不含 SecretKey |
| `apps/local-api/src/tencentMatting.test.ts` | 可参考的协议、错误和取消行为测试；本轮未执行 |
| `apps/local-api/src/providerRunner.ts` | 旧项目任务系统中调用抠图的入口 |
| `apps/web/excalidraw-app/data/local/LocalCutoutRepository.ts` | 前端访问 Local API 的设置及能力接口 |

现有真实调用逻辑：上传临时 COS 对象 → GET 同一对象并带 `ci-process` → 取图片二进制 → 返回结果；finally 尝试删除本次临时对象。取消时 SDK 底层请求可能仍在途，代码等在途请求结束后再做清理。旧清理错误被吞掉，所以不能把“有 finally”当作云端对象保证删除的证据。

主工作区 PROJECT.md 还记录过 GoodsMatting 对真人全身照不能保证只留下衣服。这里处理的是已经生成的单件白底商品图；不能直接照搬“商品抠图等于从穿搭中提取衣服”的假设。该历史记录不是本轮视觉验收结果。

没有读取、复制或输出任何实际密钥文件。旧项目有接入代码，不等于当前账号、桶权限、费用和服务开通状态已验证。

## 官方协议核对

- [腾讯云商品抠图 JavaScript SDK](https://cloud.tencent.com/document/product/460/89068)：GoodsMatting 支持已存 COS 对象或公网 detect-url 输入，可返回 Blob。
- [腾讯云通用抠图 API](https://cloud.tencent.com/document/product/460/106750)：AIPicMatting 需要签名、绑定桶并开通数据万象；返回 PNG 二进制；属于计费服务。

选 GoodsMatting 作为平铺商品图首个验证模式，AIPicMatting 留作显式可选模式；不在失败时偷偷跨模式再调用一次。两者哪一个更适合白衣、针织、蕾丝，必须用同类平铺图比较，不凭接口名称宣称效果。

已找到腾讯的现成实现，当前不再并行接阿里、不继续采用 remove.bg，也不引入本地抠图模型。

## 与新画布的适配边界

MindFrame 的实现跑在 Node Local API；新画布现有 AI 请求默认浏览器直连，`canvas-proxy` 仅透传请求，不提供云签名或凭据保管。不能直接将 Node 模块拷进插件，也不能把普通转发代理说成已有腾讯后端。

当前使用官方 `cos-js-sdk-v5` 的签名方法加原生 fetch，由浏览器直连 COS；避免 SDK 内部自动重试。服务入口为 `web/src/services/api/tencent-cutout.ts`，没有新增后端。

配置由用户在专用弹窗输入或导入 MindFrame JSON，Zustand 仅在当前页面内存保存，刷新后清除；凭据不写入节点、配置导出或源码。支持临时凭据 Token。长期凭据如手动输入，仍属于浏览器内持钥，不能把它描述成后端安全托管。桶需要允许当前站点跨域及 PUT/GET/DELETE 签名请求；未修改任何云权限。

对本地 Blob / Data URL 使用临时对象上传路径，不把本地地址当成公网 detect-url。下载后验证图片可解码和真实 alpha，再保存到现有 IndexedDB 图片存储。临时上传与去底会发生云端请求及可能费用，准备工作不包含实际调用授权或修改云权限。

## 预设提示词

保留用户已经试出效果的版本，仅将目标服装写成明确变量，避免“该短语”没有绑定对象。此前建议的文案润色不视为已经验证的效果提升。

> 根据用户模特展示图里的「{目标单品}」，生成用于创建高质量“平铺单品图（Flat Lay）”。生成一张新的照片，这张照片要在纯白背景上，展示该单品的正面3D平铺效果。构图规范：正面视图必须居中。背景统一：永远是纯白色、无缝、无阴影的背景。元素排除：必须移除原图中的模特、搭配的其他衣物、鞋子和配饰，只保留目标单品。要求尽量还原原图单品的版型、材质和关键细节，但不要生成多余搭配。如果原图里还有其他搭配，也只能围绕「{目标单品}」代表的一件主单品生成。禁止把另一件衣服、整套穿搭或多件组合一起生成。

## 实施顺序与验收

1. 建立批量节点与逐图任务映射，提供逐条目标修改、统一模型和尺寸、提示词预设及透明底开关。不要复用变量笛卡尔积的语义。
2. 接现有识别/图生图与存图能力，按每条输入创建白底结果。生成完成即持久化，失败项可以独立处理。
3. 接腾讯去底，复用协议经验和成熟 SDK，解决签名、配置、取消与临时对象清理。失败保留白底；只重试去底不重新生图。
4. 验收多款对应、真实透明度、白色与镂空衣物边缘、保存重开、停止、刷新中断、重跑保留旧图、导出，以及节点空白拖动和控件操作。

用户已确认：每次 1 张，逐张完成识别→生成→去底；不自动重试，失败保留已完成结果并继续下一张；手动重试失败项；不新增超时和总张数限制，沿用模型现有请求行为。

已运行：批量逻辑 10 个测试，腾讯请求/取消/清理与 alpha 验证 7 个测试，均通过。腾讯测试使用真实 SDK 签名、假凭据和模拟网络，不证明线上账号或 CORS 可用。依项目约定未执行语法检查、类型检查或构建，未进行浏览器验收或付费调用。

试用入口见 `plugins/canvas/flatlay/README.md`；可测试变更已写入 pending-test 和 CHANGELOG。TODO 中原有两项与本功能无关，保留不动。实际图片效果、重开/导出、拖动和腾讯线上清理仍待验收。
