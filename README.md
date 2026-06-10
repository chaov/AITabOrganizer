# AI Tab Organizer v0.4.6

## Changes in v0.4.6

- AI 请求超时从固定值改为自适应：`6000ms + tabs * 180ms`，并受设置页里的“AI 最大请求超时 ms”限制。
- 默认最大超时改为 `20000ms`，更适合 DeepSeek V4 / OpenAI-compatible 模型。
- 大窗口分批 AI 模式会在状态栏显示当前批次 tab 数和本批自适应超时。
- 兼容旧版本遗留的 `4500ms` 设置：运行时会自动提升到新的自适应上限，避免过早 abort。

## Recommended settings

- DeepSeek V4 Flash / Pro: `AI 最大请求超时 ms = 20000`
- 50 tabs以内：单批 AI 分类
- 超过50 tabs：用户选择 AI 分批或规则快速模式

