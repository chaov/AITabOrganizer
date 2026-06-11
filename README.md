# AI Tab Organizer

AI Tab Organizer 是一个基于 Chrome Extension 的智能标签页整理工具。它可以基于 AI 语义理解或本地规则生成分组预览，并在用户确认后自动创建 Chrome Tab Groups。

![AI Tab Organizer Demo](./ai_tab_org.gif)

## v0.5.0 新增能力

- 生成分组预览后，支持对单个页签进行微调。
- 每个页签条目支持拖拽移动到其他分组或“未分类 / 待调整”。
- 每个页签条目悬停时显示“↪”移动按钮，可用下拉菜单精确移动到指定分组。
- AI/规则没有纳入分组的页签会显示在“未分类 / 待调整”区域，可以拖入任意分组。
- 应用分组后，插件进入 live 模式：在插件内拖拽页签会直接更新 Chrome Tab Groups。
- 如果用户在 Chrome 标签栏中手动拖入、拖出或跨组移动页签，可以点击“同步当前分组”刷新插件显示。

## 核心功能

- 默认 AI 语义分组
- OpenAI-compatible / DeepSeek 接口接入
- 超过 50 tabs 的 AI 分批或规则快速模式
- 自适应 AI 请求超时
- 规则模式与自定义规则
- 可选页面语义增强
- 分组预览、人工微调、拖拽移动、应用、撤销与清理

## 使用方式

1. 打开 `chrome://extensions/`
2. 开启 Developer mode
3. 点击 Load unpacked
4. 选择插件目录
5. 点击浏览器工具栏中的 AI Tab Organizer 图标

## 推荐配置

```text
Endpoint: https://api.deepseek.com/chat/completions
Model: deepseek-v4-flash
AI 最大请求超时 ms: 20000
页面语义增强: 关闭
```

## 交互说明

### 预览阶段

生成分组预览后，可以：

- 直接拖拽某个页签到其他分组
- 拖拽到“未分类 / 待调整”，表示不参与分组
- 点击页签右侧“↪”按钮，通过下拉菜单选择目标分组
- 修改分组名称和颜色
- 勾选是否应用某个分组

这些操作只修改预览计划，点击“应用分组”后才会修改 Chrome。

### 应用后

应用分组后，可以：

- 在插件内继续拖拽页签，实时更新 Chrome Tab Groups
- 在 Chrome 标签栏中手动拖动页签，然后点击“同步当前分组”刷新插件显示
- 点击“清除分组”清空当前窗口分组
- 点击“撤销上次”撤销插件上一次创建的分组
