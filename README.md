# opencode-token-usage

OpenCode 令牌用量面板：终端侧边栏 + 桌面标题栏胶囊、窗口底栏和审查栏面板。

周期可选 **年 / 月 / 周 / 天**，显示当前周期内的总量、输入、输出、缓存、花费，以及按 token 排序的 Top 模型（含供应商标签与花费）。TUI 直接读本地 OpenCode 数据库；Desktop 走 `experimental.session.stats` 接口，不需要数据库权限。

## 环境要求

- OpenCode 2.x（在 2.2.6 上验证）
- Git（Git 直装需要）
- 运行时依赖由 OpenCode 安装插件时自动拉取，无需单独构建

## 安装

通过 Git 安装并 pin 到 tag：

```bash
opencode plugin add 'github:JelawatIHPC/opencode-token-usage#0.1.0'
```

或直接写入 `opencode.jsonc`（GUI 部分从全局配置加载）：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-token-usage@git+https://github.com/JelawatIHPC/opencode-token-usage.git#0.1.0"
  ]
}
```

本地开发时也可以让 `plugins` 指向仓库目录（必须是**目录**，不能指向单个文件；Windows 下写绝对路径，`~` 不会被展开）：

```jsonc
{
  "plugins": ["C:\\path\\to\\opencode-token-usage"]
}
```

验证：

```bash
opencode plugin list
```

注：`plugin list` 只枚举本地 `plugins/` 目录，不会列出由 `plugins` 配置项安装的 Git 插件；请以配置文件和实际面板行为为准。

卸载：

```bash
opencode plugin remove opencode-token-usage
```

也可以直接删除 `opencode.jsonc` 中对应的条目。

## 使用

### TUI

侧边栏显示当前周期：

- 标题行：`Monthly tokens 2026-11` 之类的周期名
- 指标：`total / input / output / cached / spent`
- `Top models`：模型名 + 供应商标签 + token 数 + 花费

点击周期标题循环切换 `monthly → weekly → daily → collapsed → yearly`，`collapsed` 只保留标题行。周期选择保存在 TUI 的插件存储里，跨重启有效。

### Desktop

- **标题栏胶囊**：`Tokens 12.3M · $1.50`，跟随当前周期；点击打开用量面板。
- **窗口底栏**：右侧对齐，依次是 `周期 | 总量·花费 | Top1 模型 · tokens·花费`，模型名与数字按模型色染色（数字暗一档）。
- **审查栏面板**：与 TUI 相同的指标网格和 Top 模型列表，供应商标签显示为独立药丸；顶部 `Period` 下拉切换年/月/周/天，标题栏与底栏同步跟随。

桌面侧的周期保存在窗口 `localStorage`，与 TUI 的相对独立。

### 慢周期的缓存

`experimental.session.stats` 的耗时随范围增长（实测：年约 790 ms，月约 170 ms，周/日只有几毫秒）。因此桌面侧只对**年和月**做 stale-while-revalidate：

- 切换周期时若命中缓存，立刻用缓存数字填满面板和底栏，同时后台发请求；
- 新结果返回后无缝替换；
- 缓存按 `周期 + 周期标签` 存窗口 `localStorage`，**不设过期时间**：跨年、跨月后标签变了自然就 miss，命中时数据一定会立刻被后台刷新替换；只按条数裁剪（最多 8 条）。
- 周/日不进缓存，每次直接请求。

## 统计口径

与 TUI 一致：

| 指标 | 计算 |
|---|---|
| `output` | `tokens.output + tokens.reasoning` |
| `cached` | `tokens.cache.read + tokens.cache.write` |
| `spent` | 会话累计花费 |

模型按 `model.id` 合并，切换供应商不会裂成两行；同一模型由多个供应商提供时，标签显示 token 最多的供应商并附 `+N`。桌面面板取全局统计，不按当前会话过滤。

## 开发

仓库根目录就是插件包根目录：

```
src/index.ts        Server part（插件身份）
src/tui.tsx         TUI part
src/gui.tsx         GUI part 源码
src/core.ts         TUI/GUI 共用的纯逻辑
dist/               GUI 构建产物（已提交，Git 安装需要）
tests/              构建产物的冒烟检查
```

```bash
npm install
npm run typecheck   # TUI + GUI 两套 tsconfig
npm run build:gui   # 重新生成 dist/gui-experimental.cjs
npm run test:bundle # 不启动 OpenCode，检查 bundle 注册项
```

GUI 部分必须先构建再提交：`dist/` 不能加入 `.gitignore`，否则 Git 安装包会缺少 `./gui-experimental`。

改完 `src/gui.tsx` 后，运行中的 Desktop 会监听 `dist/gui-experimental.cjs` 并热重载。

## 兼容性

| OpenCode | Plugin |
|---|---|
| 2.2.x | 0.1.x |

## License

Public domain, see [LICENSE](LICENSE) (Unlicense).
