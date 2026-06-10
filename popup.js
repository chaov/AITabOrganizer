let latestPlan = null;
let latestStats = null;

const GROUP_COLORS = ["blue", "green", "yellow", "purple", "cyan", "pink", "orange", "grey"];

const CATEGORY_RULES = [
  {
    name: "AI / 技术研究",
    keywords: ["ai", "agent", "llm", "openai", "anthropic", "claude", "gemini", "github", "arxiv", "paper", "docs", "developer", "chromium", "chrome", "webkit", "safari", "v8", "runtime", "kernel", "benchmark", "wwdc", "mcp", "extension"]
  },
  {
    name: "工作 / 协作",
    keywords: ["mail", "gmail", "calendar", "drive", "docs.google", "notion", "slack", "teams", "jira", "confluence", "figma", "zoom", "meet", "office", "sharepoint"]
  },
  {
    name: "购物 / 商品",
    keywords: ["amazon", "ebay", "taobao", "tmall", "jd.com", "shopping", "cart", "product", "price", "deal", "bestbuy", "target", "walmart", "coupon"]
  },
  {
    name: "新闻 / 资讯",
    keywords: ["news", "nytimes", "bbc", "cnn", "reuters", "bloomberg", "theverge", "36kr", "newsroom", "medium", "substack", "hacker news", "hn", "techcrunch"]
  },
  {
    name: "旅行 / 地图",
    keywords: ["travel", "hotel", "flight", "booking", "airbnb", "maps", "trip", "uber", "lyft", "ctrip", "expedia", "visa", "itinerary"]
  },
  {
    name: "视频 / 娱乐",
    keywords: ["youtube", "netflix", "bilibili", "video", "music", "spotify", "podcast", "twitch", "douyin", "tiktok"]
  },
  {
    name: "金融 / 数据",
    keywords: ["stock", "finance", "market", "tradingview", "nasdaq", "sec.gov", "earnings", "crypto", "bitcoin", "ethereum", "fund"]
  }
];

function normalize(text) {
  return (text || "").toLowerCase();
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return "unknown";
  }
}

function shouldSkipTab(tab, options) {
  if (options.skipPinned && tab.pinned) return "pinned";
  if (options.onlyUngrouped && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return "already_grouped";
  const url = tab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://") || url.startsWith("about:")) return "internal";
  return null;
}

function classifyTab(tab) {
  const domain = getDomain(tab.url);
  const text = normalize(`${tab.title || ""} ${tab.url || ""} ${domain}`);

  let best = { name: null, score: 0, hits: [] };
  for (const rule of CATEGORY_RULES) {
    let score = 0;
    const hits = [];
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        score += kw.length > 6 ? 2 : 1;
        hits.push(kw);
      }
    }
    if (score > best.score) best = { name: rule.name, score, hits };
  }

  if (best.score > 0) {
    return { name: best.name, reason: `命中关键词：${best.hits.slice(0, 4).join(" / ")}` };
  }

  return { name: `站点：${domain}`, reason: "未命中主题规则，按站点临时聚合" };
}

function compactGroups(groups, minGroupSize) {
  const result = {};
  const reasons = {};
  const fallback = "其他 / 稍后整理";

  for (const [name, group] of Object.entries(groups)) {
    if (name.startsWith("站点：") && group.tabs.length < minGroupSize) {
      result[fallback] = result[fallback] || [];
      reasons[fallback] = reasons[fallback] || "未达到最小成组数量，合并到稍后整理";
      result[fallback].push(...group.tabs);
    } else {
      result[name] = result[name] || [];
      reasons[name] = group.reason;
      result[name].push(...group.tabs);
    }
  }

  return { result, reasons };
}

function getOptions() {
  return {
    skipPinned: document.getElementById("skipPinned").checked,
    onlyUngrouped: document.getElementById("onlyUngrouped").checked,
    minGroupSize: Number(document.getElementById("minGroupSize").value || 2)
  };
}

async function buildPlan() {
  const options = getOptions();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = {};
  const skipped = { pinned: 0, internal: 0, already_grouped: 0 };
  let considered = 0;

  for (const tab of tabs) {
    const skipReason = shouldSkipTab(tab, options);
    if (skipReason) {
      skipped[skipReason] = (skipped[skipReason] || 0) + 1;
      continue;
    }
    considered += 1;
    const category = classifyTab(tab);
    groups[category.name] = groups[category.name] || { tabs: [], reason: category.reason };
    groups[category.name].tabs.push({
      id: tab.id,
      title: tab.title || tab.url,
      url: tab.url,
      domain: getDomain(tab.url),
      originalGroupId: tab.groupId
    });
  }

  const { result, reasons } = compactGroups(groups, options.minGroupSize);
  const plan = Object.entries(result)
    .filter(([, tabs]) => tabs.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, tabs], index) => ({
      id: `g_${index}_${Date.now()}`,
      name,
      tabs,
      color: GROUP_COLORS[index % GROUP_COLORS.length],
      enabled: true,
      reason: reasons[name] || "基于标题、URL、域名归类"
    }));

  latestStats = { total: tabs.length, considered, skipped, groups: plan.length };
  return plan;
}

function renderStats(stats) {
  const el = document.getElementById("stats");
  if (!stats) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = `当前窗口 ${stats.total} 个标签页；纳入整理 ${stats.considered} 个；生成 ${stats.groups} 个候选分组；跳过：固定 ${stats.skipped.pinned || 0}，已分组 ${stats.skipped.already_grouped || 0}，内部页 ${stats.skipped.internal || 0}。`;
}

function renderPlan(plan) {
  const preview = document.getElementById("preview");
  preview.innerHTML = "";
  renderStats(latestStats);

  if (!plan || plan.length === 0) {
    preview.innerHTML = `<div class="empty">没有可整理的标签页。可以关闭“只整理尚未分组的标签页”后再试。</div>`;
    return;
  }

  for (let i = 0; i < plan.length; i++) {
    const group = plan[i];
    const div = document.createElement("div");
    div.className = `group${group.enabled ? "" : " disabled"}`;
    div.dataset.index = String(i);

    const items = group.tabs.slice(0, 8).map(t => `<li title="${escapeHtml(t.title)}">${escapeHtml(t.title)} <span style="color:#94a3b8">(${escapeHtml(t.domain)})</span></li>`).join("");
    const more = group.tabs.length > 8 ? `<li>... 还有 ${group.tabs.length - 8} 个</li>` : "";
    const colors = GROUP_COLORS.map(c => `<option value="${c}" ${c === group.color ? "selected" : ""}>${c}</option>`).join("");

    div.innerHTML = `
      <div class="group-head">
        <input type="checkbox" class="group-enabled" ${group.enabled ? "checked" : ""} title="是否应用这个分组" />
        <input class="group-title-input" type="text" value="${escapeAttr(group.name)}" />
        <select class="color-select">${colors}</select>
        <span class="count">${group.tabs.length} tabs</span>
      </div>
      <div class="reason">${escapeHtml(group.reason)}</div>
      <ul>${items}${more}</ul>
    `;
    preview.appendChild(div);
  }

  wirePlanEditors();
}

function wirePlanEditors() {
  document.querySelectorAll(".group").forEach(div => {
    const index = Number(div.dataset.index);
    const checkbox = div.querySelector(".group-enabled");
    const title = div.querySelector(".group-title-input");
    const color = div.querySelector(".color-select");

    checkbox.addEventListener("change", () => {
      latestPlan[index].enabled = checkbox.checked;
      div.classList.toggle("disabled", !checkbox.checked);
      updateApplyButton();
    });
    title.addEventListener("input", () => {
      latestPlan[index].name = title.value.trim() || "未命名分组";
    });
    color.addEventListener("change", () => {
      latestPlan[index].color = color.value;
    });
  });
}

function updateApplyButton() {
  const enabledCount = latestPlan ? latestPlan.filter(g => g.enabled && g.tabs.length > 0).length : 0;
  document.getElementById("applyBtn").disabled = enabledCount === 0;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, "&#96;");
}

async function applyPlan(plan) {
  const created = [];
  for (const group of plan) {
    if (!group.enabled || group.tabs.length === 0) continue;
    const tabIds = group.tabs.map(t => t.id).filter(Boolean);
    if (tabIds.length === 0) continue;

    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: group.name.slice(0, 64),
      color: group.color
    });
    created.push({ groupId, tabIds, title: group.name, color: group.color, createdAt: Date.now() });
  }

  await chrome.storage.local.set({ lastAppliedGroups: created });
  document.getElementById("undoBtn").disabled = created.length === 0;
  return created;
}

async function undoLastGrouping() {
  const { lastAppliedGroups } = await chrome.storage.local.get("lastAppliedGroups");
  const groups = Array.isArray(lastAppliedGroups) ? lastAppliedGroups : [];
  if (groups.length === 0) return 0;

  let count = 0;
  for (const group of groups) {
    const liveTabs = [];
    for (const tabId of group.tabIds || []) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && tab.groupId === group.groupId) liveTabs.push(tabId);
      } catch (e) {
        // Tab may have been closed. Ignore.
      }
    }
    if (liveTabs.length > 0) {
      await chrome.tabs.ungroup(liveTabs);
      count += liveTabs.length;
    }
  }
  await chrome.storage.local.remove("lastAppliedGroups");
  document.getElementById("undoBtn").disabled = true;
  return count;
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function refreshUndoState() {
  const { lastAppliedGroups } = await chrome.storage.local.get("lastAppliedGroups");
  document.getElementById("undoBtn").disabled = !(Array.isArray(lastAppliedGroups) && lastAppliedGroups.length > 0);
}

document.getElementById("previewBtn").addEventListener("click", async () => {
  try {
    setStatus("正在生成预览...");
    latestPlan = await buildPlan();
    renderPlan(latestPlan);
    updateApplyButton();
    setStatus(`已生成 ${latestPlan.length} 个候选分组。可先编辑分组名/颜色/是否应用。`);
  } catch (e) {
    console.error(e);
    setStatus(`生成失败：${e.message || e}`);
  }
});

document.getElementById("applyBtn").addEventListener("click", async () => {
  if (!latestPlan) return;
  try {
    setStatus("正在应用分组...");
    const created = await applyPlan(latestPlan);
    setStatus(`已应用 ${created.length} 个分组。可以用“撤销上次分组”回退。`);
  } catch (e) {
    console.error(e);
    setStatus(`应用失败：${e.message || e}`);
  }
});

document.getElementById("undoBtn").addEventListener("click", async () => {
  try {
    setStatus("正在撤销上次分组...");
    const count = await undoLastGrouping();
    setStatus(`已撤销，上次创建的 ${count} 个标签页已取消分组。`);
  } catch (e) {
    console.error(e);
    setStatus(`撤销失败：${e.message || e}`);
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  latestPlan = null;
  latestStats = null;
  document.getElementById("preview").innerHTML = "";
  renderStats(null);
  document.getElementById("applyBtn").disabled = true;
  setStatus("已清空预览。");
});

refreshUndoState();
