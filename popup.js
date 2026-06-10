const COLORS = ["blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple", "grey"];
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
const DEFAULT_SETTINGS = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4.1-mini",
  extraPrompt: "",
  customRules: JSON.stringify(DEFAULT_RULES, null, 2),
  groupByDomainFallback: true
};

let currentTabs = [];
let currentPlan = [];

function $(id) { return document.getElementById(id); }
function setStatus(msg, type = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${type}`;
}
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function isSystemUrl(url = "") {
  return /^(chrome|chrome-extension|edge|about|devtools):\/\//.test(url);
}
function compactTab(tab) {
  return {
    id: tab.id,
    title: tab.title || "Untitled",
    url: tab.url || "",
    domain: domainOf(tab.url || ""),
    pinned: !!tab.pinned,
    groupId: tab.groupId
  };
}
function normalizeName(name) {
  return String(name || "未命名分组").replace(/[\n\r\t]/g, " ").trim().slice(0, 60) || "未命名分组";
}
function safeColor(color, index = 0) {
  return COLORS.includes(color) ? color : COLORS[index % COLORS.length];
}

async function getCandidateTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const onlyUngrouped = $("onlyUngrouped").checked;
  const skipPinned = $("skipPinned").checked;
  const compact = tabs.map(compactTab);
  const candidates = [];
  const skipped = [];
  for (const t of compact) {
    if (isSystemUrl(t.url)) { skipped.push({ ...t, skipReason: "system_url" }); continue; }
    if (skipPinned && t.pinned) { skipped.push({ ...t, skipReason: "pinned" }); continue; }
    if (onlyUngrouped && t.groupId !== -1) { skipped.push({ ...t, skipReason: "already_grouped" }); continue; }
    candidates.push(t);
  }
  return { allTabs: compact, candidates, skipped };
}

function keywordScore(tab, rule) {
  const text = `${tab.title} ${tab.url} ${tab.domain}`.toLowerCase();
  let score = 0;
  for (const k of (rule.keywords || [])) {
    const kk = String(k).toLowerCase().trim();
    if (kk && text.includes(kk)) score += 1;
  }
  for (const d of (rule.domains || [])) {
    const dd = String(d).toLowerCase().replace(/^www\./, "").trim();
    if (dd && tab.domain.toLowerCase().endsWith(dd)) score += 3;
  }
  for (const p of (rule.urlPatterns || [])) {
    const pp = String(p).toLowerCase().trim();
    if (pp && tab.url.toLowerCase().includes(pp)) score += 2;
  }
  for (const k of (rule.titleKeywords || [])) {
    const kk = String(k).toLowerCase().trim();
    if (kk && tab.title.toLowerCase().includes(kk)) score += 2;
  }
  return score;
}
function normalizeRules(rules) {
  if (!Array.isArray(rules)) return DEFAULT_RULES;
  return rules
    .map((r, i) => ({
      name: normalizeName(r.name || `自定义规则 ${i + 1}`),
      color: safeColor(r.color, i),
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      domains: Array.isArray(r.domains) ? r.domains : [],
      urlPatterns: Array.isArray(r.urlPatterns) ? r.urlPatterns : [],
      titleKeywords: Array.isArray(r.titleKeywords) ? r.titleKeywords : []
    }))
    .filter(r => r.keywords.length || r.domains.length || r.urlPatterns.length || r.titleKeywords.length);
}
async function loadRuleConfig() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  let rules = DEFAULT_RULES;
  try { rules = normalizeRules(JSON.parse(data.customRules || "[]")); }
  catch { rules = DEFAULT_RULES; }
  return { rules, groupByDomainFallback: data.groupByDomainFallback !== false };
}
function classifyRule(tab, rules, groupByDomainFallback) {
  let best = null;
  for (const r of rules) {
    const score = keywordScore(tab, r);
    if (score > 0 && (!best || score > best.score)) best = { ...r, score };
  }
  if (best) return { name: best.name, color: best.color, reason: `自定义/内置规则命中，score=${best.score}` };
  if (groupByDomainFallback) {
    const d = tab.domain || "其他";
    return { name: d, color: "grey", reason: "未命中规则，按站点域名归类" };
  }
  return { name: "其他 / 未分类", color: "grey", reason: "未命中规则" };
}
async function buildRulePlan(tabs, minSize) {
  const { rules, groupByDomainFallback } = await loadRuleConfig();
  const map = new Map();
  for (const tab of tabs) {
    const c = classifyRule(tab, rules, groupByDomainFallback);
    if (!map.has(c.name)) map.set(c.name, { name: c.name, color: c.color, reason: c.reason, tabIds: [], tabs: [] });
    map.get(c.name).tabIds.push(tab.id);
    map.get(c.name).tabs.push(tab);
  }
  let plan = Array.from(map.values()).filter(g => g.tabs.length >= minSize);
  plan.sort((a, b) => b.tabs.length - a.tabs.length);
  plan.forEach((g, i) => g.color = safeColor(g.color, i));
  return plan;
}

function buildAIPrompt(tabs, minSize, extraPrompt) {
  return [
    "你是一个浏览器标签页语义整理器。请根据 tabs 的 title/url/domain，把它们聚类为少量有意义的主题分组。",
    "要求：",
    `1. 只使用输入里的 tab id，不要创造 tab id。`,
    `2. 每个分组至少包含 ${minSize} 个 tab；无法成组的 tab 可以忽略。`,
    "3. 分组名使用简洁中文，适合 Chrome Tab Group 名称，最多 18 个汉字。",
    "4. 每个 tab 最多出现在一个分组里。",
    "5. color 只能从 blue/cyan/green/yellow/orange/red/pink/purple/grey 中选择。",
    "6. reason 用一句中文解释为什么这些 tab 属于同一组。",
    "7. 严格返回 JSON，不要 Markdown，不要代码块，不要额外解释。",
    "JSON 格式：{\"groups\":[{\"name\":\"...\",\"color\":\"blue\",\"reason\":\"...\",\"tabIds\":[1,2,3]}]}",
    extraPrompt ? `用户附加偏好：${extraPrompt}` : "",
    "Tabs:",
    JSON.stringify(tabs.map(t => ({ id: t.id, title: t.title, url: t.url, domain: t.domain })), null, 2)
  ].filter(Boolean).join("\n");
}
function extractJson(text) {
  const trimmed = (text || "").trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("模型没有返回 JSON 对象");
  return JSON.parse(match[0]);
}
async function callAI(tabs, minSize) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.apiKey) throw new Error("未配置 API Key。请点击 AI 设置后再使用 AI 模式。");
  const prompt = buildAIPrompt(tabs, minSize, settings.extraPrompt || "");
  const res = await fetch(settings.endpoint || DEFAULT_SETTINGS.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_SETTINGS.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "You return strict JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI 请求失败：HTTP ${res.status} ${body.slice(0, 180)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
  return extractJson(text);
}
function validatePlan(raw, candidates, minSize) {
  const tabMap = new Map(candidates.map(t => [t.id, t]));
  const used = new Set();
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  const out = [];
  groups.forEach((g, i) => {
    const tabIds = Array.isArray(g.tabIds) ? g.tabIds : [];
    const uniq = [];
    for (const id of tabIds) {
      const n = Number(id);
      if (!tabMap.has(n) || used.has(n)) continue;
      used.add(n);
      uniq.push(n);
    }
    if (uniq.length >= minSize) {
      out.push({
        name: normalizeName(g.name),
        color: safeColor(g.color, i),
        reason: String(g.reason || "AI 语义聚类").slice(0, 160),
        tabIds: uniq,
        tabs: uniq.map(id => tabMap.get(id))
      });
    }
  });
  out.sort((a, b) => b.tabs.length - a.tabs.length);
  return out;
}

function updateStats(total, used, skipped, groups) {
  $("statTotal").textContent = total;
  $("statUsed").textContent = used;
  $("statSkipped").textContent = skipped;
  $("statGroups").textContent = groups;
}
function renderPlan(plan) {
  const root = $("groups");
  root.innerHTML = "";
  currentPlan = plan;
  $("applyBtn").disabled = plan.length === 0;
  if (!plan.length) {
    root.innerHTML = `<div class="status">没有达到最小成组数量的候选分组。</div>`;
    return;
  }
  plan.forEach((g, idx) => {
    const div = document.createElement("div");
    div.className = "group";
    div.dataset.index = String(idx);
    const options = COLORS.map(c => `<option value="${c}" ${c === g.color ? "selected" : ""}>${c}</option>`).join("");
    const list = g.tabs.map(t => `<li><span class="title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span><br><span class="small">${escapeHtml(t.domain)}</span></li>`).join("");
    div.innerHTML = `
      <div class="ghead">
        <input type="checkbox" class="enabled" checked />
        <input class="gname" value="${escapeAttr(g.name)}" />
        <select class="color">${options}</select>
      </div>
      <div class="reason">${escapeHtml(g.reason || "")}</div>
      <ul>${list}</ul>`;
    root.appendChild(div);
  });
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[ch]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
function collectEditedPlan() {
  const cards = Array.from(document.querySelectorAll(".group"));
  return cards.map(card => {
    const idx = Number(card.dataset.index);
    const g = currentPlan[idx];
    return {
      ...g,
      enabled: card.querySelector(".enabled").checked,
      name: normalizeName(card.querySelector(".gname").value),
      color: safeColor(card.querySelector(".color").value, idx)
    };
  }).filter(g => g.enabled);
}

async function generatePreview() {
  try {
    setStatus("正在读取当前窗口 tabs...");
    $("applyBtn").disabled = true;
    const minSize = Math.max(1, Number($("minSize").value || 2));
    const { allTabs, candidates, skipped } = await getCandidateTabs();
    currentTabs = candidates;
    updateStats(allTabs.length, candidates.length, skipped.length, 0);
    if (!candidates.length) {
      renderPlan([]);
      setStatus("没有可整理的标签页。可取消“只整理未分组 tabs”后再试。", "error");
      return;
    }
    const mode = $("mode").value;
    let plan;
    if (mode === "ai") {
      setStatus("正在调用 AI 生成语义分组计划...");
      const raw = await callAI(candidates, minSize);
      plan = validatePlan(raw, candidates, minSize);
      setStatus(`AI 分组计划已生成：${plan.length} 组。请检查预览后应用。`, "ok");
    } else {
      plan = await buildRulePlan(candidates, minSize);
      setStatus(`规则分组计划已生成：${plan.length} 组。请检查预览后应用。`, "ok");
    }
    updateStats(allTabs.length, candidates.length, skipped.length, plan.length);
    renderPlan(plan);
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  }
}

async function applyGroups() {
  try {
    const plan = collectEditedPlan();
    if (!plan.length) { setStatus("没有选中的分组。", "error"); return; }
    setStatus("正在应用分组...");
    const created = [];
    for (const g of plan) {
      const groupId = await chrome.tabs.group({ tabIds: g.tabIds });
      await chrome.tabGroups.update(groupId, { title: g.name, color: g.color });
      created.push({ groupId, tabIds: g.tabIds, name: g.name });
    }
    await chrome.storage.local.set({ lastAppliedGroups: created, lastAppliedAt: Date.now() });
    setStatus(`已应用 ${created.length} 个分组。`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  }
}

async function undoLast() {
  try {
    const { lastAppliedGroups } = await chrome.storage.local.get({ lastAppliedGroups: [] });
    if (!lastAppliedGroups?.length) { setStatus("没有可撤销的上次分组。", "error"); return; }
    const tabIds = lastAppliedGroups.flatMap(g => g.tabIds || []);
    const existingTabs = await chrome.tabs.query({ currentWindow: true });
    const existingIds = new Set(existingTabs.map(t => t.id));
    const validIds = tabIds.filter(id => existingIds.has(id));
    if (validIds.length) await chrome.tabs.ungroup(validIds);
    await chrome.storage.local.set({ lastAppliedGroups: [] });
    setStatus(`已撤销上次分组，影响 ${validIds.length} 个标签页。`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  }
}

async function ungroupAllCurrentWindow() {
  try {
    setStatus("正在撤销当前窗口所有分组...");
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groupedTabIds = tabs
      .filter(t => t.groupId !== -1)
      .map(t => t.id)
      .filter(id => Number.isInteger(id));

    if (!groupedTabIds.length) {
      setStatus("当前窗口没有已分组的标签页。", "error");
      return;
    }

    await chrome.tabs.ungroup(groupedTabIds);
    await chrome.storage.local.set({ lastAppliedGroups: [] });
    setStatus(`已撤销当前窗口所有分组，影响 ${groupedTabIds.length} 个标签页。`, "ok");

    // Clear stale preview stats because the window state has changed.
    updateStats(tabs.length, 0, 0, 0);
    renderPlan([]);
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  }
}


async function cleanupAllWindowsBeforeUninstall() {
  try {
    const confirmed = window.confirm(
      "Chrome 扩展没有可靠的卸载回调。\n\n" +
      "此操作会先撤销所有 Chrome 窗口中的标签页分组，然后打开扩展管理页，方便你卸载 AI Tab Organizer。\n\n" +
      "是否继续？"
    );
    if (!confirmed) return;

    setStatus("正在清除所有窗口中的标签页分组...");
    const tabs = await chrome.tabs.query({});
    const groupedTabIds = tabs
      .filter(t => t.groupId !== -1)
      .map(t => t.id)
      .filter(id => Number.isInteger(id));

    if (groupedTabIds.length) {
      await chrome.tabs.ungroup(groupedTabIds);
    }
    await chrome.storage.local.set({ lastAppliedGroups: [] });
    updateStats(tabs.length, 0, 0, 0);
    renderPlan([]);

    setStatus(`已清除所有窗口中的分组，影响 ${groupedTabIds.length} 个标签页。已打开扩展管理页，可手动卸载。`, "ok");

    try {
      await chrome.tabs.create({ url: "chrome://extensions/" });
    } catch (e) {
      console.warn("Unable to open chrome://extensions/", e);
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  }
}

$("previewBtn").addEventListener("click", generatePreview);
$("applyBtn").addEventListener("click", applyGroups);
$("undoBtn").addEventListener("click", undoLast);
$("ungroupAllBtn").addEventListener("click", ungroupAllCurrentWindow);
$("cleanupBeforeUninstallBtn").addEventListener("click", cleanupAllWindowsBeforeUninstall);
$("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
setStatus("选择模式后点击“生成分组预览”。");
