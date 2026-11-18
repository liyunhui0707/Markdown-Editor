# Markora CLI 与 MCP 伴侣

让 AI 或命令行生成 Markdown 后，立即交给已安装的 Markora。伴侣工具为 0.2.0，
配合 App 0.82.0；它独立于 App 安装包，不改变应用身份、草稿、保存权限或已发布 ZIP。

## 命令

```sh
markora status
markora open "/absolute/path/文章.md"
printf '# 标题\n\n正文。\n' | markora create --name "新文章.md" --stdin
markora help
```

`create` 默认将新文件写入固定 Inbox，再打开它。当前个人安装沿用
`~/Liyunhui/Inbox`；不会覆盖同名文件。`--no-open` 仅创建文件。
Markdown 通过标准输入传入，不作为 shell 命令执行。普通命令输出 JSON。

`open` 支持明确的本地 `.md` 路径；MCP 的打开工具只接受固定 Inbox 内的文件名。
隐藏/`secrets` 路径、符号链接与不支持的文件被拒绝。创建内容沿用 App 的
524,288 UTF-16 单位 / 2 MiB 限制，保留 BOM 与原始换行。

打开请求被 macOS 接受只代表 `open_requested: true`，**不代表已显示或已保存**。
App 仍通过原有的原生打开队列和输入保护处理请求，可能等待用户完成中文选词。
工具不读取或改写当前窗口的正文，不提供关闭窗口、自动保存或脚本执行接口。

若文件创建成功而打开失败，返回 `created: true`、新文件路径与
`retry_create: false`；文件保留。之后使用 `open`，不要重新创建或删除现场。
创建结果无法确认时也保留文件，不自动重试。

## 安装

需要 macOS、Node 24+、已安装的 Markora，以及已经存在、归当前用户所有的普通 Inbox。
App 本身继续独立运行，不要求 Node。

从仓库根目录执行：

```sh
node integrations/markora/install.cjs
```

安装器只创建 `~/.local/share/markora/0.2.0` 与 `~/.local/bin/markora`，不覆盖已有安装。
运行文件、共享容量规则、许可、配置与哈希清单一起复制；命令不依赖源码目录、
`node_modules` 或临时测试目录。安装使用执行安装器的既有 Node，不下载运行时。
需要让 `~/.local/bin` 已位于 PATH 中；安装回执会报告这一状态，不修改 shell 配置。

源码运行时可显式选择位置：

```sh
node integrations/markora/cli.cjs --app "/path/Markora.app" --inbox "/existing/Inbox" status
```

固定 Inbox 限当前用户主目录内、非隐藏、非敏感、不可被其他用户写入的普通目录。
记录目录身份并在操作前后核对；不宣称可以抵抗拥有同一用户权限的恶意进程或原子目录交换。
原有 App 的文件保存检查仍独立适用。

## MCP

```sh
codex mcp add markora -- "$HOME/.local/bin/markora" mcp
```

在支持自定义 MCP 的客户端中，配置 stdio command 为 `~/.local/bin/markora` 的实际绝对路径，
args 为 `["mcp"]`。该服务器没有 HTTP 端口、账号或远程服务。

| 工具 | 作用 |
| --- | --- |
| `get_editor_status` | App 安装/版本/运行状态、固定 Inbox 是否可用；不读取文档正文 |
| `open_document` | `filename`：固定 Inbox 内的明确 `.md` 文件名 |
| `create_document` | `filename`、`markdown`，可选 `open`；独占创建，默认显示 |

示例提示：“请调用 markora 的 create_document，文件名为‘学习计划.md’，
正文使用你刚生成的 Markdown，并打开它。”

采用标准换行 JSON-RPC stdio，兼容 2024-11-05 至 2025-11-25 的初始化协议。
未实现 2026-07-28 的现代协议，客户端需要支持旧版协商。依据
[MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、
[生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)与
[工具协议](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

登记配置、服务协议自测和当前聊天已加载工具是不同的状态。刷新客户端 MCP 连接后再确认
三项工具是否出现；已有聊天的工具清单可能不会即时更新。当前仍可直接调用 CLI。

## 验证

```sh
node --test integrations/markora/test/*.test.cjs
```

覆盖独占创建、容量与 Unicode、路径边界、目录替换、未知创建结果、打开失败保留文件、
安装副本独立运行、初始化/发现/调用、错误和 UTF-8 分片。测试使用合成资料。
协议自测不代表物理中文输入、旁白或所有 Markdown 格式已通过。

本机从早期伴侣升级时，旧 `mdapp` 命令可指向同一固定运行副本作为兼容入口。
更名不修改应用 bundle ID 或草稿数据目录。MCP 配置更新后，客户端需要重新连接；
命令行提交的打开请求不能证明当前会话的模型工具已加载，也不能证明文件已保存。
