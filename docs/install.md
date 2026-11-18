# 安装、更新与回退

当前版本为 **0.82.0**，使用独立的 `Markora.app`。打开 App 不需要终端、
Node.js 或仓库，也不需要选择 Vault。实际发行状态、安装包、校验值和适用验收结果见
[GitHub Releases](https://github.com/liyunhui0707/Markora/releases)。
本轮为 Apple Silicon / arm64，采用 ad-hoc 完整性签名，未进行 Developer ID 签名和公证。
历史输入法和旁白记录保留原版本及范围；不能推断其他版本或场景通过。

更名兼容：Markora 继续使用原有应用身份和 `Markdown Vault Document` 数据目录，
原有草稿、最近文档与恢复版本无需迁移。更新时保留旧 App 作为回退，只注册新安装版。

## 安装与打开文件

1. 使用维护者交付且已核对版本和 SHA-256 的本地 App 或 ZIP。ZIP 展开后保留完整的 `Markora.app`，
   放在固定位置，例如 `~/Applications/Markora.app`。已经安装时先按下文更新。
2. 双击 App；可把它拖到 Dock，以后从 Dock 启动。安装包声明 macOS 12 或更新版本；
   本批实际构建和测试的是 Apple Silicon / arm64，不能据此宣称 Intel 或所有系统版本通过。
3. 点「打开…」选择 `.md`，或在 Finder 右键文件 →「打开方式」→ Markora。
   普通打开直接建立独立的文件编辑缓冲区，保存前不改写原文件；无法建立绑定的文件和显式磁盘检查视图仍只读，可创建编辑副本。源码窗口支持修改，
   「应用并返回」只应用到正文；源码中的 ⌘S 会应用并保存文件，⌘Enter 仍只应用到正文。
4. 如需双击 `.md` 默认使用本 App，在 Finder「显示简介」→「打开方式」选择
   Markora，再自行选择「全部更改」。安装程序不会替你更改默认关联。

草稿备份、导出副本和保存回绑定文件有不同状态。另存为会切换到新文件，导出副本保持当前目标；新文件绝不覆盖已有目标。
普通本地保存直接执行并保留历史版本，OneDrive 首次写入仍显示恢复与同步说明。支持符合检查且未同步的普通本地 APFS 目录，包括桌面、文稿、下载、主目录外和外接 APFS 卷；
OneDrive 额外支持受检查且本机已下载的文件；其他同步目录、网络卷、非 APFS 和所有权/权限不受支持的位置仍会拒绝。
打开位置与可保存位置并非同一许可。遇到冲突、部分创建或结果未知时，保留内容和提示，
不要反复点击保存。

「详情」的「磁盘文件」提供主动检查、打开磁盘版和 Finder 定位。检查只反映所示时间，
不会自动导入后续变化。磁盘版单独只读打开，当前文档与撤销历史保留；文件变化或移走后，
已暂停的写回不会因再次检查而恢复。可从磁盘版建立新编辑副本，或将当前草稿另存新文件。
底部文件保存状态与旁边的本地备份状态相互独立。

若 macOS 拦截未公证 App，先核对来源、版本与哈希，按系统给出的安全提示处理。
不要以关闭 Gatekeeper、移除隔离属性或重新签名作为默认安装步骤。

## 更新和回退

1. 保留需要的内容，正常退出 Markdown；不要覆盖仍在运行的 App。
2. 将旧的完整 App 可恢复地保留在项目的 `.local/` 验证目录（开发者）或用户自行选择
   的备份位置，并记录旧版本及路径。不要直接删除旧版本。开发测试结束后，取消旧包和候选包的 LaunchServices 注册，
   将备份包改为 `.app.disabled` 并记录原路径与哈希，避免 Finder 列出多个版本。
   改名后再次取消归档路径的登记并核对唯一安装入口，防止系统按文件身份刷新旧登记。
   恢复时先核对清单，再改回 `.app`；开发者也需查看 `.local/APP-BACKUPS.json`。
3. 将验证过的新 App 放回原安装位置，启动后核对版本、打开、草稿恢复和保存状态。
   不要同时启动新旧两个版本；同一个应用身份共享本地记录。
4. 回退前先退出新版本，保留新 App 和本地记录，再恢复之前的 App。
   老版本可能无法读取新容量或新结构的草稿：先用新版本导出需要的 Markdown，
   连同图片附件保存，不能把换回旧 App 当成数据降级或迁移。

本地记录位于 `~/Library/Application Support/` 下：

- `Markdown Vault Document Drafts/`：草稿备份。
- `Markdown Vault Document/Recent Documents/`：最近文档目录。
- `Markdown Vault Document/Original Save Versions/`：保存版本与恢复记录。

更新不应清空这些目录。需要备份时，退出 App 后完整保留记录、权限和目录结构；
不要只复制部分 JSON。App 内备份不保护磁盘损坏。此版本没有自动更新器；通过上述 Releases 页面手动下载明确版本，
核对校验值后更新，不要把任意构建当成正式升级。

## 键盘操作

- `F6` / `Shift+F6`：在文档侧栏、顶部操作区、工具栏、正文、大纲之间切换。
- `Option+F10`：进入文字格式工具栏。方向键切换按钮，`Home` / `End` 到首尾，
  `Tab` 离开这一组；按钮使用空格或回车执行。原生格式选择框保持原生操作。
- 原生功能键可能需要同时按 `Fn`，取决于 Mac 的键盘设置。
- 对话框内 `Tab` / `Shift+Tab` 移动，`Escape` 退出或进入已有的未应用修改确认；
  返回触发按钮。中文候选仍在输入时，区域快捷键不会强制提交或转移焦点。

正文与源码的大焦点框仅用于键盘定位；鼠标点击或开始输入后收起，按钮等控件的焦点提示保留。
编辑区和控件名称、焦点提示及两种主题的部分颜色组合已经过定向自动化验证。
这不等同于完整 WCAG 合规、VoiceOver 人工验收或原生 IME 验收。

## 从源码运行和打包（开发者）

仓库锁定 Node **24.20.0**。下列命令在 `apps/desktop/` 内执行：

```sh
mise exec -- npm ci           # 仅新检出；会替换 node_modules
mise exec -- npm run dev      # 当前 Document App
mise exec -- npm run pack     # 本地 .app
mise exec -- npm run dist:mac # 本地 .app 和 ZIP
```

产物位于 `apps/desktop/dist/`；本批隔离验证可指定独立输出目录。
打包会编译生产版 native helper，不能使用带测试钩子的二进制。修改渲染器入口后必须
重建对应 bundle 并验证它与源码一致。历史 `dev:legacy` 为 Vault 开发入口，不是产品启动方式。

分发或安装前核对：包内版本与 `package.json` / lock 一致、真实运行时版本、
项目运行文件和 helper 哈希、`.md` 文件关联、无 `.local`/测试/凭据或旧 Toast UI 文件。
对实际交付 ZIP 计算并独立保存校验值：

```sh
shasum -a 256 /实际路径/Markdown-版本-arm64-mac.zip
```

本机校验值仅证明拿到的是已验证产物，不替代发布者签名。开发检查点、CI 通过与
本地 ZIP 都不代表公开发布批准。签名、公证、真实输入、VoiceOver 和长期使用验收
仍按路线图收口。


## Developer ID 分发准备（维护者）

用户已决定暂不购买 Apple Developer 会员；以下流程保留待产品进度合适时启用，
历史真实输入和基础旁白通过记录只适用于原版本与范围；当前优先继续持续写作和剩余人工验收。

此流程尚未完成实际签名和公证。需要本机钥匙串中可用的 **Developer ID Application**
证书及其私钥；Apple Development 或 ad-hoc 签名不能替代本站外分发流程。
使用已有 Apple Developer 账号在本机配置证书，并以 `notarytool store-credentials`
交互式保存公证凭据。只记录钥匙串 profile 名称；不要把密码、API Key 或私钥放进仓库、
命令历史、日志或聊天。目前产品继续使用既有 bundle ID，不借发布准备迁移用户记录。

完成真实输入、VoiceOver 和持续写作验收后，从通过 CI 的确切提交构建。在
`apps/desktop/` 内设置公开的证书名称（不是密钥）后执行：

```sh
export DOCUMENT_SIGNING_IDENTITY='Developer ID Application: 你的证书名称 (TEAMID)'
mise exec -- npm run pack:document:signed
```

此命令单独输出到 `dist/signed/`，要求分发签名和 Hardened Runtime，并将
`Contents/Resources/document-save` 纳入签名；不上传、不公证、不发布。
缺少有效分发身份时失败，不退回开发签名。原有本地 `pack` / `dist:mac` 行为不变。
维护者应先复核实际包内代码、版本、生产 helper、关联和排除项，再继续。

以下路径与 profile 均为示例，替换为本次明确目标。上传公证只包含待交付 App，
不包含用户文档或私有记录。为每次候选使用新的产物路径，不覆盖旧包：

```sh
ditto -c -k --sequesterRsrc --keepParent dist/signed/Markora-darwin-arm64/Markora.app /本次候选目录/submission.zip
xcrun notarytool submit /本次候选目录/submission.zip --keychain-profile 已配置的profile名称 --wait
# 仅在上一步明确 Accepted 后执行：
xcrun stapler staple dist/signed/Markora-darwin-arm64/Markora.app
mise exec -- npm run verify:document:release -- "$PWD/dist/signed/Markora-darwin-arm64/Markora.app" 实际十位TEAMID
# Staple 改变了 App，重新制作最终交付 ZIP；不能发布之前的 submission.zip：
ditto -c -k --sequesterRsrc --keepParent dist/signed/Markora-darwin-arm64/Markora.app /本次候选目录/Markora-版本-arm64-mac.zip
shasum -a 256 /本次候选目录/Markora-版本-arm64-mac.zip
```

`verify:document:release` 只读检查包内版本/身份、App 和保存 helper 的 Developer ID、
Team ID、Hardened Runtime、时间戳、票据和 Gatekeeper；任一步失败都返回非零。
它不能替代包内容复核、功能验收或来源真实性判断。

保留公证 submission ID、提交 SHA、签名身份、最终 ZIP 哈希与实际安装结果。
在另一台受支持的 Mac 上通过真实下载路径验收最终 ZIP：首次启动、Finder 打开、
中文输入、保存与恢复、退出后更新和回退。未通过前不发布正式下载或覆盖已有 Release 资产。
签名/公证不等同于功能验收；当前这些发布门槛仍未关闭。

流程依据：[Electron 签名文档](https://www.electronjs.org/docs/latest/tutorial/code-signing)、
[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。
打包使用锁定的 Electron Packager 与 ASAR；静态产品策略保留历史配置文件名，
签名选择经适配器验证，缺证书或签名失败时不会退回 ad-hoc 成功。
