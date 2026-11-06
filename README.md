# dsh-archive-delete

> 一个 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) Web 插件：在侧栏里**永久删除已归档的会话**。
>
> A DSH Web plugin that permanently deletes **archived** sessions from the sidebar.

## 为什么需要它

DSH 的官方设计是「会话只能归档，永不删除」：归档只是把会话从列表里隐藏，日志仍然占着磁盘，也仍然能被搜索到。`dsh-archive-delete` 补上这一个缺口：

- 只有**已归档**的会话才会出现「永久删除…」菜单项；
- 只允许删除**没有在运行、没有其他写入者**的会话；
- Host 端先删日志目录，再清理 Workspace 记账与归档集合；
- 浏览器端弹出确认框，明确写出「不可撤销」。

它不删除可见会话、不删除工作区、不删除附件等共享文件。

## 特性

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
"$DSH" plugin --profile desktop add /absolute/path/to/dsh-archive-delete
```

包内 `dsh.bundle.patch` 会让插件管理器把 `dsh-archive-delete` 加入 profile 的
`dsh.profile.bundles`，bundle 里的 `cordis.patch.yml` 再插入加载行；**不需要**手工改
`cordis.patch.yml`。

安装后刷新页面（客户端 bundle 由模块图热更新）；如果 Host 半没有自动加载，重启
dsh / 桌面端。只改 `lib/client.js` 时刷新页面即可（若 `pnpm run dev:web` 在运行则自动热更新）。

### 手动复制安装

若不经过插件管理器，把仓库复制到 profile 的 `node_modules/dsh-archive-delete`，
再在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加入：

```yaml
- insert:
    - id: archive-delete
      name: "dsh-archive-delete"
```

### 从 npm / GitHub 安装（发布后）

```bash
dsh plugin --profile desktop add dsh-archive-delete
# 或
dsh plugin --profile desktop add github:ZenithJoyH/dsh-archive-delete
```

包内 `dsh.bundle.patch` 已声明挂载行，插件管理器识别 bundle 时会自动插入。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-archive-delete
```

并删除 `cordis.patch.yml` 里的 `archive-delete` 条目；重启。

## 配置

Host 侧可选配置（写在 `cordis.patch.yml` 的条目下）：

```yaml
- insert:
    - id: archive-delete
      name: "dsh-archive-delete"
      config:
        route: /plugin/archive-delete/delete
        # 覆盖 JSONL 会话根目录；默认 $DSH_HOME/sessions
        sessionsRoot: /Users/me/.dsh/sessions
        # 覆盖用于清理投影缓存文件的 dsh home；默认 $DSH_HOME 或 ~/.dsh
        dshHome: /Users/me/.dsh
```

一般不需要配置。只有当 profile 里 `@deepseek-ai/dsh-session-persistence-jsonl` 的 `root` 被改成非默认值、或 `DSH_HOME` 未被进程继承时，才需要显式指定。

## 安全边界

Host 路由 `POST /plugin/archive-delete/delete`：

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
