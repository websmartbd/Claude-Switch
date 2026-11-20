var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/shared/env.ts
var CLAUDE_ORIGIN = true ? "https://claude.ai" : "https://claude.ai";
var parsed = new URL(CLAUDE_ORIGIN);
var CLAUDE_HOST = parsed.hostname;
var CLAUDE_TAB_PATTERN = `${parsed.protocol}//${parsed.hostname}/*`;
var CLAUDE_API_PATTERN = `${parsed.protocol}//${parsed.hostname}/api/*`;

// src/shared/types.ts
var ACCOUNT_COLORS = ["#c96442", "#7d8b4e", "#5b7aa6", "#8e5a8a", "#b0893e", "#4f8f87"];

// src/background/serial.ts
function createSerialQueue() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => void 0);
    return run;
  };
}

// src/background/accounts.ts
var STORE_KEY = "cas:state";
var RESOURCE_MAP_LIMIT = 500;
var DEFAULT_PREFS = { theme: "system", style: "app", inPageSwitcher: true, badge: true };
var PUBLIC_MAIL = /* @__PURE__ */ new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com"
]);
var UnsupportedStoreVersion = class extends Error {
};
function emptyState() {
  return { version: 1, accounts: {}, order: [], activeId: null, resourceMap: {}, prefs: { ...DEFAULT_PREFS } };
}
function migrate(raw) {
  if (raw === void 0 || raw === null) return emptyState();
  const r = raw;
  if (r.version !== 1) throw new UnsupportedStoreVersion(`Unsupported store version ${String(r.version)}`);
  return { ...emptyState(), ...r, prefs: sanitizePrefs({ ...DEFAULT_PREFS, ...r.prefs ?? {} }) };
}
var capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function defaultLabel(identity) {
  const [local = "", domain = ""] = identity.email.toLowerCase().split("@");
  const base = !domain || PUBLIC_MAIL.has(domain) ? local : domain.split(".")[0] ?? local;
  return capitalize(base);
}
function pickLabel(identity, taken) {
  const first = defaultLabel(identity);
  if (!taken.has(first)) return first;
  const second = capitalize((identity.email.split("@")[0] ?? "").toLowerCase());
  if (second && !taken.has(second)) return second;
  let n = 2;
  while (taken.has(`${first} ${n}`)) n++;
  return `${first} ${n}`;
}
function orderedAccounts(state) {
  return state.order.map((id) => state.accounts[id]).filter((a) => a !== void 0);
}
function toPublic(a) {
  const { cookies: _cookies, ...rest } = a;
  return rest;
}
function sanitizePrefs(p) {
  return {
    theme: p.theme === "dark" || p.theme === "light" ? p.theme : "system",
    style: p.style === "cli" ? "cli" : "app",
    inPageSwitcher: Boolean(p.inPageSwitcher),
    badge: Boolean(p.badge)
  };
}
function firstFreeColor(used) {
  for (let i = 0; i < ACCOUNT_COLORS.length; i++) if (!used.has(i)) return i;
  return used.size % ACCOUNT_COLORS.length;
}
var AccountStore = class {
  constructor(area = chrome.storage.local) {
    this.area = area;
  }
  area;
  serial = createSerialQueue();
  async load() {
    const got = await this.area.get(STORE_KEY);
    return migrate(got[STORE_KEY]);
  }
  /** Read-modify-write, serialized so concurrent callers never lose each other's writes. */
  update(fn) {
    return this.serial(async () => {
      const s = await this.load();
      fn(s);
      await this.area.set({ [STORE_KEY]: s });
      return s;
    });
  }
  async list() {
    return orderedAccounts(await this.load());
  }
  async get(id) {
    return (await this.load()).accounts[id];
  }
  async upsert(identity, cookies, now2) {
    let out;
    await this.update((s) => {
      const prev = s.accounts[identity.accountUuid];
      const others = Object.values(s.accounts).filter((a) => a.id !== identity.accountUuid);
      const account = {
        id: identity.accountUuid,
        email: identity.email,
        name: identity.name,
        label: prev?.label ?? pickLabel(identity, new Set(others.map((a) => a.label))),
        color: prev?.color ?? firstFreeColor(new Set(others.map((a) => a.color))),
        plan: identity.plan,
        orgUuid: identity.orgUuid,
        cookies,
        savedAt: now2,
        status: "ok"
      };
      s.accounts[account.id] = account;
      if (!s.order.includes(account.id)) s.order.push(account.id);
      out = { account, isNew: !prev };
    });
    return out;
  }
  async setCookies(id, cookies, now2) {
    await this.update((s) => {
      const a = s.accounts[id];
      if (!a) return;
      a.cookies = cookies;
      a.savedAt = now2;
      a.status = "ok";
    });
  }
  async setActive(id) {
    await this.update((s) => {
      s.activeId = id !== null && s.accounts[id] ? id : null;
    });
  }
  async setStatus(id, status) {
    await this.update((s) => {
      const a = s.accounts[id];
      if (a) a.status = status;
    });
  }
  async rename(id, label) {
    await this.update((s) => {
      const a = s.accounts[id];
      if (!a) return;
      const trimmed = label.trim().slice(0, 32);
      a.label = trimmed || defaultLabel(a);
    });
  }
  async setColor(id, color) {
    await this.update((s) => {
      const a = s.accounts[id];
      if (!a) return;
      const n = ACCOUNT_COLORS.length;
      a.color = (Math.trunc(color) % n + n) % n;
    });
  }
  async remove(id) {
    await this.update((s) => {
      delete s.accounts[id];
      s.order = s.order.filter((x) => x !== id);
      if (s.activeId === id) s.activeId = null;
      for (const [key, r] of Object.entries(s.resourceMap)) if (r.accountId === id) delete s.resourceMap[key];
    });
  }
  async reorder(order) {
    await this.update((s) => {
      const known = order.filter((id, i) => s.accounts[id] !== void 0 && order.indexOf(id) === i);
      s.order = [...known, ...s.order.filter((id) => !known.includes(id))];
    });
  }
  async rememberResource(resourceKey, accountId, now2 = Date.now()) {
    await this.update((s) => {
      if (!s.accounts[accountId]) return;
      s.resourceMap[resourceKey] = { accountId, at: now2 };
      const entries = Object.entries(s.resourceMap);
      if (entries.length <= RESOURCE_MAP_LIMIT) return;
      entries.sort(([, a], [, b]) => b.at - a.at);
      for (const [key] of entries.slice(RESOURCE_MAP_LIMIT)) delete s.resourceMap[key];
    });
  }
  async resourceAccount(resourceKey) {
    return (await this.load()).resourceMap[resourceKey]?.accountId;
  }
  async updatePrefs(patch) {
    await this.update((s) => {
      s.prefs = sanitizePrefs({ ...s.prefs, ...patch });
    });
  }
};

// src/background/claudeApi.ts
var SESSION_COOKIE = "sessionKey";
var ORG_COOKIE = "lastActiveOrg";
var IDENTITY_PATH = "/api/bootstrap";
var LOGIN_PATH = "/login";
var PRESERVED_COOKIES = /* @__PURE__ */ new Set(["__cf_bm", "cf_clearance", "_cfuvid"]);
var defaultFetch = (input, init) => fetch(input, init);
var AuthError = class extends Error {
  constructor(status) {
    super(`claude.ai answered ${status}`);
    this.status = status;
    this.name = "AuthError";
  }
  status;
};
var NetworkError = class extends Error {
  constructor(message2) {
    super(message2);
    this.name = "NetworkError";
  }
};
var str = (v) => typeof v === "string" && v.length > 0 ? v : void 0;
var strs = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
function planLabel(org) {
  const tier = org.rateLimitTier ?? "";
  const caps = org.capabilities ?? [];
  if (tier.includes("max_20x")) return "Max 20x";
  if (tier.includes("max_5x")) return "Max 5x";
  if (caps.includes("claude_max")) return "Max";
  if (caps.includes("raven")) return "Team";
  if (caps.includes("enterprise")) return "Enterprise";
  if (caps.includes("claude_pro")) return "Pro";
  return "Free";
}
function parseIdentity(json, preferredOrgUuid) {
  const account = json?.account;
  const uuid = str(account?.uuid);
  const email = str(account?.email_address);
  if (!uuid || !email) throw new Error("Unexpected identity response: missing account uuid or email");
  const memberships = Array.isArray(account?.memberships) ? account.memberships : [];
  const orgs = memberships.map((m) => m.organization).filter((o) => !!o && typeof o.uuid === "string");
  const chatOrgs = orgs.filter((o) => strs(o.capabilities).includes("chat"));
  const pool = chatOrgs.length > 0 ? chatOrgs : orgs;
  const org = pool.find((o) => o.uuid === preferredOrgUuid) ?? pool[0];
  return {
    accountUuid: uuid,
    email,
    name: str(account?.full_name) ?? str(account?.display_name) ?? email,
    orgUuid: str(org?.uuid) ?? "",
    orgName: str(org?.name) ?? "",
    plan: planLabel({ capabilities: strs(org?.capabilities), rateLimitTier: str(org?.rate_limit_tier) ?? null })
  };
}
async function getJson(fetchImpl, path) {
  let res;
  try {
    res = await fetchImpl(`${CLAUDE_ORIGIN}${path}`, {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" }
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
  if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
  if (!res.ok) throw new NetworkError(`claude.ai answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new NetworkError("claude.ai answered with a non-JSON body");
  }
}
async function whoAmI(opts = {}) {
  const json = await getJson(opts.fetchImpl ?? defaultFetch, IDENTITY_PATH);
  if (json?.account === null) throw new AuthError(401);
  return parseIdentity(json, opts.preferredOrgUuid);
}
var usagePath = (orgUuid) => `/api/organizations/${encodeURIComponent(orgUuid)}/usage`;
async function fetchUsageJson(orgUuid, fetchImpl = defaultFetch) {
  return getJson(fetchImpl, usagePath(orgUuid));
}
function isResourceMiss(apiUrl, statusCode, resourceId) {
  if (statusCode !== 403 && statusCode !== 404) return false;
  let u;
  try {
    u = new URL(apiUrl);
  } catch {
    return false;
  }
  return u.origin === CLAUDE_ORIGIN && u.pathname.startsWith("/api/") && u.pathname.toLowerCase().includes(resourceId.toLowerCase());
}
var loginUrl = () => `${CLAUDE_ORIGIN}${LOGIN_PATH}`;
function hostMatchesClaude(cookieDomain) {
  const d = cookieDomain.replace(/^\./, "");
  return d === CLAUDE_HOST || CLAUDE_HOST.endsWith(`.${d}`);
}

// src/background/cookieJar.ts
var cookieJar_exports = {};
__export(cookieJar_exports, {
  clear: () => clear,
  cookieUrl: () => cookieUrl,
  hasLiveSession: () => hasLiveSession,
  isExpired: () => isExpired,
  restore: () => restore,
  selectedOrg: () => selectedOrg,
  snapshot: () => snapshot,
  toStored: () => toStored
});
var asChrome = (v) => v;
function toStored(c) {
  const s = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: String(c.sameSite ?? "unspecified"),
    hostOnly: c.hostOnly
  };
  if (c.expirationDate !== void 0) s.expirationDate = c.expirationDate;
  return s;
}
function cookieUrl(c) {
  return `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`;
}
function isExpired(c, nowMs) {
  return c.expirationDate !== void 0 && c.expirationDate * 1e3 <= nowMs;
}
function hasLiveSession(cookies, nowMs) {
  return cookies.some((c) => c.name === SESSION_COOKIE && c.value !== "" && !isExpired(c, nowMs));
}
function selectedOrg(cookies) {
  return cookies.find((c) => c.name === ORG_COOKIE && c.value !== "")?.value ?? null;
}
async function claudeCookies() {
  const all = await chrome.cookies.getAll({ domain: CLAUDE_HOST });
  return all.filter((c) => !PRESERVED_COOKIES.has(c.name));
}
async function snapshot() {
  return (await claudeCookies()).map(toStored);
}
async function clear() {
  const doomed = await claudeCookies();
  await Promise.all(
    doomed.map((c) => chrome.cookies.remove({ url: cookieUrl(c), name: c.name, ...c.storeId ? { storeId: c.storeId } : {} }))
  );
  return doomed.length;
}
async function restore(cookies, nowMs = Date.now()) {
  let restored = 0;
  for (const c of cookies) {
    if (PRESERVED_COOKIES.has(c.name) || isExpired(c, nowMs)) continue;
    const details = {
      url: cookieUrl(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: asChrome(c.sameSite)
    };
    if (!c.hostOnly) details.domain = c.domain;
    if (c.expirationDate !== void 0) details.expirationDate = c.expirationDate;
    const set = await chrome.cookies.set(details);
    if (!set) throw new Error(`Chrome refused to restore cookie ${c.name}`);
    restored++;
  }
  return restored;
}

// src/background/switcher.ts
async function reloadClaudeTabs(exceptTabId) {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_PATTERN });
  const results = await Promise.allSettled(tabs.map(async (t) => {
    if (t.id === void 0 || t.id === exceptTabId) return;
    try {
      const u = new URL(t.url || "");
      if (u.pathname.startsWith("/chat/") || u.pathname.startsWith("/project/")) {
        await chrome.tabs.update(t.id, { url: "https://claude.ai/new" });
      } else {
        await chrome.tabs.reload(t.id);
      }
    } catch {
      await chrome.tabs.reload(t.id).catch(() => void 0);
    }
  }));
  return results.filter((r) => r.status === "fulfilled").length;
}
async function saveCurrentSession(deps) {
  const cookies = await deps.jar.snapshot();
  if (!hasLiveSession(cookies, deps.now())) return { savedTo: null, cookies, isNew: false };
  let identity;
  try {
    identity = await deps.api.whoAmI(selectedOrg(cookies));
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) return { savedTo: null, cookies, isNew: false };
    throw e;
  }
  const fresh = await deps.jar.snapshot();
  const { account, isNew } = await deps.store.upsert(identity, fresh, deps.now());
  return { savedTo: account.id, cookies: fresh, isNew };
}
var message = (e) => e instanceof Error ? e.message : String(e);
var Switcher = class {
  constructor(deps, onChange = () => {
  }) {
    this.deps = deps;
    this.onChange = onChange;
  }
  deps;
  onChange;
  running = null;
  pending = null;
  target = null;
  get switchingTo() {
    return this.target;
  }
  /** Queues a switch. While one runs, only the latest request waits; earlier waiting ones resolve "superseded". */
  switchTo(accountId) {
    return new Promise((resolve) => {
      if (this.pending) this.pending.resolve({ status: "superseded", accountId: this.pending.accountId });
      this.pending = { accountId, resolve };
      if (!this.running) this.running = this.drain();
    });
  }
  async idle() {
    while (this.running) await this.running;
  }
  notify(...args) {
    try {
      this.onChange(...args);
    } catch {
      console.warn("Switcher onChange listener failed");
    }
  }
  async drain() {
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        this.target = job.accountId;
        this.notify(job.accountId);
        let result;
        try {
          result = await this.run(job.accountId);
        } catch (e) {
          result = { status: "error", accountId: job.accountId, message: message(e) };
        }
        this.target = null;
        job.resolve(result);
        this.notify(null, result);
      }
    } finally {
      this.running = null;
    }
  }
  async run(accountId) {
    const { jar, store: store2, api, tabs, now: now2 } = this.deps;
    const target = await store2.get(accountId);
    if (!target) return { status: "error", accountId, message: "Unknown account" };
    if (!hasLiveSession(target.cookies, now2())) {
      await store2.setStatus(accountId, "signedOut");
      return { status: "signedOut", accountId };
    }
    const previous = await saveCurrentSession(this.deps);
    if (previous.savedTo === accountId) {
      await store2.setActive(accountId);
      return { status: "switched", accountId, reloadedTabs: 0 };
    }
    const rollback = async () => {
      try {
        await jar.clear();
        await jar.restore(previous.cookies, now2());
        return true;
      } catch {
        console.warn("Could not restore the previous claude.ai session");
        return false;
      }
    };
    const failure = (text, restored) => ({
      status: "error",
      accountId,
      message: restored ? text : `${text} (restoring the previous session also failed)`
    });
    try {
      await jar.clear();
      await jar.restore(target.cookies, now2());
    } catch (e) {
      return failure(message(e), await rollback());
    }
    let identity;
    try {
      identity = await api.whoAmI(target.orgUuid);
    } catch (e) {
      const restored = await rollback();
      if (e instanceof AuthError) {
        await store2.setStatus(accountId, "signedOut");
        return { status: "signedOut", accountId };
      }
      return failure(message(e), restored);
    }
    if (identity.accountUuid !== accountId) {
      return failure(`The saved session belongs to ${identity.email}`, await rollback());
    }
    try {
      await store2.setCookies(accountId, await jar.snapshot(), now2());
      await store2.setActive(accountId);
    } catch (e) {
      return failure(message(e), await rollback());
    }
    const reloadedTabs = await tabs.reloadClaudeTabs().catch(() => 0);
    return { status: "switched", accountId, reloadedTabs };
  }
};

// src/background/addAccount.ts
var ADD_FLOW_KEY = "cas:addFlow";
var ADD_FLOW_TIMEOUT_MS = 15 * 60 * 1e3;
function toPublicAdd(s) {
  const base = { phase: s.phase, targetAccountId: null, savedAccountId: null, isNew: false, mismatchEmail: null, message: null };
  switch (s.phase) {
    case "waitingLogin":
      return { ...base, targetAccountId: s.targetAccountId, message: s.message ?? null };
    case "saved":
      return { ...base, savedAccountId: s.accountId, isNew: s.isNew };
    case "mismatch":
      return { ...base, targetAccountId: s.targetAccountId, mismatchEmail: s.identity.email };
    case "error":
      return { ...base, message: s.message };
    default:
      return base;
  }
}
var AddAccountFlow = class {
  constructor(deps, onChange = () => {
  }) {
    this.deps = deps;
    this.onChange = onChange;
  }
  deps;
  onChange;
  serial = createSerialQueue();
  state() {
    return this.serial(async () => {
      let s = await this.read();
      if (s.phase === "waitingLogin") {
        await this.tryComplete(s);
        s = await this.read();
        if (s.phase === "waitingLogin" && this.deps.now() - s.startedAt > ADD_FLOW_TIMEOUT_MS && !hasLiveSession(await this.deps.jar.snapshot(), this.deps.now())) {
          await this.cancelNow(s);
          s = await this.read();
        }
      }
      return toPublicAdd(s);
    });
  }
  isWaiting() {
    return this.serial(async () => ["waitingLogin", "mismatch"].includes((await this.read()).phase));
  }
  start(targetAccountId = null) {
    return this.serial(async () => {
      const current = await this.read();
      if (current.phase === "waitingLogin" || current.phase === "mismatch") return;
      let previous;
      try {
        previous = await saveCurrentSession(this.deps);
      } catch (e) {
        await this.write({ phase: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      await this.write({
        phase: "waitingLogin",
        loginTabId: null,
        previousCookies: previous.cookies,
        previousActiveId: previous.savedTo,
        targetAccountId,
        startedAt: this.deps.now()
      });
      await this.deps.jar.clear();
      const loginTabId = await this.deps.openLoginTab(loginUrl());
      const s = await this.read();
      if (s.phase === "waitingLogin") await this.write({ ...s, loginTabId });
    });
  }
  onCookieChanged(info) {
    if (info.removed || info.cookie.name !== SESSION_COOKIE || !hostMatchesClaude(info.cookie.domain)) return Promise.resolve();
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase === "waitingLogin") await this.tryComplete(s);
    });
  }
  resolveMismatch(addAsNew) {
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase !== "mismatch") return;
      if (addAsNew) await this.saveAndFinish(s.identity, s.cookies, s.loginTabId);
      else await this.cancelNow(s);
    });
  }
  cancel() {
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase === "waitingLogin" || s.phase === "mismatch") await this.cancelNow(s);
      else if (s.phase !== "idle") await this.write({ phase: "idle" });
    });
  }
  dismiss() {
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase === "saved" || s.phase === "error") await this.write({ phase: "idle" });
    });
  }
  // --- internals (call only from inside serial())
  async read() {
    const got = await this.deps.session.get(ADD_FLOW_KEY);
    return got[ADD_FLOW_KEY] ?? { phase: "idle" };
  }
  async write(s) {
    await this.deps.session.set({ [ADD_FLOW_KEY]: s });
    try {
      this.onChange(toPublicAdd(s));
    } catch {
      console.warn("AddAccountFlow onChange listener failed");
    }
  }
  async tryComplete(s) {
    const cookies = await this.deps.jar.snapshot();
    if (!hasLiveSession(cookies, this.deps.now())) return this.setMessage(s, void 0);
    let identity;
    try {
      identity = await this.deps.api.whoAmI(selectedOrg(cookies));
    } catch {
      return this.setMessage(s, await this.unverifiedMessage(s.previousActiveId));
    }
    const fresh = await this.deps.jar.snapshot();
    if (s.targetAccountId && identity.accountUuid !== s.targetAccountId) {
      await this.write({
        phase: "mismatch",
        identity,
        cookies: fresh,
        targetAccountId: s.targetAccountId,
        previousCookies: s.previousCookies,
        previousActiveId: s.previousActiveId,
        loginTabId: s.loginTabId
      });
      return;
    }
    await this.saveAndFinish(identity, fresh, s.loginTabId);
  }
  /** Writes only when the message changes, so repeated checks don't re-broadcast the same state. */
  async setMessage(s, message2) {
    if (s.message === message2) return;
    const { message: _previous, ...rest } = s;
    await this.write(message2 === void 0 ? rest : { ...rest, message: message2 });
  }
  async unverifiedMessage(previousActiveId) {
    const previous = previousActiveId === null ? void 0 : await this.deps.store.get(previousActiveId);
    const back = previous ? `go back to ${previous.label}` : "go back to being signed out";
    return `Signed in, but claude.ai's identity check failed \u2014 reopen this popup to try again, or Cancel to ${back}.`;
  }
  async saveAndFinish(identity, cookies, loginTabId) {
    const { account, isNew } = await this.deps.store.upsert(identity, cookies, this.deps.now());
    await this.deps.store.setActive(account.id);
    await this.write({ phase: "saved", accountId: account.id, isNew });
    await this.deps.tabs.reloadClaudeTabs(loginTabId ?? void 0);
  }
  async cancelNow(s) {
    await this.deps.jar.clear();
    await this.deps.jar.restore(s.previousCookies, this.deps.now());
    await this.deps.store.setActive(s.previousActiveId);
    if (s.loginTabId !== void 0 && s.loginTabId !== null) await this.deps.closeTab(s.loginTabId).catch(() => void 0);
    await this.write({ phase: "idle" });
    await this.deps.tabs.reloadClaudeTabs();
  }
};

// src/shared/resourceKey.ts
var UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
var ROUTES = [
  { kind: "codeArtifact", re: /^\/code\/artifact\/([A-Za-z0-9_-]+)\/?$/ },
  { kind: "artifact", re: /^\/artifact\/([A-Za-z0-9_-]+)\/?$/ },
  { kind: "chat", re: new RegExp(`^/chat/(${UUID})/?$`), uuid: true },
  { kind: "project", re: new RegExp(`^/project/(${UUID})/?$`), uuid: true }
];
function parseResourceUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== CLAUDE_ORIGIN) return null;
  for (const { kind, re, uuid } of ROUTES) {
    const m = re.exec(u.pathname);
    if (!m?.[1]) continue;
    const id = uuid ? m[1].toLowerCase() : m[1];
    return { kind, id, key: `${kind}:${id}` };
  }
  return null;
}

// src/background/rescue.ts
var RescueTracker = class {
  constructor(store2) {
    this.store = store2;
  }
  store;
  misses = /* @__PURE__ */ new Map();
  /** Returns the tab to notify (first miss for that resource), else null. */
  async onApiCompleted(d, pageUrlOf) {
    if (d.tabId < 0 || d.statusCode !== 403 && d.statusCode !== 404) return null;
    const pageUrl = await pageUrlOf(d.tabId);
    const ref = pageUrl ? parseResourceUrl(pageUrl) : null;
    if (!pageUrl || !ref || !isResourceMiss(d.url, d.statusCode, ref.id)) return null;
    const previous = this.misses.get(d.tabId);
    this.misses.set(d.tabId, { ref });
    return previous?.ref.key === ref.key ? null : d.tabId;
  }
  onTabUpdated(tabId, change) {
    const m = this.misses.get(tabId);
    if (!m) return;
    if (change.status === "loading" || change.url !== void 0 && parseResourceUrl(change.url)?.key !== m.ref.key) {
      this.misses.delete(tabId);
    }
  }
  onTabRemoved(tabId) {
    this.misses.delete(tabId);
  }
  miss(tabId) {
    return this.misses.get(tabId);
  }
  async info(tabId) {
    const m = this.misses.get(tabId);
    if (!m) return null;
    const s = await this.store.load();
    const remembered = s.resourceMap[m.ref.key]?.accountId ?? null;
    const candidates = orderedAccounts(s).filter((a) => a.id !== s.activeId).map(toPublic).sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered));
    return { resourceKey: m.ref.key, kind: m.ref.kind, currentAccountId: s.activeId, candidates, rememberedAccountId: remembered };
  }
};
async function openAs(store2, switchTo, resourceKey, accountId) {
  await store2.rememberResource(resourceKey, accountId);
  return switchTo(accountId);
}

// src/shared/usageFormat.ts
function levelOf(percent) {
  if (percent >= 90) return "crit";
  if (percent >= 70) return "warn";
  return "ok";
}

// src/background/usage.ts
var USAGE_KEY = "cas:usage";
var USAGE_ALARM = "cas:usage-refresh";
var USAGE_PERIOD_MIN = 15;
var USAGE_MAX_AGE_MS = 6e4;
var BADGE_WARN = "#e5a83b";
var BADGE_CRIT = "#ff6b80";
var KNOWN_MODELS = ["fable", "opus", "sonnet", "haiku"];
var RANK = { session: 0, weekly_all: 1 };
var pct = (v) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
var str2 = (v) => typeof v === "string" && v.length > 0 ? v : null;
var obj = (v) => v !== null && typeof v === "object" ? v : null;
var sortLimits = (l) => [...l].sort((a, b) => (RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2));
function parseUsage(json) {
  const o = obj(json);
  if (!o) return [];
  if (Array.isArray(o.limits)) {
    const out2 = [];
    for (const raw of o.limits) {
      const r = obj(raw);
      const percent = pct(r?.percent);
      if (!r || percent === null) continue;
      const kind = str2(r.kind) ?? "unknown";
      const model = str2(obj(obj(r.scope)?.model)?.display_name);
      const label = kind === "session" ? "5h" : kind === "weekly_all" ? "week" : model;
      if (!label) continue;
      out2.push({ kind, label, percent, resetsAt: str2(r.resets_at) });
    }
    if (out2.length > 0) return sortLimits(out2);
  }
  const out = [];
  const windowLimit = (key, kind, label) => {
    const w = obj(o[key]);
    const percent = pct(w?.utilization);
    if (w && percent !== null) out.push({ kind, label, percent, resetsAt: str2(w.resets_at) });
  };
  windowLimit("five_hour", "session", "5h");
  windowLimit("seven_day", "weekly_all", "week");
  for (const m of KNOWN_MODELS) windowLimit(`seven_day_${m}`, "weekly_scoped", m.charAt(0).toUpperCase() + m.slice(1));
  return sortLimits(out);
}
function badgeFor(snapshot2, enabled) {
  if (!enabled || !snapshot2 || snapshot2.limits.length === 0) return { text: "", color: null };
  const max = Math.max(...snapshot2.limits.map((l) => l.percent));
  const level = levelOf(max);
  if (level === "ok") return { text: "", color: null };
  return { text: `${Math.round(max)}%`, color: level === "crit" ? BADGE_CRIT : BADGE_WARN };
}
var UsageService = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  serial = createSerialQueue();
  async all() {
    const got = await this.deps.area.get(USAGE_KEY);
    return got[USAGE_KEY] ?? {};
  }
  /** Fetches the active account's usage unless its snapshot is younger than `maxAgeMs`. Serialized. */
  refreshActive(maxAgeMs = 0) {
    return this.serial(() => this.doRefresh(maxAgeMs));
  }
  /** A removed account's numbers go with it. Serialized with refreshes, so one can't write them back. */
  forget(accountId) {
    return this.serial(async () => {
      const all = await this.all();
      if (!(accountId in all)) return;
      delete all[accountId];
      await this.deps.area.set({ [USAGE_KEY]: all });
    });
  }
  async updateBadge() {
    const s = await this.deps.store.load();
    const all = await this.all();
    const b = badgeFor(s.activeId ? all[s.activeId] : void 0, s.prefs.badge);
    await this.deps.setBadge(b.text, b.color);
  }
  async doRefresh(maxAgeMs) {
    const s = await this.deps.store.load();
    const active = s.activeId ? s.accounts[s.activeId] : void 0;
    if (!active || active.status !== "ok" || !active.orgUuid) return false;
    const all = await this.all();
    const prev = all[active.id];
    if (prev && this.deps.now() - prev.fetchedAt < maxAgeMs) return false;
    let limits;
    try {
      limits = parseUsage(await this.deps.fetchUsage(active.orgUuid));
    } catch {
      return false;
    }
    if (limits.length === 0) return false;
    const next = {};
    for (const { id } of orderedAccounts(s)) {
      const snap = all[id];
      if (snap) next[id] = snap;
    }
    next[active.id] = { limits, fetchedAt: this.deps.now() };
    await this.deps.area.set({ [USAGE_KEY]: next });
    await this.updateBadge();
    return true;
  }
};

// src/background/router.ts
var REQUEST_TYPES = {
  getState: true,
  switch: true,
  "addAccount:start": true,
  "addAccount:cancel": true,
  "addAccount:resolveMismatch": true,
  "addAccount:dismiss": true,
  "account:update": true,
  "account:remove": true,
  "account:reorder": true,
  "prefs:update": true,
  "rescue:get": true,
  "rescue:openAs": true
};
var PAGE_REQUESTS = /* @__PURE__ */ new Set([
  "getState",
  "rescue:get",
  "switch",
  "addAccount:start",
  "rescue:openAs"
]);
function fromPage(sender) {
  return sender.tab !== void 0 && !(sender.url ?? "").startsWith(chrome.runtime.getURL(""));
}
function isRequest(msg) {
  if (typeof msg !== "object" || msg === null) return false;
  const type = msg.type;
  return typeof type === "string" && Object.hasOwn(REQUEST_TYPES, type);
}
async function buildUiState(deps) {
  const s = await deps.store.load();
  const accounts = orderedAccounts(s).map(toPublic);
  const all = await deps.usage.all();
  const usage2 = {};
  for (const a of accounts) {
    const snap = all[a.id];
    if (snap) usage2[a.id] = snap;
  }
  return {
    accounts,
    activeId: s.activeId,
    prefs: s.prefs,
    switchingTo: deps.switcher.switchingTo,
    lastSwitch: deps.lastSwitch(),
    add: await deps.addFlow.state(),
    usage: usage2,
    error: deps.lastError()
  };
}
async function broadcastPush(push) {
  await chrome.runtime.sendMessage(push).catch(() => void 0);
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_PATTERN });
  await Promise.allSettled(tabs.map((t) => t.id === void 0 ? Promise.resolve() : chrome.tabs.sendMessage(t.id, push)));
}
async function refreshUsage(deps, maxAgeMs) {
  await deps.switcher.idle();
  if (await deps.addFlow.isWaiting()) return false;
  return deps.usage.refreshActive(maxAgeMs);
}
function createRouter(deps) {
  const ok = (data) => ({ ok: true, data });
  const fail = (error) => ({ ok: false, error });
  const mutate = async (fn) => {
    await fn();
    await deps.broadcast();
    return ok(null);
  };
  const afterSwitch = async (fn) => {
    await deps.switcher.idle();
    await fn();
  };
  const cancelPendingAdd = async () => {
    if (await deps.addFlow.isWaiting()) await afterSwitch(() => deps.addFlow.cancel());
  };
  async function route(req, sender) {
    switch (req.type) {
      case "getState": {
        if (!fromPage(sender)) {
          void refreshUsage(deps, USAGE_MAX_AGE_MS).then((fetched) => fetched ? deps.broadcast() : void 0).catch(() => console.warn("Could not refresh usage"));
        }
        return ok(await buildUiState(deps));
      }
      case "switch":
        await cancelPendingAdd();
        void deps.switcher.switchTo(req.accountId);
        return ok(null);
      case "addAccount:start":
        return mutate(() => afterSwitch(() => deps.addFlow.start(req.targetAccountId ?? null)));
      case "addAccount:cancel":
        return mutate(() => afterSwitch(() => deps.addFlow.cancel()));
      case "addAccount:resolveMismatch":
        return mutate(() => afterSwitch(() => deps.addFlow.resolveMismatch(req.addAsNew)));
      case "addAccount:dismiss":
        return mutate(() => deps.addFlow.dismiss());
      case "account:update":
        return mutate(async () => {
          if (req.patch.label !== void 0) await deps.store.rename(req.accountId, req.patch.label);
          if (req.patch.color !== void 0) await deps.store.setColor(req.accountId, req.patch.color);
        });
      case "account:remove":
        return mutate(async () => {
          await deps.store.remove(req.accountId);
          await deps.usage.forget(req.accountId);
        });
      case "account:reorder":
        return mutate(() => deps.store.reorder(req.order));
      case "prefs:update":
        return mutate(async () => {
          await deps.store.updatePrefs(req.patch);
          await deps.usage.updateBadge();
        });
      case "rescue:get": {
        const tabId = sender.tab?.id;
        return ok(tabId === void 0 ? null : await deps.rescue.info(tabId));
      }
      case "rescue:openAs":
        if (parseResourceUrl(sender.url ?? "")?.key !== req.resourceKey) return fail("Nothing to open on this tab");
        await cancelPendingAdd();
        void openAs(deps.store, (id) => deps.switcher.switchTo(id), req.resourceKey, req.accountId).catch(
          () => console.warn("Open as failed")
        );
        return ok(null);
      default:
        return fail(`Unknown request ${req.type}`);
    }
  }
  return async function handle2(req, sender) {
    if (fromPage(sender) && !PAGE_REQUESTS.has(req.type)) return fail("Not available from a claude.ai page");
    try {
      return await route(req, sender);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

// src/background/index.ts
var store = new AccountStore(chrome.storage.local);
var now = () => Date.now();
var lastSwitch = null;
var lastError = null;
var switchDeps = {
  jar: cookieJar_exports,
  store,
  api: { whoAmI: (org) => whoAmI({ preferredOrgUuid: org ?? null }) },
  tabs: { reloadClaudeTabs },
  now
};
var usage = new UsageService({
  store,
  area: chrome.storage.local,
  fetchUsage: (org) => fetchUsageJson(org),
  now,
  setBadge: async (text, color) => {
    await chrome.action.setBadgeText({ text });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  }
});
var pushState = () => void broadcast().catch(() => console.warn("Could not send the latest state"));
var refreshUsageAndBroadcast = () => void refreshUsage(routerDeps, 0).then((fetched) => fetched ? void 0 : usage.updateBadge()).catch(() => console.warn("Could not refresh usage")).then(() => broadcast()).catch(() => console.warn("Could not send the latest state"));
var switcher = new Switcher(switchDeps, (switchingTo, result) => {
  if (switchingTo !== null) lastError = null;
  if (result?.status === "switched") {
    lastSwitch = { accountId: result.accountId, reloadedTabs: result.reloadedTabs, at: now() };
    refreshUsageAndBroadcast();
    return;
  }
  if (result?.status === "signedOut") lastError = "That account is signed out \u2014 sign in again.";
  if (result?.status === "error") lastError = result.message;
  pushState();
});
var addFlow = new AddAccountFlow(
  {
    ...switchDeps,
    session: chrome.storage.session,
    openLoginTab: async (url) => (await chrome.tabs.create({ url, active: true })).id ?? null,
    closeTab: (id) => chrome.tabs.remove(id)
  },
  (s) => {
    if (s.phase === "saved") {
      lastError = null;
      refreshUsageAndBroadcast();
    } else pushState();
  }
);
var rescue = new RescueTracker(store);
var routerDeps = {
  store,
  switcher,
  addFlow,
  rescue,
  usage,
  broadcast,
  lastSwitch: () => lastSwitch,
  lastError: () => lastError
};
var handle = createRouter(routerDeps);
async function broadcast() {
  await broadcastPush({ type: "state", state: await buildUiState(routerDeps) });
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isRequest(msg)) return false;
  void handle(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: "The extension could not handle that request" }));
  return true;
});
chrome.cookies.onChanged.addListener((info) => {
  void addFlow.onCookieChanged(info).catch(() => console.warn("Could not check the new claude.ai login"));
});
chrome.webRequest.onCompleted.addListener(
  (d) => {
    if (switcher.switchingTo || (lastSwitch && Date.now() - lastSwitch.at < 6000)) return;
    void rescue.onApiCompleted(d, async (tabId) => (await chrome.tabs.get(tabId).catch(() => void 0))?.url).then(async (tabId) => {
      if (tabId === null) return;
      const info = await rescue.info(tabId);
      if (!info) return;
      const push = { type: "rescue:show", rescue: info };
      await chrome.tabs.sendMessage(tabId, push).catch(() => void 0);
    }).catch(() => console.warn("Could not check a claude.ai link"));
  },
  { urls: [CLAUDE_API_PATTERN], types: ["xmlhttprequest"] }
);
chrome.tabs.onUpdated.addListener((tabId, change) => rescue.onTabUpdated(tabId, change));
chrome.tabs.onRemoved.addListener((tabId) => rescue.onTabRemoved(tabId));
void chrome.alarms.get(USAGE_ALARM).then((alarm) => alarm ? void 0 : chrome.alarms.create(USAGE_ALARM, { periodInMinutes: USAGE_PERIOD_MIN })).catch(() => console.warn("Could not schedule the usage refresh"));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== USAGE_ALARM) return;
  void refreshUsage(routerDeps, 0).then((fetched) => fetched ? broadcast() : void 0).catch(() => console.warn("Could not refresh usage"));
});
var restoreBadge = () => void usage.updateBadge().catch(() => console.warn("Could not update the badge"));
chrome.runtime.onStartup.addListener(restoreBadge);
chrome.runtime.onInstalled.addListener(restoreBadge);
