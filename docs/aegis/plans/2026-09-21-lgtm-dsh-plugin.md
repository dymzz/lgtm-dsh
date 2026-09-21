# lgtm-dsh 实施计划

- 日期：2026-09-21
- 基线文档：`pre_design.md`（原始设计前置文档）
- 实测基线：`docs/reference/lgtm-0.3.1-contract.md`、`docs/reference/lgtm-0.3.1-checks-metadata.md`
- 宿主版本：`@deepseek-ai/dsh` 0.1.5-rc.2，profile `web`

**Aegis Visibility**：这份计划之所以值得落成文档，是因为它要新建一个 owner
（`lgtm-dsh` 插件包）、两组公开契约（`lgtm_status` / `lgtm_audit` 工具）和两个分发面
（声明 `dsh.bundle.patch` 与 `dsh.client` 的 npm 包），并且要对
`pre_design.md` 里五条与实测不符的决策做**退役**处理——这些都不是单点改动，
需要一个能交给「没有上下文的人」执行的版本。

---

## 1. Goal

让 DSH 用户在**一次配置**之后，可以在会话内完成「安装 lgtm → 连接凭据 →
审计测试」全流程，且 agent 在写完测试时能自行触发审计。

验收证据：`lgtm_status` 报 `ready: true`；`lgtm_audit` 对一份已知含坏测试的文件
返回至少一条 `high` 发现；对一份干净文件返回空 `findings` 且 `tests > 0`。

## 2. Architecture

```
agent ──调用──> lgtm_audit ──ctx.credentials.resolve──> 配置的凭据引用
                   │                                       │
                   └──ctx.shell.resolve({command, env})────┘
                              │  node '<依赖绝对路径>/dist/cli.js' …
                              ▼
                    lgtm --yes --format json ──HTTPS──> TypeSafe Jev
                              │
                              ▼
                     stdout: 一个 JSON 对象
```

三个不变量：

1. **不存凭据**：插件不写 `~/.config/lgtm/config.json`，不持有 key，每次操作解析一次引用。
2. **不经 `ctx.llm`**：`lgtm` 是独立进程，自己发 HTTP；`ctx.llm` 无法承载它。
3. **stdin 关闭**：所有子进程调用都不传 `stdin`，执行器把它映射为关闭的 fd 0。

## 3. Tech Stack

- Node ESM（`"type": "module"`），不引入 TypeScript 构建。
- `@stardeckai/lgtm` 作为**普通 dependency**随插件进 profile；运行时用
  `createRequire(...).resolve()` 定位，绝对路径启动。不全局安装、不查 PATH。
- `defineTool`（`@deepseek-ai/dsh-tools`）编译 DSH 私有的 schema DSL —— **不是**
  JSON Schema、不是 zod、不是 TypeBox。
- `apply`（`@deepseek-ai/dsh-skill-filesystem`）把本包的 `skills/` 挂成 skill root。
- 浏览器半边手写 module loader 的 lazy-CJS factory，不需要客户端构建链。
- 插件导出约定：具名导出 `name` / `inject` / `apply`。

## 4. Baseline / Authority Refs

| 事实 | 来源 | 状态 |
|---|---|---|
| `ctx.shell` 只有 `resolve` / `run` / `start`，**没有 `which`** | `dsh-shell/lib/types/index.d.ts:48-77` | 已核实 |
| `ShellExecRequest.env` 在凭据清洗**之后**合并 | `dsh-shell/lib/types/types.d.ts:57-64` | 已核实 |
| `SENSITIVE_ENV_PATTERN = /KEY\|PASSWORD\|SECRET\|TOKEN/i` | `dsh-subprocess/lib/index.js` | 已核实 |
| 不传 `stdin` ⇒ 关闭 fd 0 | `dsh-bash-local/lib/index.js:190`、`dsh-pwsh-local/lib/index.js:291` | 已核实 |
| `ctx.credentials.resolve(ref)` ⇒ `{value, source} \| undefined` | `dsh-credentials/lib/types/index.d.ts:129-191` | 已核实 |
| 工具注册唯一入口 `ctx.tools.register(definition)` | `dsh-tools/lib/types/index.d.ts:601` | 已核实 |
| skill 布局：`<root>/x/SKILL.md` 或 `<root>/x.md` | `dsh-skill-filesystem/lib/index.js:581-614` | 已核实 |
| frontmatter 必填 `name`(kebab) + `description`，可选 `whenToUse` | `dsh-skill-filesystem/lib/index.js:664-704` | 已核实 |
| `dsh plugin --profile web add <path>` 按 `dsh.bundle` 自动挂载 | `dsh/lib/plugin-Ddi42qoW.js:101-128` | 已核实 |
| lgtm 只读 `TYPESAFE_API_KEY`，不读 `OPENROUTER_API_KEY` | `docs/reference/lgtm-0.3.1-contract.md` §1 | 已核实 |
| lgtm 的确认门禁测的是 **stdin** 而非 stdout | 同上 §4 | 已核实 |

## 5. Compatibility Boundary

- **兼容**：`lgtm >= 0.3.1`（`--format json`、`--yes`、`--skill none` 均已存在）。
  默认装 latest，不做版本钉死。
- **不兼容**：`lgtm --dry-run --json` 是**另一套 schema**（数组，元素为
  `{file, line, questions, state}`），与审计路径的 JSON 不通用，不要复用解析器。
- **宿主面**：`inject` 里 `tools`/`commands`/`shell`/`credentials`/`skills` 是硬依赖；
  `sandboxPolicy` 用 `ctx.get()` 惰性读取，缺失时降级为不设策略。
- **分发面**：`files` 必须含 `cordis.patch.yml` 与 `skills`，否则安装方拿不到配置层与 skill。

## 6. Requirement Ready Check

| 项 | 结论 |
|---|---|
| Requirement source refs | `pre_design.md` §2 目标 G1–G6、§3 成功指标、§4 组件、§8 实施计划 |
| Goals and scope refs | 同上 §1–§4 |
| Acceptance / verification refs | 本计划 §1 验收证据、§10 验证 |
| Open blocker questions | 已消解：G6（走 `ctx.llm`）与 G4（调 lgtm CLI）互斥，用户于 2026-09-21 选定**方案 A**：包 CLI + 按次解析并注入凭据，G6 改写为「不维护自有凭据」 |
| Decision | **ready** |

## 7. Change Necessity

- **用户可见需求**：在 DSH 内完成安装、初始化与测试审计，不重复粘贴 TypeSafe key。
- **非代码方案为何不够**：纯文档无法让 agent 在写完测试时自动触发审计，也无法把
  凭据从 DSH 存储器安全地送进子进程。
- **最小代码边界**：一个插件包（`index.js` + `cordis.patch.yml` + `package.json`）
  加一份随包分发的 skill；不新增服务、不改动任何既有插件、不写 DSH 配置。
- **Decision**：`code-change`。

## 8. Ripple Signal Triage

触发信号：新增公开契约（2 个工具 + 1 个命令）、新增分发面（npm bundle）、
新增 owner（`lgtm-dsh` 包）。

- **canonical owner**：审计逻辑归 `lgtm` CLI（上游），插件只做编排与归一化；
  DSH 侧凭据归 `dsh-credentials-local`；provider 注册归 `dsh-llm-pi-ai`。
- **下游消费者**：agent（读工具 schema 与渲染文本）、用户（读设置页卡片与
  `lgtm_status` 的 notes）、未来的 CI 用法（`--format github`，本计划不涉及）。
- **source-of-truth 风险**：`checks[id].threshold` 是**静态**阈值，而
  `finding.threshold` 是套用 `--threshold` 后的**有效**阈值；判定必须用后者。
- **退役**：见 §9。不保留双 owner，不新增 fallback 分支。

### Existence Check

| 拟新增面 | 既有可复用 owner | 为何不够 | 结论 |
|---|---|---|---|
| `lgtm_status` 工具 | 无（`dsh-tools` 无环境探测工具） | —— | `add-with-proof` |
| `lgtm_audit` 工具 | 无 | 上游只有 CLI，没有工具封装 | `add-with-proof` |
| 直装流程（装载时执行） | 无 | 安装必须在插件可用之前发生，不可能是 agent 的一次工具调用 | `add-with-proof` |
| 设置页卡片 | 无 | settings schema 本身渲染不出任何 UI；DSH 没有通用表单渲染器 | `add-with-proof` |
| skill root 挂载 | `aegis` 已用同一模式挂 `skills/` | 该模式可复用，不新建机制 | `reuse-existing` |
| 自建 key 文件 | `ctx.credentials` | 会与 DSH 凭据体系形成第二 owner | `reject` |

## 9. Retirement Track

| 退役项 | 原出处 | 替代 | 触发条件 |
|---|---|---|---|
| 「审计请求走 `ctx.llm`，插件不碰凭据」 | `pre_design.md` G6 / §5.4 | 包 CLI + 按次解析 `TYPESAFE_API_KEY` 注入子进程 `env`（§11 修正 1） | 立即，用户已裁定 |
| `OPENROUTER_API_KEY` 回退探测 | `pre_design.md` D4 | 只探测 `TYPESAFE_API_KEY`（§11 修正 2） | 立即 |
| 把 skill 写进 `$DSH_HOME/skills/` | `pre_design.md` D6 | 随包分发 + 挂载 skill root（§11 修正 3） | 立即 |
| `ctx.shell.which()` | `pre_design.md` D1 | 纯 Node 的 PATH 扫描（`index.js` 的 `which`） | 已完成 |
| `/lgtm-setup` 命令 | `pre_design.md` §4.1、G3 | 依赖随插件一起装（P2） | 已完成，命令已删除 |
| 全局 `add -g` 安装 + `ctx.shell.which` 探测 | 本计划 P2 初稿 | `dependencies` + `createRequire` 模块解析 | 用户 2026-09-21 修正 |
| bun/pnpm/npm 引导安装 | 本计划 P2 二稿 | 不做引导；缺依赖时给重装命令 | 用户 2026-09-21 裁定 |
| `lgtm init --skill none` | `pre_design.md` D2 | 不跑 init，凭据全程走 env | 已完成 |
| 「设置页选 lgtm 版本」 | 用户 2026-09-21 早先的要求 | **已删除**（见下方 P9） | 用户 2026-09-21 裁定 |
| 「插件自管版本目录」 | 本计划 P8 草案 | 未保留，实现后即撤回 | 用户 2026-09-21 裁定 |
| 卡片上只读的 **API** 行；`Config.credentialRef` 的展示面 | 本计划 P7 初稿 | `lgtm_status` 的 note（见 P10） | 用户 2026-09-21 裁定 |
| 自造的 `lgtm-test-audit` skill | 本计划 P1 初稿 | lgtm 官方随包的 `lgtm` + `actually-test` 两份 | 用户 2026-09-21 要求「把调用 skill 实装」 |
| `fullAccessPolicy()` 自我提权 | 本计划 P3 初稿 | `sandboxPolicy.resolve({ session })`（见 P3 差异 5） | 实测 `mode` 语义 = 已批准覆盖，即绕过用户策略 |

#### P9（退役记录）— 版本不作为运行时设置

用户先要求「版本下拉要真能切版本」，随后在实现过程中改判：

> 删除这个功能，因为插件依赖已经指定版本并下载了，需要哪个版本改依赖就好了，不要多此一举。

**判断是对的**：`@stardeckai/lgtm` 是 lgtm-dsh 的 `dependencies`，`package.json` 定范围、
profile 的 lockfile 钉版本。插件再自管一份版本目录，等于给同一个事实造了第二个 owner。

**退役内容**（全部已删除，非保留）：
- `Config.version` 字段（设置页不再有版本项）
- 卡片上的版本下拉，以及为它而存在的 GitHub Releases 拉取 —— 卡片现在**完全不碰网络**
- `dshHome()` / `versionRoot()` / `installPinnedVersion()` / `installNotes()` /
  `ensureVersion()` 与 `installs` 状态表
- `resolveLgtm(version)` 恢复为无参单源；`collectStatus` 不再有 install 参数

**保留的行为**：`lgtm_status` 照常报告**已装**版本（从解析到的 manifest 读），
因为那是事实；只是不再可配置。

**验证**：`test/smoke.test.js`（含「version 不是配置字段」「status 不报告版本控制状态」）；
`test/client.test.js`（含「卡片不暴露版本控件」「卡片不碰网络」——测试装了会抛异常的 `fetch`）。

#### P10（退役记录）— 凭据引用不再是可选项

用户指出「凭据引用」与「模型路由」是**同一个决定的两次询问**：

> 下拉菜单的逻辑不对，这里难道不是根据 dsh 的模型选择传过来的 API key 吗？

判断成立。路由的 `llm-pi-ai` profile 已经声明了自己的 `apiKeyEnv`；再存一个
`credentialRef` 就是给同一个事实造第二个 owner，还可能和 DSH 实际用的那把不一致。
这与 P9 是同一条原则。

**退役内容**（全部删除）：
- `Config.credentialRef` —— schema 现在只剩 `provider` 一个字段
- 卡片上的「凭据引用」下拉，以及 `referenceIds` / `stage('credentialRef', …)`
- 卡片保存时不再写 `credentialRef`（保存只写 `provider` 一个字段）

**替代**：`credentialRefFor(settings, provider)` —— 从 `llm-pi-ai` 的
`providers[<route>].apiKeyEnv` 读回引用。没选路由、路由不存在、路由没声明
`apiKeyEnv`、settings 服务缺失或抛异常，一律回退到 `TYPESAFE_API_KEY`（`lgtm`
自己会读的那个名字）。

**卡片**：只剩一个控件——模型路由 `<select>`。曾经还有一行只读的 **API**
（显示所选路由的 `apiKeyEnv`），用户后来裁定删掉：那是给路由自己已经说过的话再看一遍，
没有任何可操作的信息。它唯一的真实用途（提醒所选 key 可能不属于 TypeSafe）现在由
`lgtm_status` 说，因为只有那里能顺带知道凭据是否真的解析到了值。

**验证**：`test/smoke.test.js` 107/107（含「credentialRef 不是配置字段」「schema 只有一个字段」
「引用跟随所选路由」以及 5 条回退路径）；`test/client.test.js` 56/56（含「只有一个控件」
「没有 API 行」「保存只写 provider」）。

`pre_design.md` 的 `--skill project` / `--skill claude` 选项随 D6 一并退役：
skill 由插件自带，没有「装到哪里」这个问题。

## 10. TDD Route

- **mode**：`off`（项目默认，用户未要求 strict）
- **decision**：`skipped`
- **authority**：无 strict 授权
- **test posture**：以改动后回归 + 真机验证为主。脚手架已带一个可执行的烟囱入口
  （`LGTM_DSH_TEST_HOOK=1` 导出 `__test`），P1–P3 每步都必须让
  `test/smoke.test.js` 保持全绿，并补上该任务自己的断言。
- **verification**：见 §12。

## 11. 对 `pre_design.md` 的设计修正

以下三条与实测冲突，**以本节为准**。

1. **G6 / §5.4 不成立（架构级）**。`lgtm` 0.3.1 依赖 `@typesafe-ai/sdk`，自己向
   TypeSafe 发 HTTP。进程外调用无法被 `ctx.llm` 转发，因此「调 lgtm CLI」与
   「请求走 `ctx.llm`」互斥。选定方案：包 CLI；插件不新建、不存储、不刷新凭据，
   每次操作解析一次 DSH 引用并注入子进程环境。
   §5.4 引用的 refresh-token 轮换 / single-flight 风险对 TypeSafe 静态 key 不适用。
2. **D4 的 OpenRouter 回退不成立**。`lgtm` 只读 `TYPESAFE_API_KEY`；
   `jevcore-mcp` 的双路由与它无关。已改为单引用探测，不保留 fallback。
3. **D6 的落盘路径应退役**。skill 随包分发并挂载为 skill root 即可：插件对
   `$DSH_HOME/skills/` 的写入默认会被 `FS_SANDBOX_DENIED` 拒绝，而挂载是组合
   而非副作用，且插件升级会自动带上新 skill。

另有两处事实补正：

4. **D1 的 `ctx.shell.which()` 不存在**。`ctx.shell` 只有 `resolve`/`run`/`start`。
   已用纯 Node 的 PATH 扫描（含 Windows `PATHEXT`）替代，避免依赖宿主 shell 是
   bash 还是 pwsh；`ctx.subprocess.resolveExecutable()` 是等价的正规接口，留待
   P1 评估。
5. **§7 skill 的触发描述需补一条**：`lgtm` 的退出码 0 **不等于**审计干净——
   stdin 非 TTY 且未传 `--yes` 时它打印提示后以 0 退出且 stdout 为空。审计路径必须
   把「exit 0 + 空 stdout」判为**未运行**。已写入 `skills/lgtm/SKILL.md + skills/actually-test/SKILL.md`。
6. **想在「设置 → 插件 → 插件配置」出现卡片，必须自带浏览器半边。** 该页渲染的是
   「Host 服务的 settings namespace」与「在 `settings.plugin.item` 下注册了卡片的
   key」的**交集**（`dsh-client-ui-settings-plugins/lib/types/client/tab-store.d.ts`：
   *"A served namespace no card claims renders nothing"*），且全树没有任何
   schema 驱动的表单渲染器。插件的 `Config` schema **只**决定 Host 接受什么值，
   长什么样完全由卡片自己画。已按此实现：`index.js` 注册 namespace，
   `client/client.js` 用同一个 namespace 作为 `key` 注册卡片。
7. **lgtm 不接受模型参数，所以「模型列表供选择」选的是凭据引用，不是模型。**
   卡片列出的是路由及其 `apiKeyEnv`，判定依据是**端点**而非模型 id：pi-ai 路由与
   lgtm 凭据是两件事，只是恰好共用一把 key。插件不读取所选路由的 `baseURL`。

## 12. 任务

### P1 — `lgtm_status` 收口与可测化

- **文件**：`index.js`、`test/smoke.test.js`
- **目的**：把已实现的探测逻辑固定下来，并决定 `which` 的实现。
- **最小改动**：评估 `ctx.subprocess.resolveExecutable()` 是否能在不引入额外
  `inject` 的前提下取代手写 `which`；若不能，保留现状并补注释。
- **兼容影响**：无（纯读探测）。
- **验证**：`node test/smoke.test.js` 全绿；把 `lgtm` 临时装上后 `ready` 由 false 翻 true。

### P2 — 依赖解析（取代原 `lgtm-setup` 命令与全局安装）

- **文件**：`index.js`、`package.json`
- **状态**：**已实现**（2026-09-21，用户两次修正后定稿）。
- **目的**：`lgtm` 随插件一起进入 profile，插件永远不需要安装任何东西。
- **实现**：`@stardeckai/lgtm` 写进本包的 `dependencies`；
  `dsh plugin --profile <p> add lgtm-dsh` 把它和插件一起装进 profile 的
  `node_modules`。运行时用
  `createRequire(import.meta.url).resolve('@stardeckai/lgtm/package.json')`
  解析出与自己配套的那一份，读 `bin.lgtm` 得到绝对路径。
- **不探测 PATH、不探测包管理器、不做任何安装动作**：装载不阻塞、不联网。
  审计时启动 `node '<绝对路径>/dist/cli.js' …`，路径按平台引号规则转义
  （POSIX 关引号重开 / PowerShell 双写单引号）。
- **版本由包管理器管**：设置页的 `version` 是「期望版本」，不一致时只报告
  并给出重装命令，不擅自改 profile 的 lockfile。
- **不跑 `lgtm init`**：`init` 只为交互式索要并落盘 API key；本插件始终用 env 传
  key，而 `lgtm` 读取时 env 优先于 `~/.config/lgtm/config.json`。因此既不需要 init，
  也永远不会写那个文件（这正是原 D2/D3 要的效果，但路径更短）。
- **验证**：`node test/smoke.test.js` 在依赖**存在**（38/38）与**不存在**（34/34）
  两种环境下都通过；另以绝对路径实跑 `node <cli> --list-checks`，退出 0 并列出
  17 项检查。

### P3 — `lgtm_audit` 工具

- **文件**：`index.js`、`test/smoke.test.js`
- **状态**：**已实现**（2026-09-21），实际落地与本节的差异见下。
- **目的**：跑审计并把 JSON 归一化成已冻结的输出 schema。
- **最小改动**：`auditTool().execute` 内实现：
  1. `probeCredential(ctx)`；无 key 直接抛可读错误（不要跑 CLI）。
  2. 组命令：有 `target` 用 `lgtm <target>`，否则 `lgtm --diff`；追加 `--yes --format json`。
  3. `ctx.shell.resolve({ command, workdir, env: { TYPESAFE_API_KEY, NO_COLOR: '1' }, signal: exec.signal })`；
     `stdin` 保持不传。
  4. 退出码：`0` 继续；`2` 一律判为硬失败（无 key / 认证失败 / 参数错 / 无默认分支）；
     其他非 0 报错。
  5. **`exitCode === 0 && stdout.trim() === ''` ⇒ 判为「未运行」并报错**，绝不当作干净。
  6. `JSON.parse(stdout)`；按 §5 契约取字段。
  7. 置信带：`high = probability >= (f.high ?? Math.min(0.95, f.threshold + 0.15))`；
     `probability >= f.threshold` 才保留，`high` 为真记 `high`，否则 `worth-a-look`。
     注意用 `finding.threshold`，不是 `checks[id].threshold`。
  8. `costUsd = inputTokens * 0.042 / 1e6`；`durationMs`、`distribution` 原样透传。
- **实际落地（与本节的差异）**
  1. **参数从 `{target, diff, workdir}` 收敛成 `{target, plan, workdir}`。** `diff: true` 是多余的：
     lgtm 的 `--diff` 与位置参数互斥，而「不传 `target`」本身就已经表达了「只审计改动涉及的测试」。
     两个字段描述同一件事，就是两个 owner。
  2. **新增 `plan`。** 官方 `/lgtm` skill 要求「先免费估算、把估算告诉用户、再真跑」，
     所以工具必须能给那个中间步骤：`plan: true` 传 `--dry-run`（lgtm 自己构建状态、打印
     `estimated cost` / `estimated runtime`、一个模型都不调用），不传 `--yes`、不要 `--format`。
     计划文案原样透传——美元估算由 lgtm 自己算，插件不重复这个换算。
  3. **新增 `checks` 数组。** 报告里的 `checks` 只解释真正触发过的 id，且带 `blurb` + `explanation`。
     不复用它，agent 就得去背 17 项检查的文案。
  4. **凭据用 `resolveCredentialValue`（每次操作解析一次，直接拿值），不是 `probeCredential`。**
     后者刻意只回 `{present, ref, source}`——状态页需要「知不知道有值」，审计需要值本身。
     值只有一个出口：喂给一个子进程的 env，不进结果、不进日志（有断言）。
  5. **不自我提权。** 早先写的 `fullAccessPolicy()` 调 `sandboxPolicy.resolve({mode:'danger-full-access'})`。
     实测该 API 的 `mode` 语义是**已批准的模式覆盖**，也就是插件绕过用户自己的沙箱策略去给自己发权限。
     改成 `sandboxPolicy.resolve({ session })`：用调用方会话自己的策略，被拒就如实报告。
  6. **`stdoutMaxBytes` 必须显式抬高。** `dsh-pwsh-local` 的默认 `maxOutputBytes` 是 64 KB 且
     **溢出保留尾部**——对 JSON 是致命的。按该字段自己的文档（"trusted in-process consumers"）
     抬到 8 MB，并把 `truncated` 作为「报告不完整」的失败路径。
  7. **`node <cli>` 而不是 bin 垫片。** `bin.lgtm` 指向带 shebang 的 `.js`，Windows 不能直接执行；
     `process.execPath` 是确定存在的 node。
  8. **`--diff` 只裸用，且后面每个参数都必须是 flag。** lgtm 的 `normalizeDiffFlag` 会把**下一个**
     参数当作 base ref，除非它看起来像 flag 或是一个存在的文件。
- **验证**：`node test/smoke.test.js` 120/120。其中：命令行用 lgtm 自己的 `parseArgs` 语义断言
  （`--diff` 裸用、`--dry-run` 不带 `--yes`）；置信带与 lgtm 的 `certain`/`highLine` 逐例对照；
  报告归一化（阈值下丢弃、pinned high line、checks 去重、计数透传）；以及**每一种退出形态**
  都落到正确结论——`exit 2` 认证失败（提示改成指向路由，而不是 lgtm 自己的 `lgtm init`）、
  `exit 2` 无默认分支（原文透传）、`exit 0` + 空 stdout（判为未运行）、被超时杀死、JSON 解析失败、
  凭据缺失（**不碰 shell**）。
  **免费路径已用真 CLI 端到端跑通**：`scratch-plugin/fixture` 上 `--dry-run` → 退出 0，
  `will run on 2 tests in 1 file, 15 checks each … ~542 input tokens ≈ $0.0000`。
  **鉴权路径尚未端到端验证**：本机没有可直接读到的 `TYPESAFE_API_KEY`（它在凭据库里，harness
  会洗掉环境变量），所以要等用户以 `--patch` 重启后在会话里真跑一次 `lgtm_audit`。
  本节原先设想的「对含 `vacuous-assertion` 的文件跑出 ≥1 条 `high`」正好由
  `scratch-plugin/fixture/user.test.ts` 承载（两个测试分别刻意命中 `vacuous-assertion`
  与 `reimplements-logic`）。
- **兼容影响**：输出 schema 已冻结并**扩容**（新增 `checks` / `plan`）；`parameters` 去掉了 `diff`，
  属于破坏性变更，因此版本从 0.1.3 抬到 0.2.0。P6 只做适配层，不改字段名。

### P4 — 打包与 skill 发现验证

- **文件**：`package.json`（如需）、`README.md`
- **最小改动**：无功能改动，只验证。
- **验证**：`npm pack --dry-run` 产物含 `index.js`、`cordis.patch.yml`、`skills/lgtm/SKILL.md + skills/actually-test/SKILL.md`；
  `dsh plugin --profile web add <路径>` 后 `profiles/web/package.json` 的
  `dsh.profile.bundles` 含 `lgtm-dsh`；重启 `dsh web` 后会话内能加载 `lgtm` 与 `actually-test`。

### P5 — 三包管理器安装验证

- **验证**：分别在只有 bun、只有 pnpm、只有 npm 的环境各跑一次装载，确认探测命中即止、
  不重复安装、失败时把原因带回 `lgtm_status` 的 notes。

### P6 — schema 版本适配

- **文件**：`index.js`
- **最小改动**：在 `JSON.parse` 之后加一层最小兼容检查：顶层必需键
  （`findings`、`tests`、`files`、`skipped`、`inputTokens`、`durationMs`、
  `distribution`）缺失时，返回带 `notes` 的降级结果而不是抛异常。
- **触发条件**：`lgtm` 发布 schema 变更版本时。
- **验证**：用一份手工构造的旧/新 JSON 各喂一次。

### P7 — 设置卡片（宿主半边 + 浏览器半边）

- **文件**：`index.js`（注册 namespace）、`client/client.js`（新）、`package.json`（`dsh.client` + `exports` + `files`）、`test/client.test.js`（新）
- **目的**：让用户在 Settings → Plugins → Plugin configuration 里选承载 TypeSafe 凭据的路由，并在没有可用路由时被引导去添加自定义模型提供方。
- **状态**：**已实现**（2026-09-21）。**本节是最初稿**：这里的 `credentialRef` 与 `version`
  两个字段后来都被退役（见 P9 / P10），卡片最终只剩一个 `<select>`。
- **最小改动**：宿主侧 `ctx.settings.register('lgtm-dsh', Config)`，`Config` 为
  `{ provider, credentialRef, version }`，三个字段都是标量是刻意的：
  schemastery 无法枚举运行时值，卡片自己画选择器，schema 只负责接受与持久化。
  浏览器侧绑定 `lgtm-dsh` 与 `llm-pi-ai` 两个 settings scope，从后者实时读取路由表；
  版本下拉的选项由浏览器直接向 GitHub Releases API 取（公开仓库带 CORS 头），
  取不到就降级为文本框。
- **不含**：真实 React 渲染、CSS 与 slot host 传参——需要装进 profile 并重启验证。
- **兼容影响**：新增分发面（`dsh.client` + `./client` 导出）。`client` 目录已进 `files`，
  `npm pack --dry-run` 已确认随包分发。
- **验证**：`node test/client.test.js` 43/43；`node test/smoke.test.js` 依赖存在 38/38、缺失 34/34；
  `npm pack` 产物含 `client/client.js`。

#### P7 追加（2026-09-21，第二轮）— 按官方做法重做卡片

用户要求「像其他 dsh 插件一样，按官方的做」。实测三条硬约束，结论是把控件换成官方
primitives，而不是照搬第一方的 `CardForm`：

1. **primitives 里没有 `Select`（也没有 `Checkbox`/`TextInput`/`Field`）。** 下拉就是
   `Menu`，anchor 元素自己画。该包**不在磁盘上**——它是被 shell 冻进平台模块表的静态
   （`dsh-web-frontend/dist/assets/index-*.js` 中的
   `Object.freeze(Object.defineProperty({__proto__:null,…`），所以没有 `.d.ts`，
   组件名只能从第一方 bundle 的实际用法确证；名字写错会整包崩掉。
2. **`CardForm` 无法 import。** `dsh-client-ui-settings-plugins/lib/client.js` 结尾只有
   `exports.apply = apply; exports.inject = inject;`，`CardForm` / `ValueField` /
   `SecretField` / `PluginCard` 都不可用。可用的第三方卡片 `dsh-context` 因此自己实现了
   暂存表单模型。
3. `dsh-context` 的 require 面只有
   `react` / `react/jsx-runtime` / `react-dom` / `dsh-client-ui-primitives`。

所以本插件的 require 面**收敛到与 `dsh-context` 相同的集合**（`react` + primitives），
布局照第一方形状（`<li>` + 折叠头 + 每项一个 `Menu`），配色走 `--dsw-alias-*` token
而不借用别的包的私有 class。同时：

- 删除卡片里过时的「装载时自动安装（bun → pnpm → npm）」文案——那属于已退役的全局安装方案。
- 模型下拉**默认选中靠前的一条可用路由**（先找 `ready`，否则取第一条），不再留空。
- 版本下拉在 GitHub 拉取失败时仍列出已存版本，避免静默改变已钉版本。

**验证**：`node test/client.test.js` 61/61，其中包含「下拉确实来自官方 `Menu`」「默认选中靠前的
可用路由」「首条是 foreign 时改选可用的那条」「已存选择不被默认值覆盖」「拉取失败不改
已存版本」。

#### P7 追加二（2026-09-21，第三轮）— 对齐第一方的表单行为

拿到 `CardForm` 的完整契约与四个第一方卡片的逐行实现后，补齐三处差距：

1. **字段排布**改成第一方 `ValueField` 的形状：标签（可带 `Tag` 徽标）在上、控件在下、
   提示在最下面，字段之间 `.field + .field` 发丝分隔线。原实现是左标签右控件。
2. **暂存表单模型**。第一方卡片是「先暂存，点保存才写」；原实现是选完立刻写。
   现按 `card-form.d.ts` 的可观察行为复刻：草稿覆盖显示值、`dirty` 驱动「未保存」徽标、
   `放弃` 清空草稿不写、`保存` 顺序写出全部暂存字段后清空草稿并**自动收起**，
   失败则保留草稿并提示。`blocked = !dirty || saving`（下拉没有非法草稿，故无 `invalid`）。
3. **控件换成官方 primitives**：`Menu` + `Button`（保存/放弃）+ `Tag`（徽标/判定）+
   `IconChevronDownOutline14`。仍不 require 任何非 seed 模块。

**验证**：`node test/client.test.js` 61/61，含「选完不写」「标记未保存」「放弃不写」
「保存写出全部暂存字段」「保存后自动收起」「只读横幅」「未服务命名空间不渲染」。

#### P7 追加三（2026-09-21，第四轮）— 补回官方那条配置通道

**这是本计划的一个真实缺陷，由用户指出。** 官方开发文档有一页
[插件配置](https://deepseek-harness.github.io/deepseek-harness/develop/basic/config)：
导出 `Config` schema，用户在 `cordis.yml` / patch 行的 `config:` 里传值，Cordis 加载时
校验并填默认值 —— **没有 UI，这就是「直接就有」**。

而本插件 `apply(ctx)` 既没接 `config`，`ctx.settings.register` 也没传 `base`，
所以行里的 `config:` 会被**静默忽略**。

**修正**：`apply(ctx, config = {})` + `register(SETTINGS_NS, Config, { base: config })`。
`base` 的语义是「Composition-layer values resolved below the user layer (entry-config
subset)」，`dsh-llm-pi-ai` 用的正是这套（`apply(ctx, config)` + composition entry 作 base 层）。

**同时确认**（借 `@liustack/modlens@3.26.2` 的实现交叉验证）：设置页卡片**没有可复用的
表单渲染器** —— 全树搜 `SchemaForm`/`AutoForm`/`renderField`/`schemaToForm`/`widgetFor`/
`fieldWidget` 全部 0 命中，全 DSH 只有 4 张第一方手写卡，而 modlens 这样成熟的第三方
插件同样自己画，并且因为 issue #61/#65 还得注册一个空的 pass-through schema 才能让卡片
被派发。本插件的 namespace 与 schema 都是真的（配置确实存在 DSH 设置段里），不需要那层
shim；下拉用官方 `Menu`（modlens 用原生 `<select>`，第一方 `dsh-context` 用 `Menu`）。

**验证**：`node test/smoke.test.js` 42/42，新增「apply 接受组合配置」「组合配置作为 settings
base 传入」「行里给的引用真的到达 status 探测」；`node test/client.test.js` 63/63，新增卡片
`id`/`order` 断言。



| 层 | 手段 | 通过标准 |
|---|---|---|
| 单元（宿主） | `node test/smoke.test.js` | 全绿：依赖存在 38/38、依赖缺失 34/34 |
| 单元（浏览器） | `node test/client.test.js` | 全绿（29/29） |
| 环境诊断 | `node scripts/check-providers.mjs` | 打印路由表与 lgtm 可用性；只读、不花钱 |
| 语法 | `node --check index.js`、`node --check client/client.js` | 退出 0 |
| 启动 | `node '<解析出的 cli 绝对路径>' --list-checks` | 退出 0，列出 17 项检查（已实测） |
| 打包 | `npm pack --dry-run` | `index.js`、`cordis.patch.yml`、`skills/…`、`client/client.js` 都在产物里 |
| 装载 | `dsh <profile> --dump-config` | 组合树含 `lgtm-dsh` 行，无错误（已实测） |
| 激活 | `dsh --profile web --patch .verify/plugin.yml` 真启动 | 启动不因 `did not activate` 失败（已实测；反向对照见下） |
| 打包安装 | `npm pack` → `dsh plugin --profile compat add ./lgtm-dsh-0.1.0.tgz` | 退出 0，`bundles` 追加 `lgtm-dsh`，依赖落进 profile（已实测） |
| 端到端 | `lgtm_status` → `lgtm_audit` | 见 §1 验收证据 |

### 已实跑的验证记录（2026-09-21）

按官方流程完整走通：

1. `dsh --profile web --patch .verify/plugin.yml --dump-config` → 560 行（基线 557），
   含 `- id: lgtm-dsh` / `name: file:///D:/workspace/dsh/lgtm-dsh/index.js`，无错误。
2. `dsh --profile web --patch .verify/plugin.yml --no-open --port 0` → 正常启动并挂载路由。
3. **反向对照**：`.verify/broken-plugin.mjs`（注入不存在的服务）+ `.verify/broken.yml`
   → 启动**硬失败**：
   `Error: dsh: plugin tree failed to load: dsh: 1 entry did not activate`。
   因此第 2 步的安静启动等价于「导入成功 + 5 个注入服务全部解析 + `apply()` 未抛异常」。
4. `npm pack` → `lgtm-dsh-0.1.0.tgz`（6 个文件，18.6 kB）。
5. `dsh plugin --profile compat add ./lgtm-dsh-0.1.0.tgz` → 自动创建 compat profile，
   `bundles: ["@deepseek-ai/dsh-base", "lgtm-dsh"]`，`@stardeckai/lgtm@0.3.1` 随依赖落进
   profile 的 `node_modules`。
6. `dsh --profile compat --dump-config` → 335 行，含 `# == lgtm-dsh` 层，无错误。
7. **从已安装的插件里解析依赖**：`resolveLgtm()` →
   `C:\Users\Aurola\.dsh\profiles\compat\node_modules\@stardeckai\lgtm\dist\cli.js`（0.3.1），
   实跑该文件 `--list-checks` → 退出 0，17 项检查。

第 7 步是这套依赖机制的关键证据：插件解析到的是**自己那份** profile 内的依赖，
不是全局安装的那份。

**当前环境实测**（2026-09-21）：`lgtm` 已装在 `D:\SDE\nodejs\node_global\lgtm.CMD`，
`lgtm --list-checks` 退出 0 并列出全部 17 项检查；`TYPESAFE_API_KEY` 已能通过
TypeSafe 鉴权。因此 `lgtm_status` 报 `ready: true`，**P2/P3 的端到端验证前置条件已满足**。

### 第二轮验证（2026-09-21，0.2.0：`lgtm_audit` 实装）

事实来源换成了**装在本机的那份 lgtm 自己的源码**（`node_modules/@stardeckai/lgtm/dist/cli.js`、
`analyze.js`、`report.js`、`init.js`、`checks/index.js`），而不是仓库文档：

1. `init.js` 的 `resolveApiKey()` 只读两处：`process.env.TYPESAFE_API_KEY`，然后
   `~/.config/lgtm/config.json`。**没有第三个来源**，所以无论凭据引用叫什么名字，
   交给子进程的变量名必须是 `TYPESAFE_API_KEY`。
2. `cli.js` 的 `printPlan()` 在 `--format json` 下**走 stderr**，stdout 是纯 JSON；
   `--dry-run` 下走 stdout。两者都被插件用上：`plan: true` 读 stdout 的估算，
   真跑只 `JSON.parse` stdout。
3. `analyze.js` 的 `normalizeDiffFlag()` 把 `--diff` 后面**第一个不像 flag、且存在的路径**
   当 base ref。因此 `--diff` 必须裸用且独占，后面每个参数都得是 flag。
4. `report.js` 的 `certain` / `highLine` / `CERTAIN_MARGIN=0.15` 与插件里的 `confidenceOf`
   逐例对照一致（smoke 里 6 条断言，含 0.95 上限与 pinned high line）。
5. `checks/index.js` 的 `USD_PER_INPUT_TOKEN` 被 smoke **重新读一遍**并和插件里的常量比对——
   价格是 lgtm 的事实，插件只是复用它给 JSON 报告定价，所以这条断言让两者不可能悄悄漂移。
6. **免费路径端到端实跑**：`scratch-plugin/fixture` 上
   `node <cli> . --dry-run` → 退出 0，输出
   `will run on 2 tests in 1 file, 15 checks each … ~542 input tokens ≈ $0.0000`。
   同一目录下不带 `--dry-run` 的路径未跑（会花钱，且需要凭据库里的 key）。
7. **发现两个真实缺口，都关于「调用目标」**：
   1. **文件名**：`TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/`——`.mjs` / `.cjs`
      **不在其中**。两个测试文件因此从 `smoke.mjs` / `client.mjs` 改名为
      `smoke.test.js` / `client.test.js`（`"type": "module"` 让 `.js` 仍是 ESM，内容未改）。
   2. **块**：`extractTests()` 只把 **callee root 为 `it` / `test`、第一个参数是字符串字面量**的
      调用当作测试块；`describe()` 只进名字路径。两个套件当时都是扁平断言脚本（一处 `it(` / `test(`
      都没有），所以**改名之后仍然 0 块**：`lgtm test --dry-run` →
      `no test blocks found in 2 file(s)`（stderr）、退出 0、stdout 为空——正是那个
      「未运行 ≠ 干净」的形态，只是这次连「找不到文件」都不是。
   3. **字面量必须在调用点**（后面第 10 条踩到的第二个坑）。两条都已写入
      `docs/reference/lgtm-0.3.1-contract.md` §7 与 README。
8. `node test/smoke.test.js` **120/120**；`node test/client.test.js` **56/56**。
9. **当时真正可审的目标**只有一个：`scratch-plugin/fixture/user.test.ts`（2 个 `it()` 块，含刻意写成
   空洞断言的样例）。`lgtm . --dry-run` 报的就是它，`~555 input tokens ≈ $0.0000`。
10. **自举完成（§15 第 7 条的落地）**：两个套件改成顶层 `test("字面量", …)` 块——smoke 13 个、
    client 10 个。中间踩了一个坑：先用共用包装 `section('名字', body)` 生成块，
    lgtm 仍然只看到 `2 tests in 1 file`，因为 root 是 `section` 而不是 `test`，
    而包装函数内部那句 `test(name, …)` 第一个参数是标识符、`nameOf` 判 `null`。
    把字面量内联到每个调用点后 → **`25 tests in 3 files`**，`~175160 input tokens ≈ $0.0074`。
    同时把 `assert()` / `report()` 从「只记账」改成**失败即抛**，否则块里全是失败断言也照样过。
    反向对照：各翻一条断言 → 两个文件都退出 1（`pass 12 / fail 1`、`pass 9 / fail 1`）。
11. **活宿主抓到一个单元测试抓不到的 bug**：工具第一次在活宿主里真跑起来时，命令串被判
    `ParserError`——`'…node.exe' '…cli.js'` 在 PowerShell 里，开头的引号路径被解析成**表达式**，
    后面那个引号参数就成了语法错误。修法是加调用运算符 `&`，且**只能加在 Windows**
    （`&` 在 POSIX 里是后台运行）。改前改后命令字符串都自洽，所有字符串断言照样绿——只有真跑
    一遍才知道。这正是「只比字符串的测试证明不了什么」的实例，也是这次自举想要的那种反馈。
12. **本节的自举已完成，但活宿主里那份模块是旧的**：HMR 曾重载过一次（新代码确实跑起来了，
    否则第 11 条根本不会出现），但没有跟上后续修改，`ParserError` 依旧。因此**还没在会话里
    花掉那 $0.0074**。重启后再跑一次 `lgtm_audit`（`target: "."`）即可。
### 第三轮：自举后的首次真审计（2026-09-21，用户「开始测试」）

活宿主里真跑（不是 dry-run），全部输出都是真的：

| 步骤 | 结果 |
|---|---|
| `lgtm_status` | `ready: yes`；CLI 0.3.1；`TYPESAFE_API_KEY` 从 `file` 源解析到 |
| `lgtm_audit plan`（冷） | `25 tests in 3 files`，`~177512 input tokens ≈ $0.0075` |
| `lgtm_audit plan`（热） | `18 already cached, 7 to send`，`~32505 tokens ≈ $0.0014` |
| `lgtm_audit .` | 1 finding（`worth-a-look`），**7 个块被跳过** |
| `lgtm_audit test/smoke.test.js` | **13 个块里 12 个被跳过**，只剩 1 个被判定 |
| `lgtm_audit scratch-plugin/fixture` | **4 条 high**，全在那个刻意写坏的块上 |
| `lgtm usage` | `no runs recorded yet`（原因见下） |

#### 三个真发现

1. **「假干净」标题（已修）。** 12/13 被跳过的那个 run，渲染出来的标题是
   `lgtm: fine? 13 test block(s) … nothing to report`——把「只判定了 1 个」说成了干净。
   正是这个插件存在的意义所要防的东西，出现在它自己的输出里。改法：标题按**判定过的块数**
   （`tests - skipped`）说话，且 `skipped > 0` 时绝不出 `nothing to report`。
   修后的字符串由测试直接打出来：
   `lgtm: nothing found in the 1 of 13 test block(s) that were judged, but 12 were skipped and never judged — this is not a clean verdict`。
2. **被跳过的原因看不见（已修，未加载）。** `skipped` 只有数量没有原因，而原因只在 stderr：
   `console.warn("[lgtm] skipped <file>:<line>: <msg>")`。插件原来整段丢掉 stderr。现在会在 note 里
   带上最多 3 条原样原因。**这条修复还没在活宿主里生效**，所以那 12 个块到底为什么被跳，
   目前仍是未知——这是本轮唯一没查清的实质问题。
3. **`lgtm usage` 为什么是空的（已查清）。** 用量日志写在 `~/.config/lgtm/usage.jsonl`，
   在**工作区之外**；插件的子进程跑在调用方会话自己的 `workspace-write` 策略下，
   于是那次写被沙箱拒了，而 `recordRun()` 是 `try { … } catch {}` 的最佳努力写入
   （源码注释：a read-only home must never fail a run）。直接验证：从当前沙箱往
   `~/.config/` 建目录 → `Access to the path … is denied.`
   **也就是说日志丢失恰恰证明插件没有给自己提权**——它按会话策略跑，代价是跨不过工作区边界的
   记账丢了。答案缓存写在 `node_modules/.cache/lgtm`（工作区内），所以缓存是好的（18 份）。

#### 对比信息

- **自举前后**：`lgtm . --dry-run` 从 `2 tests in 1 file`（只有 fixture）→ `25 tests in 3 files`。
- **冷/热**：$0.0075 → $0.0014（18 个块命中缓存）。
- **套件自己的绿 vs lgtm 的判断**：`npm test` 183 条断言全绿；lgtm 仍然在
  `test/smoke.test.js:112` 报 `assertion-weaker-than-name` 0.77——**而且它是对的**：那个块
  叫「both tool schemas compile under the DSH schema DSL」，断言却只查 `status.name`。
  已按其建议改成真断言（`assertObjectJsonSchema` + 一条负向对照：
  `defineTool` 对缺 `additionalProperties` 的对象节点抛 `UNSUPPORTED_SCHEMA`）。
  修完后重新审计该文件**没能证明它消失了**——13 个块里 12 个被跳过，判定不成立。这一点必须如实说。
- **被跳过块的大小分布**（`--dry-run --json` 实测）：13 个块都在 8.8k–10.6k tokens 之间，
  所以**不是「太大的块被拒」那种简单解释**；第一次冷跑 25 个只跳 7 个，第三次 13 个跳 12 个，
  失败率在升高，更像服务端限流/瞬时错误，但在拿到 stderr 之前只是猜测。

## 14. Risks

| 风险 | 影响 | 处置 |
|---|---|---|
| ~~`TYPESAFE_API_KEY` 尚未在本机注册~~ | — | **已消解**：`.credentials.yaml` 的 refs 里有 `TYPESAFE_API_KEY`（和 `OPENROUTER_JEV_API_KEY`），`settings.yaml` 的 `lgtm-dsh.provider` 就是 `typesafe`。只差活宿主里真跑一次 |
| 选中的路由持有一把**别的服务**的 key（`openrouter-jev` → `OPENROUTER_JEV_API_KEY`） | lgtm 把 OpenRouter 的 key 发给 TypeSafe，被拒 → `exit 2` | `lgtm_status` 在「引用 ≠ `TYPESAFE_API_KEY`」时直接给 note；`lgtm_audit` 把认证失败翻译成「该路由必须存 TypeSafe 的 key」而不是转发 lgtm 的 `lgtm init` 建议 |
| `.mjs` / `.cjs` 测试文件对 lgtm 不可见 | `lgtm .` 报「0 个测试块」，退出 0、stdout 为空 | **已修**：两个测试文件改名为 `*.test.js`（`"type": "module"` 保持 ESM）；契约文档 §7 已记录 |
| 套件里没有 `it()`/`test()` 块，lgtm 认得出文件也提不出块 | 改名后仍报「0 个测试块」 | **已修**：两个套件改成顶层 `test("字面量", …)` 块（23 个），`lgtm . --dry-run` → `25 tests in 3 files`；工具仍把「0 块」判为**未运行** |
| `defineTool` 的 DSL 要求每个 object 节点显式写 `additionalProperties` | 漏写会在加载时抛错 | 已由 smoke 覆盖所有 schema |
| 子进程环境清洗 | key 若不走 `env` 通道就永远拿不到 | 已实测确认并写入注释与 README |
| `lgtm` 的 schema 变更 | 解析失败 | P6 兼容层 |
| `ctx.shell` 在 Windows 用 pwsh 执行 | 命令串必须对 pwsh 合法 | 只用简单命令 + 参数，不用 POSIX 专有语法 |

## 15. 待确认

1. ~~**`lgtm-setup` 该是命令还是工具？**~~ **已消解**（用户 2026-09-21）：
   改成直接安装模式，setup 步骤与命令一并删除。agent 不再需要任何安装入口。
2. `ctx.subprocess.resolveExecutable()` 是否优于手写 `which`（P1 决定）。
3. ~~是否要把 `costUsd` 展示给用户~~ **已定**：`plan` 的美元估算**原样透传 lgtm 的输出**
   （由 lgtm 自己算，插件不重复这个换算）；真跑的结果里 `costUsd` 由 `inputTokens`
   乘上 lgtm 随包发布的单价得出，而 smoke 会重读 lgtm 的常量比对，所以不存在第二份价格。
4. **`typesafe` 路由对 DSH 自身不可用，是否移除？** 详见 §11 修正 6/7 与 README 的实测表：
   TypeSafe 只提供 `POST /v1/systemone`，pi-ai 无对应协议，改 `baseURL` 修不好。
   但这条路由是 `TYPESAFE_API_KEY` 的**存放处**，删掉会让本插件失去凭据引用。
   建议保留，仅在 README 标注其用途是「存 key」而非「当模型用」。
5. ~~**`openrouter-jev` 的 `baseURL` 是否改成 `https://openrouter.ai/api/v1`？**~~
   **已修**：`settings.yaml` 里现在是 `https://openrouter.ai/api/v1`。
   同时更正 README 里那条错误结论：`typesafe/jev-1.13` 与 `typesafe/jev-latest`
   **在** OpenRouter 上有模型页（[jev-1.13](https://openrouter.ai/typesafe/jev-1.13)、
   [jev-latest](https://openrouter.ai/~typesafe/jev-latest)）；早先依据
   `GET /api/v1/models` 的 446 条结果判定「不在公开目录」，是**用一个端点当目录全集**的错误。
6. 卡片目前用原生 `<select>`/`<input>`，视觉上与 DSH 原生控件不一致。
   改用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`（`dsh-context` 的
   `PrefRow` 即此用法）需要活宿主验证组件 API，留作后续。
7. ~~**要不要把两个测试套件改写成 `node:test` 的 `it()` 块？**~~ **已做**（2026-09-21，用户裁定「测试这个插件（自举）」）： 这是「测试时调用 lgtm」在本仓库
   能不能自举的唯一开关——现在它们过不了块门槛（§13 第 7 条），lgtm 提不出块。
   - **代价**：`test/smoke.test.js` 120 条断言与 `test/client.test.js` 56 条断言都要从
     「模块顶层的扁平脚本 + 自造 `report()`/`assert()` 报告器」改成块回调；两个文件里
     跨段落共用的声明（`specs`/`runCtx`/`jsonReport`/`fakeCtx`/`applied` …）要提到模块作用域。
     约 850 行结构性改动，断言本身不用改。
   - **收益**：lgtm 能看到约 30 个有名字的块（一个段落一个块），并可以真的审它们；
     顺带换成标准 runner（`node --test`），去掉自造报告器。
   - **建议**：做，但作为**独立一步**做，不和别的改动混在一起——它只动测试结构，不动产品代码。
   - **不做的后果**：本仓库永远无法用 lgtm 审自己的测试，只能审
     `scratch-plugin/fixture` 那种带 `it()` 的样例，也就是这个插件没法自举。
