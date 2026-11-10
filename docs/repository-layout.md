# 仓库与本机工作区

当前文件夹就是唯一正式源码工作区，基于 `v1.2.0-beta.1` 的 main 初始化。Windows 适配在独立分支进行，用 Git 保存差异与历史，不复制整份源码作备份。

## 保留的文件

```text
README.md / AGENTS.md       项目入口与开发约定
package.json / lock         运行命令与锁定依赖
PDF_Vibecoding.code-workspace 编辑器任务
src/                       界面、PDF 阅读与笔记交互
server/ / shared/           本机 API、存储和共享契约
desktop/                   macOS / Windows 桌面窗口与服务
plugins/paperdesk/          可选本机 Codex 插件
public/examples/           原创阅读示例
scripts/ / tests/          启动、构建、打包和回归测试
docs/                      开发、架构、使用说明
docs/history/              已提交的版本记录，按历史证据保留
.github/                   自动检查与发布流程
启动纸间.command / .cmd      Mac / Windows 浏览器启动器
```

已发布版本和安装包见 [GitHub Releases](https://github.com/Zeen-F/XiReader/releases)。各平台的历史验收结果以对应标签的记录为准。

## 本机生成内容

```text
node_modules/               唯一一套开发依赖
dist/                       当前浏览器生产界面
public/pdf-assets/          当前 PDF.js 本机资源
data/                       浏览器服务独立库的默认位置，是否在用以配置为准
.local/dev-data/            持久开发库，按需创建并保护
.local/desktop-assets/      当前桌面图标构建资源
.local/organization/        本机整理清单
release/                    最新实际使用的分发包和校验文件
```

这些目录均不提交 Git。上表是用途示例，不要求建立或长期保留每个目录；实际保留策略见 [空间管理](../AGENTS.md#空间管理)。正式 PDF、数据库、笔记及原始迁移记录按数据边界保护，备份按用户要求和当前恢复需要处理。桌面版文献库及所选 Obsidian 知识库不因整理项目目录而移动。Windows 桌面默认资料位于 `%APPDATA%/Paperdesk/`，文献库与缓存的关系见 [Windows 指南](windows.md)。

测试的合成文献库、知识库、用户配置和截图默认放系统临时目录，成功、失败及正常中断都先停止本次进程，再清理。只有明确需要留证时指定 `.local/` 内专用证据目录；保留当前摘要和必要材料，不累计多轮失败库、安装副本、日期报告或 ZIP。

验收后可清理本次生成且可重建的安装副本与测试缓存。用途不明的文件先核对再处理。精简操作清单保存在 `.local/organization/`，记录删除范围、必要校验及仍需保留的内容；移动到废纸篓不得记为已释放磁盘空间。

## 善后边界

- 日常开发保留一套依赖和当前构建；更新同名输出，不生成带日期的旧版本副本。
- 目录包与 portable 按实际用途保留一个；其他平台安装包只在明确需要并能验证时生成。
- 测试清理只针对本次创建且核对过用途的资料，实际在用的文献库、开发库、原 PDF、真实 Obsidian 目录和迁移恢复备份受保护。
- 只停止本次拥有的进程，释放端口前核对服务身份；不要全局终止 Node、Electron 或浏览器。
- 接口与入口更新同步文档；本机验证、远端 CI、公开发布和可选翻译／Codex 宿主验收分别报告。
