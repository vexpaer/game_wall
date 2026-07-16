# Game Wall

Game Wall 是一个由 Steam 数据自动生成的个人游戏仪表盘。它在构建时读取玩家资料、已游玩游戏、游玩时长和成就汇总，再输出可直接部署到 GitHub Pages 的纯静态网站。

站点只展示游玩时长大于 0 的游戏（包括玩过的免费游戏），提供首页搜索、筛选与排序，以及每款游戏的精简详情页。没有数据库、登录、在线编辑、逐项成就列表或多用户功能。

## 技术与数据来源

- Astro 7、严格模式 TypeScript、Node.js 22
- Steam Web API：玩家资料、游戏库、时长和成就汇总
- Steam Store `appdetails`：简介、类型、开发商、发行日期和图片；这是 best-effort 的未正式支持接口，失败时页面会使用基础游戏信息和占位图
- GitHub Actions：每日同步、校验、构建与 GitHub Pages 部署

每次同步会生成 `data/generated/site-snapshot.json`。该文件及最终 `dist/` 都不会提交到 Git；玩家数据只存在于当前构建工作区和 Pages 部署产物中。Actions Cache 仅保存公开的 Steam 商店元数据，脚本以 7 天为有效期，不缓存玩家时长、成就、资料或 API Key。

## 本地运行

### 环境要求

- Node.js 22.12 或更高版本
- npm
- 一个 Steam Web API Key
- Steam 资料中的“游戏详情”必须公开

安装依赖：

```powershell
npm install
```

复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

在 `.env` 中填写：

```dotenv
STEAM_API_KEY=你的_Steam_Web_API_Key
STEAM_USER=你的_SteamID64_或自定义资料名
STEAM_LANGUAGE=schinese
```

- `STEAM_API_KEY`：在 [Steam Web API Key 页面](https://steamcommunity.com/dev/apikey)申请。不要把真实 Key 提交到 Git。
- `STEAM_USER`：可以是 17 位 SteamID64，也可以是个人资料 URL 中的 vanity 名称，例如 `https://steamcommunity.com/id/example/` 中的 `example`。
- `STEAM_LANGUAGE`：可选，默认 `schinese`；它只影响 Steam 商店补充资料的语言。

抓取真实数据并启动开发服务器：

```powershell
npm run steam:sync
npm run dev
```

如果只想查看界面，不使用 Steam Key，可使用仓库内的固定脱敏数据：

```powershell
npm run dev:fixture
```

默认站点基础路径是 `/game_wall/`。若要在本机根路径预览，可临时设置 `BASE_PATH=/`；PowerShell 示例：

```powershell
$env:BASE_PATH="/"
npm run dev:fixture
```

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run steam:sync` | 从 Steam 同步真实数据并生成快照 |
| `npm run data:fixture` | 写入固定、脱敏的开发/CI 快照 |
| `npm run data:validate` | 校验现有快照结构和数据约束 |
| `npm run dev` | 启动 Astro 开发服务器，使用现有快照 |
| `npm run dev:fixture` | 生成 fixture 后启动开发服务器 |
| `npm test` | 运行数据处理与容错测试 |
| `npm run check` | 运行 Astro 检查和 TypeScript 类型检查 |
| `npm run build` | 校验快照并生成 `dist/` 静态站点 |
| `npm run build:fixture` | 使用 fixture 完成一次生产构建 |
| `npm run preview` | 本地预览已生成的 `dist/` |

完整的本地交付检查：

```powershell
npm test
npm run data:fixture
npm run check
npm run build
```

## Steam 隐私设置

Steam Web API 只有在资料允许时才能返回游戏和总时长。打开 Steam 的“编辑个人资料 → 隐私设置”，完成以下设置：

1. 将“我的个人资料”以及其下的“游戏详情”设为“公开”。
2. 不要勾选“即使用户可以查看我的游戏详情，也始终保持我的总游戏时间为私密”。

如果 Steam 对一个有效账号返回隐私导致的空游戏响应，同步会成功生成“游戏资料未公开”页面，并部署它来替换旧的公开数据。真正公开但没有任何已游玩游戏时，则生成空游戏库页面。单款游戏的成就接口失败不会冒充为 0%，页面会显示“暂不可用”。

注意：GitHub Pages 是公开静态站点。部署后，昵称、头像、游戏名称、游玩时间、最后游玩时间和成就汇总都会成为公开内容。如果不希望公开这些信息，请不要启用部署，或删除 Pages 站点。

## 配置 GitHub Actions 与 Pages

将项目推送到 GitHub，默认分支保持为 `main`。本项目不会自行创建远端仓库，也不会在工作流中执行 `git add`、`git commit` 或 `git push`。

### 1. 配置凭据和账号

在仓库的 **Settings → Secrets and variables → Actions** 中添加：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Repository secret | `STEAM_API_KEY` | Steam Web API Key |
| Repository variable | `STEAM_USER` | SteamID64 或 vanity 名称 |
| Repository variable（可选） | `STEAM_LANGUAGE` | 默认 `schinese` |

`STEAM_API_KEY` 只注入到 Steam 抓取步骤；测试、类型检查、构建、PR CI 和其他步骤都拿不到它。同步请求通过 `x-webapi-key` 请求头发送 Key，生成快照和错误信息不应包含 Key。

来自 fork 的 Pull Request 默认也不会获得仓库 Secrets；`.github/workflows/ci.yml` 始终使用固定 fixture，不访问 Steam 或任何 Secret。

### 2. 启用 Pages

在 **Settings → Pages → Build and deployment** 中，将 **Source** 设为 **GitHub Actions**。工作流会从 Pages 配置读取站点 origin 和 base path，因此项目页会自动适配 `https://<用户名>.github.io/<仓库名>/`，而不是把域名写死在源码中。

### 3. 首次部署与更新

`.github/workflows/deploy-pages.yml` 会在以下情况同步并部署：

- 推送到 `main`
- 在 Actions 页手动运行 **Deploy Game Wall**
- 每天 `02:17 UTC`（北京时间 `10:17`）的定时任务；GitHub 可能会让定时任务略有延迟

同步成功后依次校验快照、构建站点、上传 Pages artifact，再部署到 `github-pages` 环境。玩家资料或游戏库的认证/暂时性请求失败会让本次部署失败，Pages 会保留上一次成功版本；有效的隐私空响应则会正常部署隐私提示页，以免旧数据继续公开。

公共 Steam 商店资料通过 Actions Cache 恢复。缓存按周轮换，脚本只接受 7 天内的条目；成就、时长和玩家资料每次都会重新拉取。

## 数据行为与边界

- 只保留 `playtime_forever > 0` 的游戏，未玩过的已拥有游戏不会出现在站点中。
- 总成就完成率按“所有可用游戏的已解锁成就数 ÷ 总成就数”加权计算，不是各游戏百分比的简单平均。
- 只保存成就数量与完成率，不保存或展示逐项成就。
- 商店资料最多保留 4 张截图，不获取价格、用户评测、DLC 或视频。
- 商店补充接口失败不会中止部署；资料页会回退到 Steam Web API 的名称、图标与站点占位视觉。
- 所有外部响应都会在写入快照前校验。商店简介按纯文本呈现，不渲染外部 HTML。
- 外部图片只接受安全的 HTTPS 地址。
- 展示时间使用 `Asia/Shanghai` 时区；Steam 返回的分钟数会在界面中格式化为小时和分钟。

## 故障排查

### `STEAM_API_KEY` 或 `STEAM_USER` 缺失

本地检查 `.env` 是否存在且变量名正确；GitHub 中检查 Key 是否放在 **Repository secrets**、用户标识是否放在 **Repository variables**。修改后手动运行一次 **Deploy Game Wall**。

### Steam 返回 401、403 或“认证失败”

重新在 Steam Web API Key 页面确认 Key，检查复制时是否带有空格，并确认该 Key 仍有效。Key 不需要也不应写进 URL、源码或普通 GitHub variable。

### vanity 名称解析失败

`STEAM_USER` 只填写 `/id/` 后的名称，不要粘贴整个 URL。也可以改用 SteamID64。若资料 URL 是 `/profiles/7656.../`，填写其中的 17 位数字。

### 页面提示游戏资料未公开

按“Steam 隐私设置”一节公开“游戏详情”并取消隐藏总游戏时长，等待 Steam 设置生效后手动重新部署。

### 某些游戏显示成就暂不可用或没有成就

并非所有游戏都接入 Steam 成就；Steam 也可能临时拒绝单游戏的成就请求。同步会保留这款游戏并明确区分“无成就”和“暂不可用”，下一次部署会重新尝试。

### 简介、类型或图片缺失

Steam Store `appdetails` 不是受支持的正式 Web API，可能限流、缺少某种语言或改变响应。该数据按 best-effort 处理，缺失不会阻止站点部署。

### GitHub Pages 的样式或详情链接 404

确认 Pages 的 Source 是 **GitHub Actions**，并从部署工作流构建站点。不要把另一个仓库名下构建的 `dist/` 直接复制过来；工作流会根据当前 Pages 配置设置 `SITE_URL` 和 `BASE_PATH`。

### 定时任务没有准点运行

GitHub 的 schedule 触发可能排队，并且只在默认分支上的工作流有效。检查默认分支是否为 `main`、Actions 是否启用，以及仓库是否因长期无活动而暂停定时工作流；必要时使用手动触发。

### 上一次页面仍然可见

查看 **Actions → Deploy Game Wall**。认证失败或 Steam 暂时性错误会故意阻止新 artifact 部署，以保留上一版本；修复变量或等待服务恢复后重新运行即可。

## 声明

本项目展示的数据来自 Steam。Steam、Steam 标志以及相关游戏素材归 Valve Corporation 或相应权利人所有。本项目是非官方个人项目，与 Valve Corporation 无隶属、赞助或认可关系。
