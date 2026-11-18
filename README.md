# dsh-session-actions

> 一个 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) Web 插件：侧栏会话行上的**操作集合**——标为未读、永久删除已归档会话。
>
> A DSH Web plugin that puts **session actions** in the sidebar row menu: mark unread, and permanently delete archived sessions.

原名 `dsh-archive-delete`；功能从“只删归档会话”扩展到“会话操作”后改为现名。旧版本的未读标记会自动迁移。

## 为什么需要它

DSH 的官方设计是「会话只能归档，永不删除」：归档只是把会话从列表里隐藏，日志仍然占着磁盘，也仍然能被搜索到。`dsh-session-actions` 补上这一个缺口：

- 只有**已归档**的会话才会出现「永久删除…」菜单项；
- 只允许删除**没有在运行、没有其他写入者**的会话；
- Host 端先删日志目录，再清理 Workspace 记账与归档集合；
- 浏览器端弹出确认框，明确写出「不可撤销」。

它不删除可见会话、不删除工作区、不删除附件等共享文件。

## 两个功能

| 功能 | 入口 | 作用范围 |
|---|---|---|
| 标为未读 / 标为已读 | 会话行「⋯」菜单 | 任意会话；行尾显示未读圆点 |
| 永久删除… | 归档会话的「⋯」菜单 | 仅已归档、未在运行的会话 |

### 关于「未读」

DSH 自带的未读状态只存在于浏览器内存：会话跑完一轮后变未读，打开即清除，**刷新后全部丢失**。本插件：

- 把未读标记持久化在浏览器 `localStorage`（键 `dsh-session-actions.unread`），刷新、重启后仍在；
- 同时尽量同步官方那份内存状态，使官方行状态点与提示文案保持一致；
- 打开会话（成为主视图）时自动清除标记，规则与官方一致；
- 会话被删除时一并清除标记。

## 特性

- 🔵 **未读标记**：「⋯」→「标为未读」，行尾出现圆点，刷新后仍保留；打开会话即恢复已读；
- 🗑 **归档行专属入口**：在「⋯」菜单里新增一行「永久删除…」，普通会话与置顶会话看不到；
- 🛡 **Host 端双重准入**：会话必须在归档集合中、且没有 live Agent / 其他写锁，否则拒绝；
- 🪟 **真正的确认弹窗**：显示会话标题与不可撤销警告，失败时就地显示原因；
- 🔁 **幂等清理**：日志已不存在但归档记账还在时，重试只做清理，不报错；
- 🌏 中英双语文案，跟随 dsh 语言设置；
- 🎨 使用 dsh 主题 token，明暗主题自动适配；
- 📦 无构建步骤，Host 半零第三方依赖。

## 交互

1. 在侧栏把某个会话归档（官方 Archive）；
2. 把视图切到「全部对话」或「仅显示已归档」，找到这个归档行；
3. 打开该行「⋯」菜单 → **永久删除…**；
4. 确认弹窗里点 **永久删除**；
5. 成功后会话日志目录被移除，归档集合与 Workspace 记账同步清理，该行消失。

> 删除的是会话日志（`$DSH_HOME/sessions/...`）。会话里引用过的附件是内容寻址的共享文件，不会被删除；如果你需要连附件一起清理，应另行实现带引用计数的手动清理。

## 安装

### 本机源码安装（当前桌面端）

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile desktop add /absolute/path/to/dsh-session-actions
```

包内 `dsh.bundle.patch` 会让插件管理器把 `dsh-session-actions` 加入 profile 的
`dsh.profile.bundles`，bundle 里的 `cordis.patch.yml` 再插入加载行；**不需要**手工改
`cordis.patch.yml`。

安装后刷新页面（客户端 bundle 由模块图热更新）；如果 Host 半没有自动加载，重启
dsh / 桌面端。只改 `lib/client.js` 时刷新页面即可（若 `pnpm run dev:web` 在运行则自动热更新）。

### 手动复制安装

若不经过插件管理器，把仓库复制到 profile 的 `node_modules/dsh-session-actions`，
再在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加入：

```yaml
- insert:
    - id: session-actions
      name: "dsh-session-actions"
```

### 从 npm 安装（发布后）

```bash
# Web profile
dsh plugin --profile web add dsh-session-actions

# Desktop profile
dsh plugin --profile desktop add dsh-session-actions

# 或从 GitHub 源码安装
dsh plugin --profile web add github:ZenithJoyH/dsh-session-actions
dsh plugin --profile desktop add github:ZenithJoyH/dsh-session-actions
```

包内 `dsh.bundle.patch` 已声明挂载行，插件管理器识别 bundle 时会自动插入。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-session-actions
```

并删除 `cordis.patch.yml` 里的 `session-actions` 条目；重启。

## 兼容性与权限

- **DSH**：0.2.x（Web / 桌面端均使用同一套 client bundle）；
- **平台**：macOS / Linux / Windows（Host 侧仅使用 Node `fs`/`path`，目录编码与官方 JSONL 后端一致）；
- **运行环境**：Node.js ≥ 22；
- **权限**：Host 侧读取 `$DSH_HOME/sessions` 与会话持久化服务，删除时移除该会话的 JSONL 目录与投影缓存；不发起外网请求、不读取工作区文件、不执行命令；
- **外部服务**：无；浏览器只调用同源 Host 路由 `/plugin/session-actions/delete`；
- **数据**：只删除会话日志；附件等内容寻址共享文件与工作区目录不受影响；未读标记仅存于本机浏览器 `localStorage`，不上传；
- **许可证**：MIT。

## 配置

Host 侧可选配置（写在 `cordis.patch.yml` 的条目下）：

```yaml
- insert:
    - id: session-actions
      name: "dsh-session-actions"
      config:
        route: /plugin/session-actions/delete
        # 覆盖 JSONL 会话根目录；默认 $DSH_HOME/sessions
        sessionsRoot: /Users/me/.dsh/sessions
        # 覆盖用于清理投影缓存文件的 dsh home；默认 $DSH_HOME 或 ~/.dsh
        dshHome: /Users/me/.dsh
```

一般不需要配置。只有当 profile 里 `@deepseek-ai/dsh-session-persistence-jsonl` 的 `root` 被改成非默认值、或 `DSH_HOME` 未被进程继承时，才需要显式指定。

## 安全边界

Host 路由 `POST /plugin/session-actions/delete`：

- 复用 `ctx.connection.requestRejection()`：Host/Origin 围栏 + 浏览器会话认证，和官方 `/api` 同级；
- 只接受 `POST`，请求体上限 64 KiB；
- 只删除字符串 Session id，路径由后端同款 `projectKey` / `encodeSegment` 计算，并强制落在会话根目录内；
- 调用 `sessionPersistence.open(id, 'write')` 抢占写所有权后才删除，避免与另一个进程并发写；
- 删除日志目录成功后才清理 registry；两者之间失败时保留归档状态，重试可完成（幂等）；
- 同一进程内对同一 Session 的删除串行化，双击不会并发执行。

它**不会**：

- 删除非归档会话（即使知道 id）；
- 停止正在运行的会话再删除（请先停止/归档）；
- 删除工作区目录、附件、导出文件或 `session_projcache` 之外的任何缓存；
- 提供批量「清空归档」按钮（当前版本按会话删除；如需批量可在此基础上扩展）。

## 开发

```bash
npm test
# = node --check lib/index.js
#   node --check lib/client.js
#   node test/host.test.mjs
#   node test/client.smoke.cjs
```

测试覆盖：

- 与官方 JSONL 后端一致的 `projectKey` / `encodeSegment`；
- 正常删除、非归档拒绝、运行中拒绝、写锁拒绝；
- 日志已丢失时的幂等清理；
- 浏览器 bundle 的加载、pending 状态机、成功/失败请求路径。

## 实现说明

- Host 半 `lib/index.js`：`ctx.inject(['webServer', 'connection', 'workspaceRegistry'])` 后注册一条 exact 路由；核心操作 `deleteArchivedSession()` 可单独测试。
- Client 半 `lib/client.js`：手写 dsh client-bundle 格式，注册两个 slot：
  - `sidebar.workspaces.session.menu.item`（order 500，官方 `session-id` 之后）——仅归档行可见；
  - `shell.overlay`（order 900）——确认弹窗。
- 删除后的列表更新来自 Host 的 Workspace follow 流：`detachSession` + `unarchiveSession` 会推送 Workspace/归档增量，侧栏自然移除该行。

### 已知限制

- 依赖 JSONL 持久化后端的目录布局；若未来后端改名/改布局，需要同步 `projectKey` / `encodeSegment`。
- 会话删除后，SQLite 全文索引（若该组合启用）不会主动清行；重新索引时自然消失，期间不会命中已删除日志。
- 确认弹窗不支持「输入标题确认」这类强确认；如需要可自行加一道输入校验。

## License

MIT
