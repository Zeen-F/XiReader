# 批注讨论：本地记录与人工保存回答

这是源码中的有界本地讨论功能，不是内置模型或 agent harness。普通阅读、打开讨论、切换范围、预览和保存问题都不向模型发送内容；没有模型账户、OAuth、自动抓取 Codex 回答、流式生成或后台任务。保存的问题状态为 `saved`，仅表示本机落盘，绝不表示“已发送”“已生成”或“模型已完成”。回答必须由用户检查内容后主动保存，标为 `manual-answer`；不会自动追加到正文笔记。

## 来源与上下文

每个讨论固定绑定本篇文献 UUID、批注 UUID、PDF SHA-256、实际页码、引文和归一化区域。创建、预览、保存以及读取讨论时检查当前 PDF 的真实字节，而不只相信索引里的校验和。客户端不能传文件路径、任意来源矩形或自定义页面正文。

上下文由当前库的批注和页面文字生成：

- `selection`：仅固定引文；区域批注没有虚构引文，也不做 OCR。
- `page`：批注所在的实际 PDF 页。
- `adjacent`：所在页及前后各一页，边界处只取存在的页。
- `custom`：明确指定的实际页码，排序后最多 10 页。

每轮最多 50,000 个 JavaScript 字符（UTF-16 码元），不是 token 额度。超限拒绝，不静默截断；空文字页在 `emptyPages` 明确列出，不静默省略。问题保存前必须提交预览 `contextDigest`，服务端重新构建并核对；已保存的快照不会跟随后续翻页、选区或索引变化。

缩小本轮范围不会删除之前的记录，也不意味着外部对话已忘记旧内容。页面正文始终是参考资料，不变成系统指令。复制/交接到外部 Codex 是另一个由用户明确执行的动作，不等同于本地问题保存。

## 持久化与恢复

主库继续使用 schema 5，现有文献、批注、书签、笔记和 PDF 不迁移。独立讨论库为相同本机数据目录下的 `discussions.sqlite`，自有 schema 1；每篇文献的线程、消息与幂等请求记录作为一个受验证的有界 JSON 聚合在 SQLite 事务中提交。建立新侧库不改写主库记录。缺失/未知的已建立侧库结构和较新版本拒绝打开，不重建空表覆盖。未来讨论 schema 升级必须先加一致性备份与迁移测试。

Obsidian 模式的权威文件是管理目录中的 `Discussions/<documentId>.json`，不是库外的 SQLite 缓存。它不修改 `Notes/<documentId>.md`、用户 frontmatter、`Library.md` 或 PDF。文件不保存个人绝对路径和运行时库 ID，可随完整管理目录备份恢复。

侧文件复用现有知识库路径检查、禁止符号链接、旧版本 token 校验、临时文件刷新、原子替换、读回及原文件恢复副本保护。只有权威文件保存并读回后才更新缓存。若权威文件成功而缓存提交失败，接口可能报保存结果待核对；原文件仍是权威，同一 `requestId` 重试会恢复而不会重复追加。侧文件写入/读回阶段失败以 503 `DISCUSSION_SAVE_UNCERTAIN` 保守报告，不能当作明确未保存而丢弃请求 ID。已有缓存记录但权威文件缺失时拒绝创建空历史；损坏/未知 JSON 同样拒绝覆盖。删除缓存后可从完整侧文件重建；只备份缓存不能代替权威文件备份。

备份时正常关闭服务后保存独立库完整目录（包括讨论库），或在 Obsidian 模式备份完整管理目录、所有已关联的源 PDF，以及库外 `recoveries`。运行中不要只复制 SQLite 主文件而漏掉 WAL。讨论文件应由应用维护，不建议手改；旧客户端不会理解讨论记录，不能保证混用/外部同步的跨设备写入一致性。现有错开编辑、同步完整落地后再切换设备的约束不变。

删除批注不会删除讨论；历史显示 `annotation-missing`，禁止继续预览或追加。外部修改了来源批注或文献哈希则显示相应失效状态，不静默重绑。已保存记录仍可读取/复制；若原 PDF 本身缺失或不匹配，来源验证拒绝继续，需先恢复匹配文件。

## 接口

所有接口仍受本机 Host/Origin 限制，响应 `no-store`。从 `/api/plugin/status` 取得 `libraryId`。以下 `base` 为 `/api/documents/:documentId/threads`。

| 方法/路径 | 内容 |
| --- | --- |
| `GET base?libraryId=...` | `{threads,limits}`，仅当前文献；包含消息及来源状态 |
| `POST base` | `{libraryId,annotationId,pdfSha256,requestId}`，创建或复用同批注/来源讨论，返回 `{thread,replayed}` |
| `GET base/export?libraryId=...` | 下载本篇讨论的无损 JSON（含上下文与重试记录），与原笔记 Markdown 导出分开 |
| `GET base/:threadId?libraryId=...` | `{thread}`，拒绝跨文献线程 ID |
| `POST base/:threadId/context` | `{libraryId,pdfSha256,scope,pages?}`，返回 `{context}`，不保存问题/不发送 |
| `POST base/:threadId/messages` | 公共字段 `{libraryId,pdfSha256,expectedRevision,requestId,role,content}`；问题加 `{scope,pages?,contextDigest}`；人工回答使用 `role:'assistant',reviewed:true`，不得伪装生成状态 |

创建/追加新请求返回 201，原样幂等重放返回 200。`requestId` 在本篇文献内绑定规范化载荷；同 ID 不同载荷返回 409。追加使用整数 `expectedRevision` CAS，冲突不覆盖；重放先查已保存请求，不会因旧 revision 重复提交。收到超时/断网/500/503 后保留原载荷和 requestId，读取线程核对或按原样重试，不把通信失败当作一定没保存。

`thread` 包括 `id,libraryId,documentId,annotationId,pdfSha256,page,kind,quote,rects,title,revision,messageCount,createdAt,updatedAt,messages,sourceStatus`。`sourceStatus` 可为 `verified,annotation-missing,annotation-changed,source-changed`。

消息包括 `id,role,content,status:'saved',provenance:'user'|'manual-answer',sequence,requestId,context,createdAt`。人工回答 `context:null`，不假装由自动模型生成；用户问题保留完整不可变上下文。上下文包括 `schemaVersion,scope,pages:[{page,text}],quote,pageCount,characterCount,emptyPages,source,digest`，其中 source 仅携带已核验本库来源身份。

每篇文献最多 50 个线程，每线程 200 条消息；每篇聚合最多 8 MiB。问题最多 20,000 字符，人工回答最多 50,000 字符。达到上限时明确拒绝，不删除旧记录腾空间。没有生成任务，所以没有假的 cancel/job endpoint；取消预览只是放弃本轮未保存输入，不撤回已复制到外部对话的内容。

另外，普通文献 `GET ?expectedLibraryId=...`、`PATCH {expectedLibraryId,...}` 和 `POST /vault-conflict {expectedLibraryId,text}` 支持可选库身份守卫，拒绝切库后的旧笔记队列；错误码 `LIBRARY_IDENTITY_MISMATCH`。不传字段的旧客户端仍兼容。来源导航还可在 GET 中同时提供 `expectedPdfSha256` 与 `expectedLibraryId`，服务端匹配文献记录并核验真实 PDF 字节后才返回；仅比较旧数据库哈希不足以证明当前文件未变化。

## 自动验证与未验证边界

`tests/threads.test.mjs` 使用系统临时目录和原创合成 PDF，覆盖独立库/知识库保存与重启、精确幂等、冲突与并发、来源替换、跨库/跨文献拒绝、手动回答确认、上下文上限/空页/变动、SQLite 故障、权威侧文件恢复、缺失/损坏/符号链接、恢复备份失败，以及旧库身份读写保护。失败测试故意注入本地保存错误，不涉及真实模型或个人文献。

已有笔记 Markdown 导出不包含讨论；讨论面板提供独立的“导出本篇讨论 JSON”，包含全部已保存问题、人工回答和上下文。导出不会清空讨论或解除保存上限。

这些后端测试不代替 Chromium 操作、视觉布局、Electron 安装包、真实 Codex 宿主消息投递或跨设备同步验收。当前实现未接入真实模型，不能宣称回答自动回传已验证。

## 原生包阅读工作流验收

构建后运行 `node scripts/test-isolated.mjs scripts/test-reading-workspace-desktop.mjs --packaged <应用路径>`。该入口使用独立 Electron 配置、合成文献及沙箱窗口，复用阅读工作流交互断言，覆盖面板尺寸与键盘调整、批注来源、上下文核对、本机问题、人工回答确认、存储失败及多窗口草稿隔离。它与基础桌面、可靠性及 Obsidian 桌面验收互补；不会打开真实资料库，也不验证真实 Codex 宿主自动回传。
