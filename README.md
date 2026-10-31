# XiReader

在本机阅读 PDF、划重点、记笔记，并把选中的证据带回写作。支持 Windows 桌面、Apple Silicon Mac 桌面和本机浏览器；可以使用独立文献库，也可以连接已有 Obsidian 知识库。

我是软件开发小白，这个软件是通过和 AI 对话、反复试用和修改，**vibecoding（vibe coding）** 出来的。最初只是想给自己做一个方便读 PDF、划重点和记笔记的工具，于是有了最初的「纸间」，现更名为 XiReader。目前仍是预览版，欢迎反馈问题、提建议或提交改进。

项目现名 XiReader，原名纸间 Paperdesk；仓库已从 `Zeen-F/PDF_Vibecoding` 更名为 [Zeen-F/XiReader](https://github.com/Zeen-F/XiReader)。已有本地工作区无需改名；`Paperdesk.app` / `Paperdesk.exe`、安装包文件名、`paperdesk` API/MCP 标识、`PAPERDESK_*` 配置和现有资料目录继续沿用，避免影响已有文献库和插件绑定。

## 版本与获取方式

截至 **2026-10-31**，最新公开预发布为 **1.2.0-beta.6**（2026-10-22 发布）。下述开发分支仍沿用这个 package 版本号，因此不能仅凭版本号判断是否包含新侧栏。

| 版本／分支 | 包含什么 | 如何获取 |
| --- | --- | --- |
| 已发布 `v1.2.0-beta.6`；`main` 的功能基线为该版本（`ed204b3`） | PDF 阅读、批注、笔记、Obsidian 库、翻译 API、Codex MCP 插件、知识工作台交换和山岚 V2；beta.6 修复普通桌面入口读取已保存的山岚外观 | 下方 Release 安装包；应用仍显示 Paperdesk |
| 开发分支 `codex/xireader-codex-sidebar`，本文核对至 `b7b3f0a` | XiReader 显示名称、可调阅读侧栏、统一 Codex 阅读会话、按需补读和回答追加 | [开发分支源码](https://github.com/Zeen-F/XiReader/tree/codex/xireader-codex-sidebar)，按下方源码步骤切换分支并重新构建；尚未合入 `main` 或公开发布 |

下载 beta.6 不会获得下述新 Codex 侧栏。源码更新也不会自动替换已安装的应用；已发布功能以 [beta.6 发布页](https://github.com/Zeen-F/XiReader/releases/tag/v1.2.0-beta.6) 为准。

## 开发版：统一 Codex 阅读会话

- 阅读优先的可调左右侧栏；折叠不卸载已经打开的笔记和 Codex 编辑器。
- 批注“问 Codex”打开本篇文献的当前会话，首次自动创建；后续批注更换下一条消息的引用，保留同一会话和草稿。只有用户选择“新对话”才另开会话，点击批注不会自动发送。
- 直接通过本机已有 Codex CLI 流式问答、续聊、停止与恢复。批注讨论和普通阅读问答使用同一会话，不再提供独立讨论主面板。
- 输入区显示连接状态，模型和推理强度来自本机 Codex 实际能力列表；连接检查不发送阅读资料。
- 发送前核对 PDF 页码、可见范围、选区和批注快照；可取消附带。勾选本轮补读后，模型可按需读取本篇 PDF 的有界页文字，工具过程显示在消息中；没有 OCR 或整库访问。
- 已完成的真实回答可经预览确认追加到原批注或笔记，保留原内容及“查看原对话”来源。旧手动讨论和草稿在批注的只读历史资料中展示，不伪装为模型输出。

使用前先在本机安装并登录 Codex CLI；侧栏通过 `codex app-server` 连接它，使用已有 CLI 登录状态，不在侧栏收集密码，也不需要翻译 API 密钥或下文的 MCP 插件。当前实现按 CLI 0.164.0 协议核验；其他版本能否使用以实际连接检查为准。若找不到 CLI，可在启动 XiReader 前设置 `PAPERDESK_CODEX_CLI` 为可执行文件的完整路径。

1. 运行上述开发分支，打开文献，在右侧“Codex”页新建会话，或点击批注的“问 Codex”。
2. 点击“连接 Codex”，连接可用后选择模型和推理强度；缺少认证时先在终端完成 Codex 登录，再重新检查连接。
3. 选择或移除本轮阅读引用，输入问题，点击“核对上下文”，确认后再“发送给 Codex”。需要补读时，单独勾选“允许补读本篇”。
4. 回答留在此文献的会话中；需要写入时点击“保存回答到笔记”或“保存到此批注”，预览后确认追加。

上下文只包含有界文字层、页码与位置：每次最多附带三页，每页最多 4000 字符；可见矩形不代表文字已精确裁剪到屏幕范围。侧栏不发送页面图像，不做 OCR。补读每次最多三页、每轮最多四次，不开放其他文献或整库；发送的资料可能进入 Codex 服务的会话记录。连接可用也不保证后续请求的网络和额度。

操作、隔离权限、容量和恢复边界见 [Codex 阅读侧栏](https://github.com/Zeen-F/XiReader/blob/b7b3f0af23a93d788b7d16b4e18c425ee977a31e/docs/codex-sidebar.md)。旧存储与导出兼容规则见 [批注讨论说明](https://github.com/Zeen-F/XiReader/blob/b7b3f0af23a93d788b7d16b4e18c425ee977a31e/docs/annotation-discussions.md)。真实模型、宿主插件和打包应用需分别验证，不能用模拟测试代替。

## 下载、启动与升级

以下为已发布的 **1.2.0-beta.6** 安装包，无需编译源码。[下载版本与校验值](https://github.com/Zeen-F/XiReader/releases/tag/v1.2.0-beta.6) 以 Release 页面实际提供的文件为准。

| 入口 | 使用方法 |
| --- | --- |
| [Windows x64 ZIP](https://github.com/Zeen-F/XiReader/releases/download/v1.2.0-beta.6/Paperdesk-1.2.0-beta.6-win-x64.zip) | 完整解压到固定应用目录，打开 `Paperdesk.exe`；无需 Node.js。整个目录是一套应用，不能只复制 EXE。 |
| [macOS ARM64 DMG](https://github.com/Zeen-F/XiReader/releases/download/v1.2.0-beta.6/Paperdesk-1.2.0-beta.6-mac-arm64.dmg) | 将发布包中的 `Paperdesk.app` 拖入「应用程序」；无需 Node.js。当前预览包尚未经过 Apple 签名或公证。 |
| [本机浏览器 ZIP](https://github.com/Zeen-F/XiReader/releases/download/v1.2.0-beta.6/Paperdesk-1.2.0-beta.6-browser.zip) | 安装 Node.js 24+，在解压目录运行 `npm ci --omit=dev`、`npm start`，打开 `http://127.0.0.1:4317`；PowerShell 使用 `npm.cmd`。 |

发布页另有 macOS ARM64 应用 ZIP。Windows 包未签名，macOS 包未签名／公证；首次启动按系统提示核对来源。Windows、macOS 和浏览器包的校验清单分别为 `SHA256SUMS-win`、`SHA256SUMS`、`SHA256SUMS-browser`。当前未提供 Intel Mac、Windows ARM64、Linux 或移动端安装包。

升级前保存并正常退出旧应用，备份完整文献库。将新版完整应用目录放到固定位置，再更新原桌面快捷方式的目标和工作目录；不要把临时测试包作为长期入口，也不要覆盖或搬动文献库。没有自动更新。旧插件若占用应用文件，先正常断开连接再升级。

独立库沿用 schema 5；旧格式迁移、回退与 Obsidian Markdown 兼容要求见 [桌面安装与升级](docs/desktop-release.md) 和 [Obsidian 仓库模式](docs/obsidian-vault.md)。数据库自动备份不能替代 PDF、Markdown 和设置的完整备份。Windows 入口、云盘文件下载和目录安排见 [Windows 指南](docs/windows.md)。

## 阅读与记录

| 功能 | 已发布 beta.6 与 main 的行为 |
| --- | --- |
| PDF 与文献库 | 导入或拖入 PDF，按内容去重；Obsidian 中已有 PDF 原位阅读，保留源文件位置与内容。 |
| 整理和搜索 | 单层文件夹、PDF 可提取文字／笔记／批注搜索，点击结果定位。 |
| 阅读布局 | 左右翻页或上下连续阅读，单页至九页布局、缩放与适合宽度；次要选项集中在显示设置。 |
| 目录与书签 | PDF 目录、文字目录识别与页码校正，以及单独保存的个人页面书签。 |
| 高亮与区域批注 | 选中文字后核对引文并写评论；扫描页、图表和公式可以框选区域。 |
| 笔记与导出 | 单一 Markdown 编辑区、自动／手动保存，导出引文、评论和实际 PDF 页码。 |
| 专注与返回 | 临时收起阅读侧栏并保留笔记编辑区和草稿；来源定位后可返回原页及窗口内阅读位置。 |
| 弹层与窄窗 | 显示设置和翻译卡支持键盘焦点、Esc 关闭及窄窗口布局。 |

beta.6 已包含集中显示设置、专注阅读、来源返回、翻译确认和受权限控制的 MCP 搜索；开发分支进一步增加可调左右侧栏及折叠时保留已挂载编辑器的行为。详细操作见 [阅读布局与来源定位](docs/reader-display.md)。森林、暖砂、雾蓝、夜读四套皮肤不会改变 PDF 原始颜色。

## 山岚 V2 外观

beta.6 和当前源码均提供山岚书桌、紧凑书架、仅按标题的快速定位，以及晨间／月下场景。快速定位支持 ↑↓、Enter、Esc，关闭后焦点返回入口；文献栏边界可以拖动，也可用左右方向键调宽、Home／End 调到边界、双击恢复默认。密度与场景仅在本次页面内生效，不改写已保存的四套主题。

- 浏览器：在当前本机服务地址后加 `/?visual=shanlan`。去掉该参数即回到原外观。
- 源码桌面：构建后运行 `npx.cmd electron . --shanlan-daily`；已有完整桌面包可运行 `Paperdesk.exe --shanlan-daily`。此模式沿用原配置及文献库，使用前正常退出已有窗口。
- 隔离预览：使用 `--shanlan-preview`，可附加 `--preview-profile=完整目录路径` 指定独立配置目录；默认使用单独的预览配置。预览不会迁移日常文献库，测试时只导入合成资料。

新外观自 beta.5 提供；beta.6 的普通桌面入口读取当前配置目录的 `appearance.json`（`{"visual":"shanlan"}`），不更换配置目录或资料库。未设置时保留原外观。`npm.cmd run check` 包含合成资料的山岚界面回归；浏览器测试不代表真实模型、Codex 宿主或各平台安装器均已验收。

## 划词与手动选段翻译

1. 在带文字层的 PDF 中手动选择一个词、一句话或一段。
2. 打开翻译预览，核对原文、服务、接口和目标语言。
3. 点击“确认发送选文”。每次只发送这次预览中的选区，译文不自动写入笔记。
4. 下一段重新手动选择并确认；切换语言、修改服务配置或失败后重试，也需要重新确认。上一版译文保留到新译文成功。

**不提供整页翻译，不自动扩展选区或连续发送相邻段落。** 扫描图片暂不做 OCR，区域截图不能直接使用文字翻译。

软件内 API 翻译是可选项，支持百度、Azure、DeepL 和 OpenAI 兼容接口。填写自己的服务参数后才能使用，费用与可用额度由服务商决定；保存配置不代表凭据已验证。“测试翻译”会发送固定短句并可能使用额度，普通阅读、打开预览和切换语言不会发送选文。配置、缓存、预算和失败处理见 [翻译说明](docs/translation.md)。

也可以通过下方 Codex 插件明确共享选区，在当前对话中要求翻译或讨论；它使用当前 Codex 会话，与软件内独立翻译 API 分开。

## Codex MCP 插件：在 Codex 中使用阅读器

这是已有的外部 Codex 会话入口，与开发版内置阅读侧栏分别配置、分别保存对话。安装插件不会给 beta.6 增加新侧栏；使用侧栏也不必先安装插件。

插件连接本机 XiReader 服务。阅读器中的普通浏览不自动共享全文；核对选区后再点“交给 Codex”，需要回答时再发送问题。AI 回答留在当前对话，只有明确要求记录时才追加笔记；未保存草稿或版本冲突会阻止覆盖。

源码版需要 Node.js 24+、项目依赖和支持本地插件的 Codex。下面的命令对应源码浏览器服务：先运行 `npm.cmd run build`、`npm.cmd start`，核对打开的是预期文献库；保持服务运行，在另一个终端执行：

```powershell
npm.cmd run plugin:install
```

命令会准备本机绑定、注册本地 marketplace 并安装插件。安装后在 Codex 新会话启用插件并核对返回的资料库身份。beta.6 与 main 的插件仍显示“纸间 Paperdesk”，可说“打开纸间阅读器”；开发分支显示“XiReader”，可说“打开 XiReader 阅读器”。已有绑定不一致时先确认目标库，不要覆盖配置。移动运行时目录或升级桌面包后需要重新核对绑定；自定义端口不能照抄默认的 4317。完整安装和绑定步骤见 [Codex 插件说明](docs/codex-plugin.md)。

MCP 文献搜索默认只搜索标题。正文、笔记和批注检索需要本机显式授权，授权包含内容范围、有效期及预算；不因一句“搜索文献”自动开放整个资料库。主动共享或检索返回给 Codex 的内容可能进入模型请求。

插件安装、MCP 调用成功和宿主实际显示内嵌面板是不同检查；面板、消息与图片能力取决于当前 Codex 宿主。真实宿主流程和翻译服务账户需要分别验证，历史 Windows 结果或模拟测试不能证明当前环境可用。

## 从阅读证据到科研笔记

与 [知识工作台](https://github.com/Zeen-F/knowledge-workbench) 连接同一个 Obsidian 库后，在 XiReader 选中文字或区域，点击“发送到知识库”，核对实际 PDF 页并补充想法。保存的是这次选区、来源和可选原图，不会自动调用模型，也不修改原 PDF。

在工作台收集箱筛选材料、预览来源并选择参考笔记，再确认共享给 Codex 或自己的模型 API。生成结果进入待审草稿，结合固定的原文快照核对后再保存；原文、个人假设、AI 推断和待验证项应分别保留。来源链接可返回原 PDF 页和选区，文件变化或丢失时会提示核对，不会静默替换来源。

beta.6 已包含 XiReader 一侧的选区导出与来源返回，知识工作台需要另行运行并连接同一知识库；不会随 XiReader 安装包自动安装。接口、离线导入和返回规则见 [知识工作台交换说明](docs/knowledge-workbench.md)。

## 数据、保存与恢复

- 普通阅读、搜索、批注与笔记在本机处理，不需要翻译密钥或 Codex 插件。
- Obsidian 模式下，已有 PDF 保持原位；外部导入副本保存在 `Paperdesk/PDFs/`，笔记、批注和页面书签在 `Paperdesk/Notes/`。正文可在两边编辑，受管理的标题、批注和书签在 XiReader 修改。
- 桌面文献库与应用目录分开；源码浏览器版默认用 `data/`，开发模式用隔离的 `.local/dev-data/`。索引、翻译设置及恢复资料不作为正式笔记写进知识库。
- 开发版 Codex 会话也需备份：独立库保存在 `codex-conversations.sqlite`，Obsidian 模式保存在 `Paperdesk/CodexConversations/<文献 ID>.json`；仅备份笔记或重建缓存不能替代这些正式会话记录。
- 保存失败或版本冲突会保留输入并要求核对；正常桌面关闭等待待保存内容。评论草稿属于当前浏览器／桌面配置，不能替代文献库备份。
- 跨盘保存保留可恢复的原文件，并检查副本和并发修改。云盘 PDF 短暂改变元数据时有界重读，持续变化或校验不一致仍拒绝继续。详见 [跨盘保存与成品验证](docs/vault-cross-volume-recovery.md)。

备份前正常停止服务；独立库备份完整数据库及 PDF、翻译数据，不能在运行中只复制数据库主文件。Obsidian 模式应备份关联源 PDF、XiReader 管理文件及库外设置／恢复资料。含凭据的配置与数据库不要上传或提交 Git。强制退出、断电或清理浏览器存储不保证尚未提交的内容可恢复。

## 从源码运行与检查

需要 Node.js 24+、Git 和项目依赖。以下为新工作区的 Windows PowerShell 命令，macOS 使用 `npm` / `npx`；已有工作区继续使用原目录，切换前先处理自己的未提交改动。

```powershell
git clone https://github.com/Zeen-F/XiReader.git
cd XiReader
# 需要上文的新 Codex 侧栏时，先切换开发分支；只运行 main 则省略此行。
git switch --track origin/codex/xireader-codex-sidebar
npm.cmd ci
npm.cmd run desktop
```

本机浏览器入口：`npm.cmd run build` 后运行 `npm.cmd start`，打开 `http://127.0.0.1:4317`。也可双击 `启动纸间.cmd`（macOS 为 `启动纸间.command`）。更新源码后重新构建；关掉网页不会停止服务，终端按 Ctrl+C 正常停止。服务仅监听本机地址。

开发入口为 `npm.cmd run dev`，打开 `http://127.0.0.1:5173`，API 默认在 4318，使用 `.local/dev-data/`；开发入口不会沿用生产知识库配置。日常浏览器服务可用 `PORT`、`PAPERDESK_DATA_DIR` 指定端口和库目录；连接 Obsidian 时设置 `PAPERDESK_VAULT_DIR`，库外缓存目录必须在知识库之外。桌面版从应用菜单选择文献库或 Obsidian 知识库。完整配置见 [开发指南](docs/development.md) 和 [Obsidian 仓库模式](docs/obsidian-vault.md)。

```powershell
npx.cmd playwright install chromium
npm.cmd run check
npm.cmd run desktop:pack:win
npm.cmd run test:desktop -- --packaged release/win-unpacked/Paperdesk.exe
```

Windows 目录包入口为 `release/win-unpacked/Paperdesk.exe`。打包需要本目录中的完整物理依赖，不能用 Junction／symlink 根 `node_modules`；打包检查会核对生产依赖和 MCP 面板资源。macOS 打包入口为 `npm run desktop:pack`。安装依赖需要联网；测试使用合成资料，详见 [开发指南](docs/development.md)。

仅在上述侧栏开发分支中，另有 `node scripts/test-codex-chat.mjs`、`node scripts/test-codex-unified.mjs` 和 `node scripts/test-codex-ux.mjs`；main 尚无这些脚本。切换开发分支并构建后再运行，默认使用模拟模型。这些检查不等于真实 Codex 连通、成品或公开发布验收；真实模型测试的前提和独立命令见 [侧栏验证说明](https://github.com/Zeen-F/XiReader/blob/b7b3f0af23a93d788b7d16b4e18c425ee977a31e/docs/codex-sidebar.md#模块和验证)。

## 限制与反馈

- 暂无 OCR、PDF 内嵌批注编辑、内置云同步或多人协作；不支持加密／权限受限 PDF。
- 双栏、脚注、公式、复杂文字层及过小字号可能影响选文顺序与精度，发送或保存引文前核对预览。
- 同一文献建议只在一个窗口编辑；没有多设备并发写入的一致性保证。Windows 桌面验收不能替代原生 macOS 验收，CI 也不等于真实模型或宿主面板验收。

[反馈问题](https://github.com/Zeen-F/XiReader/issues) · [贡献约定](CONTRIBUTING.md) · [仓库安排](docs/repository-layout.md)

作者联系方式：**微信 a1152017529 · QQ 1152017529**。

本项目采用 [MIT License](LICENSE)，第三方依赖保留各自许可证。
