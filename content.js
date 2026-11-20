"use strict";
(() => {
  // src/shared/messages.ts
  async function sendToBackground(req) {
    const reply = await chrome.runtime.sendMessage(req);
    if (!reply) throw new Error("No reply from the extension background");
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  }

  // src/shared/types.ts
  var ACCOUNT_COLORS = ["#c96442", "#7d8b4e", "#5b7aa6", "#8e5a8a", "#b0893e", "#4f8f87"];

  // src/shared/html.ts
  var ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
  }
  function avatarHtml(label, color) {
    const n = ACCOUNT_COLORS.length;
    const bg = ACCOUNT_COLORS[(color % n + n) % n];
    const initial = (label.trim().charAt(0) || "?").toUpperCase();
    return `<span class="avatar" style="background:${bg}" aria-hidden="true">${esc(initial)}</span>`;
  }
  function accountRowParts(a, index, s) {
    const right = s.switchingTo === a.id ? `<span class="spinner" aria-label="Switching"></span>` : a.id === s.activeId ? `<span class="check" aria-label="Active">\u2713</span>` : index < 9 ? `<span class="kbd">Ctrl+Shift+${index + 1}</span>` : `<span></span>`;
    const sub = a.status === "signedOut" ? `<span class="err">signed out \u2014 sign in again</span>` : `<span class="email">${esc(a.email)}</span>`;
    return { sub, right };
  }

  // Usage & Free Limit helpers for in-page switcher
  var FREE_LIMITS_KEY = "cas:freeLimits";
  var cachedFreeLimits = {};

  function parseTimeToday(timeStr) {
    if (!timeStr) return null;
    const now = new Date();
    const m = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(timeStr.trim());
    if (!m) return null;
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const meridiem = m[3] ? m[3].toUpperCase() : null;
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;

    let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
    let diff = target.getTime() - now.getTime();

    // If target time is in the past, it could only be tomorrow if it crosses midnight within <= 5.5 hours
    if (diff < 0) {
      const tomorrowTarget = new Date(target.getTime() + 24 * 3600 * 1000);
      const tomorrowDiff = tomorrowTarget.getTime() - now.getTime();
      // Claude free limit window is strictly 5 hours
      if (tomorrowDiff <= 5.5 * 3600 * 1000) {
        target = tomorrowTarget;
        diff = tomorrowDiff;
      } else {
        // It's in the past and has already expired!
        return null;
      }
    }

    // A valid Claude free limit reset MUST be within 5.5 hours from now
    if (diff > 5.5 * 3600 * 1000) {
      return null;
    }

    return target.getTime();
  }

  function detectPageRateLimit(doc) {
    const alerts = doc.querySelectorAll('div[class*="banner"], div[role="alert"], div[class*="notice"], div[class*="error"], fieldset, form');
    for (const el of alerts) {
      const t = el.textContent || "";
      const m = /out of (?:free )?messages until\s+([0-9]{1,2}:[0-9]{2}(?:\s*[AaPp][Mm])?)/i.exec(t)
             || /(?:reached|exceeded) (?:your )?(?:free )?message limit until\s+([0-9]{1,2}:[0-9]{2}(?:\s*[AaPp][Mm])?)/i.exec(t)
             || /(?:resets|try again)\s*(?:at|until)\s+([0-9]{1,2}:[0-9]{2}(?:\s*[AaPp][Mm])?)/i.exec(t);
      if (m) return m[1].trim();
    }
    const text = doc.body ? (doc.body.innerText || "") : "";
    if (!text) return null;
    const m = /out of (?:free )?messages until\s+([0-9]{1,2}:[0-9]{2}(?:\s*[AaPp][Mm])?)/i.exec(text)
           || /(?:reached|exceeded) (?:your )?(?:free )?message limit until\s+([0-9]{1,2}:[0-9]{2}(?:\s*[AaPp][Mm])?)/i.exec(text)
           || /(?:resets|try again)\s*(?:at|until)\s+([0-9]{1,2}:[0-9]{2}(?:\s*[AaPp][Mm])?)/i.exec(text);
    return m ? m[1].trim() : null;
  }

  async function syncFreeLimit(activeId, doc, onDetected) {
    if (!activeId) return;
    const timeStr = detectPageRateLimit(doc);
    if (!timeStr) {
      const fl = cachedFreeLimits[activeId];
      if (fl && fl.resetsAt && Date.now() >= fl.resetsAt) {
        delete cachedFreeLimits[activeId];
        await chrome.storage.local.set({ [FREE_LIMITS_KEY]: cachedFreeLimits }).catch(() => void 0);
        if (onDetected) onDetected();
      }
      return;
    }
    const resetsAt = parseTimeToday(timeStr);
    if (!resetsAt) {
      // timeStr has already passed, clear it!
      if (cachedFreeLimits[activeId]) {
        delete cachedFreeLimits[activeId];
        await chrome.storage.local.set({ [FREE_LIMITS_KEY]: cachedFreeLimits }).catch(() => void 0);
        if (onDetected) onDetected();
      }
      return;
    }
    const prev = cachedFreeLimits[activeId];
    if (prev && prev.timeStr === timeStr && Math.abs(prev.resetsAt - resetsAt) < 60000) return;
    cachedFreeLimits[activeId] = { timeStr, resetsAt, detectedAt: Date.now() };
    await chrome.storage.local.set({ [FREE_LIMITS_KEY]: cachedFreeLimits }).catch(() => void 0);
    if (onDetected) onDetected();
  }

  function lvOf(p) { return p >= 90 ? "crit" : p >= 70 ? "warn" : "ok"; }
  function fmtReset(resetsAt, now2) {
    if (!resetsAt) return "";
    const t = typeof resetsAt === "number" ? resetsAt : Date.parse(resetsAt);
    if (Number.isNaN(t)) return "";
    const diff = t - now2;
    if (diff <= 0) return "resetting\u2026";
    if (diff >= 24 * 36e5) return "";
    const mins = Math.round(diff / 6e4);
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `in ${h}h\u00A0${m}m` : `in ${m}m`;
  }
  function getUsageInfo(accountId, plan, st) {
    const fallbackBar = `<span class="urow"><span class="upct">${esc(plan)}</span></span>`;
    const snap = st?.usage ? st.usage[accountId] : null;
    if (snap && snap.limits && snap.limits.length > 0) {
      const maxP = Math.max(...snap.limits.map((l) => l.percent));
      const topL = snap.limits[0];
      const p = Math.round(topL.percent);
      const lv = lvOf(topL.percent);
      const rst = fmtReset(topL.resetsAt, Date.now());
      const ring = lvOf(maxP) !== "ok" ? ` lv-${lvOf(maxP)}` : "";
      const bar = `<span class="urow"><span class="ubar lv-${lv}" style="--p:${p}%"><i></i></span><span class="upct">${p}%${rst ? ` \xB7 ${rst}` : ""}</span></span>`;
      return { ring, bar };
    }
    const fl = cachedFreeLimits[accountId];
    if (fl && fl.resetsAt) {
      const nowMs = Date.now();
      const remainingMs = fl.resetsAt - nowMs;
      // If time has passed OR if remaining time > 5.5 hours (invalid/corrupted stale data), clear it immediately!
      if (remainingMs <= 0 || remainingMs > 5.5 * 3600 * 1000) {
        delete cachedFreeLimits[accountId];
        chrome.storage.local.set({ [FREE_LIMITS_KEY]: cachedFreeLimits }).catch(() => void 0);
        return { ring: "", bar: fallbackBar };
      }
      const rst = fmtReset(fl.resetsAt, nowMs);
      const ring = " lv-crit";
      const bar = `<span class="urow"><span class="ubar lv-crit" style="--p:100%"><i></i></span><span class="upct">100% \xB7 ${rst || fl.timeStr}</span></span>`;
      return { ring, bar };
    }
    return { ring: "", bar: fallbackBar };
  }

  // src/content/banner.ts
  function createBanner(root, doc, send) {
    const el = doc.createElement("div");
    el.className = "banner";
    el.hidden = true;
    el.setAttribute("role", "alert");
    root.appendChild(el);
    let info = null;
    let state = null;
    let switching = false;
    let error = null;
    const draw = () => {
      if (!info || !state) {
        el.hidden = true;
        return;
      }
      const i = info;
      el.hidden = false;
      if (switching) {
        el.innerHTML = `<div class="title"><span>Switching\u2026</span></div>`;
        return;
      }
      const current = state.accounts.find((a) => a.id === i.currentAccountId);
      const where = current ? `${esc(current.label)} <span class="muted">(${esc(current.email)})</span>` : "this account";
      const remembered = i.candidates.find((a) => a.id === i.rememberedAccountId);
      const buttons = i.candidates.map((a) => {
        const signedOut = a.status === "signedOut";
        const primary = a.id === i.rememberedAccountId;
        return `<button class="btn${primary ? " primary" : ""}" data-action="openAs" data-id="${esc(a.id)}"${signedOut ? " disabled" : ""}>Open as ${esc(a.label)}${signedOut ? " \xB7 signed out" : ""}</button>`;
      }).join("");
      const extra = i.candidates.length === 0 ? `<button class="btn" data-action="add">+ Add another account</button>` : "";
      el.innerHTML = `<div class="title"><span>This isn't in ${where}</span><button class="close" data-action="close" aria-label="Dismiss">\xD7</button></div>${remembered ? `<div class="muted">Last opened as ${esc(remembered.label)}</div>` : ""}${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}<div class="actions">${buttons}${extra}</div>`;
    };
    const fail = (e) => {
      error = e instanceof Error ? e.message : String(e);
      draw();
    };
    el.addEventListener("click", (e) => {
      const t = e.target.closest("[data-action]");
      if (!t || t instanceof HTMLButtonElement && t.disabled || !info) return;
      const resourceKey = info.resourceKey;
      switch (t.dataset.action) {
        case "close":
          info = null;
          switching = false;
          draw();
          break;
        case "add":
          error = null;
          void send({ type: "addAccount:start" }).catch((e2) => fail(e2));
          break;
        case "openAs":
          error = null;
          switching = true;
          draw();
          void send({ type: "rescue:openAs", accountId: t.dataset.id ?? "", resourceKey }).catch((e2) => {
            switching = false;
            fail(e2);
          });
          break;
      }
    });
    return {
      show(next) {
        info = next;
        switching = false;
        error = null;
        draw();
      },
      setState(next) {
        state = next;
        draw();
      },
      hide() {
        info = null;
        draw();
      },
      element: el
    };
  }

  // src/content/styles.ts
  var CONTENT_CSS = `
:host { all: initial; font-family: inherit; font-size: 13px; line-height: 1.4; color-scheme: light dark;
  --cas-bg: #faf9f5; --cas-surface: #f5f4ed; --cas-surface-2: #f0eee6; --cas-border: rgba(31,30,29,.14);
  --cas-text: #141413; --cas-muted: #73726c; --cas-claude: #c96442; --cas-warn: #e5a83b; --cas-err: #c4314b; }
@media (prefers-color-scheme: dark) { :host { --cas-bg: #262624; --cas-surface: #1f1e1d; --cas-surface-2: #30302e;
  --cas-border: rgba(222,220,209,.14); --cas-text: #faf9f5; --cas-muted: #9c9a92; --cas-claude: #d97757; --cas-warn: #e5a83b; --cas-err: #ff6b80; } }
[hidden] { display: none !important; }
.cas-switch { position: fixed; z-index: 2147483646; color: var(--cas-text); font: inherit; }
.pill { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border-radius: 50%;
  border: 0.5px solid var(--cas-border); background: var(--cas-surface); color: inherit; font: inherit; cursor: pointer; transition: transform .12s, box-shadow .12s; }
.pill:hover { background: var(--cas-surface-2); transform: scale(1.08); box-shadow: 0 2px 6px rgba(0,0,0,.15); }
.pill .avatar { width: 22px; height: 22px; font-size: 11px; }
.avatar { display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 600; }
.menu { position: absolute; bottom: 34px; left: 0; min-width: 240px; padding: 4px; border-radius: 12px; background: var(--cas-bg);
  border: 0.5px solid var(--cas-border); box-shadow: 0 12px 32px rgba(0,0,0,.25); }
.item { display: grid; grid-template-columns: 20px 1fr auto; gap: 8px; align-items: center; width: 100%; padding: 6px 8px; border: 0;
  border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.item:hover { background: var(--cas-surface-2); }
.item .email { display: block; color: var(--cas-muted); font-size: 11px; }
.item .err { display: block; color: var(--cas-err); font-size: 11px; }
.check { color: var(--cas-claude); }
.kbd { font-family: inherit; font-size: 10px; font-weight: 500; color: var(--cas-muted); padding: 1px 4px; border-radius: 4px; background: var(--cas-surface-2); border: 0.5px solid var(--cas-border); }
.sep { height: 0.5px; background: var(--cas-border); margin: 4px 0; }
.hint { padding: 6px 8px; font-size: 11px; color: var(--cas-muted); }
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; width: min(520px, calc(100vw - 32px));
  padding: 10px 12px; border-radius: 12px; background: var(--cas-bg); color: var(--cas-text); border: 0.5px solid var(--cas-border);
  box-shadow: 0 12px 32px rgba(0,0,0,.25); font: inherit; font-size: 13px; }
.banner .title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.banner .muted { color: var(--cas-muted); font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.btn { height: 26px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--cas-border); background: var(--cas-surface-2);
  color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.btn.primary { background: var(--cas-claude); border-color: transparent; color: #fff; }
.btn[disabled] { opacity: .5; cursor: default; }
.close { border: 0; background: transparent; color: var(--cas-muted); cursor: pointer; font: inherit; font-size: 16px; }
.spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--cas-border); border-top-color: var(--cas-claude); animation: cas-spin .8s linear infinite; }
@keyframes cas-spin { to { transform: rotate(360deg); } }
.avatar.lv-warn { outline: 2px solid var(--cas-warn); outline-offset: 1px; }
.avatar.lv-crit { outline: 2px solid var(--cas-err); outline-offset: 1px; }
.urow { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.ubar { position: relative; height: 3px; border-radius: 2px; background: rgba(127,127,127,.2); width: 56px; overflow: hidden; flex: none; }
.ubar > i { position: absolute; inset: 0 auto 0 0; width: var(--p,0%); border-radius: 2px; background: #2f8f46; }
.ubar.lv-warn > i { background: var(--cas-warn); }
.ubar.lv-crit > i { background: var(--cas-err); }
.upct { font-size: 10px; color: var(--cas-muted); white-space: nowrap; }
.plan-lbl { display: block; font-size: 10px; color: var(--cas-muted); margin-top: 1px; }
.err { color: var(--cas-err); }
`;

  // src/content/host.ts
  var HOST_ID = "claude-account-switcher-root";
  var SHADOW_MODE = true ? "closed" : "closed";
  var roots = /* @__PURE__ */ new WeakMap();
  function ensureHost(doc) {
    const existing = doc.getElementById(HOST_ID);
    const known = existing ? roots.get(existing) ?? existing.shadowRoot : null;
    if (known) return known;
    const host = doc.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: SHADOW_MODE });
    roots.set(host, root);
    const style = doc.createElement("style");
    style.textContent = CONTENT_CSS;
    root.appendChild(style);
    (doc.body ?? doc.documentElement).appendChild(host);
    return root;
  }

  // src/content/keys.ts
  var NON_TEXT_INPUTS = /* @__PURE__ */ new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);
  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.tagName === "INPUT") return !NON_TEXT_INPUTS.has(el.type);
    return el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
  }
  function installKeys(win, getAccounts, onSwitch) {
    const onKey = (e) => {
      if (e.isComposing || e.repeat) return;
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        let n = null;
        const codeMatch = /^Digit([1-9])$/.exec(e.code) || /^Numpad([1-9])$/.exec(e.code);
        if (codeMatch) {
          n = Number(codeMatch[1]);
        } else {
          const shiftMap = { "!": 1, "@": 2, "#": 3, "$": 4, "%": 5, "^": 6, "&": 7, "*": 8, "(": 9 };
          if (shiftMap[e.key]) n = shiftMap[e.key];
          else if (e.key >= "1" && e.key <= "9") n = Number(e.key);
        }
        if (n !== null && n >= 1 && n <= 9) {
          const account = getAccounts()[n - 1];
          if (!account || account.status === "signedOut") return;
          e.preventDefault();
          e.stopPropagation();
          onSwitch(account.id);
        }
      }
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  }

  // src/content/anchors.ts
  var ANCHOR_SELECTORS = ['[data-testid="user-menu-button"]', 'button[data-testid*="user-menu"]'];
  function findAnchor(doc) {
    for (const sel of ANCHOR_SELECTORS) {
      const el = doc.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  var PILL_HEIGHT = 28;
  function placement(anchor, viewport, doc) {
    const floating = { mode: "floating", left: 12, top: viewport.height - 12 - PILL_HEIGHT };
    
    if (doc) {
      const aux = doc.querySelector('.df-footer-aux, [class*="df-footer-aux"]');
      if (aux) {
        const ab = aux.getBoundingClientRect();
        if (ab.width > 0 && ab.height > 0) {
          const left = Math.round(ab.left - PILL_HEIGHT - 5);
          const top = Math.max(8, Math.round(ab.top + ab.height / 2 - PILL_HEIGHT / 2));
          return {
            mode: "anchored",
            left: Math.max(8, Math.min(left, viewport.width - PILL_HEIGHT - 8)),
            top
          };
        }
      }
    }

    if (!anchor) return floating;
    const r = anchor.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return floating;

    let left = r.right + 6;
    let top = Math.max(8, Math.round(r.top + r.height / 2 - PILL_HEIGHT / 2));

    return {
      mode: "anchored",
      left: Math.max(8, Math.min(left, viewport.width - PILL_HEIGHT - 8)),
      top
    };
  }

  // src/content/switcherUi.ts
  function createSwitcher(root, doc, send) {
    const win = doc.defaultView;
    const wrap = doc.createElement("div");
    wrap.className = "cas-switch";
    wrap.hidden = true;
    root.appendChild(wrap);
    let state = null;
    let open = false;
    let error = null;
    let unavailable = null;
    const reposition = () => {
      const p = placement(findAnchor(doc), { width: win.innerWidth, height: win.innerHeight }, doc);
      wrap.dataset.placement = p.mode;
      wrap.style.left = `${p.left}px`;
      wrap.style.top = `${p.top}px`;
    };
    const draw = () => {
      if (unavailable) {
        wrap.hidden = false;
        wrap.innerHTML = `<button class="pill" disabled role="alert"><span>${esc(unavailable)}</span></button>`;
        reposition();
        return;
      }
      if (!state || !state.prefs.inPageSwitcher || state.accounts.length === 0) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      const s = state;
      const active = s.accounts.find((a) => a.id === s.activeId);
      const items = s.accounts.map((a, i) => {
        const { right } = accountRowParts(a, i, s);
        const action = a.status === "signedOut" ? "signin" : "switch";
        const { ring: uRing, bar: uBar } = getUsageInfo(a.id, a.plan, s);
        const _n = ACCOUNT_COLORS.length;
        const _bg = ACCOUNT_COLORS[(a.color % _n + _n) % _n];
        const _init = (a.label.trim().charAt(0) || "?").toUpperCase();
        const avEl = `<span class="avatar${uRing}" style="background:${_bg}" aria-hidden="true">${esc(_init)}</span>`;
        const signedOutMsg = a.status === "signedOut" ? `<span class="err">signed out \u2014 sign in again</span>` : "";
        const subLine = signedOutMsg || uBar;
        return `<button class="item" role="menuitem" data-action="${action}" data-id="${esc(a.id)}">${avEl}<span><span class="label">${esc(a.label)}</span>${subLine}</span>${right}</button>`;
      }).join("");
      const failure = error ? `<div class="hint err" role="alert">${esc(error)}</div>` : "";
      const uInfo = active ? getUsageInfo(active.id, active.plan, s) : { ring: "" };
      const _pbg = active ? ACCOUNT_COLORS[(active.color % 6 + 6) % 6] : "#c96442";
      const _pinit = active ? (active.label.trim().charAt(0) || "?").toUpperCase() : "A";
      const pillAvatar = `<span class="avatar${uInfo.ring}" style="background:${_pbg}" aria-hidden="true">${esc(_pinit)}</span>`;
      wrap.innerHTML = `<button class="pill" data-action="toggle" title="${esc(active?.label ?? "Accounts")}" aria-label="Switch Account: ${esc(active?.label ?? "")}" aria-haspopup="menu" aria-expanded="${open}">${pillAvatar}</button><div class="menu" role="menu"${open ? "" : " hidden"}>${items}${failure}<div class="sep"></div><button class="item" data-action="add"><span></span><span>+ Add another account</span><span></span></button><div class="hint">Ctrl+Shift+1–9 switch</div></div>`;
      reposition();
    };
    const close = () => {
      open = false;
      draw();
    };
    const run = (req) => {
      error = null;
      new Promise((resolve) => resolve(send(req))).catch((e) => {
        error = e instanceof Error ? e.message : String(e);
        open = true;
        draw();
      });
    };
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const id = el.dataset.id ?? "";
      switch (el.dataset.action) {
        case "toggle":
          open = !open;
          error = null;
          draw();
          break;
        case "switch":
          close();
          run({ type: "switch", accountId: id });
          break;
        case "signin":
          close();
          run({ type: "addAccount:start", targetAccountId: id });
          break;
        case "add":
          close();
          run({ type: "addAccount:start" });
          break;
      }
    });
    const onDocClick = (e) => {
      if (!open) return;
      const path = e.composedPath();
      if (path.includes(root.host) || path.includes(wrap)) return;
      close();
    };
    const onEsc = (e) => {
      if (open && e.key === "Escape") close();
    };
    doc.addEventListener("click", onDocClick, false);
    doc.addEventListener("keydown", onEsc, true);
    let timer;
    const observer = new win.MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(reposition, 300);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    win.addEventListener("resize", reposition);
    return {
      update(next) {
        state = next;
        unavailable = null;
        draw();
      },
      unavailable(message) {
        unavailable = message;
        open = false;
        draw();
      },
      reposition,
      destroy() {
        observer.disconnect();
        clearTimeout(timer);
        doc.removeEventListener("click", onDocClick, false);
        doc.removeEventListener("keydown", onEsc, true);
        win.removeEventListener("resize", reposition);
        wrap.remove();
      },
      element: wrap
    };
  }

  // src/content/boot.ts
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function boot(deps) {
    const { doc, win, send } = deps;
    const delays = deps.retryDelaysMs ?? [250, 1e3, 3e3];
    let ui = null;
    let pendingState = null;
    let pendingRescue = null;
    deps.onMessage((msg) => {
      const push = msg;
      if (push?.type === "state") {
        if (ui) ui.apply(push.state);
        else pendingState = push.state;
      } else if (push?.type === "rescue:show") {
        if (ui) ui.rescue(push.rescue);
        else pendingRescue = push.rescue;
      }
    });
    let fetched = null;
    for (let attempt = 0; attempt <= delays.length && !fetched && !pendingState; attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1] ?? 0);
      fetched = await send({ type: "getState" }).catch(() => null);
    }
    let state = pendingState ?? fetched;
    doc.getElementById(HOST_ID)?.remove();
    const root = ensureHost(doc);
    const switcher = createSwitcher(root, doc, send);
    const banner = createBanner(root, doc, send);
    const apply = (next) => {
      state = next;
      switcher.update(next);
      banner.setState(next);
    };
    ui = { apply, rescue: (info) => banner.show(info) };
    if (state) apply(state);
    else switcher.unavailable("Account switcher unavailable \u2014 reload");
    if (pendingState && pendingState !== state) apply(pendingState);
    pendingState = null;
    chrome.storage.local.get(FREE_LIMITS_KEY).then((got) => {
      if (got && got[FREE_LIMITS_KEY]) {
        cachedFreeLimits = got[FREE_LIMITS_KEY];
        if (state) apply(state);
      }
    }).catch(() => void 0);
    const checkLimitAndRefresh = () => {
      if (state?.activeId) {
        void syncFreeLimit(state.activeId, doc, () => {
          if (state) apply(state);
        });
      }
    };
    setTimeout(checkLimitAndRefresh, 100);
    installKeys(
      win,
      () => state?.accounts ?? [],
      (accountId) => void send({ type: "switch", accountId }).catch(() => console.warn("Could not switch account"))
    );
    let timer;
    const observer = new win.MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!root.host.isConnected && !doc.getElementById(HOST_ID)) (doc.body ?? doc.documentElement).appendChild(root.host);
        checkLimitAndRefresh();
      }, deps.settleMs ?? 300);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    const limitInterval = setInterval(checkLimitAndRefresh, 2500);
    const rescue = pendingRescue ?? await send({ type: "rescue:get" }).catch(() => null);
    if (rescue) banner.show(rescue);
    return {
      destroy() {
        observer.disconnect();
        clearTimeout(timer);
        clearInterval(limitInterval);
      }
    };
  }

  // src/content/main.ts
  void boot({
    doc: document,
    win: window,
    send: (req) => sendToBackground(req),
    onMessage: (cb) => chrome.runtime.onMessage.addListener((msg) => {
      cb(msg);
      return false;
    })
  });
})();
