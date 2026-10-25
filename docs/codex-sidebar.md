# Codex 阅读侧栏

XiReader 的“Codex”页可直接调用本机已有 Codex CLI，流式显示回答、续聊、停止并恢复本应用创建的线程。“讨论”页的手动记录仍作为备用；反向 MCP 插件连接成功不等于本侧栏聊天可用。

## 使用与上下文

1. 打开文献，在“Codex”页新建或选择该文献的会话；也可选文后点击“问 Codex”，或从批注点击“在 Codex 中讨论”。
2. 选择跟随阅读或固定当前批注，输入问题，点击“核对上下文”。预览明确列出实际页码、可见矩形、选文、批注、将发送的有界页文字及缺文本／截断限制。可取消附带阅读内容。
3. 点击发送时重新采集 PDF.js 状态并核验库、文献、PDF 哈希和批注。与预览不一致时拒绝发送并要求重新核对。模型连接期间还会再次核验源文件；已发送快照不随翻页改变。
4. 回答流式保存在侧栏。停止、断线或结果不明不会自动重发；可核对原会话结果。已发送问题和部分回答保留，输入草稿按库、文献、会话和窗口隔离。

最多附带三页，每页 4000 字符，选文最多 4000 字符，批注评论最多 2000 字符；总快照上限约 19000 UTF-8 字节，进一步截断会在预览中说明。可见矩形来自阅读器，但文字是对应页面的有界文字层，**不是精确裁剪到可见矩形的逐字内容**。扫描 PDF 没有文字层时不假造文字；没有 OCR，也不发送页面图像。上下文作为协议 `additionalContext` 的 `untrusted` 资料分段传递，不能变成应用指令。只在用户明确点击发送时调用模型。

## 运行与权限

- 使用公开 `codex app-server --listen stdio://`；不控制 Codex 桌面、不读取原生历史目录、不创建登录或持久凭据。当前协议已按 CLI 0.164.0 的本地 schema 核验。CLI 应已安装并由用户自行完成登录；找不到命令或认证失败时保留输入并报错。
- macOS 优先检查 Homebrew 常见安装路径，其他平台从 PATH 查找；可用 `PAPERDESK_CODEX_CLI` 指定可执行文件路径，不接受 shell 命令片段。
- 子进程使用应用自有独立目录，显式只读、无文件网络权限、空 environments、禁用 shell、浏览器、插件、应用、hooks 等能力。通过公开 MCP 状态接口发现继承服务名，逐项禁用并在每个线程首次发送前核验 disabled 且没有工具或资源；无法确认则不发送。不改用户全局配置。
- 审批请求显示在侧栏，当前只读聊天只支持明确拒绝或停止，不提供额外命令／写入授权。没有匹配会话的请求拒绝；结果未知不自动批准或重新发送。
- 普通本机 Host/Origin 边界仍适用。API 的库／文献／PDF 身份检查、请求去重及外部修改冲突保护独立于界面。

## 保存与恢复

独立库使用 `codex-conversations.sqlite`，按需创建。Obsidian 模式以 `Paperdesk/CodexConversations/<文献 ID>.json` 为权威记录，复用原子替换、读回、冲突与恢复保护；删除可重建索引不会丢失正式会话。备份完整独立库或这些权威侧文件，不仅备份缓存。

每篇最多 50 个会话、每会话 100 轮、每轮回答最多 100000 字符；达到上限停止或要求另开会话，不丢弃旧记录。侧栏目前没有会话删除／独立导出按钮；需要备份时保留上述存储文件。已发送内容也可能保留在用户现有 Codex 服务的会话记录中。

重新打开窗口可恢复本地消息与草稿；进程中断的轮次标记待核对，恢复只使用已保存的本应用线程 ID 和公开 thread/read、thread/resume。未确认的发送无法按顺序猜测为某轮成功，必须保留不确定状态。存储失败时中断回答并保留错误，不覆盖外部修改。

## 模块和验证

- `server/codex-rpc.mjs` / `codex-runtime.mjs`：有界 stdio RPC、隔离和运行时核验。
- `server/codex-reading-context.mjs` / `codex-input.mjs`：验证、冻结、有界不可信输入。
- `server/codex-session.mjs` / `codex-store.mjs` / `codex-api.mjs`：流式生命周期、停止竞态、持久化与本机 API。
- `src/CodexChat.jsx` / `src/Reader.jsx`：可见侧栏、实时 PDF.js 状态与发送前预览。

`npm run test:api` 包含协议、生命周期、上下文及独立／合成 Obsidian 库测试。构建后运行 `node scripts/test-codex-chat.mjs` 验证模拟模型的可见 UI；运行 `node scripts/test-codex-desktop.mjs --packaged <应用包> --real` 会使用原创示例 PDF 向真实模型发送明确标记的测试问题。后者需要现有 CLI 认证，不能把模拟结果当真实连通，也不能把源码测试当成品验收。

本轮没有覆盖已安装应用或公开发布；具体本机测试记录和成品对应提交保存在项目忽略目录。真实模型验收仅使用合成问题／原创示例，不读取或发送真实文献和笔记。

## 参考与许可

实现采用本项目原创代码，没有复制参考项目代码。

- [Claudian](https://github.com/YishenTu/claudian/tree/b796b98977e5ffce349f695523efb14da78d482f)（MIT）：参考独立 app-server、线程和审批架构，以及发送瞬间选区快照。其普通侧栏选区机制不代表完整 PDF 页码／可见区域感知。
- [Codex Panel 5.5.1](https://github.com/murashit/codex-panel/tree/f30b5411f4c969e1cb76c041c39b99187242ce75)（Apache-2.0）：参考不可信上下文分段、线程隔离和恢复；未照搬以整个 vault 为工作目录的默认方式。
- [Codex app-server](https://github.com/openai/codex/tree/rust-v0.164.0/codex-rs/app-server)：实验协议可能变化；不兼容运行时需报错，不能扩大权限以继续。
