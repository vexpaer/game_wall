# Game Wall

Game Wall v2 是一个多平台个人游戏仪表盘：GitHub Actions 定期读取 Steam、Xbox、Epic 和 Nintendo Switch 数据，生成统一快照，再由 Astro 构建成纯静态 GitHub Pages。首页同时提供：

- **合并展示**：同一游戏跨平台合并为一张卡片，并保留各平台记录。
- **分平台展示**：按 Steam、Xbox、Epic、Switch 分别查看原始平台记录。

没有数据库、常驻后端、网页端登录或在线编辑。由于 GitHub Pages 只能托管静态文件，Epic 与 Switch 的首次绑定必须在自己的电脑上完成；之后 GitHub Actions 才能使用加密状态定期同步。

> [!IMPORTANT]
> 此前在对话中发送的 OpenXBL Key 已经暴露，必须立即在 [OpenXBL 控制台](https://xbl.io/)吊销并重新生成。本文不会复述该 Key，代码也不会使用或保存它。**新 Key 只应保存为仓库的 Actions Secret `OPENXBL_API_KEY`**；不要再发到聊天、Issue、源码、`.env`、Repository Variable 或 Actions 日志中。

## 架构与数据公开范围

同步和部署流程如下：

```text
Steam / OpenXBL / Legendary / Switch 导入或 nxapi
                         ↓
             GitHub Actions 定时同步
                         ↓
      data/generated/site-snapshot.json（临时）
                         ↓
               Astro 静态构建
                         ↓
                  GitHub Pages
```

- 浏览器只读取构建产物，不会接触平台凭据，也不会在用户访问页面时请求游戏平台。
- `data/generated/site-snapshot.json`、`dist/` 和原始凭据不提交到 Git；它们只存在于当前构建工作区。
- Epic 与实验性 Switch 自动同步分别使用 `EPIC_STATE_KEY` 和 `SWITCH_STATE_KEY` 做 AES-256-GCM 加密；两把密钥必须独立生成，绝不能共用。仓库只提交 `data/credentials/*.enc`，解密密钥只存于各自的 GitHub Secret。
- Actions Cache 只保存公开的 Steam Store 元数据；Pages artifact 不含凭据。唯一例外是密文推送连续三次失败时生成的 7 天恢复 artifact，它严格只包含 `data/credentials/*.enc`，仍须按敏感密文保护。
- Pages 是公开静态站点。昵称、头像、游戏名称、时长、最后游玩时间、成就汇总，以及手工导入的 Switch 内容都会公开；不希望公开时请不要启用 Pages。

合并展示使用规范化标题生成 `canonicalId`。不同版本若被自动识别为同一游戏，会聚合已知时长；这不是跨平台存档识别，若两个平台记录了同一段游玩时间，合计可能重复。可用 [`data/game-aliases.json`](data/game-aliases.json)手工修正，详见“跨平台别名”一节。

## 数据能力矩阵

| 来源 | 接入方式 | 可展示游戏 | 游玩时长 | 成就 | 主要限制 |
| --- | --- | --- | --- | --- | --- |
| Steam | 官方 Steam Web API；Store 补充资料为 best-effort | 时长大于 0 的已游玩游戏 | 总时长、近期时长及可用的平台分项 | 汇总可用 | “游戏详情”必须公开；Store `appdetails` 不是受支持的正式 API |
| Xbox | **非官方** [OpenXBL](https://xbl.io/) | Xbox 标题历史 | 当前适配器没有可靠时长，明确显示“未知”而不是 0 | OpenXBL 返回的汇总 | Key 与 OpenXBL 账号绑定；接口、限额或字段可能变化 |
| Epic | **非官方** [Legendary](https://github.com/legendary-gl/legendary) | Epic 账号拥有的基础游戏，过滤 DLC | 无权威时长 | 当前不支持 | Epic 没有面向个人完整游戏库的公开官方 API；登录状态可能过期 |
| Switch 手工导入 | 本地 JSON / CSV | 由你提供的数字版、实体卡或其他记录 | 可选 | 不支持 | 不会自动发现新增游戏，需要更新导入文件 |
| Switch 自动实验 | **非官方、逆向** [nxapi `pctl`](https://github.com/samuelthomas2774/nxapi/blob/main/docs/cli.md#nintendo-switch-parental-controls) | 家长控制日报中出现过的游戏 | 主机级日报累计，汇总 `devicePlayers` 与 `anonymousPlayer` | 不支持 | 必须先绑定家长控制；不是购买库，不能补齐未记录的实体卡或历史，随时可能失效 |

“未知”与真实的 `0` 会严格区分。Epic、Switch 和当前 Xbox 适配器不会为了填满界面而伪造时长或成就。

## 你需要提供什么

请只把 Secret 输入 GitHub 的 Secret 表单或本地认证工具，不要发到聊天中。

### Steam（沿用现有配置）

- Steam Web API Key，保存为 Secret `STEAM_API_KEY`。
- SteamID64 或个人资料 vanity 名称，保存为 Variable `STEAM_USER`。
- “我的个人资料”和“游戏详情”公开，并取消隐藏总游戏时长。
- 可选语言 `STEAM_LANGUAGE`，默认 `schinese`。

### Xbox

- 吊销已暴露 Key 后生成的**新 OpenXBL API Key**，只保存为 Secret `OPENXBL_API_KEY`。

不需要再提供 Gamertag 或 XUID；OpenXBL 的 `/account` 返回与该 Key 关联的账号。OpenXBL 不是 Microsoft/Xbox 官方 API，本项目也不会把它返回的缺失时长当作 0。

### Epic

- 在自己的电脑上用 Legendary 完成一次交互式 `auth`；不要提供 Epic 密码、授权码或 token 给本项目维护者。
- Legendary 生成的 `user.json`，使用本项目 CLI 加密后提交为 `data/credentials/epic-user.enc`。
- 一把只用于 Epic 的 32 字节状态密钥，本地文件为 `.epic-state-key`，保存为 Secret `EPIC_STATE_KEY`。
- Variable `EPIC_SYNC_ENABLED=true`；显示名 `EPIC_DISPLAY_NAME` 可选。

Epic 没有可供此用途使用的官方完整个人库 API；这里明确使用第三方 Legendary。`user.json` 内含可轮换的登录状态，Actions 每次运行后会重新加密并提交更新，但 token 仍可能被 Epic 撤销或自然过期，届时需要重新本地绑定。

### Nintendo Switch

已经确认你的设备是**第一代 Nintendo Switch Lite**、日服账号，因此默认使用：

- `SWITCH_LOCALE=ja-JP`
- `SWITCH_DEVICE=Nintendo Switch Lite`
- 游戏系统默认 `switch`，不是 `switch-2`

然后二选一：

1. **手工 JSON / CSV**：提供游戏标题；可选提供 16 位十六进制 Application ID、分钟数、首次/最后游玩日期、封面 HTTPS URL 和所有权类型。这是补齐数字版与实体卡收藏最可控的方式。
2. **实验性 nxapi `pctl`**：先用任天堂官方“みまもり Switch”应用把这台 Lite 与家长控制账号配对，再在本地执行 `nxapi pctl auth`；提供 `SWITCH_DEVICE_ID`，并加密提交 nxapi data 目录。它读取的是家长控制主机日报，不是完整购买库。

Switch nxapi 还需要一把只用于该平台的 32 字节状态密钥，本地文件为 `.switch-state-key`，保存为 Secret `SWITCH_STATE_KEY`；它绝不能与 Epic 密钥相同。该路径读取的是**主机级日报**：当前解析器会把响应中的全部 `devicePlayers` 和可选 `anonymousPlayer` 按游戏汇总。单用户 Switch Lite 通常等同于个人数据；同一 Lite 有多个用户或匿名游玩时，页面时长会把它们合并，不能当作某个 Nintendo Account 的个人精确时长。它不能可靠同步完整数字购买库、从未出现在日报中的游戏、未被记录的实体卡收藏或绑定前的全部历史，也不是 Nintendo 官方集成。

## 环境要求与快速预览

- Node.js 22.12 或更高版本
- npm
- 配置 GitHub 时建议安装 [GitHub CLI](https://cli.github.com/)并执行 `gh auth login`
- Epic 本地绑定需要 Python 3.10+；工作流使用 Python 3.12
- Switch 自动绑定需要 `tar` 和 Node.js 全局 CLI 安装权限

安装依赖并使用固定脱敏数据预览：

```powershell
npm ci
npm run dev:fixture
```

默认基础路径为 `/game_wall/`。本地按根路径预览：

```powershell
$env:BASE_PATH = "/"
npm run dev:fixture
```

## 配置 GitHub Pages 与 Actions

1. 将仓库默认分支设为 `main`。
2. 在 **Settings → Pages → Build and deployment** 中把 **Source** 设为 **GitHub Actions**。
3. 在 **Settings → Secrets and variables → Actions** 中按下表添加所需项。
4. 在 **Actions** 页手动运行 **Sync and deploy Game Wall** 做首次验证。

### Repository Secrets

| 名称 | 何时需要 | 内容 |
| --- | --- | --- |
| `STEAM_API_KEY` | 启用 Steam | Steam Web API Key |
| `OPENXBL_API_KEY` | 启用 Xbox | **吊销旧 Key 后创建的新 OpenXBL Key** |
| `EPIC_STATE_KEY` | 启用 Epic | 由 `.epic-state-key` 通过 stdin 写入；只解密 `epic-user.enc` |
| `SWITCH_STATE_KEY` | 启用 Switch nxapi | 由 `.switch-state-key` 通过 stdin 写入；只解密 `nxapi-state.enc` |

### Repository Variables

| 名称 | 何时需要 | 示例 / 说明 |
| --- | --- | --- |
| `STEAM_USER` | Steam | SteamID64 或 vanity 名称 |
| `STEAM_LANGUAGE` | Steam，可选 | `schinese` |
| `EPIC_SYNC_ENABLED` | Epic | 必须为 `true` 才安装并运行 Legendary |
| `EPIC_DISPLAY_NAME` | Epic，可选 | 页面显示名；默认 `Epic Games` |
| `SWITCH_SYNC_MODE` | Switch | `manual` 或 `nxapi` |
| `SWITCH_IMPORT_FILE` | Switch 手工 | 如 `data/imports/switch.json` |
| `SWITCH_IMPORT_FORMAT` | Switch 手工 | `json` 或 `csv` |
| `SWITCH_LOCALE` | Switch | 当前账号使用 `ja-JP` |
| `SWITCH_DEVICE` | Switch，可选 | 当前设备使用 `Nintendo Switch Lite` |
| `SWITCH_DISPLAY_NAME` | Switch，可选 | 页面显示名；默认 `Nintendo Switch` |
| `SWITCH_ACCOUNT_ID` | Switch，可选 | 仅作公开展示标识；不应填写登录凭据 |
| `SWITCH_DEVICE_ID` | Switch nxapi | `nxapi pctl devices --json` 返回的主机 ID，不是 Nintendo Account ID |

Secret 可用不回显的交互命令设置；命令运行后再在提示中粘贴值：

```powershell
gh secret set STEAM_API_KEY
gh secret set OPENXBL_API_KEY
```

普通账号配置示例：

```powershell
gh variable set STEAM_USER --body "你的 SteamID64 或 vanity 名称"
gh variable set STEAM_LANGUAGE --body "schinese"
gh variable set SWITCH_LOCALE --body "ja-JP"
gh variable set SWITCH_DEVICE --body "Nintendo Switch Lite"
```

不要把 Secret 改成 Repository Variable。Variables 会以普通配置处理，不具备 Secret 的隐藏语义。

## Steam 绑定

申请 [Steam Web API Key](https://steamcommunity.com/dev/apikey)后执行：

```powershell
gh secret set STEAM_API_KEY
gh variable set STEAM_USER --body "你的 SteamID64 或 vanity 名称"
gh variable set STEAM_LANGUAGE --body "schinese"
```

随后在 Steam 的“编辑个人资料 → 隐私设置”中：

1. 将“我的个人资料”和“游戏详情”设为公开。
2. 取消“即使用户可以查看我的游戏详情，也始终保持我的总游戏时间为私密”。

有效账号因隐私设置返回空库时会展示“未公开”，不会继续公开旧快照；单款游戏成就请求失败会显示“暂不可用”，不会伪装成 0%。

## Xbox 绑定

先在 OpenXBL 控制台吊销此前暴露的 Key，再创建新 Key。只执行下面的交互命令保存新值：

```powershell
gh secret set OPENXBL_API_KEY
```

不设置其他 Xbox Variable。工作流使用 `X-Authorization` 请求头调用 OpenXBL 的账号和标题历史接口；Key 不进入 URL、快照或日志。可先阅读 [OpenXBL 入门说明](https://xbl.io/blog/getting-started-xbox-live-api)，并留意当前账号套餐的请求限额。

## 平台独立加密密钥

Epic 与 Switch nxapi 必须使用两把不同的密钥：

- `.epic-state-key` → Repository Secret `EPIC_STATE_KEY` → `epic-user.enc`
- `.switch-state-key` → Repository Secret `SWITCH_STATE_KEY` → `nxapi-state.enc`

绝不能复制或复用其中一把来配置另一个平台。这样即使一个平台的密钥或上游状态失效，也不会同时暴露另一个平台。`.epic-state-key` 与 `.switch-state-key` 已被 `.gitignore` 排除；请分别保存到密码管理器或其他离线安全位置，不能提交、打印或发送。GitHub Secret 无法读取回来，因此后续重绑要保留与现有 Secret 对应的本地或离线副本。

CLI 的实际语法为：

```text
npm run state -- keygen <密钥输出文件>
npm run state -- encrypt <原始文件> <加密文件>
npm run state -- decrypt <加密文件> <原始文件>
```

`keygen` 不会覆盖已有密钥文件。为保持 CLI 通用，`encrypt` / `decrypt` 仍只从当前进程变量 `GAME_WALL_STATE_KEY` 读取密钥；本地操作时一次只把当前平台的文件内容临时载入该变量，完成后立即清理。Actions 则只在 Epic 步骤把 `EPIC_STATE_KEY` 映射到它，只在 Switch 步骤把 `SWITCH_STATE_KEY` 映射到它。

下面的平台步骤都通过 `cmd /d /c "gh secret set ... < 密钥文件"` 把文件原始字节送入 stdin。不要使用 PowerShell 的 `Get-Content ... | gh secret set ...`：PowerShell 会向原生程序管道追加换行，使严格 Base64 密钥失效。也不要改成 `--body`，否则密钥可能出现在本机进程命令行中。

## Epic 一次性本地绑定

下列 PowerShell 命令与 Actions 使用的 Legendary `0.20.34` 一致。认证过程由 Legendary 与 Epic 完成，本项目不接收密码或授权码。

```powershell
# 仅首次绑定生成；已有 .epic-state-key 时跳过 keygen 并继续使用原文件
npm run state -- keygen .epic-state-key
cmd /d /c "gh secret set EPIC_STATE_KEY < .epic-state-key"

py -3 -m pip install "legendary-gl==0.20.34"

$epicPath = Join-Path (Resolve-Path -LiteralPath "data\credentials").Path "epic-local"
New-Item -ItemType Directory -Force -Path $epicPath | Out-Null
$env:LEGENDARY_CONFIG_PATH = $epicPath

try {
  legendary auth
  if ($LASTEXITCODE -ne 0) { throw "Legendary 登录失败" }
  legendary list --third-party --json --force-refresh | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Legendary 游戏库验证失败" }

  if (-not (Test-Path -LiteralPath "$epicPath\user.json")) {
    throw "Legendary 未生成 user.json"
  }

  $env:GAME_WALL_STATE_KEY = (Get-Content -LiteralPath ".epic-state-key" -Raw).Trim()
  npm run state -- encrypt "$epicPath\user.json" "data\credentials\epic-user.enc"
  if ($LASTEXITCODE -ne 0) { throw "Epic 凭据加密失败" }
}
finally {
  Remove-Item -LiteralPath "Env:\GAME_WALL_STATE_KEY" -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "Env:\LEGENDARY_CONFIG_PATH" -ErrorAction SilentlyContinue
}

gh variable set EPIC_SYNC_ENABLED --body "true"
# 可选；不设置时显示为 Epic Games
gh variable set EPIC_DISPLAY_NAME --body "你的 Epic 页面显示名"
```

只提交加密文件：

```powershell
git add data/credentials/epic-user.enc
git commit -m "chore: add encrypted Epic binding"
git push
```

`.epic-state-key` 只对应 GitHub Secret `EPIC_STATE_KEY`，绝不能拿 `.switch-state-key` 替代。`data/credentials/epic-local/user.json` 含敏感 token，绝对不要使用 `git add -f`。提交前可运行 `git status --short --ignored data/credentials` 复核：只应暂存目标 `.enc`，任何原始状态都不能进入 Git。确认 `.enc` 已生成并能在 Actions 解密后，可删除原始本地目录。Legendary 在列库时可能轮换 refresh token，所以工作流会在每次运行后重新加密最新 `user.json` 并提交；一旦登录被撤销或过期，按故障排查中的 Epic 重绑步骤处理。

Epic Games Store 没有针对个人完整购买库的公开官方 API；相关限制也可参见 [Epic Developer Community 的讨论](https://forums.unrealengine.com/t/how-to-retrieve-game-library-details-and-purchase-dates-via-epic-games-api/2245578)。本功能是非官方适配，不代表 Epic 的认可或支持。

## Switch 路径 A：手工 JSON / CSV

### JSON

复制公开、脱敏的示例并编辑：

```powershell
Copy-Item -LiteralPath "data\imports\switch.example.json" -Destination "data\imports\switch.json"
```

每条记录支持：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `title` | 是 | 游戏标题 |
| `ownership` | 是 | `owned`、`played`、`subscription` 或 `unknown` |
| `externalId` | 否 | 16 位十六进制 Switch Application ID；未知可留空 |
| `playMinutes` | 否 | 非负整数；未知请省略，不要填 0 |
| `firstPlayed` / `lastPlayed` | 否 | `YYYY-MM-DD` 或带时区的 RFC 3339 时间 |
| `system` | 否 | 当前设备使用 `switch`；默认也是 `switch` |
| `coverUrl` | 否 | 公开的 HTTPS 图片地址 |

### CSV

CSV 必须包含 `title` 与 `ownership` 表头，其他列可省略。完整表头如下：

```csv
title,externalId,playMinutes,firstPlayed,lastPlayed,system,ownership,coverUrl
ゼルダの伝説 ブレス オブ ザ ワイルド,01007EF00011E000,6000,2024-01-01,2026-07-18,switch,owned,
```

配置 Actions：

```powershell
gh variable set SWITCH_SYNC_MODE --body "manual"
gh variable set SWITCH_IMPORT_FILE --body "data/imports/switch.json"
gh variable set SWITCH_IMPORT_FORMAT --body "json"
gh variable set SWITCH_LOCALE --body "ja-JP"
gh variable set SWITCH_DEVICE --body "Nintendo Switch Lite"

git add data/imports/switch.json
git commit -m "data: add sanitized Switch library"
git push
```

CSV 用户把文件名和 `SWITCH_IMPORT_FORMAT` 分别改为实际路径与 `csv`。手工导入文件会进入公开仓库和 Pages，请先删除真实姓名、邮箱、Nintendo 登录标识等敏感字段；解析器也只接受表中列出的白名单字段。

## Switch 路径 B：实验性 nxapi 家长控制同步

这是非官方、可失效的增强路径。先按照任天堂日服支持文档，用官方[『Nintendo みまもり Switch』への登録](https://support.nintendo.com/jp/switch/parentalcontrols/app/setup.html)流程把 Switch Lite 与家长控制账号配对。nxapi 本身不能完成主机配对。

安装与 Actions 相同的固定版本，并在本地专用 data 目录登录。nxapi `1.6.1` 只有在显式设置 `DEBUG` 时才输出调试信息，其中可能包含认证 token；绑定前应清除 `DEBUG`。此外，`pctl auth` 会把 session token 作为正常终端输出显示，这不是调试日志，不能用开关关闭：不要录屏、重定向、保存或分享该终端内容。[nxapi 上游项目与 CLI 文档](https://github.com/samuelthomas2774/nxapi/blob/main/docs/cli.md#nintendo-switch-parental-controls)列出了对应命令。

```powershell
# 仅首次绑定生成；已有 .switch-state-key 时跳过 keygen 并继续使用原文件
npm run state -- keygen .switch-state-key
cmd /d /c "gh secret set SWITCH_STATE_KEY < .switch-state-key"

npm install --global "nxapi@1.6.1"

$nxapiPath = Join-Path (Resolve-Path -LiteralPath "data\credentials").Path "nxapi-local"
New-Item -ItemType Directory -Force -Path $nxapiPath | Out-Null

Remove-Item -LiteralPath "Env:\DEBUG" -ErrorAction SilentlyContinue
nxapi --data-path "$nxapiPath" pctl auth
if ($LASTEXITCODE -ne 0) { throw "nxapi 家长控制登录失败" }
nxapi --data-path "$nxapiPath" pctl devices --json
if ($LASTEXITCODE -ne 0) { throw "nxapi 主机列表读取失败" }
```

从第二条命令返回值中复制这台 Lite 的设备 ID，然后先验证日报读取：

```powershell
$switchDeviceId = "替换为 devices 返回的设备 ID"
Remove-Item -LiteralPath "Env:\DEBUG" -ErrorAction SilentlyContinue
nxapi --data-path "$nxapiPath" pctl daily-summaries "$switchDeviceId" --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw "nxapi 日报读取失败" }
```

把**整个** nxapi data 目录打包后加密；不能只复制其中一个 token 文件：

```powershell
$nxapiArchive = Join-Path (Resolve-Path -LiteralPath "data\credentials").Path "nxapi-state.tgz"
tar -czf "$nxapiArchive" -C "$nxapiPath" .
$env:GAME_WALL_STATE_KEY = (Get-Content -LiteralPath ".switch-state-key" -Raw).Trim()
try {
  npm run state -- encrypt "$nxapiArchive" "data\credentials\nxapi-state.enc"
  if ($LASTEXITCODE -ne 0) { throw "Switch 凭据加密失败" }
}
finally {
  Remove-Item -LiteralPath "Env:\GAME_WALL_STATE_KEY" -ErrorAction SilentlyContinue
}

gh variable set SWITCH_SYNC_MODE --body "nxapi"
gh variable set SWITCH_DEVICE_ID --body "$switchDeviceId"
gh variable set SWITCH_LOCALE --body "ja-JP"
gh variable set SWITCH_DEVICE --body "Nintendo Switch Lite"
```

只提交密文：

```powershell
git add data/credentials/nxapi-state.enc
git commit -m "chore: add encrypted Switch binding"
git push
```

`.switch-state-key` 只对应 GitHub Secret `SWITCH_STATE_KEY`，绝不能拿 `.epic-state-key` 替代。`nxapi-state.tgz` 与 `nxapi-local` 内的文件都是敏感状态，不得提交；不要对它们使用 `git add -f`，并用 `git status --short --ignored data/credentials` 确认只暂存了 `nxapi-state.enc`。确认密文可用后请安全处理原始副本。Actions 会解密整个 data 目录、读取指定 `SWITCH_DEVICE_ID` 的日报，再运行：

```text
npm run switch:history -- <脱敏累计历史.json> <本次 nxapi 原始响应.json> <本次公开导入.json>
```

当前工作流的实际三个路径依次为 `game-wall-daily-history.json`、runner 临时目录中的 `switch-daily.json` 和 `switch-import.json`。该命令只把经过字段白名单校验的日报历史写回 nxapi data 目录，按“主机 + 日期”去重后累计秒数，再生成供站点读取的手工导入结构。原始响应只留在当前 runner 临时目录；脱敏历史会连同可能刷新的登录状态一起重新打包加密，因此下次定时任务能在既有天数上继续累计，而不是只展示本次 API 返回窗口。

日报中的 `devicePlayers` 是该主机的具名玩家数组，`anonymousPlayer` 是可选的匿名玩家记录；两者都会进入同一款游戏的累计时长。单用户 Lite 通常等同于个人数据，多用户 Lite 则一定会合并，当前不能在 Game Wall 中按主机用户拆分。

nxapi 上游明确说明 `pctl auth` 使用的是 Nintendo Switch Parental Controls 会话，不能拿 Nintendo Switch Online 会话替代。日报命令与设备 ID 获取方式见 [nxapi CLI 文档](https://github.com/samuelthomas2774/nxapi/blob/main/docs/cli.md#nintendo-switch-parental-controls)。任天堂官方只保证在家长控制应用中查看主机使用活动，参见 [Nintendo Support](https://en-americas-support.nintendo.com/app/answers/detail/a_id/22366/c/184)；本项目的自动读取并非官方能力。

## Actions 的自动轮换与分支权限

`.github/workflows/deploy-pages.yml` 在以下情况运行：

- 推送到 `main`
- 手动触发 `workflow_dispatch`
- 每天 `02:17 UTC`，即北京时间 `10:17`；定时任务可能排队延迟

启用 Epic 或 Switch nxapi 时，工作流会：

1. 先确认当前 ref 是 `refs/heads/main`；从其他分支手动运行时会立即失败，不会执行有状态同步。
2. 安装项目依赖并运行安全测试，然后安装本次需要的固定版本第三方客户端 Legendary / nxapi。**所有第三方工具安装均发生在任何平台状态解密之前**，安装步骤拿不到状态解密密钥或明文凭据。
3. 若启用 nxapi，先在 runner 临时目录解密 Switch 状态、校验归档、拉取主机日报、更新脱敏累计历史并重新加密。Actions 显式把 `DEBUG` 设为空、禁用额外更新检查，并将 `XDG_CACHE_HOME`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME` 全部指向 runner 临时目录；CLI 的 stderr 只进入临时错误文件，不会回显。随后在校验路径仍位于 `$RUNNER_TEMP` 后，立即连同 `NXAPI_DATA_PATH` 一起删除五个目录，以及解密出的 `.tgz`、新打包的 `.tgz`、原始日报、错误日志和恢复标记；只有公开导入 JSON 留给后续建站。
4. **确认 Switch 明文状态已清理后**才解密 Epic。`npm run library:sync` 拉取 Steam、Xbox、Epic，并合入前面准备好的 Switch 公开导入；Legendary 可能轮换 `user.json`，工作流重新加密后立即删除整个 Legendary 明文目录和恢复标记。
5. 在两种明文凭据都已清理后，校验 v2 快照、运行类型检查、构建并上传 Pages artifact。
6. 最后若密文变化，以 `game-wall[bot]` 身份提交 `data/credentials/*.enc`；依次执行 `fetch`、在最新 `origin/main` 上 `rebase`、再推送到 `main`，冲突或并发更新时最多重试三次。

这也是工作流声明 `contents: write` 的原因。GitHub 使用当前工作流的 `GITHUB_TOKEN` 推送该提交，不会再次触发普通 `push` 工作流，因此不会形成同步循环；参见 [GitHub 的 `GITHUB_TOKEN` 文档](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)。

权限按 job 分离：workflow 默认只有 `contents: read`；build job 仅提升为 `contents: write` 并授予 `pages: read` 以读取 Pages 配置，**不申请 `id-token: write`，因此 build 没有 OIDC**。只有独立的 Pages deploy job 拥有 `pages: write` 与 `id-token: write`，用于 GitHub Pages 部署。

> [!WARNING]
> 当前实现只允许在 `main` 执行 Epic / nxapi 有状态同步，并把轮换后的密文**直推 `main`**。三次 `fetch` / `rebase` / `push` 重试只能缓解普通并发更新，不能绕过 branch protection / ruleset。如果规则要求 PR、限制推送者或禁止自动化绕过，三次都会失败，随后本次部署也会停止，Pages 保留上次成功版本。请在启用 Epic / nxapi 前明确允许该工作流身份写入 `main`；如果你不愿授予默认分支写权限，应先定制为独立状态分支、GitHub App 或人工更新密文。GitHub 的规则行为见[受保护分支文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)。

`contents: write` 也意味着受信任分支上的工作流代码拥有仓库写权限。不要从不受信任 PR 运行部署工作流，不要向 PR 暴露 Secrets。仓库的 `.github/workflows/ci.yml` 只使用固定 fixture 和 `contents: read`，fork PR 不会获得上述 Secrets。

### 三次推送失败后的密文恢复 artifact

若 **Persist rotated encrypted state** 的三次 `fetch` / `rebase` / `push` 全部失败，build 会失败，Pages 保留上次成功版本；随后 **Upload encrypted state recovery artifact** 仍会运行。它创建：

```text
game-wall-encrypted-state-recovery-<run_id>-<run_attempt>
```

artifact 的保留期为 7 天，上传路径严格限定为 `data/credentials/*.enc`。它不会也绝不能包含 `.epic-state-key`、`.switch-state-key`、任何解密密钥、`user.json`、`*.tgz`、nxapi data 目录或原始日报。虽然内容已经加密，里面仍是可与密钥组合使用的平台登录状态，必须视作敏感密文；不要转发、公开发布或上传到 Issue。

恢复步骤：

1. 打开仓库 **Actions → Sync and deploy Game Wall → 对应失败 run**，在页面底部 **Artifacts** 下载名称以 `game-wall-encrypted-state-recovery-` 开头且 run ID / attempt 与该次运行一致的 ZIP。务必在 7 天内完成。
2. 解压到独立审查目录，并确认文件白名单。PowerShell 示例：

   ```powershell
   Expand-Archive -LiteralPath ".\game-wall-encrypted-state-recovery-<run_id>-<run_attempt>.zip" -DestinationPath ".\state-recovery-review"
   $recoveryFiles = @(Get-ChildItem -LiteralPath ".\state-recovery-review" -Recurse -File)
   $unexpected = @($recoveryFiles | Where-Object {
     $_.Extension -ne ".enc" -or $_.Name -notin @("epic-user.enc", "nxapi-state.enc")
   })
   if ($recoveryFiles.Count -eq 0 -or $unexpected.Count -ne 0) {
     throw "恢复 artifact 包含缺失或非白名单文件"
   }
   $recoveryFiles | Select-Object FullName, Length
   ```

   结果只能是 `epic-user.enc`、`nxapi-state.enc` 中实际启用平台对应的一项或两项。发现 Key、`.tgz`、`user.json`、目录归档、日志或其他文件时立即停止，不要提交。
3. 回到仓库并更新 `main`，然后只把下载内容中的对应密文复制到固定目标。根据 artifact 实际包含的文件执行相应命令，不要复制整个审查目录：

   ```powershell
   git switch main
   git pull --ff-only origin main

   # artifact 中存在 Epic 密文时执行
   Copy-Item -LiteralPath ".\state-recovery-review\epic-user.enc" -Destination "data\credentials\epic-user.enc" -Force

   # artifact 中存在 Switch 密文时执行
   Copy-Item -LiteralPath ".\state-recovery-review\nxapi-state.enc" -Destination "data\credentials\nxapi-state.enc" -Force
   ```

   浏览器下载 ZIP 有时会保留子目录；这时先用上一步输出的 `FullName` 找到准确 `.enc`，再把该明确路径作为 `Copy-Item -LiteralPath`，不要使用通配符。
4. 复核 Git 只看到对应密文，明确暂存并从 `main` 提交：

   ```powershell
   git status --short -- data/credentials
   git diff --stat -- data/credentials
   git add -- data/credentials/epic-user.enc data/credentials/nxapi-state.enc
   git diff --cached --name-only
   git commit -m "chore: recover encrypted provider state"
   git push origin main
   ```

   若 artifact 只有一个平台文件，`git add` 也只填写那一个存在的 `.enc`。`git diff --cached --name-only` 必须只列出预期密文；任何 Key、`.tgz`、`user.json` 或其他明文都不得提交。推送仍需满足 `main` 的 branch protection / ruleset。

## 跨平台别名

默认会统一大小写、Unicode 形式、标点和常见 `Deluxe / Complete / Ultimate / GOTY Edition` 后缀；`Remake`、`Remastered` 等不会主动删除，以减少误合并。标题不同或自动结果错误时编辑 [`data/game-aliases.json`](data/game-aliases.json)：

```json
{
  "records": {
    "steam:你的AppID": "the witcher 3 wild hunt",
    "xbox:你的TitleID": "the witcher 3 wild hunt",
    "switch:你的ApplicationID": "the witcher 3 wild hunt"
  },
  "titles": {
    "巫师 3 狂猎": "the witcher 3 wild hunt"
  }
}
```

`records` 既能合并，也能拆分：若两个不同作品恰好同名，可分别把它们映射为不同的稳定标题（例如 `prey 2006` 与 `prey 2017`），避免仅凭标题误合并。为防止静默串数据，同一平台出现无法区分的同名记录时同步会明确失败，并要求先完成这种拆分。修改别名后 canonical 详情 URL 会变化，旧的数字 Steam URL 仍会落到新页面。

- `records` 的键必须是 `<source>:<externalId>`，适合精确指定某个平台记录。
- `titles` 的键是经过 NFKC、大小写、标点和 edition 后缀处理后的规范化标题，适合同名批量映射。
- 映射值相同的记录会得到相同 `canonicalId`，在合并视图成为一款游戏；分平台视图仍保留各自记录。
- 别名文件不是 Secret，应正常提交并由测试校验。

修改后运行 fixture 和测试，确认没有误合并独立作品。

## 本地开发与交付检查

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run library:sync` | 同步当前环境中已配置的所有平台并生成 v2 快照 |
| `npm run steam:sync` | 仅同步 Steam，保留兼容入口 |
| `npm run state -- ...` | 生成密钥、加密或解密轮换状态 |
| `npm run switch:history -- ...` | 合并本次 nxapi 日报与既有脱敏历史，并导出 Switch 导入 JSON |
| `npm run data:fixture` | 写入固定、脱敏的多平台 fixture |
| `npm run data:validate` | 严格校验现有快照 |
| `npm run dev` | 使用现有快照启动 Astro |
| `npm run dev:fixture` | 先写 fixture，再启动 Astro |
| `npm test` | 运行 provider、解析、加密状态与合并逻辑测试 |
| `npm run check` | Astro 与 TypeScript 检查 |
| `npm run build` | 校验快照并生成 `dist/` |
| `npm run build:fixture` | 使用 fixture 完成生产构建 |
| `npm run preview` | 预览已生成的静态站点 |

提交前完整检查：

```powershell
npm test
npm run data:fixture
npm run data:validate
npm run check
npm run build
```

`npm run library:sync` 会忽略完全未配置的平台，但某个平台只配了一半时会明确失败。例如 Steam 必须同时有 `STEAM_API_KEY` 和 `STEAM_USER`；Epic 必须既启用 Variable 又能读取已解密的 Legendary 配置。

## 故障排查

### OpenXBL 401 / 403

确认旧 Key 已吊销，新 Key 只存于 Secret `OPENXBL_API_KEY`，且 Secret 名称完全一致。不要为了排查把 Key 打印到 Actions 日志；直接在 OpenXBL 控制台再轮换一次更安全。

### Xbox 有游戏但时长为空

这是当前数据边界，不是 0 小时。OpenXBL 标题历史没有为本适配器提供足够可靠、统一的时长字段，因此页面保留“未知”。

### Epic 提示认证失败或 `user.json` 无效

Legendary refresh token 可能已经过期、被撤销或因上游改动失效。重新执行“Epic 一次性本地绑定”中的 Legendary 登录，但**跳过 `keygen`**；使用与现有 GitHub Secret `EPIC_STATE_KEY` 对应的 `.epic-state-key`（或其离线备份），临时载入本地 `GAME_WALL_STATE_KEY` 后加密新的 `user.json`，提交更新后的 `epic-user.enc`，再从 `main` 手动运行工作流。绝不能使用 Switch 的密钥。如果对应密钥副本已经丢失，GitHub 无法导出 Secret；此时必须只轮换 `EPIC_STATE_KEY`，并用新 Epic 密钥重新生成 `epic-user.enc`。

### Switch nxapi 找不到主机或日报为空

先在官方“みまもり Switch”应用确认 Lite 已注册且联网，再运行 `nxapi --data-path <目录> pctl devices --json`。`SWITCH_DEVICE_ID` 必须来自这里；Nintendo Account ID、好友码和序列号都不能替代。刚配对、主机未上传记录或日报尚未完成时可能暂时为空。

若 nxapi 会话确认失效，重新执行本地 `pctl auth` 并打包 data 目录，但**跳过 `keygen`**；使用与现有 GitHub Secret `SWITCH_STATE_KEY` 对应的 `.switch-state-key`（或其离线备份），临时载入本地 `GAME_WALL_STATE_KEY` 后重新生成 `nxapi-state.enc`，再从 `main` 手动运行工作流。绝不能使用 Epic 的密钥。如果对应密钥副本已经丢失，只轮换 `SWITCH_STATE_KEY` 并重新加密 `nxapi-state.enc`；不要改动 Epic Secret 或密文。

### 自动密文提交失败

查看日志中的 **Persist rotated encrypted state**。该步骤已做三次 `fetch` / `rebase` / `push` 尝试；三次都失败时，确认 build job 仍有 `contents: write`，并检查 `main` 的 branch protection / ruleset 是否允许当前 Actions 身份直接推送。不要用扩大到所有仓库的 PAT 作为快捷修复；若必须替换认证，优先使用仅安装到此仓库、最小 `Contents: write` 权限的 GitHub App，并相应修改工作流。

### 两个平台没有合并，或错误合并

记录详情页会显示各平台的 `source` 与 `externalId`。把这些精确键加入 `data/game-aliases.json` 的 `records` 后重新构建。不要为了合并原版与 Remake 而建立过宽的标题规则。

### 页面链接或样式在 Pages 上 404

确认 Pages Source 是 **GitHub Actions**，不要手工复制别处构建的 `dist/`。部署工作流通过 `actions/configure-pages` 注入当前仓库的 origin 和 base path，项目页会自动适配 `https://<用户>.github.io/<仓库>/`。

## 上游与声明

- [GitHub Pages 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Actions Secrets 文档](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Steam Web API](https://steamcommunity.com/dev)
- [OpenXBL](https://xbl.io/)（非官方 Xbox API 网关）
- [Legendary](https://github.com/legendary-gl/legendary)（非官方 Epic CLI）
- [nxapi](https://github.com/samuelthomas2774/nxapi)（非官方 Nintendo app API 客户端）
- [任天堂日服家长控制绑定说明](https://support.nintendo.com/jp/switch/parentalcontrols/app/setup.html)

Game Wall 是非官方个人项目，与 Valve、Microsoft/Xbox、Epic Games、Nintendo、OpenXBL、Legendary 或 nxapi 维护者没有隶属、赞助或认可关系。平台名称、标志和游戏素材归各自权利人所有；第三方或逆向接口可能随时改变、限流、撤销访问或停止工作。
