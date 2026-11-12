const navButtons = document.querySelectorAll("[data-view]");
const brandLink = document.querySelector("[data-nav='home']");
const views = {
  home: document.getElementById("view-home"),
  research: document.getElementById("view-research"),
  contact: document.getElementById("view-contact")
};

function switchView(target) {
  const next = views[target] ? target : "home";
  Object.entries(views).forEach(([key, el]) => {
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

  if (window.location.hash !== `#${next}`) {
    history.replaceState(null, "", `#${next}`);
  }
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

if (brandLink) {
  brandLink.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("home");
  });
}

const initialHash = window.location.hash.replace("#", "");
if (initialHash && views[initialHash]) {
  switchView(initialHash);
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

const researchPosts = [];
const writeupList = document.getElementById("writeupList");
const writeupCount = document.getElementById("writeupCount");

function renderResearch() {
  if (!writeupList) return;
  if (writeupCount) {
    const noun = researchPosts.length === 1 ? "writeup" : "writeups";
    writeupCount.textContent = `${researchPosts.length} ${noun}`;
  }

  writeupList.replaceChildren();
  if (researchPosts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "writeup-empty";
    const title = document.createElement("p");
    title.className = "writeup-empty-title";
    title.textContent = "no writeups published yet.";
    empty.appendChild(title);
    writeupList.appendChild(empty);
    return;
  }

  researchPosts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "writeup-card";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "writeup-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const main = document.createElement("div");
    main.className = "writeup-head-main";
    const title = document.createElement("h3");
    title.className = "writeup-title";
    title.textContent = post.title;
    const summary = document.createElement("p");
    summary.className = "writeup-summary";
    summary.textContent = post.summary || "";
    main.append(title, summary);

    const meta = document.createElement("div");
    meta.className = "writeup-meta mono";
    if (post.date) {
      const dateEl = document.createElement("span");
      dateEl.textContent = post.date;
      meta.appendChild(dateEl);
    }
    if (post.category) {
      const tag = document.createElement("span");
      tag.className = "project-tag mono";
      tag.textContent = post.category;
      meta.appendChild(tag);
    }

    const body = document.createElement("div");
    body.className = "writeup-body";
    body.hidden = true;
    const paragraphs = Array.isArray(post.body) ? post.body : [post.body || ""];
    paragraphs.forEach((text) => {
      if (!text) return;
      const p = document.createElement("p");
      p.textContent = text;
      body.appendChild(p);
    });

    toggle.addEventListener("click", () => {
      const nextOpen = body.hidden;
      body.hidden = !nextOpen;
      toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    });

    toggle.append(main, meta);
    card.append(toggle, body);
    writeupList.appendChild(card);
  });
}

renderResearch();

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
