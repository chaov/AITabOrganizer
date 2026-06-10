let latestPlan = null;

const GROUP_COLORS = ["blue", "green", "yellow", "purple", "cyan", "pink", "orange", "grey"];

const CATEGORY_RULES = [
  {
    name: "AI / 技术研究",
    keywords: ["ai", "agent", "llm", "openai", "anthropic", "gemini", "github", "arxiv", "paper", "docs", "developer", "chromium", "webkit", "v8", "runtime", "kernel", "benchmark"]
  },
  {
    name: "工作 / 协作",
    keywords: ["mail", "gmail", "calendar", "drive", "docs.google", "notion", "slack", "teams", "jira", "confluence", "figma", "zoom", "meet"]
  },
  {
    name: "购物 / 商品",
    keywords: ["amazon", "ebay", "taobao", "tmall", "jd.com", "shopping", "cart", "product", "price", "deal", "bestbuy", "target"]
  },
  {
    name: "新闻 / 资讯",
    keywords: ["news", "nytimes", "bbc", "cnn", "reuters", "bloomberg", "theverge", "36kr", "newsroom", "medium", "substack"]
  },
  {
    name: "旅行 / 地图",
    keywords: ["travel", "hotel", "flight", "booking", "airbnb", "maps", "trip", "uber", "lyft", "ctrip", "expedia"]
  },
  {
    name: "视频 / 娱乐",
    keywords: ["youtube", "netflix", "bilibili", "video", "music", "spotify", "podcast", "twitch"]
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

function shouldSkipTab(tab, skipPinned) {
  if (skipPinned && tab.pinned) return true;
  const url = tab.url || "";
  return url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://") || url.startsWith("about:");
}

function classifyTab(tab) {
  const domain = getDomain(tab.url);
  const text = normalize(`${tab.title || ""} ${tab.url || ""} ${domain}`);

  let best = { name: null, score: 0 };
  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) score += kw.length > 6 ? 2 : 1;
    }
    if (score > best.score) best = { name: rule.name, score };
  }

  if (best.score > 0) return best.name;

  // fallback: group same domain if multiple tabs later; provisional domain category
  return `站点：${domain}`;
}

function compactDomainGroups(groups) {
  const result = {};
  for (const [name, tabs] of Object.entries(groups)) {
    if (name.startsWith("站点：") && tabs.length === 1) {
      const fallback = "其他 / 稍后整理";
      result[fallback] = result[fallback] || [];
      result[fallback].push(...tabs);
    } else {
      result[name] = result[name] || [];
      result[name].push(...tabs);
    }
  }
  return result;
}

async function buildPlan() {
  const skipPinned = document.getElementById("skipPinned").checked;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = {};

  for (const tab of tabs) {
    if (shouldSkipTab(tab, skipPinned)) continue;
    const category = classifyTab(tab);
    groups[category] = groups[category] || [];
    groups[category].push({ id: tab.id, title: tab.title || tab.url, url: tab.url, domain: getDomain(tab.url) });
  }

  const compacted = compactDomainGroups(groups);
  const sorted = Object.entries(compacted)
    .filter(([, tabs]) => tabs.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, tabs], index) => ({ name, tabs, color: GROUP_COLORS[index % GROUP_COLORS.length] }));

  return sorted;
}

function renderPlan(plan) {
  const preview = document.getElementById("preview");
  preview.innerHTML = "";

  if (!plan || plan.length === 0) {
    preview.innerHTML = `<p>没有可整理的标签页。</p>`;
    return;
  }

  for (const group of plan) {
    const div = document.createElement("div");
    div.className = "group";
    const items = group.tabs.slice(0, 8).map(t => `<li title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</li>`).join("");
    const more = group.tabs.length > 8 ? `<li>... 还有 ${group.tabs.length - 8} 个</li>` : "";
    div.innerHTML = `
      <div class="group-title">
        <span>${escapeHtml(group.name)}</span>
        <span class="count">${group.tabs.length} tabs</span>
      </div>
      <ul>${items}${more}</ul>
    `;
    preview.appendChild(div);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

async function applyPlan(plan) {
  for (const group of plan) {
    if (group.tabs.length === 0) continue;
    const tabIds = group.tabs.map(t => t.id).filter(Boolean);
    if (tabIds.length === 0) continue;

    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: group.name,
      color: group.color
    });
  }
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

document.getElementById("previewBtn").addEventListener("click", async () => {
  setStatus("正在生成预览...");
  latestPlan = await buildPlan();
  renderPlan(latestPlan);
  document.getElementById("applyBtn").disabled = !latestPlan || latestPlan.length === 0;
  setStatus(`已生成 ${latestPlan.length} 个分组预览。`);
});

document.getElementById("applyBtn").addEventListener("click", async () => {
  if (!latestPlan) return;
  setStatus("正在应用分组...");
  await applyPlan(latestPlan);
  setStatus("已应用分组。可以在 Chrome 标签栏查看 Tab Groups。");
});

document.getElementById("clearBtn").addEventListener("click", () => {
  latestPlan = null;
  document.getElementById("preview").innerHTML = "";
  document.getElementById("applyBtn").disabled = true;
  setStatus("已清空预览。");
});
