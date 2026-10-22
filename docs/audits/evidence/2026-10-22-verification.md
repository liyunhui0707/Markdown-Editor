# 2026-10-22 验证记录

本文件归档当日审计的验证摘要，不表示在后续文档归档任务中重跑了测试。
测试对象为 HEAD `8926fd6f1101ed643d669074bbe4bccd3f29b7c4` 加当时未提交工作区。
源码选定文件 SHA-256 见[指纹](2026-10-22-source-fingerprints.json)，不能仅凭 HEAD 重建被测对象。

## 环境和隔离

- 原项目：`/Users/liyunhui/Liyunhui/Codes/markdown-vault-app`。
- 临时审计根：`/private/tmp/markdown-editor-audit-20261022.CmjWjm`。
- 临时源码位于根下 `project/`，按允许目录复制，包含需要的未跟踪运行模块和测试。
- 未复制 Git 数据库、个人配置、Inbox、环境/secret 文件、工作流状态、真实笔记或转录。
- 测试使用固定 Node 24.20.0；通过固定 PATH 使用该版本，未改变项目或用户全局配置。
- 使用锁文件安装 545 个包，`npm ci --ignore-scripts --no-audit --fund=false`，使用临时缓存和 `/dev/null` user config。
- 离线安装因缓存缺少 zwitch 失败，随后获准从公共 npm registry 安装成功；不能称为离线安装通过。
- Electron 运行时使用已有官方缓存 `electron-v43.4.1-darwin-arm64.zip`，展开到临时 `runtime/`。
- 第一轮临时复制遗漏 CLAUDE.md 且使用了临时目录默认 Node 26，属于验证环境错误。
  补齐测试依赖的文档并固定 Node 24 后，以下最终测试通过；未通过修改产品代码或断言掩盖失败。

## 结果

| 检查 | 最终结果 | 证据范围 |
| --- | --- | --- |
| 原项目 npm ls --depth=0 --offline | 通过 | 直接依赖可解析；不等于 Electron 二进制已安装 |
| 临时副本锁文件安装 | 通过 | 545 packages；生命周期脚本禁用 |
| npm run test:ci（Node 24） | 退出 0 | 2,375 tests / 2,373 pass / 0 fail / 2 skipped |
| npm run check:tiptap-readiness | 退出 0 | 44 pass / 0 fail；READY: 0 blockers，仅限清单 |
| 七个 build 脚本 | 通过 | editor、cm6、tiptap、spike-cm6、katex、hljs、mermaid |
| 重建文件比较 | 通过 | 90 个生成文件逐文件 SHA-256 与工作区一致 |
| 现有 npm run test:e2e | 退出 0，1 passed（4.8s） | Tiptap、合成文件、真实 renderer 键入/保存、不同进程和新 profile 重开 |
| npm run pack 加临时 output/electronDist/electronVersion 参数 | 退出 0 | 本地 unsigned arm64 .app；使用缓存 Electron 43.4.1 |
| 包成员和源码比较 | 通过 | 164 个运行文件无差异，27 个直接生产依赖均在包中，所检查的禁止路径无命中 |
| npm run audit:prod -- --registry=https://registry.npmjs.org | 退出 1 | 5 low；当日结果，非永久安全保证 |
| npm run audit:full -- --registry=https://registry.npmjs.org | 退出 1 | 19 汇总：6 low / 9 moderate / 4 high |
| 原项目 node tools/check-generated.mjs | 失败报告 | Tiptap/Toast UI bundle 是未提交修改；不等于重建内容不一致 |
| git diff --check | 未报告空白错误 | 当日审计末检查 |

完整测试最终摘要：

```text
# tests 2375
# pass 2373
# fail 0
# cancelled 0
# skipped 2
# todo 0
[test-baseline] passed: tests=2375, pass=2373, fail=0, cancelled=0, skipped=2, todo=0
```

完整测试通过不能替代文件安全、原生 IME 或发布验收；现有 CI 的两个安全审计门槛当日均失败。
Electron 虽列在 devDependencies，其运行时进入应用，不能因此把其高危报告仅视为构建工具问题。
审计原始建议中的 `npm audit fix` / `--force` **未执行，也不是本报告的实施建议**。

## 构建身份

- 新包：临时根下 `package/mac-arm64/markdown-vault-desktop.app`，版本 0.18.0。
- ASAR SHA-256：`32ee2581bd0ff5785d8f6882d01462d67df57bb8c47c5846cfdedf7b2591f55b`。
- 与 9 月 12 日记录的候选 ASAR 相同；未将其推断为当前系统所有原生行为都已重测。
- 工作区原有 dist ASAR：`0a5a197dd330c00509bafd769f529a1f551687dfc72ab38b665d331ec2683c38`，也是 0.18.0，但不是本轮当前源码候选。
- 原 dist 未声明 CFBundleDocumentTypes；现有 manifest 无 fileAssociations，main 未注册所需 open-file 流程。
- 当前包跳过代码签名、使用默认 Electron 图标；本轮未生成 DMG、安装到 Applications 或验证公证。

## 存储观察方法

只创建五个合成目录，每个含一个 sample.md。隔离 Electron app/ipc 生命周期，加载真实 main.js 并捕获 IPC handlers。
调用真实 load-vault-notes 后，向所加载 note.body 追加 `\nLOCAL EDIT\n`，再调用真实 save-note。
external-edit 场景在加载与保存之间先将磁盘替换为合成的 EXTERNAL UPDATE 内容。
unsupported-yaml 应返回拒绝，其余场景观察实际返回及磁盘字节。
输入、输出和临时路径逐项保存在[观察 JSON](2026-10-22-storage-observations.json)，临时路径仅标识当日 fixture，不是重跑前提。

F1/F2 的丢行/去缩进、F3 自动 H1 和 F4 外部覆盖由该存储边界复现；没有通过调用 Tiptap 转换器伪装整个应用验证。
这份观察不是新加入的回归测试套件；后续批准实现时，应把相关行为转成聚焦失败测试。

## GitHub 查询

通过只读 gh API 查询仓库 metadata、refs/heads、main commit 和 PR，未 fetch/pull/push 或修改引用。
实时 main 为 `8926fd6f1101ed643d669074bbe4bccd3f29b7c4`；默认分支 main；最后推送 2026-08-30；无 open PR。
远程还存在已合并的 fix/tiptap-table-alignment，提交 `12cc53e6b9a7ec8170cfbe14abd7aad9ac39f938`。
本地 main 为 e4698da、落后 2；当前分支与远程 main 提交一致，但 115 项跟踪变化及 26 个未跟踪文件未在远程保存。
这些数量是归档文档之前的工作区快照，新增本报告后自然会改变。

## 限制和证据保留

现有 E2E 的目录选择器被替换为合成 Vault；实际 renderer/preload/文件 IPC 和磁盘操作是真实的。
它不认证 Finder、真实选择器、真实中文 composition、原生快捷键或正常安装后的包启动。
main 存储观察也没有认证这些 GUI 流程。未打开用户常用 editor 或任何真实 Vault。
本地 `npm run dev` 所依赖的 node_modules/electron 下二进制缺失；本轮通过匹配缓存运行时验证启动。

临时完整日志为根下 test-ci-node24.log、tiptap-readiness.log、package.log；其 SHA-256 记录于源码指纹文件。
Playwright traces 在临时 project/apps/desktop/test-results/electron-e2e/，仅含合成测试。
临时目录可能被系统清理；本目录保留结果摘要、合成观察、完整 npm 审计输出及源码指纹。
未将二进制、node_modules、临时 profiles、完整 500KB 测试日志或截图/trace 复制入项目。
