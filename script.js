const navButtons = document.querySelectorAll("[data-view]");
const brandLink = document.querySelector("[data-nav='home']");
const views = {
  home: document.getElementById("view-home"),
  research: document.getElementById("view-research"),
  contact: document.getElementById("view-contact")
};

function parseRouteHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return { view: "", slug: "" };
  if (raw.startsWith("research/")) {
    const rawSlug = raw.slice("research/".length).replace(/^\/+|\/+$/g, "");
    try {
      return { view: "research", slug: decodeURIComponent(rawSlug) };
    } catch (_) {
      return { view: "research", slug: rawSlug };
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

  if (next === "research") {
    const openedSlug = slug && typeof openPost === "function" ? openPost(slug) : "";
    if (openedSlug) {
      updateUrlHash(`#research/${encodeURIComponent(openedSlug)}`, push);
      return;
    }
    if (typeof showResearchFeed === "function") {
      showResearchFeed();
    }
    updateUrlHash("#research", push);
    return;
  }

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

const researchFeed = document.getElementById("researchFeed");
const researchReader = document.getElementById("researchReader");
const writeupList = document.getElementById("writeupList");
const writeupCount = document.getElementById("writeupCount");
const postBackBtn = document.getElementById("postBackBtn");
const postMeta = document.getElementById("postMeta");
const postTitle = document.getElementById("postTitle");
const postSummary = document.getElementById("postSummary");
const postContent = document.getElementById("postContent");

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

function getPosts() {
  const raw = Array.isArray(window.BLOG_POSTS) ? window.BLOG_POSTS : [];
  const seen = new Set();
  return raw
    .filter((item) => item && typeof item === "object")
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

      return {
        slug: unique,
        title: String(item.title || "untitled"),
        date: item.date ? String(item.date) : "",
        tags,
        summary: item.summary ? String(item.summary) : "",
        body: bodyText,
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
  post.tags.forEach((tagText) => {
    const tag = document.createElement("span");
    tag.className = "project-tag mono";
    tag.textContent = tagText;
    container.appendChild(tag);
  });
}

function renderInlineMarkdown(container, text) {
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
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
        link.textContent = match[2];
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
      strong.textContent = match[4];
      container.appendChild(strong);
    } else if (match[5] !== undefined) {
      const em = document.createElement("em");
      em.textContent = match[5];
      container.appendChild(em);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function renderMarkdown(container, markdown) {
  if (!container) return;
  container.replaceChildren();

  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let paragraphLines = [];
  let listEl = null;
  let quoteLines = [];
  let inCodeBlock = false;
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
    const pre = document.createElement("pre");
    pre.className = "post-code";
    const code = document.createElement("code");
    code.textContent = codeLines.join("\n");
    pre.appendChild(code);
    container.appendChild(pre);
    codeLines = [];
    inCodeBlock = false;
  }

  lines.forEach((line) => {
    if (inCodeBlock) {
      if (/^\s*```\s*$/.test(line)) {
        flushCodeBlock();
      } else {
        codeLines.push(line);
      }
      return;
    }

    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      inCodeBlock = true;
      codeLines = [];
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      return;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const heading = document.createElement(`h${headingMatch[1].length + 1}`);
      renderInlineMarkdown(heading, headingMatch[2].trim());
      container.appendChild(heading);
      return;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      if (!listEl) {
        listEl = document.createElement("ul");
      }
      const li = document.createElement("li");
      renderInlineMarkdown(li, listMatch[1].trim());
      listEl.appendChild(li);
      return;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1].trim());
      return;
    }

    flushList();
    flushQuote();
    paragraphLines.push(line.trim());
  });

  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushParagraph();
  flushList();
  flushQuote();
}

function showResearchFeed() {
  if (researchFeed) researchFeed.hidden = false;
  if (researchReader) researchReader.hidden = true;
}

function openPost(slug) {
  const posts = getPosts();
  const normalized = slugify(slug);
  const post = posts.find((item) => item.slug === slug || item.slug === normalized);
  if (!post || !researchReader) return "";

  appendPostMeta(postMeta, post);
  if (postTitle) {
    postTitle.textContent = post.title;
  }
  if (postSummary) {
    postSummary.textContent = post.summary;
    postSummary.hidden = !post.summary;
  }
  renderMarkdown(postContent, post.body);

  if (researchFeed) researchFeed.hidden = true;
  researchReader.hidden = false;
  window.scrollTo(0, 0);
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

const enterGate = document.getElementById("enterGate");
const scIframe = document.getElementById("scWidget");
const audioLabel = document.getElementById("audioLabel");
const audioToggleBtn = document.getElementById("audioToggleBtn");
const audioNextBtn = document.getElementById("audioNextBtn");

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
    auto_play: autoPlay ? "true" : "false",
    show_artwork: "false",
    buying: "false",
    sharing: "false",
    download: "false",
    show_comments: "false",
    show_user: "false"
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

function updateAudioUI(isPlaying) {
  if (!audioLabel || !audioToggleBtn || !audioNextBtn) return;
  const current = playlist[trackIndex];
  audioToggleBtn.hidden = false;
  audioNextBtn.hidden = false;
  if (isPlaying) {
    audioLabel.textContent = `playing: ${current.label}`;
    audioLabel.classList.add("is-playing");
    audioToggleBtn.textContent = "pause";
  } else {
    audioLabel.textContent = `paused: ${current.label}`;
    audioLabel.classList.remove("is-playing");
    audioToggleBtn.textContent = "play";
  }
}

function showAudioError() {
  clearPlayWatchdog();
  isLoadingTrack = false;
  if (!audioLabel) return;
  audioLabel.classList.remove("is-playing");
  audioLabel.textContent = "soundcloud playback unavailable";
  if (audioToggleBtn) {
    audioToggleBtn.hidden = false;
    audioToggleBtn.textContent = "play";
  }
  if (audioNextBtn) {
    audioNextBtn.hidden = false;
  }
}

function playTrackAt(index, candIndex = 0) {
  clearPlayWatchdog();
  isAdvancing = false;
  isLoadingTrack = true;
  userPaused = false;
  trackIndex = (index + playlist.length) % playlist.length;
  candidateIndex = candIndex;
  const track = playlist[trackIndex];
  if (audioLabel) {
    audioLabel.textContent = `loading: ${track.label}`;
    audioLabel.classList.remove("is-playing");
  }
  if (audioToggleBtn) {
    audioToggleBtn.hidden = false;
    audioToggleBtn.textContent = "pause";
  }
  if (audioNextBtn) {
    audioNextBtn.hidden = false;
  }
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
    show_artwork: false,
    buying: false,
    sharing: false,
    download: false,
    show_comments: false,
    show_user: false,
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
