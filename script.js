const navButtons = document.querySelectorAll("[data-view]");
const brandLink = document.querySelector("[data-nav='home']");
const views = {
  home: document.getElementById("view-home"),
  research: document.getElementById("view-research"),
  contact: document.getElementById("view-contact")
};
const researchFeed = document.getElementById("researchFeed");
const researchReader = document.getElementById("researchReader");
const writeupList = document.getElementById("writeupList");
const writeupCount = document.getElementById("writeupCount");
const postBackBtn = document.getElementById("postBackBtn");
const postMeta = document.getElementById("postMeta");
const postTitle = document.getElementById("postTitle");
const postSummary = document.getElementById("postSummary");
const postContent = document.getElementById("postContent");
const postToc = document.getElementById("postToc");
const enterGate = document.getElementById("enterGate");
const scIframe = document.getElementById("scWidget");
const audioLabel = document.getElementById("audioLabel");
const audioToggleBtn = document.getElementById("audioToggleBtn");
const audioNextBtn = document.getElementById("audioNextBtn");

const loadedBodies = new Map();
let activePostRequest = 0;
let tocScrollHandler = null;
let graphIdCounter = 0;

const SLUG_REDIRECTS = {
  "azuradlc-drm": "azuradlc"
};

function resolvePostSlug(slug) {
  const normalized = slugify(slug);
  return SLUG_REDIRECTS[slug] || SLUG_REDIRECTS[normalized] || slug;
}

function parseRouteHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return { view: "", slug: "" };
  if (raw.startsWith("research/")) {
    const rawSlug = raw.slice("research/".length).replace(/^\/+|\/+$/g, "");
    try {
      return { view: "research", slug: resolvePostSlug(decodeURIComponent(rawSlug)) };
    } catch (_) {
      return { view: "research", slug: resolvePostSlug(rawSlug) };
    }
  }
  if (views[raw]) return { view: raw, slug: "" };
  return { view: "", slug: "" };
}

function updateUrlHash(nextHash, push) {
  if (!nextHash || window.location.hash === nextHash) return;
  try {
    if (push) {
      history.pushState(null, "", nextHash);
    } else {
      history.replaceState(null, "", nextHash);
    }
  } catch (_) {
    window.location.hash = nextHash;
  }
}

const REVEAL_SELECTOR =
  ".hero, .section-head, .project-row, .stack-item, .writeup-card, .contact-row, .post-header, .post-content > *, .site-footer";
const STAGGER_SELECTOR = ".project-row, .stack-item, .writeup-card, .contact-row";
let revealObserver = null;

function getRevealObserver() {
  if (revealObserver) return revealObserver;
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof IntersectionObserver !== "function"
  ) {
    return null;
  }
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        revealObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.02, rootMargin: "0px 0px -24px 0px" }
  );
  return revealObserver;
}

function observeScrollReveals(root = document) {
  if (!root) return;
  const observer = getRevealObserver();
  if (!observer) return;

  const targets =
    root === postContent
      ? Array.from(postContent.children)
      : Array.from(root.querySelectorAll(REVEAL_SELECTOR));

  targets.forEach((el) => {
    if (el.classList.contains("scroll-reveal")) return;
    if (el.matches(STAGGER_SELECTOR) && el.parentElement) {
      const idx = Array.from(el.parentElement.children).indexOf(el);
      if (idx > 0) {
        el.style.setProperty("--reveal-delay", `${Math.min(idx, 6) * 45}ms`);
      }
    }
    el.classList.add("scroll-reveal");
    observer.observe(el);
  });
}

function switchView(target, slug = "", options = {}) {
  const next = views[target] ? target : "home";
  const push = Boolean(options.push);

  Object.entries(views).forEach(([key, el]) => {
    if (!el) return;
    const active = key === next;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  });

  navButtons.forEach((btn) => {
    const active = btn.dataset.view === next;
    btn.classList.toggle("is-active", active);
    if (active) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });

  if (views[next]) {
    observeScrollReveals(views[next]);
  }

  if (next === "research") {
    const openedSlug = slug ? openPost(slug) : "";
    if (openedSlug) {
      updateUrlHash(`#research/${encodeURIComponent(openedSlug)}`, push);
      return;
    }
    showResearchFeed();
    updateUrlHash("#research", push);
    return;
  }

  activePostRequest += 1;
  cleanupTocScroll();
  updateUrlHash(`#${next}`, push);
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view, "", { push: true }));
});

if (brandLink) {
  brandLink.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("home", "", { push: true });
  });
}

const avatarImg = document.getElementById("avatarImg");
if (avatarImg) {
  avatarImg.addEventListener("error", () => {
    avatarImg.parentElement.classList.add("is-fallback");
  });
}

function bindCopyButton(button, statusEl, defaultLabel) {
  if (!button) return;
  let timer = null;
  button.addEventListener("click", async () => {
    const value = button.dataset.copy;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (statusEl) {
        statusEl.textContent = "copied!";
      } else {
        button.textContent = "Copied!";
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = "failed";
      } else {
        button.textContent = "Copy failed";
      }
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (statusEl) {
        statusEl.textContent = defaultLabel;
      } else {
        button.textContent = defaultLabel;
      }
    }, 1800);
  });
}

bindCopyButton(
  document.getElementById("copyDiscordBtn"),
  document.getElementById("copyStatus"),
  "copy"
);
bindCopyButton(
  document.getElementById("copyDiscordContactBtn"),
  null,
  "Copy handle"
);

function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "post"
  );
}

function estimateReadTime(text) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (!words) return "";
  return `${Math.max(1, Math.ceil(words / 200))} min read`;
}

function canPreviewDrafts() {
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  return new URLSearchParams(window.location.search).get("drafts") === "1";
}

function safeBodyPath(rawPath) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed || trimmed.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return "";
  }
  return trimmed;
}

function getPosts() {
  const raw = Array.isArray(window.BLOG_POSTS) ? window.BLOG_POSTS : [];
  const includeDrafts = canPreviewDrafts();
  const seen = new Set();
  return raw
    .filter((item) => {
      if (!item || typeof item !== "object") return false;
      const isDraft = item.published === false || item.draft === true;
      return includeDrafts || !isDraft;
    })
    .map((item, index) => {
      const base = slugify(item.slug || item.title || `post-${index + 1}`);
      let unique = base;
      let suffix = 2;
      while (seen.has(unique)) {
        unique = `${base}-${suffix}`;
        suffix += 1;
      }
      seen.add(unique);

      const tags = Array.isArray(item.tags)
        ? item.tags.filter(Boolean).map(String)
        : item.category
          ? [String(item.category)]
          : [];
      const bodyText = Array.isArray(item.body)
        ? item.body.join("\n\n")
        : String(item.body || "");
      const bodyFile = safeBodyPath(item.bodyFile);

      return {
        slug: unique,
        title: String(item.title || "untitled"),
        date: item.date ? String(item.date) : "",
        tags,
        summary: item.summary ? String(item.summary) : "",
        body: bodyText,
        bodyFile,
        isDraft: item.published === false || item.draft === true,
        readTime: item.readTime ? String(item.readTime) : estimateReadTime(bodyText)
      };
    });
}

function safeHref(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#") || /^\/(?!\/)/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    ) {
      return parsed.href;
    }
  } catch (_) {
    return "";
  }
  return "";
}

function appendPostMeta(container, post) {
  if (!container) return;
  container.replaceChildren();
  if (post.date) {
    const dateEl = document.createElement("span");
    dateEl.textContent = post.date;
    container.appendChild(dateEl);
  }
  if (post.readTime) {
    const timeEl = document.createElement("span");
    timeEl.textContent = post.readTime;
    container.appendChild(timeEl);
  }
  if (post.isDraft) {
    const draftTag = document.createElement("span");
    draftTag.className = "project-tag mono";
    draftTag.textContent = "draft";
    container.appendChild(draftTag);
  }
  post.tags.forEach((tagText) => {
    const tag = document.createElement("span");
    tag.className = "project-tag mono";
    tag.textContent = tagText;
    container.appendChild(tag);
  });
}

function renderInlineMarkdown(container, text) {
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*((?:[^*]|\*(?!\*))+)\*\*|\*([^*]+)\*|~~((?:[^~]|~(?!~))+)~~/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    if (match[1] !== undefined) {
      const code = document.createElement("code");
      code.className = "post-inline-code";
      code.textContent = match[1];
      container.appendChild(code);
    } else if (match[2] !== undefined) {
      const href = safeHref(match[3]);
      if (href) {
        const link = document.createElement("a");
        link.className = "post-link";
        link.href = href;
        renderInlineMarkdown(link, match[2]);
        if (href.startsWith("http://") || href.startsWith("https://")) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        container.appendChild(link);
      } else {
        container.appendChild(document.createTextNode(match[2]));
      }
    } else if (match[4] !== undefined) {
      const strong = document.createElement("strong");
      renderInlineMarkdown(strong, match[4]);
      container.appendChild(strong);
    } else if (match[5] !== undefined) {
      const em = document.createElement("em");
      renderInlineMarkdown(em, match[5]);
      container.appendChild(em);
    } else if (match[6] !== undefined) {
      const del = document.createElement("del");
      renderInlineMarkdown(del, match[6]);
      container.appendChild(del);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function parseTableRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;

  const cells = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());

  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|")) cells.pop();

  return cells.length ? cells : null;
}

function parseTableAlignments(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    if (cell.startsWith(":") && cell.endsWith(":")) {
      alignments.push("center");
    } else if (cell.endsWith(":")) {
      alignments.push("right");
    } else if (cell.startsWith(":")) {
      alignments.push("left");
    } else {
      alignments.push("");
    }
  }
  return alignments;
}

function expandFlattenedTableLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;

  const parts = trimmed.split(/\|\s*\|/);
  if (parts.length < 2) return null;

  const rows = parts.map((part, idx) => {
    let row = part;
    if (idx > 0) row = `|${row}`;
    if (idx < parts.length - 1) row = `${row}|`;
    return row;
  });

  const headerCells = parseTableRow(rows[0]);
  const sepCells = parseTableRow(rows[1]);
  const alignments = parseTableAlignments(sepCells);
  if (!headerCells || !alignments || headerCells.length !== alignments.length) {
    return null;
  }

  return rows;
}

function renderTableBlock(container, headerCells, alignments, bodyRows) {
  const wrap = document.createElement("div");
  wrap.className = "post-table-wrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  headerCells.forEach((cellText, colIdx) => {
    const th = document.createElement("th");
    if (alignments[colIdx]) th.style.textAlign = alignments[colIdx];
    renderInlineMarkdown(th, cellText);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  if (bodyRows.length > 0) {
    const tbody = document.createElement("tbody");
    bodyRows.forEach((rowCells) => {
      const tr = document.createElement("tr");
      for (let colIdx = 0; colIdx < headerCells.length; colIdx += 1) {
        const td = document.createElement("td");
        if (alignments[colIdx]) td.style.textAlign = alignments[colIdx];
        renderInlineMarkdown(td, rowCells[colIdx] || "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderMarkdown(container, markdown) {
  if (!container) return;
  container.replaceChildren();

  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let paragraphLines = [];
  let listEl = null;
  let quoteLines = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    const p = document.createElement("p");
    renderInlineMarkdown(p, paragraphLines.join(" "));
    container.appendChild(p);
    paragraphLines = [];
  }

  function flushList() {
    if (!listEl) return;
    container.appendChild(listEl);
    listEl = null;
  }

  function flushQuote() {
    if (quoteLines.length === 0) return;
    const blockquote = document.createElement("blockquote");
    const p = document.createElement("p");
    renderInlineMarkdown(p, quoteLines.join(" "));
    blockquote.appendChild(p);
    container.appendChild(blockquote);
    quoteLines = [];
  }

  function flushCodeBlock() {
    if (codeLang === "graph") {
      container.appendChild(renderCustomGraph(codeLines));
    } else {
      const pre = document.createElement("pre");
      pre.className = "post-code";
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      container.appendChild(pre);
    }
    codeLines = [];
    codeLang = "";
    inCodeBlock = false;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (inCodeBlock) {
      if (/^\s*```\s*$/.test(line)) {
        flushCodeBlock();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const fenceMatch = line.match(/^\s*```(.*)$/);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      inCodeBlock = true;
      codeLang = fenceMatch[1].trim().toLowerCase();
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      container.appendChild(document.createElement("hr"));
      continue;
    }

    const flattenedRows = expandFlattenedTableLine(line);
    if (flattenedRows) {
      flushParagraph();
      flushList();
      flushQuote();
      const headerCells = parseTableRow(flattenedRows[0]);
      const alignments = parseTableAlignments(parseTableRow(flattenedRows[1]));
      const bodyRows = flattenedRows
        .slice(2)
        .map((rowLine) => parseTableRow(rowLine))
        .filter(Boolean);
      renderTableBlock(container, headerCells, alignments, bodyRows);
      continue;
    }

    if (i + 1 < lines.length) {
      const headerCells = parseTableRow(line);
      const sepCells = parseTableRow(lines[i + 1]);
      const alignments = parseTableAlignments(sepCells);
      if (headerCells && alignments && headerCells.length === alignments.length) {
        flushParagraph();
        flushList();
        flushQuote();
        const bodyRows = [];
        i += 1;
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (!nextLine.trim() || /^\s*```/.test(nextLine)) break;
          const rowCells = parseTableRow(nextLine);
          if (!rowCells) break;
          bodyRows.push(rowCells);
          i += 1;
        }
        renderTableBlock(container, headerCells, alignments, bodyRows);
        continue;
      }
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const heading = document.createElement(`h${headingMatch[1].length + 1}`);
      renderInlineMarkdown(heading, headingMatch[2].trim());
      container.appendChild(heading);
      continue;
    }

    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      if (!listEl || listEl.tagName !== "UL") {
        flushList();
        listEl = document.createElement("ul");
      }
      const li = document.createElement("li");
      renderInlineMarkdown(li, ulMatch[1].trim());
      listEl.appendChild(li);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      if (!listEl || listEl.tagName !== "OL") {
        flushList();
        listEl = document.createElement("ol");
      }
      const li = document.createElement("li");
      renderInlineMarkdown(li, olMatch[1].trim());
      listEl.appendChild(li);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1].trim());
      continue;
    }

    flushList();
    flushQuote();
    paragraphLines.push(line.trim());
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushParagraph();
  flushList();
  flushQuote();

  buildPostToc(container);
  observeScrollReveals(container);
}

function renderCustomGraph(lines) {
  const wrap = document.createElement("div");
  wrap.className = "post-graph";

  const meta = {};
  const body = [];
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const kv = line.match(/^(type|title|direction|x|y|line)\s*:\s*(.+)$/i);
    if (kv) {
      meta[kv[1].toLowerCase()] = kv[2].trim();
    } else {
      body.push(line);
    }
  });

  if (meta.title) {
    const h = document.createElement("div");
    h.className = "post-graph-title mono";
    h.textContent = meta.title;
    wrap.appendChild(h);
  }

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");

  const graphId = ++graphIdCounter;

  if (meta.type === "bar") {
    const labels = (meta.x || "").split("|").map((s) => s.trim()).filter(Boolean);
    const values = (meta.y || "")
      .split("|")
      .map((s) => {
        const n = Number(s.trim());
        return Number.isFinite(n) ? n : 0;
      });
    const maxVal = Math.max(...values, 1);
    const w = 640;
    const h = 240;
    const padL = 54;
    const padR = 20;
    const padT = 26;
    const padB = 40;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const gradId = `gb-accent-${graphId}`;
    const parts = [
      `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c084fc" stop-opacity="0.45"/><stop offset="100%" stop-color="#c084fc" stop-opacity="0.08"/></linearGradient></defs>`
    ];
    for (let i = 0; i <= 4; i += 1) {
      const y = padT + (plotH * i) / 4;
      const val = Math.round(maxVal * (1 - i / 4));
      parts.push(`<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="3 4"/>`);
      parts.push(`<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="#a1a1aa" font-size="11" font-family="monospace">${val}</text>`);
    }

    const step = plotW / Math.max(values.length, 1);
    const barW = Math.min(56, step * 0.52);
    const linePts = [];

    values.forEach((v, i) => {
      const bh = Math.max((v / maxVal) * plotH, 3);
      const cx = padL + step * i + step / 2;
      const x = cx - barW / 2;
      const y = padT + plotH - bh;
      linePts.push(`${cx},${y}`);
      parts.push(`<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="url(#${gradId})" stroke="rgba(192,132,252,0.55)" stroke-width="1.2"/>`);
      parts.push(`<text x="${cx}" y="${y - 7}" text-anchor="middle" fill="#e4e4e7" font-size="11" font-weight="600" font-family="monospace">${v.toLocaleString()}</text>`);
      if (labels[i]) {
        parts.push(`<text x="${cx}" y="${h - 14}" text-anchor="middle" fill="#a1a1aa" font-size="11" font-family="monospace">${escapeSvg(labels[i])}</text>`);
      }
    });

    if (meta.line === "true" && linePts.length > 1) {
      parts.push(`<polyline points="${linePts.join(" ")}" fill="none" stroke="#c084fc" stroke-width="1.8" stroke-opacity="0.9"/>`);
      linePts.forEach((pt) => {
        const [px, py] = pt.split(",");
        parts.push(`<circle cx="${px}" cy="${py}" r="3.5" fill="#18181b" stroke="#c084fc" stroke-width="1.8"/>`);
      });
    }

    svg.innerHTML = parts.join("");
    wrap.appendChild(svg);
    return wrap;
  }

  const edges = [];
  const nodeOrder = [];
  const addNode = (name) => {
    if (!nodeOrder.includes(name)) nodeOrder.push(name);
  };
  body.forEach((line) => {
    const m = line.match(/^(.+?)\s*--(?:\|(.+?)\|)?-->\s*(.+)$/) || line.match(/^(.+?)\s*->\s*(.+)$/);
    if (!m) return;
    const from = m[1].trim();
    const label = m.length === 4 ? (m[2] || "").trim() : "";
    const to = (m.length === 4 ? m[3] : m[2]).trim();
    addNode(from);
    addNode(to);
    edges.push({ from, to, label });
  });

  const depth = {};
  nodeOrder.forEach((n) => { depth[n] = 0; });
  for (let pass = 0; pass < nodeOrder.length; pass += 1) {
    edges.forEach((e) => {
      if (depth[e.to] <= depth[e.from]) {
        depth[e.to] = depth[e.from] + 1;
      }
    });
  }

  const cols = [];
  nodeOrder.forEach((n) => {
    const d = depth[n];
    if (!cols[d]) cols[d] = [];
    cols[d].push(n);
  });

  const vertical = (meta.direction || "").toLowerCase() === "td";
  const boxH = 38;
  const pos = {};
  const pad = 14;
  let totalW = 640;
  let totalH = 200;

  if (vertical) {
    const nodeWidth = (name) => Math.max(170, name.length * 7.4 + 28);
    const maxW = Math.max(...nodeOrder.map(nodeWidth), 200);
    const gapY = 42;
    const gapX = 18;
    const maxCross = Math.max(...cols.map((c) => (c ? c.length : 0)), 1);
    totalW = Math.max(600, pad * 2 + maxCross * maxW + (maxCross - 1) * gapX);
    totalH = pad * 2 + cols.length * boxH + Math.max(cols.length - 1, 0) * gapY;

    cols.forEach((group, d) => {
      if (!group) return;
      const span = group.length * maxW + (group.length - 1) * gapX;
      const startX = (totalW - span) / 2;
      group.forEach((name, idx) => {
        const nw = nodeWidth(name);
        pos[name] = { x: startX + idx * (maxW + gapX) + (maxW - nw) / 2, y: pad + d * (boxH + gapY), w: nw };
      });
    });
  } else {
    const maxColsPerRow = 3;
    const colW = 190;
    const gapX = 28;
    const gapY = 46;
    const bandCount = Math.ceil(cols.length / maxColsPerRow);
    const bandHeights = [];
    for (let b = 0; b < bandCount; b += 1) {
      let maxInBand = 1;
      for (let c = b * maxColsPerRow; c < Math.min((b + 1) * maxColsPerRow, cols.length); c += 1) {
        if (cols[c] && cols[c].length > maxInBand) maxInBand = cols[c].length;
      }
      bandHeights.push(maxInBand * boxH + (maxInBand - 1) * 14);
    }
    totalW = pad * 2 + Math.min(cols.length, maxColsPerRow) * colW + Math.max(Math.min(cols.length, maxColsPerRow) - 1, 0) * gapX;
    totalH = pad * 2 + bandHeights.reduce((s, bh) => s + bh, 0) + Math.max(bandCount - 1, 0) * gapY;

    let bandTop = pad;
    for (let b = 0; b < bandCount; b += 1) {
      const bh = bandHeights[b];
      const startCol = b * maxColsPerRow;
      const endCol = Math.min((b + 1) * maxColsPerRow, cols.length);
      for (let c = startCol; c < endCol; c += 1) {
        const group = cols[c];
        if (!group) continue;
        const localCol = c - startCol;
        const span = group.length * boxH + (group.length - 1) * 14;
        const startY = bandTop + (bh - span) / 2;
        group.forEach((name, idx) => {
          const nw = Math.min(colW, Math.max(130, name.length * 7.2 + 24));
          pos[name] = {
            x: pad + localCol * (colW + gapX) + (colW - nw) / 2,
            y: startY + idx * (boxH + 14),
            w: nw
          };
        });
      }
      bandTop += bh + gapY;
    }
  }

  svg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);

  const arrId = `g-arr-${graphId}`;
  const parts = [
    `<defs><marker id="${arrId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="rgba(192,132,252,0.85)"/></marker></defs>`
  ];

  edges.forEach((e) => {
    const a = pos[e.from];
    const b = pos[e.to];
    if (!a || !b) return;
    let x1; let y1; let x2; let y2; let d;
    if (vertical || b.y > a.y + boxH + 10) {
      x1 = a.x + a.w / 2;
      y1 = a.y + boxH;
      x2 = b.x + b.w / 2;
      y2 = b.y - 3;
      const midY = (y1 + y2) / 2;
      d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    } else {
      x1 = a.x + a.w;
      y1 = a.y + boxH / 2;
      x2 = b.x - 3;
      y2 = b.y + boxH / 2;
      const midX = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    }
    parts.push(`<path d="${d}" fill="none" stroke="rgba(192,132,252,0.45)" stroke-width="1.35" marker-end="url(#${arrId})"/>`);
    if (e.label) {
      const lx = (x1 + x2) / 2 + (vertical ? 10 : 0);
      const ly = (y1 + y2) / 2 + (vertical ? 4 : -7);
      const anchor = vertical ? "start" : "middle";
      parts.push(`<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="#c084fc" font-size="10.5" font-family="monospace">${escapeSvg(e.label)}</text>`);
    }
  });

  const maxDepth = Math.max(...Object.values(depth), 1);
  nodeOrder.forEach((name) => {
    const p = pos[name];
    const isTerminal = depth[name] === 0 || depth[name] === maxDepth;
    const stroke = isTerminal ? "rgba(192,132,252,0.65)" : "rgba(255,255,255,0.18)";
    const fill = isTerminal ? "rgba(192,132,252,0.08)" : "rgba(255,255,255,0.03)";
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${boxH}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`);
    parts.push(`<text x="${p.x + p.w / 2}" y="${p.y + boxH / 2 + 4}" text-anchor="middle" fill="#f4f4f5" font-size="11.5" font-weight="500" font-family="monospace">${escapeSvg(name)}</text>`);
  });

  svg.innerHTML = parts.join("");
  wrap.appendChild(svg);
  return wrap;
}

function escapeSvg(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanupTocScroll() {
  if (tocScrollHandler) {
    window.removeEventListener("scroll", tocScrollHandler);
    tocScrollHandler = null;
  }
}

function buildPostToc(container) {
  if (!postToc) return;

  cleanupTocScroll();

  const headings = Array.from(container.querySelectorAll("h2, h3, h4"));
  if (headings.length === 0) {
    postToc.replaceChildren();
    postToc.hidden = true;
    return;
  }

  const title = document.createElement("div");
  title.className = "post-toc-title";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.5");
  icon.innerHTML = '<path d="M2 4h12M2 8h10M2 12h8"/>';
  const titleText = document.createElement("span");
  titleText.textContent = "Contents";
  title.append(icon, titleText);

  const body = document.createElement("div");
  body.className = "post-toc-body";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "post-toc-rail");

  const list = document.createElement("ul");
  list.className = "post-toc-list";

  const items = [];
  headings.forEach((heading, idx) => {
    const id = `sec-${idx}-${slugify(heading.textContent)}`;
    heading.id = id;

    const depth = heading.tagName === "H4" ? 2 : heading.tagName === "H3" ? 1 : 0;
    const li = document.createElement("li");
    li.className = "post-toc-item";
    li.dataset.depth = String(depth);

    const a = document.createElement("a");
    a.className = "post-toc-link";
    a.href = `#${id}`;
    a.textContent = heading.textContent;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      heading.scrollIntoView({ block: "start" });
    });

    li.appendChild(a);
    list.appendChild(li);
    items.push({ heading, li, depth });
  });

  body.append(svg, list);
  postToc.replaceChildren(title, body);
  postToc.hidden = false;

  let currentActive = 0;
  let railPts = [];
  let arrowEl = null;
  let dotEls = [];

  const drawRail = () => {
    const h = list.offsetHeight;
    const w = list.offsetWidth;
    if (!h || !w) return;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    railPts = items.map((item) => ({
      x: 7 + item.depth * 14,
      y: item.li.offsetTop + 13
    }));

    let d = `M ${railPts[0].x} 0 L ${railPts[0].x} ${railPts[0].y}`;
    for (let i = 0; i < railPts.length - 1; i += 1) {
      const a = railPts[i];
      const b = railPts[i + 1];
      if (a.x === b.x) {
        d += ` L ${b.x} ${b.y}`;
      } else {
        const midY = (a.y + b.y) / 2;
        d += ` C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;
      }
    }

    const parts = [`<path d="${d}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.2" stroke-dasharray="2.5 3"/>`];
    railPts.forEach((pt, idx) => {
      parts.push(`<circle class="post-toc-dot" data-idx="${idx}" cx="${pt.x}" cy="${pt.y}" r="2.8" fill="#18181b" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/>`);
    });
    parts.push(`<polygon class="post-toc-arrow" points="0,6 -4.5,-3 0,-1 4.5,-3" fill="#ffffff"/>`);
    svg.innerHTML = parts.join("");
    arrowEl = svg.querySelector(".post-toc-arrow");
    dotEls = Array.from(svg.querySelectorAll(".post-toc-dot"));
  };

  const syncRailState = () => {
    if (!arrowEl || railPts.length === 0) return;
    const activePt = railPts[currentActive] || railPts[0];
    arrowEl.style.transform = `translate(${activePt.x}px, ${activePt.y}px)`;
    dotEls.forEach((dot, idx) => {
      if (idx === currentActive) {
        dot.style.opacity = "0";
      } else if (idx < currentActive) {
        dot.style.opacity = "1";
        dot.setAttribute("fill", "rgba(255,255,255,0.45)");
        dot.setAttribute("stroke", "rgba(255,255,255,0.65)");
      } else {
        dot.style.opacity = "1";
        dot.setAttribute("fill", "#18181b");
        dot.setAttribute("stroke", "rgba(255,255,255,0.35)");
      }
    });
  };

  const updateActive = () => {
    let activeIdx = 0;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].heading.getBoundingClientRect().top <= 120) {
        activeIdx = i;
      }
    }
    currentActive = activeIdx;
    items.forEach((item, idx) => {
      item.li.classList.toggle("is-active", idx === activeIdx);
    });
    if (!arrowEl) drawRail();
    syncRailState();
  };

  tocScrollHandler = updateActive;
  window.addEventListener("scroll", tocScrollHandler, { passive: true });
  requestAnimationFrame(() => {
    drawRail();
    updateActive();
  });
}

function renderPostStatus(message) {
  if (!postContent) return;
  const status = document.createElement("p");
  status.className = "writeup-summary";
  status.textContent = message;
  postContent.replaceChildren(status);
}

function showResearchFeed() {
  activePostRequest += 1;
  cleanupTocScroll();
  if (researchFeed) researchFeed.hidden = false;
  if (researchReader) researchReader.hidden = true;
}

function renderLoadedBody(post, text) {
  const readTime = post.readTime || estimateReadTime(text);
  appendPostMeta(postMeta, { ...post, readTime });
  if (!String(text || "").trim()) {
    renderPostStatus(post.isDraft ? "draft file is empty." : "writeup coming soon.");
    return;
  }
  renderMarkdown(postContent, text);
}

function openPost(slug) {
  const posts = getPosts();
  const resolvedSlug = resolvePostSlug(slug);
  const normalized = slugify(resolvedSlug);
  const post = posts.find((item) => item.slug === resolvedSlug || item.slug === normalized);
  if (!post || !researchReader) return "";

  const requestId = ++activePostRequest;

  appendPostMeta(postMeta, post);
  if (postTitle) {
    postTitle.textContent = post.title;
  }
  if (postSummary) {
    postSummary.textContent = post.summary;
    postSummary.hidden = !post.summary;
  }

  if (researchFeed) researchFeed.hidden = true;
  researchReader.hidden = false;
  window.scrollTo(0, 0);

  if (post.body) {
    renderMarkdown(postContent, post.body);
    return post.slug;
  }

  if (!post.bodyFile) {
    renderPostStatus("draft has no content yet.");
    return post.slug;
  }

  if (loadedBodies.has(post.bodyFile)) {
    renderLoadedBody(post, loadedBodies.get(post.bodyFile));
    return post.slug;
  }

  renderPostStatus("loading writeup...");
  fetch(post.bodyFile)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`http ${res.status}`);
      }
      return res.text();
    })
    .then((text) => {
      loadedBodies.set(post.bodyFile, text);
      if (requestId !== activePostRequest) return;
      renderLoadedBody(post, text);
    })
    .catch(() => {
      if (requestId !== activePostRequest) return;
      renderPostStatus("could not load writeup file (preview via localhost or github pages).");
    });

  return post.slug;
}

function renderPostFeed() {
  if (!writeupList) return;
  const posts = getPosts();

  if (writeupCount) {
    const noun = posts.length === 1 ? "post" : "posts";
    writeupCount.textContent = `${posts.length} ${noun}`;
  }

  writeupList.replaceChildren();
  if (posts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "writeup-empty";
    const title = document.createElement("p");
    title.className = "writeup-empty-title";
    title.textContent = "no writeups published yet.";
    empty.appendChild(title);
    writeupList.appendChild(empty);
    return;
  }

  posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "writeup-card";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "writeup-card-btn";

    const main = document.createElement("div");
    main.className = "writeup-head-main";
    const title = document.createElement("h3");
    title.className = "writeup-title";
    title.textContent = post.title;
    main.appendChild(title);

    if (post.summary) {
      const summary = document.createElement("p");
      summary.className = "writeup-summary";
      summary.textContent = post.summary;
      main.appendChild(summary);
    }

    const meta = document.createElement("div");
    meta.className = "writeup-meta mono";
    appendPostMeta(meta, post);

    btn.addEventListener("click", () => {
      switchView("research", post.slug, { push: true });
    });

    btn.append(main, meta);
    card.appendChild(btn);
    writeupList.appendChild(card);
  });

  observeScrollReveals(writeupList);
}

if (postBackBtn) {
  postBackBtn.addEventListener("click", () => {
    switchView("research", "", { push: true });
  });
}

renderPostFeed();

const initialRoute = parseRouteHash();
if (initialRoute.view) {
  switchView(initialRoute.view, initialRoute.slug);
} else {
  showResearchFeed();
}

window.addEventListener("hashchange", () => {
  const route = parseRouteHash();
  switchView(route.view || "home", route.slug);
});

const tracks = [
  {
    urls: [
      "https://soundcloud.com/suki_waterhouse/good-looking",
      "https://soundcloud.com/alicia-garcia-reyes/suki-waterhouse-good-looking",
      "https://soundcloud.com/subpop/suki-waterhouse-good-looking-stripped"
    ],
    label: "Suki Waterhouse - Good Looking"
  },
  {
    urls: [
      "https://soundcloud.com/alyssa-proffitt-843724748/washing-skin"
    ],
    label: "alyssagrace - Washing Skin"
  }
];

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const DEFAULT_VOLUME = 40;
const SC_EMBED_OPTIONS = {
  show_artwork: false,
  buying: false,
  sharing: false,
  download: false,
  show_comments: false,
  show_user: false
};
const playlist = shuffle(tracks);
const failedUrls = new Set();
let trackIndex = 0;
let candidateIndex = 0;
let scWidget = null;
let widgetReady = false;
let hasStarted = false;
let pendingPlay = false;
let isAdvancing = false;
let isLoadingTrack = false;
let userPaused = false;
let playWatchdogId = null;

function currentTrackUrl() {
  return playlist[trackIndex].urls[candidateIndex];
}

function applyVolume() {
  if (scWidget) {
    scWidget.setVolume(DEFAULT_VOLUME);
  }
}

function clearPlayWatchdog() {
  if (playWatchdogId !== null) {
    clearTimeout(playWatchdogId);
    playWatchdogId = null;
  }
}

function schedulePlayWatchdog() {
  clearPlayWatchdog();
  playWatchdogId = setTimeout(() => {
    playWatchdogId = null;
    if (!hasStarted || userPaused || isAdvancing || !scWidget || !widgetReady) {
      return;
    }
    scWidget.isPaused((paused) => {
      if (paused) {
        advanceOnFailure();
        return;
      }
      scWidget.getPosition((pos) => {
        if (!userPaused && pos < 100) {
          advanceOnFailure();
        }
      });
    });
  }, 8500);
}

function buildEmbedUrl(trackUrl, autoPlay) {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: String(autoPlay),
    ...Object.fromEntries(
      Object.entries(SC_EMBED_OPTIONS).map(([k, v]) => [k, String(v)])
    )
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

function setAudioControls({ label, playing = false, toggleText, showControls = true }) {
  if (audioLabel && label !== undefined) {
    audioLabel.textContent = label;
    audioLabel.classList.toggle("is-playing", playing);
  }
  if (audioToggleBtn) {
    audioToggleBtn.hidden = !showControls;
    if (toggleText) audioToggleBtn.textContent = toggleText;
  }
  if (audioNextBtn) {
    audioNextBtn.hidden = !showControls;
  }
}

function updateAudioUI(isPlaying) {
  const current = playlist[trackIndex];
  setAudioControls({
    label: `${isPlaying ? "playing" : "paused"}: ${current.label}`,
    playing: isPlaying,
    toggleText: isPlaying ? "pause" : "play"
  });
}

function showAudioError() {
  clearPlayWatchdog();
  isLoadingTrack = false;
  setAudioControls({
    label: "soundcloud playback unavailable",
    playing: false,
    toggleText: "play"
  });
}

function playTrackAt(index, candIndex = 0) {
  clearPlayWatchdog();
  isAdvancing = false;
  isLoadingTrack = true;
  userPaused = false;
  trackIndex = (index + playlist.length) % playlist.length;
  candidateIndex = candIndex;
  const track = playlist[trackIndex];
  setAudioControls({
    label: `loading: ${track.label}`,
    playing: false,
    toggleText: "pause"
  });
  if (!scWidget || !widgetReady) {
    pendingPlay = true;
    if (scIframe) {
      scIframe.src = buildEmbedUrl(currentTrackUrl(), true);
    }
    return;
  }
  applyVolume();
  scWidget.load(currentTrackUrl(), {
    auto_play: true,
    ...SC_EMBED_OPTIONS,
    callback() {
      applyVolume();
      checkLoadedSoundPlayable(true);
    }
  });
  schedulePlayWatchdog();
}

function advanceOnFailure() {
  if (isAdvancing) return;
  clearPlayWatchdog();
  failedUrls.add(currentTrackUrl());
  const totalUrls = playlist.reduce((sum, t) => sum + t.urls.length, 0);
  if (failedUrls.size >= totalUrls) {
    showAudioError();
    return;
  }

  let nextTrack = trackIndex;
  let nextCand = candidateIndex + 1;
  if (nextCand >= playlist[nextTrack].urls.length) {
    nextTrack = (trackIndex + 1) % playlist.length;
    nextCand = 0;
  }

  isAdvancing = true;
  setTimeout(() => {
    playTrackAt(nextTrack, nextCand);
  }, 150);
}

function isSoundPlayable(sound) {
  return Boolean(sound && sound.policy !== "BLOCK" && sound.policy !== "SNIP");
}

function checkLoadedSoundPlayable(andPlay) {
  if (!scWidget) return;
  scWidget.getCurrentSound((sound) => {
    if (!isSoundPlayable(sound)) {
      if (hasStarted) {
        advanceOnFailure();
      } else {
        failedUrls.add(currentTrackUrl());
      }
      return;
    }
    if (andPlay && !userPaused) {
      applyVolume();
      scWidget.isPaused((paused) => {
        if (paused && !userPaused) {
          scWidget.play();
        }
      });
    }
  });
}

function initSoundCloudWidget() {
  if (!scIframe || !window.SC || !window.SC.Widget || scWidget) return;
  scIframe.src = buildEmbedUrl(currentTrackUrl(), false);
  scWidget = window.SC.Widget(scIframe);

  scWidget.bind(window.SC.Widget.Events.READY, () => {
    widgetReady = true;
    applyVolume();
    const shouldPlay = pendingPlay;
    pendingPlay = false;
    checkLoadedSoundPlayable(shouldPlay);
    if (shouldPlay && hasStarted && !userPaused) {
      schedulePlayWatchdog();
    }
  });

  scWidget.bind(window.SC.Widget.Events.PLAY, () => {
    isAdvancing = false;
    isLoadingTrack = false;
    applyVolume();
    if (hasStarted && !userPaused) {
      updateAudioUI(true);
    }
  });

  scWidget.bind(window.SC.Widget.Events.PAUSE, () => {
    if (!hasStarted || isAdvancing || isLoadingTrack) return;
    if (userPaused) {
      updateAudioUI(false);
      return;
    }
    scWidget.getPosition((pos) => {
      if (pos >= 200) {
        updateAudioUI(false);
        return;
      }
      const stalledUrl = currentTrackUrl();
      setTimeout(() => {
        if (!hasStarted || userPaused || isAdvancing || currentTrackUrl() !== stalledUrl) {
          return;
        }
        scWidget.isPaused((paused) => {
          if (!paused || userPaused) return;
          scWidget.getPosition((laterPos) => {
            if (!userPaused && laterPos < 100) {
              advanceOnFailure();
            }
          });
        });
      }, 800);
    });
  });

  scWidget.bind(window.SC.Widget.Events.FINISH, () => {
    clearPlayWatchdog();
    playTrackAt(trackIndex + 1, 0);
  });

  scWidget.bind(window.SC.Widget.Events.ERROR, () => {
    if (!hasStarted) {
      failedUrls.add(currentTrackUrl());
      return;
    }
    advanceOnFailure();
  });
}

function dismissGateAndPlay() {
  if (enterGate && !enterGate.classList.contains("is-dismissed")) {
    enterGate.classList.add("is-dismissed");
    enterGate.setAttribute("aria-hidden", "true");
  }
  if (audioToggleBtn) {
    audioToggleBtn.hidden = false;
    audioToggleBtn.textContent = "pause";
  }
  if (audioNextBtn) {
    audioNextBtn.hidden = false;
  }
  if (hasStarted) return;
  hasStarted = true;
  userPaused = false;
  if (audioLabel) {
    audioLabel.textContent = `loading: ${playlist[trackIndex].label}`;
  }
  if (widgetReady && scWidget) {
    if (failedUrls.has(currentTrackUrl())) {
      advanceOnFailure();
      return;
    }
    applyVolume();
    scWidget.play();
    schedulePlayWatchdog();
  } else {
    pendingPlay = true;
  }
}

if (window.SC && window.SC.Widget) {
  initSoundCloudWidget();
} else {
  const tag = document.createElement("script");
  tag.src = "https://w.soundcloud.com/player/api.js";
  tag.onload = initSoundCloudWidget;
  tag.onerror = showAudioError;
  document.head.appendChild(tag);
}

if (enterGate) {
  enterGate.addEventListener("click", dismissGateAndPlay);
  enterGate.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dismissGateAndPlay();
    }
  });
}

if (audioToggleBtn) {
  audioToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!hasStarted) {
      dismissGateAndPlay();
      return;
    }
    if (!scWidget || !widgetReady) return;
    scWidget.isPaused((paused) => {
      if (paused) {
        userPaused = false;
        applyVolume();
        scWidget.play();
        updateAudioUI(true);
        schedulePlayWatchdog();
      } else {
        userPaused = true;
        clearPlayWatchdog();
        scWidget.pause();
        updateAudioUI(false);
      }
    });
  });
}

if (audioNextBtn) {
  audioNextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    failedUrls.clear();
    hasStarted = true;
    playTrackAt(trackIndex + 1, 0);
  });
}

observeScrollReveals(document);
