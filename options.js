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
  groupByDomainFallback: true
};

async function loadSettings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  document.getElementById("endpoint").value = data.endpoint || DEFAULTS.endpoint;
  document.getElementById("apiKey").value = data.apiKey || "";
  document.getElementById("model").value = data.model || DEFAULTS.model;
  document.getElementById("extraPrompt").value = data.extraPrompt || "";
  document.getElementById("customRules").value = data.customRules || DEFAULTS.customRules;
  document.getElementById("groupByDomainFallback").checked = data.groupByDomainFallback !== false;
}

async function saveSettings() {
  const settings = {
    endpoint: document.getElementById("endpoint").value.trim() || DEFAULTS.endpoint,
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim() || DEFAULTS.model,
    extraPrompt: document.getElementById("extraPrompt").value.trim(),
    customRules: document.getElementById("customRules").value.trim() || DEFAULTS.customRules,
    groupByDomainFallback: document.getElementById("groupByDomainFallback").checked
  };
  try { JSON.parse(settings.customRules); }
  catch (e) {
    document.getElementById("status").textContent = "规则 JSON 格式错误：" + e.message;
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
  await chrome.storage.local.set({ customRules: DEFAULTS.customRules, groupByDomainFallback: true });
  await loadSettings();
  document.getElementById("status").style.color = "#047857";
  document.getElementById("status").textContent = "已恢复默认规则。";
}

document.getElementById("saveBtn").addEventListener("click", saveSettings);
document.getElementById("clearBtn").addEventListener("click", clearSettings);
document.getElementById("resetRulesBtn").addEventListener("click", resetRules);
loadSettings();
