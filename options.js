const DEFAULT_RULES = [
  { name: "AI / Agent", color: "blue", keywords: ["ai", "agent", "llm", "openai", "anthropic", "gemini", "deepseek", "chatgpt", "claude"] },
  { name: "浏览器 / Web 技术", color: "cyan", keywords: ["chrome", "safari", "browser", "extension", "web", "dom", "css", "javascript", "runtime", "kernel", "wwdc", "developer.chrome.com", "chromium"] },
  { name: "论文 / 开源代码", color: "purple", keywords: ["arxiv", "paper", "github", "gitlab", "stackoverflow", "docs", "documentation"] },
  { name: "工作 / 协作", color: "green", keywords: ["mail", "gmail", "calendar", "docs.google", "office", "notion", "slack", "teams", "jira", "confluence", "figma", "zoom", "meeting", "飞书", "lark"] },
  { name: "购物 / 商品", color: "orange", keywords: ["amazon", "taobao", "tmall", "jd", "ebay", "shop", "cart", "product", "price", "buy", "deal", "商品", "购物", "价格"] },
  { name: "新闻 / 资讯", color: "red", keywords: ["news", "reuters", "bloomberg", "36kr", "theverge", "techcrunch", "nytimes", "cnn", "bbc", "medium", "新闻", "资讯"] },
  { name: "旅行 / 地图", color: "yellow", keywords: ["travel", "flight", "hotel", "booking", "airbnb", "maps", "trip", "weather", "restaurant", "旅行", "酒店", "机票", "地图"] },
  { name: "视频 / 娱乐", color: "pink", keywords: ["youtube", "bilibili", "netflix", "video", "music", "spotify", "douyin", "tiktok", "视频", "音乐"] }
];
const DEFAULTS = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4.1-mini",
  extraPrompt: "",
  customRules: JSON.stringify(DEFAULT_RULES, null, 2),
  groupByDomainFallback: true,
  enablePageSemantics: false,
  pageSnippetChars: 500,
  maxSemanticTabs: 8,
  semanticTimeoutMs: 350,
  semanticCacheTtlMinutes: 30,
  aiRequestTimeoutMs: 20000
};

async function loadSettings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  document.getElementById("endpoint").value = data.endpoint || DEFAULTS.endpoint;
  document.getElementById("apiKey").value = data.apiKey || "";
  document.getElementById("model").value = data.model || DEFAULTS.model;
  document.getElementById("extraPrompt").value = data.extraPrompt || "";
  document.getElementById("customRules").value = data.customRules || DEFAULTS.customRules;
  document.getElementById("groupByDomainFallback").checked = data.groupByDomainFallback !== false;
  document.getElementById("enablePageSemantics").checked = data.enablePageSemantics === true;
  document.getElementById("pageSnippetChars").value = data.pageSnippetChars || DEFAULTS.pageSnippetChars;
  document.getElementById("maxSemanticTabs").value = data.maxSemanticTabs || DEFAULTS.maxSemanticTabs;
  document.getElementById("semanticTimeoutMs").value = data.semanticTimeoutMs || DEFAULTS.semanticTimeoutMs;
  document.getElementById("semanticCacheTtlMinutes").value = data.semanticCacheTtlMinutes || DEFAULTS.semanticCacheTtlMinutes;
  document.getElementById("aiRequestTimeoutMs").value = data.aiRequestTimeoutMs || DEFAULTS.aiRequestTimeoutMs;
}

async function saveSettings() {
  const settings = {
    endpoint: document.getElementById("endpoint").value.trim() || DEFAULTS.endpoint,
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim() || DEFAULTS.model,
    extraPrompt: document.getElementById("extraPrompt").value.trim(),
    customRules: document.getElementById("customRules").value.trim() || DEFAULTS.customRules,
    groupByDomainFallback: document.getElementById("groupByDomainFallback").checked,
    enablePageSemantics: document.getElementById("enablePageSemantics").checked,
    pageSnippetChars: Math.max(200, Math.min(1200, Number(document.getElementById("pageSnippetChars").value || DEFAULTS.pageSnippetChars))),
    maxSemanticTabs: Math.max(0, Math.min(50, Number(document.getElementById("maxSemanticTabs").value || DEFAULTS.maxSemanticTabs))),
    semanticTimeoutMs: Math.max(150, Math.min(2000, Number(document.getElementById("semanticTimeoutMs").value || DEFAULTS.semanticTimeoutMs))),
    semanticCacheTtlMinutes: Math.max(1, Math.min(1440, Number(document.getElementById("semanticCacheTtlMinutes").value || DEFAULTS.semanticCacheTtlMinutes))),
    aiRequestTimeoutMs: Math.max(8000, Math.min(30000, Number(document.getElementById("aiRequestTimeoutMs").value || DEFAULTS.aiRequestTimeoutMs)))
  };
  try {
    const parsed = JSON.parse(settings.customRules);
    if (!Array.isArray(parsed)) throw new Error("顶层必须是数组，例如 [{\"name\":...,\"keywords\":[...]}]");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const m = msg.match(/position\s+(\d+)/i);
    let hint = msg;
    if (m) {
      const pos = Number(m[1]);
      const text = settings.customRules;
      const before = text.slice(0, pos);
      const line = before.split("\n").length;
      const col = before.length - before.lastIndexOf("\n");
      const start = Math.max(0, pos - 60);
      const end = Math.min(text.length, pos + 60);
      hint += `；位置：第 ${line} 行，第 ${col} 列；附近：${text.slice(start, end)}`;
    }
    document.getElementById("status").textContent = "规则 JSON 格式错误：" + hint + "。常见原因：漏了英文双引号、用了中文引号、字符串里有未转义换行、末尾多了逗号。";
    document.getElementById("status").style.color = "#b91c1c";
    return;
  }
  await chrome.storage.local.set(settings);
  document.getElementById("status").textContent = "已保存。";
}

async function clearSettings() {
  await chrome.storage.local.set({ endpoint: DEFAULTS.endpoint, apiKey: "", model: DEFAULTS.model, extraPrompt: "" });
  await loadSettings();
  document.getElementById("status").style.color = "#047857";
  document.getElementById("status").textContent = "已清空 AI 设置，规则配置保持不变。";
}
async function resetRules() {
  await chrome.storage.local.set({ customRules: DEFAULTS.customRules, groupByDomainFallback: true, enablePageSemantics: DEFAULTS.enablePageSemantics, pageSnippetChars: DEFAULTS.pageSnippetChars, maxSemanticTabs: DEFAULTS.maxSemanticTabs, semanticTimeoutMs: DEFAULTS.semanticTimeoutMs, semanticCacheTtlMinutes: DEFAULTS.semanticCacheTtlMinutes, aiRequestTimeoutMs: DEFAULTS.aiRequestTimeoutMs });
  await loadSettings();
  document.getElementById("status").style.color = "#047857";
  document.getElementById("status").textContent = "已恢复默认规则。";
}

document.getElementById("saveBtn").addEventListener("click", saveSettings);
document.getElementById("clearBtn").addEventListener("click", clearSettings);
document.getElementById("resetRulesBtn").addEventListener("click", resetRules);
loadSettings();
