# Claude Switch ⚡

> **Instant, seamless multi-account switcher for Claude.ai with real-time rate limit tracking.**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Compatible with Chromium](https://img.shields.io/badge/Browser-Chrome%20%7C%20Brave%20%7C%20Edge-brightgreen.svg)]()

Claude Switch is an unofficial, open-source productivity extension for Chromium browsers (Chrome, Brave, Edge, Arc). It allows you to keep multiple Claude.ai accounts signed in simultaneously and toggle between them in a single click or keyboard shortcut — without ever logging out manually.

---

## ✨ Features

- 🔄 **One-Click Account Switching:** Switch between unlimited Claude accounts instantly without manual login/logout cycles.
- ⌨️ **Instant Keyboard Shortcuts:** Press `Ctrl + Shift + 1`, `Ctrl + Shift + 2` ... `Ctrl + Shift + 9` to switch accounts from anywhere on the page, even while typing.
- ⏱️ **Real-Time Free Limit Reset Tracking:** Automatically detects when a Free account runs out of messages (e.g. *"out of free messages until 5:20 PM"*) and displays a live percentage bar and countdown timer.
- 📊 **Pro & Max Usage Statistics:** Displays 5-hour session and weekly utilization quotas for Pro/Team/Max accounts.
- 🎨 **Status Avatars:** Colored avatar rings indicating account status at a glance:
  - 🟢 **Normal / Ready:** Account is under limit and ready to chat.
  - 🟡 **Warning:** Usage ≥ 70%.
  - 🔴 **Critical:** Limit exhausted (100%), displays exact reset time.
- 🪟 **Dual Interface Options:**
  - **In-Page Switcher:** Floating pill anchored to Claude's sidebar for swift in-browser switching.
  - **Extension Toolbar Popup:** Clean management dashboard accessible from your browser toolbar.
- 🛡️ **100% Private & Local:** Zero telemetry, zero analytics, zero external API requests. All session tokens and cookies remain encrypted/stored strictly inside your local browser.

---

## 📥 Installation

Since Claude Switch is free and open-source, you can install it in less than 30 seconds using **Developer Mode**:

### Step 1: Download
1. Clone or download this repository as a `.zip` file.
2. If downloaded as a `.zip`, extract it to a permanent folder on your computer.

### Step 2: Load into Browser
1. Open your browser and navigate to the Extensions page:
   - **Google Chrome:** `chrome://extensions`
   - **Brave Browser:** `brave://extensions`
   - **Microsoft Edge:** `edge://extensions`
2. Toggle on **"Developer mode"** (usually located in the top-right corner).
3. Click the **"Load unpacked"** button in the top-left corner.
4. Select the extracted `Claude-Switcher` folder.
5. **Done!** Open [claude.ai](https://claude.ai) and you will see the switcher pill at the bottom-left.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Shift + 1` | Switch directly to Account #1 |
| `Ctrl + Shift + 2` | Switch directly to Account #2 |
| `Ctrl + Shift + 3..9` | Switch directly to Account #3 through #9 |
| `Click on Switcher Pill` | Toggle the account switcher dropdown |
| `Escape` | Close the open switcher dropdown |

> **Note:** The shortcuts work anywhere on `claude.ai`, even when your cursor is focused inside the message box.

---

## 🔒 Privacy & Security

We believe security should be non-negotiable, especially for authentication tooling:

- **No Remote Servers:** Claude Switch does not own or communicate with any external backend or third-party servers.
- **Direct Anthropic Communication Only:** The extension only connects to official `https://claude.ai/api/*` endpoints to read your account profile and verify rate limits.
- **Local Isolation:** All authentication cookies and session state are persisted strictly inside your browser's local sandbox (`chrome.storage.local`).
- **Open Source:** The full code is readable and auditable by anyone.

---

## 📄 License & Terms of Use

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)**.

### What you CAN do:
- ✅ **Free to Use:** Anyone is free to install, run, and use this extension for personal and daily productivity.
- ✅ **Share:** You can share the repository link or package with friends, colleagues, and community members.

### What you CANNOT do:
- ❌ **No Commercial Selling:** You are strictly **forbidden** from selling this extension, charging for access, or monetizing it in any commercial form.
- ❌ **No Modification Without Attribution:** If you fork, alter, or build upon this source code:
  - You **MUST** provide clear and visible credit to the original author.
  - You **CANNOT** rebrand or sell the modified version as a commercial closed-source product.

For complete license text, please refer to the [LICENSE](LICENSE) file.

---

## ⚠️ Disclaimer

This is an independent open-source project. This extension is **not** affiliated with, authorized, maintained, sponsored, or endorsed by Anthropic, PBC or any of its affiliates. "Claude" is a registered trademark of Anthropic, PBC.

