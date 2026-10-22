# markdown-vault-app 恢复审计与产品方向评估 — 2026-10-22

## 阅读约定与决策状态

本报告保存 2026-10-22 第一轮只读审计结论，依据当前源码、配置、Git/GitHub 查询和隔离验证。
历史会话和文档仅作辅助。记录入库不表示技术迁移已获批准，也不表示发现的问题已经修复。
用户已明确文件优先、单一所见即所得界面、macOS 体验和数据可靠性的产品需求；下文技术路线、UI 和阶段计划仍是建议。
本轮未改变应用代码、版本、依赖锁文件或 Git 引用，未提交或推送，未访问独立的 ai-session-manager 项目或真实笔记。

证据分为：**本轮验证**、**代码支持**、**历史证据**、**待验证风险**、**建议**。
行号对应审计时的源码；后续变化请以函数名和[源码指纹](evidence/2026-10-22-source-fingerprints.json)定位。
日期性结论，特别是依赖审计、远程分支和竞品版本，必须在后续决策前刷新。

## 1. 项目现状总结

**结论：项目是可运行的 Vault 编辑器原型，已有值得复用的富文本核心，但还不是可靠的独立 Markdown 文档应用。**

- 本轮重新安装依赖、构建、完整测试、语料检查、现有 Electron E2E 和 arm64 打包均取得通过结果。
- 当前打开方式仍以选择 Vault 为前提；没有完整的 Finder 文件打开、另存为和跨目录独立文档流程。
- Tiptap 已有大量能力，但仍为 opt-in；默认是旧 hybrid-cm6，界面保留 Write、Preview、Source。
- 文件内容先被拆成 title/body/frontmatter，保存时重组。本轮复现正文丢失、缩进语义改变和外部更新覆盖。
- 重要工作仍未提交；工作区不能由 HEAD 提交单独还原。
- 本轮安全审计不再是零漏洞，当前候选不能据旧安全记录直接发布。

上次开发主要停在独立编辑器试用基线验收，包括长文档/真实图片粘贴、失败 Save All、安装启动和最终干净 CI。
部分原生测试因 Computer Use 的窗口定位错误中断；这类工具错误不能自动算作产品缺陷。
旧临时 QA 目录本轮已不存在。后续证据应在项目中保留摘要、合成复现和构建身份，不能只依赖临时目录。

## 2. 实际技术架构

| 层次 | 审计时实际实现 |
| --- | --- |
| 桌面外壳 | Electron 43.4.1；electron-builder 26.15.7 |
| 前端 | 原生 HTML、JavaScript、CSS；无 React/Vue |
| 默认编辑引擎 | hybrid-cm6；解析器还允许 hybrid、cm6、hybrid-cm6-lp、tiptap |
| 富文本核心 | Tiptap 3.30.5 / ProseMirror，自定义节点和转换桥 |
| Markdown | unified、remark-parse、remark-gfm、自定义数学分隔规则、remark-stringify |
| Preview / 扩展 | Toast UI、KaTeX、Mermaid、highlight.js |
| 状态 | renderer 全局状态、notes、编辑器缓存、localStorage、dirty/close helpers |
| 文件读写 | Electron main 接收 Vault 路径和笔记对象，经 IPC 加载/保存 |
| 测试 | Node 内置运行器；一个可选 Playwright Electron 保存/重开用例 |
| 工作区版本 | 0.18.0，未提交；HEAD 中版本为 0.17.4 |

当前链路：选择 Vault → main 扫描文件并拆分标题/正文 → renderer 笔记对象 → 编辑器 → title/body/frontmatter → main 重组并保存。
主进程持有文件 I/O，renderer 通过 preload/IPC 使用，`contextIsolation: true`、`nodeIntegration: false`。
Tiptap 使用本项目的 remark 桥，**未采用官方 @tiptap/markdown 扩展**；部分 tiptap-markdown 注释已经过时。

主要证据：[main.js](../../apps/desktop/main.js)、[preload.js](../../apps/desktop/preload.js)、[write-engine.js](../../apps/desktop/lib/write-engine.js)、[Tiptap 入口](../../apps/desktop/lib/tiptap-entry.js)、[转换桥](../../apps/desktop/lib/markdown-mdast-pm.js)。
index.html 为 4,572 行，main.js 为 867 行，Tiptap 入口为 352 行。职责集中会增加维护成本；建议按文档边界逐步拆分，不做一次性整理重构。

## 3. 功能完成度与数据可靠性

| 能力 | 结果分类 | 依据与限制 |
| --- | --- | --- |
| 选择目录、扫描并加载 Markdown | 已实现、有测试 | load-vault-notes；仍要求 Vault |
| 基础编辑、保存、重新打开 | 本轮限定验证通过 | 现有 E2E：实际键入、保存、新进程和新配置重开 |
| Tiptap 常用 Markdown/GFM | 已实现、有自动化覆盖 | 标题、标记、链接、列表、任务、引用、代码、表格；不等于全部交互已验收 |
| 表格列对齐 | 已实现并提交 | PR #137；语料测试 |
| 数学/货币分隔、Mermaid | 已实现、有测试 | 自定义数学规则和节点；部分修复仍在工作区 |
| 图片安全渲染、相对图片、粘贴落盘 | 部分验收 | 有代码/测试；真实剪贴板和长文档组合验收不完整 |
| 未编辑正文避免规范化假草稿 | 已实现、有测试 | loaded/source snapshots；不代表整个文件保存链路字节保真 |
| 通用 YAML Front Matter | 部分完成 | 编辑器桥可保留；main 仅接受简单 tags/source，其余拒绝保存 |
| 原始 HTML、引用链接、脚注 | 已实现限定保留 | rawInline/rawBlock；未知语法没有全面保真保证 |
| 撤销重做、切换隔离 | 有自动化和历史原生证据 | 加载重置历史，避免跨笔记恢复；不恢复 Tiptap 离开前的历史 |
| 中文 IME | 历史限定通过 | 本轮未重测；不能宣称所有输入法和组合均稳定 |
| 未保存提示、Save All | 已实现、部分原生验收 | 失败保存路径的剩余原生证据仍未补齐 |
| Finder 打开、文件 → 打开、⌘O | 尚未完成 | 未找到 open-file 注册和文件关联配置；选择器选择目录 |
| ⌘N / ⌘S | 部分满足 | 当前新建/保存笔记，尚非完整文档使用模式 |
| 另存为、⌘⇧S、最近文件 | 尚未实现所需链路 | 不能由现有 Vault 功能推定 |
| 跨目录多文档、重复打开去重 | 尚未实现 | 全局 mainWindow、单 Vault |
| 文档内查找替换 | 尚未形成统一功能 | 笔记搜索不能代替文档内查找 |
| 外部修改冲突保护 | 已复现缺口 | stale note 保存可覆盖外部更新 |
| 原子保存 | 代码支持的缺口 | 原位保存直接 writeFileSync；本轮未注入中途写入故障 |
| 深色主题与系统跟随 | 未找到完整实现 | 现有主要为浅色 tokens |
| arm64 .app | 本轮打包通过 | 未签名；不等于普通用户安装/公证验收 |
| AI Imports、Local AI | 代码保留，本轮未调用模型 | 暂缓扩展，不在本轮擅自删除 |
| AI Sessions | 本地已进行移除 | 删除及边界工作尚未提交；独立项目不在本轮范围 |

### 已复现的文件边界问题

以下均使用合成文件，调用当前 main 的真实 load-vault-notes / save-note handlers；Electron 生命周期被隔离替身取代。
结果是主进程存储边界复现，不冒充完整原生交互测试。五个场景的输入、加载值和保存值见[原始观察 JSON](evidence/2026-10-22-storage-observations.json)。

| ID | 分类 / 严重程度 | 输入与实际结果 | 代码证据 |
| --- | --- | --- | --- |
| F1 | 确认缺陷 / 高 | `# Title\nDO NOT LOSE THIS LINE\nSecond paragraph.\n` 加载后丢掉紧接标题的一行，编辑保存后不再存在 | main.js parseMarkdownFile，约 313–315 行：lines.slice(2) |
| F2 | 确认缺陷 / 高 | 标题后正文以四空格代码开始，trimStart 去掉缩进；保存改变 Markdown 语义 | 同函数及 parseFrontmatter 的 trimStart |
| F3 | 新产品要求与现状不符 / 中 | 无 H1 的普通文件编辑保存后被自动加上 `# sample` | main.js save-note，约 656–658 行；标题与文件内容耦合 |
| F4 | 确认存储边界风险 / 高 | 加载 → 外部改写 → 提交旧 note，保存成功且外部更新丢失 | file-name.js performSaveNote，约 245–247 行；无基线冲突检查 |
| F5 | 当前安全保护通过 / 限制 | custom YAML 的保存被拒绝，磁盘原文不变 | frontmatter-save-safety.js；这是保护策略，不是通用 YAML 已支持 |

F1/F2/F4 优先进入聚焦复现和 TDD；F3 是用户新文档需求下必须消除的模型约束。
纯加载未改动这些合成文件的磁盘原文，问题发生在加载结果及后续提交保存。

### 待验证风险，不列为已确认缺陷

- Tiptap getRichMarkdown 序列化异常时将 body 设为空串；严格加载失败后有宽松加载重试。需专门复现后判断数据影响。
- 普通富文本编辑重新序列化正文，尚无未触及块/格式局部保留保证。
- UTF-8 以外编码、BOM、混合换行的完整文件策略尚不明确；现有 CRLF 语料通过不等于字节保真。
- Vault 图片路径限制需要适配独立文件与资源授权；不能简单让 renderer 任意读绝对路径。

## 4. 本地与 GitHub 状态快照

| 项目 | 2026-10-22 查询结果 |
| --- | --- |
| 工作区 / Git 根目录 | /Users/liyunhui/Liyunhui/Codes/markdown-vault-app |
| 当前分支 | refactor/editor-session-split，跟踪 origin/main |
| HEAD / 实时 GitHub main | 均为 8926fd6f1101ed643d669074bbe4bccd3f29b7c4，领先/落后均 0 |
| Remote | git@github.com:liyunhui0707/Markdown-Editor.git；默认分支 main |
| 本地 main | e4698da，落后实时 main 2 个提交 |
| 工作区 | 115 项已跟踪变化，26 个未跟踪文件（23 个简略入口），暂存 0 |
| stash / worktree | stash 无；worktree 一个 |
| 远程其他分支 | fix/tiptap-table-alignment，已包含于 main |
| 未合并 PR / 最近推送 | 无；2026-08-30，PR #137 已合并 |

**提交历史一致、无分叉；工作区代码不一致，重要成果仅在本地未提交修改中。**
其中包含编辑器/会话拆分、安全更新、历史隔离、数学规则、保存保护、打包和 E2E。
个人配置变化需单独处理；不应 git add 全部内容。当前没有拉取或覆盖本地的理由。
建议先评审并保护这些成果，后续获得 Git 操作授权后形成可追溯提交基线。本报告不授权同步或提交。

## 5. 历史技术问题与根因

Git 记录确认：Toast UI WYSIWYG → 分块 textarea hybrid → CM6 → 装饰式实时预览 → Tiptap/remark。
CM6 路线主要承担隐藏语法、替换组件、可变高度、点击坐标与选择映射的复杂性；源码保留高度和点击偏移修正。
不能将此概括为 CM6 不可能实现 Live Preview；它支持装饰和块组件。当前路线维护代价与产品目标才是取舍依据。
Tiptap 提供富文本模型，但 Markdown/mdast/ProseMirror 之间仍需明确映射、序列化与未知内容策略。

已有针对性成果包括切换旧内容残留、加载污染撤销、混合任务列表、表格对齐、公式歧义、假草稿和 YAML 拒绝保护。
最大模型矛盾是：进入编辑器前文件已被拆分处理，保存时再重组，编辑核心无法挽回边界已经丢掉的内容。

9 月 10 日 IME 失败记录、后来未知构建的人工通过、9 月 12 日明确候选的限定通过，应分别保留。
9 月 12 日为 Tiptap + 简体拼音，Space 提交中文，Return 提交 Latin `ceshi`，结合人工与磁盘/重开证据通过。
本轮重打包 ASAR 与该候选相同，但未重测当前系统 IME；不推断历史根因，也不预选 IME 修复。
详见[9 月验收记录](../pilot-acceptance-sep12.md)。

## 6. 产品定位、竞品与许可证

产品目标：**面向 macOS、本地文件优先、单一连续排版编辑界面、保存标准 Markdown 的文档编辑器。**
借鉴 Word/WPS 的文件生命周期和 Typora 的编辑体验，不以 Vault、知识图谱、账号、同步或插件生态为当前核心。

| 产品 / 技术 | 类型与取舍 |
| --- | --- |
| Obsidian | 完整产品；可参考本地文件互操作，不继承 Vault 作为使用前提 |
| Typora | 完整商业产品；最接近文件使用和 Live Preview 目标，不能复制专有代码/品牌资源 |
| iA Writer | 完整产品；借鉴排版和界面克制，其写作/Preview 分离不是本项目交互目标 |
| MarkText | 完整产品及 MIT 源码；2026-10-21 发布 v0.23.0，仍活跃；Electron/Vue/Pinia/Muya 与较大依赖面，不能假定 Fork 更省成本 |
| Milkdown | MIT 编辑器框架；v7.22.3 发布于 2026-10-10；同为 ProseMirror/remark 基础，不自动解决保真 |
| Tiptap | MIT 开源核心、另有商业扩展；现有成果优先验证；官方 Markdown 扩展审计时仍标 Beta |
| ProseMirror / CM6 | MIT 底层框架；旧 GitHub 仓库归档与迁站有关，不能据此判断停维护，新站近期活动本轮未核实 |

复用需保留适用的版权/许可，并核对第三方依赖、字体、图标与品牌资产；框架许可证不能覆盖所有商业扩展或资源。
没有安装或实测上述竞品；交互与架构研究来自官方资料和公开源码，未作完整 Fork 可行性审计。

## 7. 技术路线建议与预验证门槛

| 维度 | A：现状定向修复 | B：替换编辑核心 | C：MarkText 二次开发 | D：文档架构调整 |
| --- | --- | --- | --- | --- |
| 文件优先匹配 | 单靠修补不足 | 文件层仍需建设 | 有产品能力，需实测 | 直接解决核心对象 |
| 单界面编辑 | 现有 Tiptap 可复用 | Milkdown 等需验证 | 已有交互，仍需适配 | 统一现有编辑表面 |
| Markdown 保真 | 存储缺陷待处理 | 转换风险仍在 | 不保证完全保真 | 明确完整文档契约 |
| macOS 集成 | 要补文件/菜单 | 同 A | 可借鉴已有流程 | 按文档生命周期设计 |
| 视觉自由度 | 高 | 高 | 改造已有 UI 体系 | 高 |
| 技术成熟度 | 底层成熟，应用早期 | 新增集成风险 | 上游活跃、复杂度高 | 不新增核心框架 |
| 迁移成本 | 低但模型可能延续 | 中高 | 高 | 中，集中边界 |
| 长期维护 | 多引擎负担 | 取决于适配层 | 承担 Fork 跟进 | 职责清晰后最契合 |
| 主要风险 | 继续局部修补 | 再次带入转换问题 | 分叉和定制成本 | 范围失控成重写 |

**推荐 D 的有限版本：保留 Electron/Tiptap，建立完整文档层；尚待批准实施。**
初期建议一文件一窗口，同文件重复打开聚焦已有窗口；以后再评估标签页。
建议职责：打开请求排队/去重 → 文档会话（路径、完整内容、编码、dirty、磁盘基线）→ 编辑适配器 → 冲突检查及可靠写入。
主进程仍拥有授权文件和 I/O；当前全局窗口与关闭状态需逐步改为按文档管理。

建议保存契约：仅浏览不写盘；未改保存字节不变；文件名/H1 独立；未编辑 Front Matter 原样保留；
未知语法在同一界面用安全原文块保留；转换失败阻止覆盖；外部修改明确冲突；写入失败保留原件和内存编辑；
非支持编码明确拒绝或由用户选择转换；实际编辑尽量只重写必要区域。

**先做小实验，后决定迁移：**固定合成语料贯通完整文件加载、实际编辑、序列化、保存、新进程重开，
覆盖 F1–F5、GFM、相对图片、公式、HTML/脚注、换行/编码，以及外部修改、只读、写入失败。
同时比较视觉、语义和未触及区域的原始字节；真实 IME 使用固定候选做少量人工验收。
保留源位置/原文、限定重写区域的可行性必须实验验证，普通文本 diff 不自动提供保真。
出现内容损失或安全保存不确定即停止提升默认引擎。只有明确证据证明当前方案不适合，才以相同语料比较 Milkdown。

## 8. UI/UX 与设计工作流建议

代码已有暖中性色、紫色强调色、字体和状态 tokens；未找到独立 Figma/Sketch 原型或完整主题体系。
当前工具栏、Vault 筛选和独立标题输入仍体现笔记模型，不能只靠换色满足文档需求。

| 方向 | 特征与代价 |
| --- | --- |
| A：安静的 macOS 文档窗口（推荐） | 紧凑标题栏、文件名/修改状态、单编辑区、侧栏默认关闭；辅助操作进入菜单 |
| B：书页式阅读写作 | 较强页面留白、衬线排版；阅读舒适但可能被误认为分页排版 |
| C：轻量专业编辑台 | 工具栏、可选目录和状态信息更丰富；操作直接但视觉复杂度高 |

建议初始参数：系统 UI/中文字体、正文约 18px、行高约 1.7–1.8、内容宽约 760px；用中英文长文实际调校。
间距采用 4/8/12/16/24/32/48；浅色暖白/中性白，深色近黑灰，分别调校代码/公式和可访问性。
复用组件包括按钮、菜单、搜索、对话框、文本块、表格；状态区分 dirty、saving、failed、conflict、readonly、语法保护。
文档标题属于内容，不再单独绑定应用标题框；初始入口为新建、打开、最近文件，主界面不设必须切换的编辑模式。
AI 功能接口保留并暂停扩展，入口取舍后续评估。原型优先覆盖主窗口、打开、冲突和只读状态。
工作流：版本化设计说明/tokens → HTML/CSS 静态原型 → 合成文档交互原型 → 真实文档层 → 截图/交互回归。
不依赖 Claude Design，也不在此轮重写 UI 或引入前端框架。

## 9. 分阶段路线与验收场景（提案）

| 阶段 | 顺序与验收 |
| --- | --- |
| 0：基线 | 保护并评审未提交成果，明确新需求与安全门槛；批准后才形成 Git 基线 |
| 1：文档预验证 | 完整内容、保真、Front Matter/未知语法、冲突、失败写入；已确认缺陷先有失败回归 |
| 2：文件优先 MVP | 阶段 1 通过后接 Finder 冷/热启动、打开/新建/保存/另存为、独立窗口、去重、查找替换、单编辑面 |
| 3：桌面打磨 | 浅/深色、系统跟随、最近文件、菜单/焦点/长文、错误状态；原型可在阶段 1 并行设计 |
| 4：发布 | 安全审计、类型注册、支持平台、图标/DMG或ZIP、签名/公证、干净构建和普通安装验收 |

| 用户场景 | 验收条件 | 本轮状态 |
| --- | --- | --- |
| A 独立打开 | Finder 打开 x.md，无需选目录 | 未完成 |
| B 跨目录 | Y.md 另开独立文档，保存互不影响 | 未完成 |
| C 连续排版编辑 | 加载即排版、可编辑、无需切模式 | 核心有基础，默认/UI 未统一 |
| D 数据往返 | 语义兼容、未触及内容保留、其他工具可读 | 确认存在问题 |
| E 稳定输入 | 自动化编辑/撤销/粘贴，加真实 IME 与长文 | 部分证据，未完整验收 |
| F 文件安全 | 未保存、冲突、只读、写入失败、重复打开 | 部分保护，外部覆盖已复现 |
| G 产品体验 | 下载/安装/Finder/写作/保存/退出 | 未完成 |

MVP 必需：独立文件、单编辑面、基础 Markdown/GFM、可靠保存、IME/历史、关闭与冲突保护。
发布前必需：安全门槛、安装关联、分发对应签名/公证、主题/可访问性、版本和构建追溯。
以后可选：文件夹浏览、标签页、导出增强、AI 扩展、插件、同步/协作、知识组织。

## 10. 下一步具体行动与使用规则

**建议下一任务：完整 Markdown 文档加载与保存边界的最小 TDD 切片，先澄清/评审规格，再实施。**
聚焦 F1/F2/F4，明确 F3 新要求；补充未改保存不写盘、转换失败拒绝覆盖的契约，不因测试变绿降低要求。
保留 Tiptap/remark、节点扩展、安全组件、close/dirty/collision 可复用逻辑、语料和现有 E2E。
暂停 CM6 装饰式 WYSIWYG 扩建、多引擎同等产品投入、Vault/AI 扩张和无边界人工 QA；不擅自删除历史代码。
避免立即 Fork、全量重写、迁移框架或升级所有依赖；安全修复需要单独评估和回归。

本报告是日期快照，不是新的完成声明。后续改变 runtime、锁文件、文件层、编辑器或输入环境时，重验受影响结论。
新的执行计划应链接本报告，并记录批准范围；9 月 roadmap/验收记录作为历史保留，不自动宣告关闭。
下一步建议使用 task-clarification-tdd-spec：产出文档边界验收条件、合成复现和 TDD 清单，保持 Finder/UI/框架迁移分开。

## 验证证据与官方参考

- [验证方法、结果及限制](evidence/2026-10-22-verification.md)
- [合成存储观察](evidence/2026-10-22-storage-observations.json)、[源码/日志指纹](evidence/2026-10-22-source-fingerprints.json)
- [生产依赖审计原始输出](evidence/2026-10-22-audit-prod.txt)、[完整依赖审计原始输出](evidence/2026-10-22-audit-full.txt)
- [Obsidian 文件模型](https://obsidian.md/help/Files%2Band%2Bfolders/How%2BObsidian%2Bstores%2Bdata)、[Typora Live Preview](https://typora.io/)、[Typora 文件打开](https://support.typora.io/Use-Typora-From-Shell-or-cmd/)、[Typora EULA](https://support.typora.io/License-Agreement/)、[iA Writer](https://ia.net/writer)
- [MarkText v0.23.0](https://github.com/marktext/marktext/releases/tag/v0.23.0)、[桌面依赖](https://raw.githubusercontent.com/marktext/marktext/develop/packages/desktop/package.json)、[MIT](https://raw.githubusercontent.com/marktext/marktext/develop/LICENSE)
- [Milkdown 架构/许可说明](https://github.com/Milkdown/milkdown)、[v7.22.3](https://github.com/Milkdown/milkdown/releases/tag/v7.22.3)、[Tiptap Markdown 限制](https://tiptap.dev/docs/editor/markdown)、[Tiptap MIT](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md)
- [ProseMirror 迁站说明](https://raw.githubusercontent.com/ProseMirror/prosemirror/master/README.md)、[CM6 迁站说明](https://raw.githubusercontent.com/codemirror/view/main/README.md)、[Electron open-file](https://www.electronjs.org/docs/latest/api/app#event-open-file-macos)
