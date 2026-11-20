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

  var FREE_LIMITS_KEY = "cas:freeLimits";
  var popupFreeLimits = {};
  chrome.storage.local.get(FREE_LIMITS_KEY).then((got) => {
    if (got && got[FREE_LIMITS_KEY]) popupFreeLimits = got[FREE_LIMITS_KEY];
  }).catch(() => void 0);

  // src/shared/usageFormat.ts
  function levelOf(percent) {
    if (percent >= 90) return "crit";
    if (percent >= 70) return "warn";
    return "ok";
  }
  function formatAge(ms) {
    const min = Math.floor(ms / 6e4);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var pad = (n) => String(n).padStart(2, "0");
  function formatReset(resetsAt, now) {
    if (!resetsAt) return "";
    const t = Date.parse(resetsAt);
    if (Number.isNaN(t)) return "";
    const diff = t - now;
    if (diff < 24 * 36e5) {
      const total = Math.max(0, Math.round(diff / 6e4));
      const h = Math.floor(total / 60);
      const m = total % 60;
      return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
    }
    const d = new Date(t);
    return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function resetTitle(limits, now) {
    return limits.map((l) => ({ l, when: formatReset(l.resetsAt, now) })).filter((x) => x.when).map((x) => `${x.l.label} resets ${x.when}`).join(" \xB7 ");
  }

  // src/popup/view.ts
  var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  var labelOf = (s, id) => s.accounts.find((a) => a.id === id)?.label ?? "account";
  var head = (title, back = false) => `<header class="head">${back ? `<button class="btn ghost back" data-action="back" aria-label="Back">\u2039</button>` : ""}<span class="title">${esc(title)}</span></header>`;
  function usageLine(a, s, now) {
    const snap = s.usage[a.id];
    if (!snap || snap.limits.length === 0) {
      const fl = popupFreeLimits[a.id];
      if (fl && fl.resetsAt) {
        const remainingMs = fl.resetsAt - now;
        if (remainingMs <= 0 || remainingMs > 5.5 * 3600 * 1000) {
          delete popupFreeLimits[a.id];
          chrome.storage.local.set({ [FREE_LIMITS_KEY]: popupFreeLimits }).catch(() => void 0);
          return "";
        }
        return `<span class="usage" title="Free message limit reached"><span class="u crit"><span class="ul">limit</span> <span class="num">100%</span><span class="ubar"><i style="width:100%"></i></span></span><span class="asof"> \xB7 resets ${esc(fl.timeStr)}</span></span>`;
      }
      return "";
    }
    const active = a.id === s.activeId;
    const items = snap.limits.slice(0, 3).map((l) => {
      const p = Math.round(l.percent);
      return `<span class="u ${levelOf(l.percent)}"><span class="ul">${esc(l.label)}</span> <span class="num">${p}%</span><span class="ubar"><i style="width:${p}%"></i></span></span>`;
    }).join(`<span class="dot"> \xB7 </span>`);
    const asOf = active ? "" : `<span class="asof"> \xB7 as of ${esc(formatAge(now - snap.fetchedAt))}</span>`;
    return `<span class="usage${active ? "" : " stale"}" title="${esc(resetTitle(snap.limits, now))}">${items}${asOf}</span>`;
  }
  function row(a, i, s, now) {
    const active = a.id === s.activeId;
    const signedOut = a.status === "signedOut";
    const { sub, right } = accountRowParts(a, i, s);
    return `<button class="row${active ? " active" : ""}" data-action="${signedOut ? "signin" : "switch"}" data-id="${esc(a.id)}">${avatarHtml(a.label, a.color)}<span class="who"><span class="label">${esc(a.label)}</span>${sub}</span><span class="badge">${esc(a.plan)}</span>${right}${signedOut ? "" : usageLine(a, s, now)}</button>`;
  }
  function renderList(s, now) {
    const top = `<header class="head"><span class="title"><img class="logo" src="icons/icon-32.png" width="16" height="16" alt=""> Claude Switch</span></header>`;
    const status = s.switchingTo ? `<div class="status"><span class="spinner"></span> Switching to ${esc(labelOf(s, s.switchingTo))}\u2026</div>` : s.lastSwitch && now - s.lastSwitch.at < 1e4 ? `<div class="status muted">${s.lastSwitch.reloadedTabs > 0 ? `Reloaded ${plural(s.lastSwitch.reloadedTabs, "claude.ai tab")}` : "Switched"}</div>` : "";
    const body = s.accounts.length ? `<div class="list">${s.accounts.map((a, i) => row(a, i, s, now)).join("")}</div>` : `<div class="empty"><p>No accounts yet.</p><p class="muted">+ Add account first saves the claude.ai account you're signed into, then opens claude.ai signed out so you can sign in to another.</p></div>`;
    const foot = `<footer class="foot"><button class="btn ghost" data-action="addIntro">+ Add account</button><button class="btn ghost" data-action="manage">Manage</button><span class="muted count">${plural(s.accounts.length, "account")}</span></footer>`;
    return top + status + body + foot;
  }
  function renderAddIntro() {
    return `${head("Add account", true)}<div class="pane"><p>First we save the claude.ai account you're signed into (if any). Then claude.ai opens signed out, so you can sign in to another account with Google or email.</p><p class="muted">Open the email magic link in this Chrome profile.</p><button class="btn primary block" data-action="addStart">Open claude.ai login</button></div>`;
  }
  function renderAdd(s) {
    const a = s.add;
    const target = s.accounts.find((x) => x.id === a.targetAccountId);
    switch (a.phase) {
      case "waitingLogin": {
        const hint = a.message ? `<p class="err">${esc(a.message)}</p>` : `<p class="muted">Google or email magic link, in the claude.ai tab we opened. It gives up after 15 minutes.</p>`;
        return `${head("Add account")}<div class="pane"><p><span class="spinner"></span> Waiting for you to sign in${target ? ` as ${esc(target.email)}` : ""}\u2026</p>${hint}<button class="btn block" data-action="addCancel">Cancel</button></div>`;
      }
      case "saved": {
        const acct = s.accounts.find((x) => x.id === a.savedAccountId);
        return `${head("Account saved")}<div class="pane"><p class="ok">\u2713 ${a.isNew ? "Saved" : "Updated"} ${esc(acct?.email ?? "")} \xB7 ${esc(acct?.plan ?? "")}</p><label class="field"><span class="muted">Label</span><input class="input" id="label" maxlength="32" value="${esc(acct?.label ?? "")}"></label><button class="btn primary block" data-action="addDone" data-id="${esc(a.savedAccountId ?? "")}">Done</button></div>`;
      }
      case "mismatch":
        return `${head("Different account")}<div class="pane"><p>You signed in as ${esc(a.mismatchEmail ?? "")}, not ${esc(target?.email ?? "the account you picked")}.</p><button class="btn primary block" data-action="mismatchAdd">Add ${esc(a.mismatchEmail ?? "")} as a new account</button><button class="btn block" data-action="mismatchCancel">Cancel</button></div>`;
      case "error":
        return `${head("Something went wrong")}<div class="pane"><p class="err">${esc(a.message ?? "")}</p><button class="btn block" data-action="addDismiss">Close</button></div>`;
      default:
        return "";
    }
  }
  function renderManage(s, v) {
    const rows = s.accounts.map((a, i) => {
      const isActive = a.id === s.activeId;
      return `<div class="mrow"><button class="avatar-btn" data-action="color" data-id="${esc(a.id)}" title="Change colour">${avatarHtml(a.label, a.color)}</button><input class="input slim" data-action="rename" data-id="${esc(a.id)}" value="${esc(a.label)}" maxlength="32" aria-label="Label for ${esc(a.email)}"><button class="btn ghost icon" data-action="up" data-id="${esc(a.id)}" aria-label="Move up"${i === 0 ? " disabled" : ""}>\u2191</button><button class="btn ghost icon" data-action="down" data-id="${esc(a.id)}" aria-label="Move down"${i === s.accounts.length - 1 ? " disabled" : ""}>\u2193</button><button class="btn ghost danger" data-action="remove" data-id="${esc(a.id)}"${isActive ? ' disabled title="Switch to another account first"' : ""}>${v.confirmRemoveId === a.id ? "Confirm" : "Remove"}</button></div>`;
    }).join("");
    const seg = (pref, options, current) => `<div class="seg" role="group" aria-label="${pref}">${options.map(([value, text]) => `<button data-action="pref" data-pref="${pref}" data-value="${value}" aria-pressed="${value === current}">${text}</button>`).join("")}</div>`;
    const toggle = (pref, label) => `<div class="prefrow"><span>${label}</span><button class="switch" role="switch" data-action="toggle" data-pref="${pref}" aria-checked="${s.prefs[pref]}" aria-label="${label}"></button></div>`;
    return `${head("Manage", true)}<div class="pane">${rows || `<p class="muted">No accounts yet.</p>`}</div><hr class="divider"><div class="pane prefs"><div class="prefrow"><span>Theme</span>${seg("theme", [["system", "system"], ["dark", "dark"], ["light", "light"]], s.prefs.theme)}</div><div class="prefrow"><span>Style</span>${seg("style", [["app", "Claude"], ["cli", "CLI"]], s.prefs.style)}</div>${toggle("inPageSwitcher", "Switcher on claude.ai")}${toggle("badge", "Usage badge on the toolbar icon")}<p class="muted note">Saved sessions are stored unencrypted in this Chrome profile. Removing an account only forgets it here; it doesn't log you out.</p></div>`;
  }
  var withBanner = (html, error) => error ? html.replace("</header>", () => `</header><div class="error" role="alert">${esc(error)}</div>`) : html;
  function render(s, v, now, localError = null) {
    const err = localError ?? s.error;
    if (s.add.phase !== "idle") return withBanner(renderAdd(s), err);
    if (v.screen === "addIntro") return withBanner(renderAddIntro(), err);
    if (v.screen === "manage") return withBanner(renderManage(s, v), err);
    return withBanner(renderList(s, now), err);
  }

  // src/popup/popup.ts
  function applyPrefs(doc, s) {
    const html = doc.documentElement;
    if (s.prefs.theme === "system") html.removeAttribute("data-theme");
    else html.setAttribute("data-theme", s.prefs.theme);
    html.setAttribute("data-style", s.prefs.style);
  }
  var isEditable = (t) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
  function mount(root, send, initial, now = Date.now) {
    let state = initial;
    let failure = null;
    const view = { screen: "list", confirmRemoveId: null };
    const doc = root.ownerDocument;
    let lastHtml = null;
    const selectorOf = (el) => {
      const q = (v) => v.replace(/["\\]/g, "\\$&");
      if (el.id) return `#${el.id}`;
      const action = el.dataset.action;
      if (!action) return null;
      return ["id", "pref", "value"].reduce(
        (sel, k) => el.dataset[k] !== void 0 ? `${sel}[data-${k}="${q(el.dataset[k])}"]` : sel,
        `[data-action="${q(action)}"]`
      );
    };
    const draw = () => {
      applyPrefs(doc, state);
      const html = render(state, view, now(), failure);
      if (html === lastHtml) return;
      const active = doc.activeElement instanceof HTMLElement && root.contains(doc.activeElement) ? doc.activeElement : null;
      const sel = active ? selectorOf(active) : null;
      const typed = active instanceof HTMLInputElement ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
      root.innerHTML = html;
      lastHtml = html;
      const next = sel ? root.querySelector(sel) : null;
      if (!next) return;
      next.focus();
      if (typed && next instanceof HTMLInputElement) {
        next.value = typed.value;
        if (typed.start !== null && typed.end !== null) next.setSelectionRange(typed.start, typed.end);
      }
    };
    const run = async (req) => {
      try {
        await send(req);
        if (failure !== null) {
          failure = null;
          draw();
        }
        return true;
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
        draw();
        return false;
      }
    };
    const fire = (req) => void run(req);
    root.addEventListener("click", (e) => {
      const el = e.target?.closest("[data-action]");
      if (!el || el instanceof HTMLButtonElement && el.disabled) return;
      const id = el.dataset.id ?? "";
      if (el.dataset.action !== "remove" && view.confirmRemoveId !== null) {
        view.confirmRemoveId = null;
        draw();
      }
      switch (el.dataset.action) {
        case "switch":
          fire({ type: "switch", accountId: id });
          break;
        case "signin":
          fire({ type: "addAccount:start", targetAccountId: id });
          break;
        case "addIntro":
          view.screen = "addIntro";
          draw();
          break;
        case "addStart":
          view.screen = "list";
          fire({ type: "addAccount:start" });
          break;
        case "addCancel":
          fire({ type: "addAccount:cancel" });
          break;
        case "addDone": {
          const label = root.querySelector("#label")?.value ?? "";
          void run({ type: "account:update", accountId: id, patch: { label } }).then(
            (saved) => saved ? run({ type: "addAccount:dismiss" }) : void 0
          );
          break;
        }
        case "addDismiss":
          fire({ type: "addAccount:dismiss" });
          break;
        case "mismatchAdd":
          fire({ type: "addAccount:resolveMismatch", addAsNew: true });
          break;
        case "mismatchCancel":
          fire({ type: "addAccount:resolveMismatch", addAsNew: false });
          break;
        case "manage":
          view.screen = "manage";
          draw();
          break;
        case "back":
          view.screen = "list";
          view.confirmRemoveId = null;
          draw();
          break;
        case "color": {
          const a = state.accounts.find((x) => x.id === id);
          if (a) fire({ type: "account:update", accountId: id, patch: { color: (a.color + 1) % ACCOUNT_COLORS.length } });
          break;
        }
        case "up":
        case "down": {
          const order = state.accounts.map((a) => a.id);
          const i = order.indexOf(id);
          const j = el.dataset.action === "up" ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= order.length) break;
          [order[i], order[j]] = [order[j], order[i]];
          fire({ type: "account:reorder", order });
          break;
        }
        case "remove":
          if (view.confirmRemoveId === id) {
            view.confirmRemoveId = null;
            fire({ type: "account:remove", accountId: id });
          } else {
            view.confirmRemoveId = id;
            draw();
          }
          break;
        case "pref": {
          const pref = el.dataset.pref;
          fire({ type: "prefs:update", patch: { [pref]: el.dataset.value } });
          break;
        }
        case "toggle": {
          const pref = el.dataset.pref;
          fire({ type: "prefs:update", patch: { [pref]: !state.prefs[pref] } });
          break;
        }
      }
    });
    root.addEventListener("change", (e) => {
      const el = e.target;
      if (el.dataset.action === "rename" && el.dataset.id) fire({ type: "account:update", accountId: el.dataset.id, patch: { label: el.value } });
    });
    doc.addEventListener("keydown", (e) => {
      if (view.screen !== "list" || state.add.phase !== "idle" || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      const a = m ? state.accounts[Number(m[1]) - 1] : void 0;
      if (a && a.status === "ok") fire({ type: "switch", accountId: a.id });
    });
    draw();
    return {
      update(next) {
        state = next;
        draw();
      },
      current: () => state,
      view
    };
  }

  // src/popup/main.ts
  void (async () => {
    const root = document.getElementById("app");
    if (!root) return;
    let initial;
    try {
      initial = await sendToBackground({ type: "getState" });
    } catch (e) {
      root.textContent = e instanceof Error ? e.message : "Could not reach the extension";
      root.className = "error";
      return;
    }
    const app = mount(root, (req) => sendToBackground(req), initial);
    chrome.runtime.onMessage.addListener((msg) => {
      const push = msg;
      if (push?.type === "state") app.update(push.state);
      return false;
    });
    setInterval(() => app.update(app.current()), 5e3);
  })();
})();
