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
  groupByDomainFallback: true,
  enablePageSemantics: false,
  pageSnippetChars: 500,
  maxSemanticTabs: 8,
  semanticTimeoutMs: 350,
  semanticCacheTtlMinutes: 30,
  aiRequestTimeoutMs: 20000
};

let currentTabs = [];
let currentPlan = [];
let currentUnassignedTabs = [];
let isLiveMode = false;
let dragTabId = null;

function $(id) { return document.getElementById(id); }
function setStatus(msg, type = "") { const el = $("status"); el.textContent = msg; el.className = `status ${type}`; }
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function isSystemUrl(url = "") { return /^(chrome|chrome-extension|edge|about|devtools):\/\//.test(url); }
function canInjectIntoTab(tab) { const url = tab?.url || ""; return /^(https?|file):\/\//.test(url) && !isSystemUrl(url); }
function normalizeName(name) { return String(name || "未命名分组").replace(/[\n\r\t]/g, " ").trim().slice(0, 60) || "未命名分组"; }
function safeColor(color, index = 0) { return COLORS.includes(color) ? color : COLORS[index % COLORS.length]; }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[ch])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

function compactTab(tab) {
  return {
    id: tab.id,
    title: tab.title || "Untitled",
    url: tab.url || "",
    domain: domainOf(tab.url || ""),
    pinned: !!tab.pinned,
    groupId: tab.groupId,
    windowId: tab.windowId,
    index: tab.index,
    metaDescription: "",
    headings: [],
    pageSnippet: "",
    semanticStatus: "not_collected",
    active: !!tab.active
  };
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

function pageSemanticExtractor(maxChars) {
  function textOf(el) { return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim(); }
  function meta(name) {
    return document.querySelector(`meta[name="${name}"]`)?.content ||
      document.querySelector(`meta[property="${name}"]`)?.content || "";
  }
  const metaDescription = meta("description") || meta("og:description") || meta("twitter:description");
  const headings = Array.from(document.querySelectorAll("h1,h2")).map(h => textOf(h)).filter(Boolean).slice(0, 10);
  const candidates = [document.querySelector("article"), document.querySelector("main"), document.querySelector('[role="main"]'), document.body].filter(Boolean);
  let mainText = "";
  for (const c of candidates) { const t = textOf(c); if (t.length > mainText.length) mainText = t; }
  return { metaDescription: metaDescription.slice(0, 500), headings, pageSnippet: mainText.slice(0, Math.max(200, Number(maxChars) || 500)), semanticStatus: "ok" };
}
function withTimeout(promise, timeoutMs, fallback) {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, timeoutMs);
    promise.then(value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } })
      .catch(err => { if (!done) { done = true; clearTimeout(timer); resolve({ __error: err?.message || String(err) }); } });
  });
}
async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await worker(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}
function cacheKeyForTab(tab) { return `${tab.url || ""}::${tab.title || ""}`.slice(0, 700); }
async function collectPageSemantics(tabs) {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (data.enablePageSemantics !== true) {
    return { tabs: tabs.map(t => ({ ...t, semanticStatus: "disabled_fast_path" })), okCount: 0, failCount: 0, skippedCount: tabs.length, cachedCount: 0, deferredCount: 0, enabled: false };
  }
  const maxChars = Math.max(200, Math.min(1200, Number(data.pageSnippetChars || 500)));
  const maxSemanticTabs = Math.max(0, Math.min(50, Number(data.maxSemanticTabs || 8)));
  const timeoutMs = Math.max(150, Math.min(2000, Number(data.semanticTimeoutMs || 350)));
  const ttlMs = Math.max(1, Number(data.semanticCacheTtlMinutes || 30)) * 60 * 1000;
  const now = Date.now();
  const cacheObj = await chrome.storage.local.get({ pageSemanticCacheV1: {} });
  const cache = cacheObj.pageSemanticCacheV1 || {};
  let okCount = 0, failCount = 0, skippedCount = 0, cachedCount = 0, deferredCount = 0;
  const enriched = tabs.map(tab => ({ ...tab }));
  const toCollect = [];
  for (let i = 0; i < enriched.length; i++) {
    const tab = enriched[i];
    if (!canInjectIntoTab(tab)) { enriched[i] = { ...tab, semanticStatus: "skipped" }; skippedCount++; continue; }
    const key = cacheKeyForTab(tab);
    const cached = cache[key];
    if (cached && now - cached.ts < ttlMs) { enriched[i] = { ...tab, ...cached.snapshot, semanticStatus: "cached" }; cachedCount++; continue; }
    toCollect.push({ tab, index: i, key });
  }
  toCollect.sort((a, b) => a.tab.active !== b.tab.active ? (a.tab.active ? -1 : 1) : (a.tab.title || "").length - (b.tab.title || "").length);
  const selected = toCollect.slice(0, maxSemanticTabs);
  const deferred = toCollect.slice(maxSemanticTabs);
  for (const item of deferred) { enriched[item.index] = { ...item.tab, semanticStatus: "deferred_fast_path" }; deferredCount++; }
  const changedCache = { ...cache };
  await runLimited(selected, 6, async ({ tab, index, key }) => {
    const result = await withTimeout(chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageSemanticExtractor, args: [maxChars] }), timeoutMs, { __timeout: true });
    if (result?.__timeout) { enriched[index] = { ...tab, semanticStatus: "timeout_fast_path" }; failCount++; return; }
    if (result?.__error) { enriched[index] = { ...tab, semanticStatus: "failed" }; failCount++; return; }
    const snapshot = result?.[0]?.result || {};
    const clean = { metaDescription: snapshot.metaDescription || "", headings: Array.isArray(snapshot.headings) ? snapshot.headings.slice(0, 6) : [], pageSnippet: snapshot.pageSnippet || "" };
    enriched[index] = { ...tab, ...clean, semanticStatus: "ok" };
    changedCache[key] = { ts: now, snapshot: clean };
    okCount++;
  });
  const entries = Object.entries(changedCache).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0)).slice(0, 300);
  await chrome.storage.local.set({ pageSemanticCacheV1: Object.fromEntries(entries) });
  return { tabs: enriched, okCount, failCount, skippedCount, cachedCount, deferredCount, enabled: true };
}

function keywordScore(tab, rule) {
  const text = `${tab.title} ${tab.url} ${tab.domain} ${tab.metaDescription || ""} ${(tab.headings || []).join(" ")} ${tab.pageSnippet || ""}`.toLowerCase();
  let score = 0;
  for (const k of (rule.keywords || [])) { const kk = String(k).toLowerCase().trim(); if (kk && text.includes(kk)) score += 1; }
  for (const d of (rule.domains || [])) { const dd = String(d).toLowerCase().replace(/^www\./, "").trim(); if (dd && tab.domain.toLowerCase().endsWith(dd)) score += 3; }
  for (const p of (rule.urlPatterns || [])) { const pp = String(p).toLowerCase().trim(); if (pp && tab.url.toLowerCase().includes(pp)) score += 2; }
  for (const k of (rule.titleKeywords || [])) { const kk = String(k).toLowerCase().trim(); if (kk && tab.title.toLowerCase().includes(kk)) score += 2; }
  return score;
}
function normalizeRules(rules) {
  if (!Array.isArray(rules)) return DEFAULT_RULES;
  return rules.map((r, i) => ({ name: normalizeName(r.name || `自定义规则 ${i + 1}`), color: safeColor(r.color, i), keywords: Array.isArray(r.keywords) ? r.keywords : [], domains: Array.isArray(r.domains) ? r.domains : [], urlPatterns: Array.isArray(r.urlPatterns) ? r.urlPatterns : [], titleKeywords: Array.isArray(r.titleKeywords) ? r.titleKeywords : [] }))
    .filter(r => r.keywords.length || r.domains.length || r.urlPatterns.length || r.titleKeywords.length);
}
async function loadRuleConfig() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  let rules = DEFAULT_RULES;
  try { rules = normalizeRules(JSON.parse(data.customRules || "[]")); } catch { rules = DEFAULT_RULES; }
  return { rules, groupByDomainFallback: data.groupByDomainFallback !== false };
}
function classifyRule(tab, rules, groupByDomainFallback) {
  let best = null;
  for (const r of rules) { const score = keywordScore(tab, r); if (score > 0 && (!best || score > best.score)) best = { ...r, score }; }
  if (best) return { name: best.name, color: best.color, reason: `自定义/内置规则命中，score=${best.score}` };
  if (groupByDomainFallback) return { name: tab.domain || "其他", color: "grey", reason: "未命中规则，按站点域名归类" };
  return { name: "其他 / 未分类", color: "grey", reason: "未命中规则" };
}
async function buildRulePlan(tabs, minSize) {
  const { rules, groupByDomainFallback } = await loadRuleConfig();
  const map = new Map();
  for (const tab of tabs) {
    const c = classifyRule(tab, rules, groupByDomainFallback);
    if (!map.has(c.name)) map.set(c.name, { name: c.name, color: c.color, reason: c.reason, tabIds: [], tabs: [] });
    map.get(c.name).tabIds.push(tab.id); map.get(c.name).tabs.push(tab);
  }
  const plan = Array.from(map.values()).filter(g => g.tabs.length >= minSize).sort((a, b) => b.tabs.length - a.tabs.length);
  plan.forEach((g, i) => g.color = safeColor(g.color, i));
  return plan;
}

function isDeepSeekSettings(settings) { const e = String(settings.endpoint || "").toLowerCase(); const m = String(settings.model || "").toLowerCase(); return e.includes("deepseek") || m.startsWith("deepseek"); }
function computeAdaptiveAITimeoutMs(tabCount, settings) {
  const n = Math.max(1, Number(tabCount) || 1);
  const configured = Number(settings.aiRequestTimeoutMs || DEFAULT_SETTINGS.aiRequestTimeoutMs || 20000);
  const maxTimeout = Math.max(8000, Math.min(30000, configured <= 4500 ? 20000 : configured));
  return Math.max(6000, Math.min(maxTimeout, 6000 + n * 180));
}
function buildAIPrompt(tabs, minSize, extraPrompt) {
  return [
    "你是一个浏览器标签页语义整理器。请根据 tabs 的 title/url/domain/metaDescription/headings/pageSnippet，把它们聚类为少量有意义的主题分组。",
    "你必须返回一个合法 JSON 对象，且只能返回 JSON。",
    `每个分组至少包含 ${minSize} 个 tab；无法成组的 tab 可以忽略。`,
    "分组名使用简洁中文，最多 18 个汉字。每个 tab 最多出现在一个分组里。",
    "color 只能从 blue/cyan/green/yellow/orange/red/pink/purple/grey 中选择。",
    "严格返回 JSON 对象，不要 Markdown，不要代码块，不要额外解释，不要 <think>，不要返回数组。",
    "JSON 格式示例：{\"groups\":[{\"name\":\"浏览器 AI 调研\",\"color\":\"blue\",\"reason\":\"这些标签都在研究浏览器 AI 功能\",\"tabIds\":[1,2,3]}]}",
    extraPrompt ? `用户附加偏好：${extraPrompt}` : "",
    "Tabs:",
    JSON.stringify(tabs.map(t => ({ id: t.id, title: String(t.title || "").slice(0, 120), url: String(t.url || "").slice(0, 180), domain: t.domain, metaDescription: String(t.metaDescription || "").slice(0, 160), headings: (t.headings || []).slice(0, 5), pageSnippet: String(t.pageSnippet || "").slice(0, 280) })), null, 2)
  ].filter(Boolean).join("\n");
}
function cleanJsonText(text) {
  let s = String(text || "").trim();
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstObj = s.indexOf("{"); const lastObj = s.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) s = s.slice(firstObj, lastObj + 1);
  else { const firstArr = s.indexOf("["); const lastArr = s.lastIndexOf("]"); if (firstArr >= 0 && lastArr > firstArr) s = s.slice(firstArr, lastArr + 1); }
  return s.replace(/,\s*([}\]])/g, "$1");
}
function extractJson(text, meta = {}) {
  const jsonText = cleanJsonText(text);
  if (!jsonText) throw new Error(`模型返回内容为空${meta.finishReason ? `；finish_reason=${meta.finishReason}` : ""}`);
  if (!jsonText.startsWith("{") && !jsonText.startsWith("[")) throw new Error(`模型没有返回 JSON 对象。原始返回片段：${String(text || "").replace(/\s+/g, " ").slice(0, 260) || "<empty>"}`);
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed) ? { groups: parsed } : parsed;
}
function buildAIRequestBody(settings, prompt, retry = false) {
  const body = { model: settings.model || DEFAULT_SETTINGS.model, temperature: 0.1, max_tokens: 2200, messages: [ { role: "system", content: "Return strict JSON only. The response must be a valid json object with a top-level groups array." }, { role: "user", content: retry ? `${prompt}\n\n再次强调：只输出一个合法 JSON 对象，必须以 { 开头，以 } 结尾。不要解释。` : prompt } ] };
  if (isDeepSeekSettings(settings)) { body.response_format = { type: "json_object" }; body.thinking = { type: "disabled" }; }
  return body;
}
function extractAIText(data) {
  const choice = data?.choices?.[0]; const msg = choice?.message || {};
  let content = msg.content ?? choice?.text ?? "";
  if (Array.isArray(content)) content = content.map(part => typeof part === "string" ? part : (part?.text || part?.content || "")).join("\n");
  if (!content && Array.isArray(msg.tool_calls) && msg.tool_calls.length) content = msg.tool_calls.map(t => t?.function?.arguments || "").filter(Boolean).join("\n");
  return { text: String(content || ""), finishReason: choice?.finish_reason || "" };
}
async function postAI(settings, prompt, signal, retry = false) {
  const res = await fetch(settings.endpoint || DEFAULT_SETTINGS.endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` }, signal, body: JSON.stringify(buildAIRequestBody(settings, prompt, retry)) });
  if (!res.ok) { const body = await res.text().catch(() => ""); throw new Error(`AI 请求失败：HTTP ${res.status} ${body.slice(0, 260)}`); }
  return res.json();
}
async function callAI(tabs, minSize) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.apiKey) throw new Error("未配置 API Key。请点击 AI 设置后再使用 AI 模式。");
  const prompt = buildAIPrompt(tabs, minSize, settings.extraPrompt || "");
  const timeoutMs = computeAdaptiveAITimeoutMs(tabs.length, settings);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const data = await postAI(settings, prompt, controller.signal, attempt > 0);
      const { text, finishReason } = extractAIText(data);
      try { return extractJson(text, { finishReason }); } catch (parseErr) { lastErr = parseErr; if (attempt === 0) continue; throw parseErr; }
    } catch (err) {
      lastErr = err?.name === "AbortError" ? new Error(`AI 请求超过 ${timeoutMs}ms，已中止。可使用规则模式或更快模型。`) : err;
      if (attempt === 0 && isDeepSeekSettings(settings)) continue;
      throw lastErr;
    } finally { clearTimeout(timer); }
  }
  throw lastErr || new Error("AI 请求失败。");
}
function validatePlan(raw, candidates, minSize) {
  const tabMap = new Map(candidates.map(t => [t.id, t])); const used = new Set(); const out = [];
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  groups.forEach((g, i) => {
    const ids = Array.isArray(g.tabIds) ? g.tabIds : [];
    const uniq = [];
    for (const id of ids) { const n = Number(id); if (!tabMap.has(n) || used.has(n)) continue; used.add(n); uniq.push(n); }
    if (uniq.length >= minSize) out.push({ name: normalizeName(g.name), color: safeColor(g.color, i), reason: String(g.reason || "AI 语义聚类").slice(0, 160), tabIds: uniq, tabs: uniq.map(id => tabMap.get(id)) });
  });
  out.sort((a, b) => b.tabs.length - a.tabs.length); return out;
}
function chunkArray(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
function mergePlans(plans, minSize) {
  const map = new Map(); const used = new Set();
  for (const plan of plans) for (const g of plan || []) {
    const key = normalizeName(g.name).replace(/\s+/g, "").toLowerCase();
    if (!map.has(key)) map.set(key, { name: normalizeName(g.name), color: safeColor(g.color, map.size), reason: g.reason || "AI 分批语义聚类", tabIds: [], tabs: [] });
    const target = map.get(key);
    for (const t of g.tabs || []) { if (!t || used.has(t.id)) continue; used.add(t.id); target.tabIds.push(t.id); target.tabs.push(t); }
  }
  const out = Array.from(map.values()).filter(g => g.tabs.length >= minSize).sort((a, b) => b.tabs.length - a.tabs.length); out.forEach((g, i) => g.color = safeColor(g.color, i)); return out;
}
async function buildAIBatchedPlan(tabs, minSize) {
  const MAX = 50;
  if (tabs.length <= MAX) { const raw = await callAI(tabs, minSize); return validatePlan(raw, tabs, minSize); }
  const useBatchAI = window.confirm(`当前可整理标签页有 ${tabs.length} 个，超过 50 个。\n\n选择“确定”：使用 AI 分批整理全部标签页，可能需要更长时间。\n选择“取消”：进入大窗口快速模式，使用规则模式整理全部标签页。`);
  if (!useBatchAI) return { plan: await buildRulePlan(tabs, minSize), modeUsed: "rule_large_window", batches: 0 };
  const batches = chunkArray(tabs, MAX); const plans = [];
  for (let i = 0; i < batches.length; i++) { const settings = await chrome.storage.local.get(DEFAULT_SETTINGS); setStatus(`大窗口 AI 分批处理中：第 ${i + 1}/${batches.length} 批，当前批 ${batches[i].length} 个 tabs，自适应超时 ${computeAdaptiveAITimeoutMs(batches[i].length, settings)}ms...`); const raw = await callAI(batches[i], minSize); plans.push(validatePlan(raw, batches[i], minSize)); }
  return { plan: mergePlans(plans, minSize), modeUsed: "ai_batched", batches: batches.length };
}

function updateStats(total, used, skipped, groups) { $("statTotal").textContent = total; $("statUsed").textContent = used; $("statSkipped").textContent = skipped; $("statGroups").textContent = groups; }
function assignedTabIds(plan = currentPlan) { return new Set(plan.flatMap(g => (g.tabs || []).map(t => t.id))); }
function computeUnassigned(allTabs, plan) { const used = assignedTabIds(plan); return allTabs.filter(t => !used.has(t.id)); }
function syncPlanFromDom() {
  for (const card of document.querySelectorAll('.group[data-index]')) {
    const idx = Number(card.dataset.index); const g = currentPlan[idx]; if (!g) continue;
    const nameInput = card.querySelector('.gname'); const colorSelect = card.querySelector('.color'); const enabled = card.querySelector('.enabled');
    if (nameInput) g.name = normalizeName(nameInput.value); if (colorSelect) g.color = safeColor(colorSelect.value, idx); if (enabled) g.enabled = enabled.checked;
  }
}
function allMoveTargets() {
  return [
    ...currentPlan.map((g, idx) => ({ value: `group:${idx}`, label: g.name || `分组 ${idx + 1}` })),
    { value: 'unclassified', label: '未分类 / 拖出分组' }
  ];
}
function renderPlan(plan, unassigned = currentUnassignedTabs) {
  const root = $("groups"); root.innerHTML = ""; currentPlan = plan; currentUnassignedTabs = unassigned; $("applyBtn").disabled = plan.length === 0 || isLiveMode;
  if (!plan.length && !unassigned.length) { root.innerHTML = `<div class="status">没有可显示的分组或未分类页签。</div>`; return; }
  plan.forEach((g, idx) => root.appendChild(renderGroupCard(g, idx, false)));
  root.appendChild(renderGroupCard({ name: "未分类 / 待调整", color: "grey", reason: isLiveMode ? "当前窗口中未加入任何 Tab Group 的标签页。可拖入上方分组。" : "AI/规则未纳入分组的标签页。可拖入上方分组，或保持未分类。", tabs: unassigned, tabIds: unassigned.map(t => t.id) }, 'unclassified', true));
  attachDnDHandlers();
}
function renderGroupCard(g, idx, unclassified) {
  const div = document.createElement('div'); div.className = `group ${unclassified ? 'unclassified' : ''} ${isLiveMode ? 'live' : ''}`; div.dataset.index = String(idx);
  const options = COLORS.map(c => `<option value="${c}" ${c === g.color ? 'selected' : ''}>${c}</option>`).join('');
  const movableOptions = allMoveTargets().map(t => `<option value="${escapeAttr(t.value)}">${escapeHtml(t.label)}</option>`).join('');
  const list = (g.tabs || []).map(t => `<li class="tab-item" draggable="true" data-tab-id="${t.id}">
    <div class="title-wrap"><span class="title" title="${escapeAttr(t.title)}">${escapeHtml(t.title)}</span><span class="small">${escapeHtml(t.domain)}${t.semanticStatus === 'ok' ? ' · 已读取页面语义' : ''}</span></div>
    <button class="move-btn" title="移动到其他分组">↪</button>
    <select class="move-select" style="display:none">${movableOptions}</select>
  </li>`).join('') || `<li class="empty-drop">拖入页签到这里</li>`;
  div.innerHTML = unclassified ? `
    <div class="ghead"><span class="badge">未分组</span><input class="gname" value="${escapeAttr(g.name)}" disabled /><span class="small">${(g.tabs || []).length} 个</span></div>
    <div class="reason">${escapeHtml(g.reason || '')}</div><ul class="tab-list" data-target="unclassified">${list}</ul>` : `
    <div class="ghead"><input type="checkbox" class="enabled" ${g.enabled === false ? '' : 'checked'} ${isLiveMode ? 'disabled' : ''}/><input class="gname" value="${escapeAttr(g.name)}" ${isLiveMode ? 'disabled' : ''}/><select class="color" ${isLiveMode ? 'disabled' : ''}>${options}</select><span class="small">${(g.tabs || []).length} 个</span></div>
    <div class="reason">${escapeHtml(g.reason || '')}</div><ul class="tab-list" data-target="group:${idx}">${list}</ul>`;
  return div;
}
function attachDnDHandlers() {
  document.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', () => { document.querySelectorAll('.tab-item.selected').forEach(x => x.classList.remove('selected')); item.classList.add('selected'); });
    item.addEventListener('dragstart', e => { dragTabId = Number(item.dataset.tabId); e.dataTransfer.setData('text/plain', String(dragTabId)); e.dataTransfer.effectAllowed = 'move'; });
    const btn = item.querySelector('.move-btn'); const select = item.querySelector('.move-select');
    btn?.addEventListener('click', e => { e.stopPropagation(); document.querySelectorAll('.move-select').forEach(s => { if (s !== select) s.style.display = 'none'; }); select.style.display = select.style.display === 'none' ? 'inline-block' : 'none'; });
    select?.addEventListener('change', async e => { const target = e.target.value; e.target.style.display = 'none'; await moveTabTo(Number(item.dataset.tabId), target); });
  });
  document.querySelectorAll('.tab-list').forEach(list => {
    list.addEventListener('dragover', e => { e.preventDefault(); list.classList.add('drag-over'); });
    list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
    list.addEventListener('drop', async e => { e.preventDefault(); list.classList.remove('drag-over'); const id = Number(e.dataTransfer.getData('text/plain') || dragTabId); if (id) await moveTabTo(id, list.dataset.target); });
  });
}
function removeTabFromState(tabId) {
  let tab = null;
  currentUnassignedTabs = currentUnassignedTabs.filter(t => { if (t.id === tabId) { tab = t; return false; } return true; });
  for (const g of currentPlan) {
    g.tabs = (g.tabs || []).filter(t => { if (t.id === tabId) { tab = t; return false; } return true; });
    g.tabIds = g.tabs.map(t => t.id);
  }
  return tab || currentTabs.find(t => t.id === tabId) || null;
}
async function moveTabTo(tabId, target) {
  syncPlanFromDom();
  const tab = removeTabFromState(tabId); if (!tab) return;
  if (isLiveMode) {
    try {
      if (target === 'unclassified') await chrome.tabs.ungroup(tabId);
      else {
        const idx = Number(String(target).split(':')[1]); const group = currentPlan[idx];
        if (group?.groupId !== undefined) await chrome.tabs.group({ tabIds: [tabId], groupId: group.groupId });
      }
      await syncCurrentGroups(false);
      setStatus('已同步 Chrome 分组调整。', 'ok');
      return;
    } catch (err) { setStatus(err.message || String(err), 'error'); return; }
  }
  if (target === 'unclassified') currentUnassignedTabs.push(tab);
  else {
    const idx = Number(String(target).split(':')[1]); if (currentPlan[idx]) { currentPlan[idx].tabs.push(tab); currentPlan[idx].tabIds = currentPlan[idx].tabs.map(t => t.id); }
    else currentUnassignedTabs.push(tab);
  }
  renderPlan(currentPlan, currentUnassignedTabs);
  setStatus('已调整预览。点击“应用分组”后生效。', 'ok');
}
function collectEditedPlan() { syncPlanFromDom(); return currentPlan.filter(g => g.enabled !== false && (g.tabs || []).length > 0).map((g, i) => ({ ...g, name: normalizeName(g.name), color: safeColor(g.color, i), tabIds: (g.tabs || []).map(t => t.id) })); }

async function generatePreview() {
  try {
    isLiveMode = false; setStatus('正在读取当前窗口 tabs...'); $("applyBtn").disabled = true;
    const minSize = Math.max(1, Number($("minSize").value || 2));
    const { allTabs, candidates, skipped } = await getCandidateTabs(); currentTabs = candidates; updateStats(allTabs.length, candidates.length, skipped.length, 0);
    if (!candidates.length) { renderPlan([], []); setStatus('没有可整理的标签页。可取消“只整理未分组 tabs”后再试。', 'error'); return; }
    const semanticResult = await collectPageSemantics(candidates); const enriched = semanticResult.tabs; currentTabs = enriched;
    const semanticMsg = semanticResult.enabled ? `页面语义：成功 ${semanticResult.okCount}，缓存 ${semanticResult.cachedCount || 0}，失败 ${semanticResult.failCount}，延后 ${semanticResult.deferredCount || 0}。` : '快速路径：页面语义增强未阻塞。';
    const mode = $("mode").value; let plan;
    if (mode === 'ai') {
      const settings = await chrome.storage.local.get(DEFAULT_SETTINGS); setStatus(`${semanticMsg} 正在调用 AI... 本批自适应超时 ${computeAdaptiveAITimeoutMs(Math.min(enriched.length, 50), settings)}ms。`);
      const aiResult = await buildAIBatchedPlan(enriched, minSize);
      if (Array.isArray(aiResult)) { plan = aiResult; setStatus(`AI 分组计划已生成：${plan.length} 组。可拖拽微调后应用。`, 'ok'); }
      else { plan = aiResult.plan; setStatus(aiResult.modeUsed === 'ai_batched' ? `AI 分批计划已生成：${plan.length} 组，共 ${aiResult.batches} 批。可拖拽微调后应用。` : `大窗口快速模式已生成：${plan.length} 组。可拖拽微调后应用。`, 'ok'); }
    } else { plan = await buildRulePlan(enriched, minSize); setStatus(`规则分组计划已生成：${plan.length} 组。可拖拽微调后应用。`, 'ok'); }
    currentUnassignedTabs = computeUnassigned(enriched, plan); updateStats(allTabs.length, candidates.length, skipped.length, plan.length); renderPlan(plan, currentUnassignedTabs);
  } catch (err) { console.error(err); setStatus(err.message || String(err), 'error'); }
}
async function applyGroups() {
  try {
    const plan = collectEditedPlan(); if (!plan.length) { setStatus('没有选中的分组。', 'error'); return; }
    setStatus('正在应用分组...'); const created = [];
    for (const g of plan) { const groupId = await chrome.tabs.group({ tabIds: g.tabIds }); await chrome.tabGroups.update(groupId, { title: g.name, color: g.color }); created.push({ groupId, tabIds: g.tabIds, name: g.name, color: g.color }); }
    await chrome.storage.local.set({ lastAppliedGroups: created, lastAppliedAt: Date.now() });
    isLiveMode = true; await syncCurrentGroups(false); setStatus(`已应用 ${created.length} 个分组。现在可继续在插件里拖拽调整，或在 Chrome 标签栏调整后点“同步当前分组”。`, 'ok');
  } catch (err) { console.error(err); setStatus(err.message || String(err), 'error'); }
}
async function syncCurrentGroups(showMessage = true) {
  const tabs = (await chrome.tabs.query({ currentWindow: true })).map(compactTab).filter(t => !isSystemUrl(t.url) && (!$("skipPinned").checked || !t.pinned));
  const grouped = tabs.filter(t => t.groupId !== -1); const ungrouped = tabs.filter(t => t.groupId === -1);
  const ids = [...new Set(grouped.map(t => t.groupId))]; const groupInfos = new Map();
  for (const id of ids) { try { const info = await chrome.tabGroups.get(id); groupInfos.set(id, info); } catch {} }
  const map = new Map();
  for (const t of grouped) {
    if (!map.has(t.groupId)) { const info = groupInfos.get(t.groupId); map.set(t.groupId, { groupId: t.groupId, name: info?.title || `分组 ${t.groupId}`, color: safeColor(info?.color || 'grey'), reason: '来自当前 Chrome Tab Groups。', tabIds: [], tabs: [], enabled: true }); }
    const g = map.get(t.groupId); g.tabs.push(t); g.tabIds.push(t.id);
  }
  currentTabs = tabs; currentPlan = Array.from(map.values()).sort((a,b)=>b.tabs.length-a.tabs.length); currentUnassignedTabs = ungrouped; isLiveMode = true; updateStats(tabs.length, grouped.length, ungrouped.length, currentPlan.length); renderPlan(currentPlan, currentUnassignedTabs); if (showMessage) setStatus('已同步当前窗口 Chrome 分组。可继续拖拽调整。', 'ok');
}
async function undoLast() {
  try { const { lastAppliedGroups } = await chrome.storage.local.get({ lastAppliedGroups: [] }); if (!lastAppliedGroups?.length) { setStatus('没有可撤销的上次分组。', 'error'); return; } const ids = lastAppliedGroups.flatMap(g => g.tabIds || []); const existing = new Set((await chrome.tabs.query({ currentWindow: true })).map(t => t.id)); const valid = ids.filter(id => existing.has(id)); if (valid.length) await chrome.tabs.ungroup(valid); await chrome.storage.local.set({ lastAppliedGroups: [] }); isLiveMode = false; renderPlan([], []); setStatus(`已撤销上次分组，影响 ${valid.length} 个标签页。`, 'ok'); } catch (err) { setStatus(err.message || String(err), 'error'); }
}
async function ungroupAllCurrentWindow() {
  try { const tabs = await chrome.tabs.query({ currentWindow: true }); const ids = tabs.filter(t => t.groupId !== -1).map(t => t.id).filter(Number.isInteger); if (!ids.length) { setStatus('当前窗口没有已分组的标签页。', 'error'); return; } await chrome.tabs.ungroup(ids); await chrome.storage.local.set({ lastAppliedGroups: [] }); isLiveMode = false; updateStats(tabs.length, 0, 0, 0); renderPlan([], []); setStatus(`已清除当前窗口分组，影响 ${ids.length} 个标签页。`, 'ok'); } catch (err) { setStatus(err.message || String(err), 'error'); }
}
async function cleanupAllWindowsBeforeUninstall() {
  try { if (!window.confirm('此操作会先撤销所有 Chrome 窗口中的标签页分组，然后打开扩展管理页，方便你卸载 AI Tab Organizer。\n\n是否继续？')) return; const tabs = await chrome.tabs.query({}); const ids = tabs.filter(t => t.groupId !== -1).map(t => t.id).filter(Number.isInteger); if (ids.length) await chrome.tabs.ungroup(ids); await chrome.storage.local.set({ lastAppliedGroups: [] }); renderPlan([], []); setStatus(`已清除所有窗口中的分组，影响 ${ids.length} 个标签页。已打开扩展管理页。`, 'ok'); await chrome.tabs.create({ url: 'chrome://extensions/' }); } catch (err) { setStatus(err.message || String(err), 'error'); }
}

$("previewBtn").addEventListener("click", generatePreview);
$("applyBtn").addEventListener("click", applyGroups);
$("syncBtn").addEventListener("click", () => syncCurrentGroups(true));
$("undoBtn").addEventListener("click", undoLast);
$("ungroupAllBtn").addEventListener("click", ungroupAllCurrentWindow);
$("cleanupBeforeUninstallBtn").addEventListener("click", cleanupAllWindowsBeforeUninstall);
$("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
setStatus('默认 AI 语义模式。生成预览后可拖拽页签微调；应用后可继续拖拽同步 Chrome 分组。');
