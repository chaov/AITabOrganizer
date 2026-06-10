# AI Tab Organizer

AI Tab Organizer 是一个基于 Chrome Extension 的智能标签页整理工具。它可以读取当前 Chrome 窗口中的标签页信息，基于 AI 语义理解或本地规则生成分组预览，并在用户确认后自动创建 Chrome Tab Groups，帮助用户快速整理大量混乱标签页。

![AI Tab Organizer Demo](./ai_tab_extension.gif)

## 核心功能

### 1. AI 语义分组

插件默认使用 AI 模式进行标签页整理。它会收集当前窗口中可整理标签页的标题、URL、域名等信息，并调用 OpenAI-compatible 模型生成分组计划。

模型只负责生成分组方案，真正的浏览器操作由插件本地执行，避免模型直接控制 Chrome。

支持的典型场景包括：

- 技术调研标签页整理
- 浏览器 / Web / AI 相关资料分组
- 工作协作页面归类
- 购物、新闻、视频、旅行等日常标签页整理
- 大量标签页的快速清理和主题归并

### 2. 规则模式兜底

除了 AI 模式，插件还提供本地规则模式。规则模式不依赖网络和模型，适合以下场景：

- 没有配置 API Key
- AI 接口响应较慢
- 标签页数量很多，需要快速整理
- 希望使用固定、可解释的分类规则

规则模式支持自定义 JSON 规则，可以按关键词、域名、URL 片段、标题关键词进行匹配。

### 3. 大窗口分批处理

当可整理标签页超过 50 个时，插件会提示用户选择：

- 使用 AI 分批整理全部标签页
- 进入大窗口快速模式，使用规则模式整理全部标签页

这样可以避免 AI 模式只处理部分标签页，也避免在大量标签页场景下长时间无提示等待。

### 4. 自适应 AI 超时

从 v0.4.5 开始，AI 请求超时不再使用固定值，而是根据标签页数量自动调整：

```text
AI 请求超时 = 6000ms + tabs 数量 × 180ms
```

同时受设置页中的“AI 最大请求超时 ms”限制。默认最大超时为 20000ms，更适合 DeepSeek V4、OpenAI-compatible API 等模型。

### 5. 页面语义增强

插件支持可选的页面语义增强能力。开启后，插件会尝试读取页面的：

- meta description
- h1 / h2 标题
- 页面正文片段

这些信息可以提升 AI 分组准确率。为了保证响应速度，该能力默认关闭，并带有数量限制、超时控制和缓存机制。

### 6. 分组预览与人工确认

插件不会直接修改浏览器标签页，而是先生成分组预览。用户可以在预览中：

- 查看每个分组包含哪些标签页
- 修改分组名称
- 修改分组颜色
- 勾选是否应用某个分组
- 确认后再创建 Chrome Tab Groups

### 7. 分组清理与撤销

插件提供以下清理能力：

- 撤销上次：撤销插件上一次创建的分组
- 清除分组：清除当前窗口中的所有标签页分组
- 卸载：先清理所有窗口中的分组，再打开 Chrome 扩展管理页，方便手动卸载

## 使用方式

### 1. 加载插件

```text
1. 打开 chrome://extensions/
2. 打开右上角 Developer mode
3. 点击 Load unpacked
4. 选择插件目录
5. 点击浏览器工具栏中的 AI Tab Organizer 图标
```

### 2. 配置 AI 模型

点击插件顶部的“AI 设置”，填写 OpenAI-compatible 接口信息。

DeepSeek 推荐配置：

```text
Endpoint: https://api.deepseek.com/chat/completions
Model: deepseek-v4-flash
AI 最大请求超时 ms: 20000
页面语义增强: 关闭
```

也可以使用其他兼容 OpenAI Chat Completions 格式的模型服务。

### 3. 生成分组

```text
1. 打开多个网页标签页
2. 点击 AI Tab Organizer 图标
3. 默认使用 AI 语义模式
4. 点击“生成分组预览”
5. 检查分组结果
6. 点击“应用分组”
```

## 推荐配置

### 快速演示

```text
分类模式：AI 语义模式
页面语义增强：关闭
AI 最大请求超时 ms：20000
只整理未分组 tabs：开启
跳过 pinned tabs：开启
最小成组数量：2
```

### 大量标签页场景

```text
50 个以内：使用 AI 语义模式
超过 50 个：根据提示选择 AI 分批整理或规则快速整理
需要 5 秒内完成：建议使用规则模式
```

### 更高准确率

```text
页面语义增强：开启
页面正文片段长度：500～900
最大语义抽取 tabs：8～12
语义抽取超时：350～800ms
```

## 自定义规则示例

可以在设置页中配置自定义规则 JSON：

```json
[
  {
    "name": "Safari / Apple Intelligence",
    "color": "blue",
    "keywords": ["safari", "apple intelligence", "wwdc", "notify me"],
    "domains": ["apple.com", "macrumors.com"]
  },
  {
    "name": "Chrome Extension 开发",
    "color": "cyan",
    "keywords": ["chrome extension", "manifest", "tabGroups", "tabs api"],
    "domains": ["developer.chrome.com"]
  },
  {
    "name": "Agentic Web 研究",
    "color": "purple",
    "keywords": ["agentic web", "web agent", "browser agent", "llm", "agent"],
    "domains": ["arxiv.org", "github.com"]
  },
  {
    "name": "工作 / 协作",
    "color": "green",
    "keywords": ["jira", "confluence", "docs", "meeting", "notion", "gmail"]
  }
]
```

## 设计原则

AI Tab Organizer 的核心设计原则是：

```text
AI 负责规划，本地插件负责校验、预览和执行。
```

也就是说，模型不会直接调用 Chrome API。插件会对模型返回的分组计划进行校验，只允许合法的 tabId、颜色和分组名称进入预览，并且必须经过用户确认后才会真正修改标签页分组。

## 当前版本

```text
Version: 0.4.6
```

主要能力包括：

- 默认 AI 语义分组
- OpenAI-compatible 模型接入
- DeepSeek V4 适配增强
- 超过 50 tabs 的分批 AI / 规则降级策略
- 自适应 AI 请求超时
- 可选页面语义增强
- 自定义规则模式
- 分组预览、编辑、应用、撤销和清理

## 后续方向

后续可以继续演进：

- 用户手动调整后的偏好学习
- 新打开标签页自动建议归组
- 跨窗口 / 跨会话标签页主题管理
- 页面语义缓存和任务级 Tab Workspace
- 与 Notify Me、AI Site Customizer 等 Agentic Browsing 能力联动
