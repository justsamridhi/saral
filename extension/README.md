# SARAL Companion Browser Extension (`v1.0.0`)

> **Manifest V3 Smart Rewards, Subscription Mandate Monitor, Password Security Guardian & Merchant Footprint Companion**

The **SARAL Companion** is a client-side browser companion built to seamlessly extend the [SARAL](https://github.com/justsamridhi/saral) consumer financial platform into daily web browsing. Designed with strict zero-trust privacy boundaries, client-side cryptographic isolation, and zero unauthorized DOM interference, the extension assists users during e-commerce checkouts, recurring mandate renewals, and credential entry.

---

## 1. Directory Structure

All extension code is strictly isolated inside the `extension/` directory on the `feature/saral-companion-extension` branch, leaving the core web app (`saral.html`) and backend database schemas untouched:

```text
extension/
├── manifest.json            # Manifest V3 configuration with host & client permissions
├── background.js            # Background service worker (message routing, badges, deep-linking)
├── content.js               # Content script (in-page shadow DOM voucher pill, mandate alert, nag)
├── content.css              # Styles for injected shadow DOM floating widgets
├── popup.html               # 3-view popup shell (Sign In, Dashboard Hub, Privacy Center)
├── popup.css                # Polished slate/white design system matching SARAL web app
├── popup.js                 # Dual-view controller, accordion state, generator, and privacy sync
├── icons/
│   ├── icon16.png           # 16x16 toolbar and tab icon
│   ├── icon48.png           # 48x48 management UI icon
│   └── icon128.png          # 128x128 Web Store / installation icon
└── utils/
    ├── api.js               # API client targeting SARAL endpoints with mock fallbacks
    ├── crypto.js            # Web Crypto API: SHA-1, k-anonymity breach check, AES-GCM-256 vault
    └── storage.js           # Typed wrapper around chrome.storage.local (tokens, vault, settings)
```

---

## 2. Core Capability Pillars

### Pillar 1: Smart Rewards & Contextual Voucher Engine (Phase 2)
- **Automatic Merchant Recognition**: On page load (`document_idle`), clean domain names (e.g., `amazon.in`, `swiggy.com`, `zomato.com`, `flipkart.com`, `myntra.com`) are checked against active SARAL vouchers.
- **Shadow DOM Overlay**: Injects an isolated, non-intrusive floating pill in the bottom-right corner of merchant pages. Styles cannot leak into or be corrupted by merchant CSS.
- **Safe Copy Action**: Users can preview discount tags (e.g., `50% OFF`, `₹200 FLAT`) and copy coupon codes directly to their clipboard with one click and visual confirmation.
- **Zero Form Tampering**: The extension strictly avoids auto-submitting forms or manipulating merchant checkout fields.

### Pillar 2: Active Subscription & Auto-Pay Tracker (Phase 3)
- **Recurring Mandate Awareness**: Detects supported subscription services (`claude.ai`, `netflix.com`, `spotify.com`, `chatgpt.com`, `amazon.in`) and displays active plan pricing, renewal dates, and payment methods.
- **Badge Indicators**: Background worker sets an `AUTO` badge with an indigo background (`#4F46E5`) when recurring mandates are detected on active tabs.
- **Monthly Burn Aggregation**: In the popup dashboard, calculates and displays total monthly auto-pay commitments in Indian Rupees (₹).
- **Secure Cancellation Safety**: Mandate cancellations must occur inside the authenticated SARAL web application. The extension provides a safe deep-link directly to `saral.html#activity`.

### Pillar 3: Password Guardian & Security Habit Coach ("The Nag") (Phase 4)
- **k-Anonymity Breach Checking**: When checking passwords against known data leaks, only the first 5 characters of the SHA-1 hash are queried via `https://api.pwnedpasswords.com/range/{prefix}`. Hashes are computed client-side using the browser's Web Crypto API (`crypto.subtle.digest('SHA-1', ...)`), ensuring **zero plaintext password transmission**.
- **Local Encrypted Vault**: Saved user credentials in `chrome.storage.local` are encrypted using `AES-GCM-256` with a key derived from the user's master PIN using `PBKDF2` (100,000 iterations, SHA-256).
- **Passive Form Inspection**: Non-intrusively monitors password fields on credential rotation pages to offer context-aware security coaching without recording keystrokes.
- **Strong Password Generator**: Generates cryptographically secure passwords (8–32 characters, configurable symbols) with entropy scoring and one-click copy.

### Pillar 4: Privacy Controls & Merchant Card Footprint (Phase 5)
- **PCI DSS Read-Only Boundary**: Never collects, transmits, or stores full Primary Account Numbers (PANs), CVVs, or expiration dates. Surfaces only masked payment methods (e.g., `HDFC Bank Visa (••4112)`) previously recorded in SARAL server logs.
- **Dedicated Privacy Center (View C)**: An interactive sub-view in `popup.html` providing:
  - Full transparency disclosure of all active browser permissions (`storage`, `activeTab`, `clipboardWrite`, `pwnedpasswords.com`).
  - Synchronized feature toggles (`[Vouchers]`, `[Subscriptions]`, `[Password Alerts]`).
  - Client-side data sanitization tools: **Clear Local Cache** and **Purge Local Encrypted Vault & Reset PIN**.

---

## 3. Cryptographic & Security Architecture

| Security Domain | Standard / Mechanism | Implementation Details |
| :--- | :--- | :--- |
| **Breach Verification** | k-Anonymity Model | Client computes uppercase SHA-1; queries only `prefix` (first 5 hex chars) against HIBP API; suffix matching is performed locally. |
| **Vault Encryption** | AES-GCM-256 & PBKDF2 | User master PIN + 16-byte random salt &rarr; PBKDF2 (100,000 rounds, SHA-256) &rarr; AES-GCM-256 encrypt/decrypt. |
| **PCI DSS Compliance** | Masked Tokenized Display | Read-only display of card brand and last 4 digits (`••4112`); strictly zero CVV or full PAN access. |
| **Authentication** | JWT Bearer Token | Supabase Auth user JWT stored in `chrome.storage.local`; strictly zero Supabase service-role keys. |
| **DOM Tampering** | Shadow DOM Container | Floating pill injected into an isolated Shadow Root (`closed`/custom container) preventing third-party script reads. |

---

## 4. Installation & Local Development

### Prerequisites
- Google Chrome, Brave, Chromium, or Microsoft Edge (Manifest V3 support).
- Node.js (v18+ recommended) for running local test servers or validation scripts.

### Loading the Extension in Developer Mode
1. Clone or navigate to the repository on branch `feature/saral-companion-extension`:
   ```bash
   git checkout feature/saral-companion-extension
   ```
2. Open your Chromium-based browser and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** via the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `extension/` directory from this repository:
   ```text
   d:\_3rd Year\S_paypal\extension
   ```
6. The **SARAL Companion** (`v1.0.0`) card will appear in your extensions list. Pin it to your toolbar for easy access.

---

## 5. Testing & Verification Guide

### 1. Authentication Handoff
- Click the SARAL Companion toolbar icon.
- You will see **View A (Sign In)**.
- Enter demo credentials (e.g., `samridhi@kdu.in` / `DemoPass123!`) or click **Sign In**.
- Upon authentication, the popup switches to **View B (Dashboard Hub)** with the user's initials avatar (`SG`) and connection ping.

### 2. Contextual Voucher Engine
- Navigate to `https://www.amazon.in` or `https://www.swiggy.com`.
- A floating slate pill will appear in the bottom-right corner showing active deals (e.g., `50% OFF`, `₹200 FLAT`).
- Click the pill to expand details and click **Copy Code** to verify clipboard copy and instant feedback.
- Click the extension icon to see active deals highlighted in Card 1 of the popup.

### 3. Active Subscription & Auto-Pay Tracker
- Navigate to `https://claude.ai` or `https://netflix.com`.
- Notice the toolbar badge changes to `AUTO` with an indigo background.
- Open the extension popup; Card 2 displays the active recurring mandate details (`₹1,999 / Monthly`, renewal date, auto-pay method).
- Click **Manage** or **Open Activity Tab** to verify deep-link redirection to `saral.html#activity`.

### 4. Password Guardian & Security Habit Coach
- In the extension popup, expand Card 3 (**Password Guardian**).
- Review the overall Vault Audit Health Score (e.g., `78/100`), reused count, stale count, and breached count tags.
- Test the built-in strong password generator by adjusting the length slider (8–32 chars) and toggling symbols.

### 5. Merchant Card Footprint & Privacy Center
- On `amazon.in`, expand Card 4 (**Card Footprint**) in the popup.
- Verify masked transaction history: `HDFC Bank Visa (••4112)` used on Oct 12, 2026.
- Click the Shield/Gear icon in the top header to enter **View C (Privacy Center)**.
- Review active permissions (`storage`, `activeTab`, `clipboardWrite`, `pwnedpasswords.com`).
- Toggle feature switches to verify instant synchronization with dashboard toggles.
- Click **Clear Local Cache** or **Purge Local Encrypted Vault** and observe toast confirmation.

---

## 6. API Integration Contracts

The extension's `utils/api.js` client communicates with SARAL backend endpoints using standard Bearer token authorization:

| Action | HTTP Endpoint | Authorization | Description |
| :--- | :--- | :--- | :--- |
| **Login** | `POST /api/auth/login` | None | Authenticates user; returns `{ token, user }`. |
| **Profile** | `GET /api/user/profile` | `Bearer <JWT>` | Retrieves user profile metadata and initials. |
| **Vouchers** | `GET /api/user/vouchers?domain=<domain>` | `Bearer <JWT>` | Returns active coupon vouchers for a merchant site. |
| **Subscriptions**| `GET /api/user/subscriptions?domain=<domain>`| `Bearer <JWT>` | Returns recurring auto-pay mandates for domain. |
| **All Mandates**| `GET /api/user/subscriptions` | `Bearer <JWT>` | Aggregates all recurring mandates for monthly burn calculation. |
| **Vault Creds** | `GET /api/user/vault/credentials?domain=<domain>`| `Bearer <JWT>` | Fetches encrypted credentials for security habit audit. |
| **Security Audit**| `GET /api/user/security/audit` | `Bearer <JWT>` | Fetches vault health score, reused count, stale count. |
| **Card Footprint**| `GET /api/user/cards/footprint?domain=<domain>`| `Bearer <JWT>` | Returns read-only masked payment transaction records. |
| **Health Ping** | `GET /api/health` | None | Ping endpoint returning latency and server status. |

*Note: When local server endpoints are unreachable or `MOCK_MODE` is enabled, `utils/api.js` automatically provides realistic fallback data ensuring offline development resilience.*

---

## 7. Compliance & Invariant Checklist

- [x] **Branch Isolation**: All extension files are strictly confined to `extension/`. Core app files (`saral.html`, database migrations) remain untouched.
- [x] **Zero Plaintext Passwords**: Password breach checks use 5-char k-anonymity SHA-1 ranges. Vault uses AES-GCM-256.
- [x] **PCI DSS Compliance**: No CVVs, full card numbers, or card expirations are ever collected, transmitted, or saved.
- [x] **Supabase Security**: No `service_role` keys present in extension files. All data access relies on client JWTs.
- [x] **User Consent**: Independent toggles for Vouchers, Subscriptions, and Password Alerts with local cache wipe options.

