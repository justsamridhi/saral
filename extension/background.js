/**
 * SARAL Companion Extension — Background Service Worker (Manifest V3)
 * Phase 4: Password Guardian & Security Habit Coach ("The Nag")
 * Coordinates lifecycle, domain inspection, k-anonymity breach lookups, and badge priority.
 *
 * Security Invariants:
 * 1. Plaintext passwords NEVER logged or transmitted to central servers.
 * 2. Breach lookups use k-anonymity (5-character SHA-1 prefix only).
 * 3. Pure client surface with zero payment or database secret keys.
 */

// Import storage, API, and crypto helpers into worker scope
importScripts('utils/storage.js', 'utils/api.js', 'utils/crypto.js');

// In-memory cache for HIBP range responses to prevent redundant network lookups
const breachLookupCache = new Map();

// Initialize default settings and state on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.info('[SARAL Companion] Extension installed/updated:', details.reason);

  try {
    const existing = await SaralStorage.getSettings();
    if (!existing) {
      await SaralStorage.saveSettings({
        vouchersEnabled: true,
        subscriptionsEnabled: true,
        passwordAlertEnabled: true,
        mockMode: false
      });
    }
  } catch (err) {
    console.error('[SARAL Companion] Failed to initialize default storage:', err);
  }

  updateGlobalBadge(false);
});

/**
 * Update global default badge status
 * @param {boolean} isAuthenticated
 */
function updateGlobalBadge(isAuthenticated) {
  if (chrome.action) {
    if (isAuthenticated) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // Emerald green
      chrome.action.setTitle({ title: 'SARAL Companion (Connected)' });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'SARAL Companion (Disconnected)' });
    }
  }
}

/**
 * Update tab-specific badge following Phase 4 priority rules:
 * 1. If security breach/stale credential nag exists -> show "NAG" (Crimson #EF4444)
 * 2. Else if active vouchers exist -> show voucher count (Blue #2563EB)
 * 3. Else if active subscription mandate exists -> show "AUTO" (Indigo #4F46E5)
 * 4. Else if authenticated -> show "ON" (Emerald #10B981)
 * 5. Else -> clear badge
 *
 * @param {number} tabId
 * @param {object} status
 */
function updateTabPriorityBadge(tabId, { hasNag = false, voucherCount = 0, subscriptionCount = 0, isAuthenticated = false } = {}) {
  if (!chrome.action || !tabId) return;

  if (hasNag) {
    chrome.action.setBadgeText({ tabId, text: 'NAG' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#EF4444' }); // Crimson Warning
    chrome.action.setTitle({ tabId, title: 'SARAL Password Guardian: Weak or breached credential detected' });
  } else if (voucherCount > 0) {
    chrome.action.setBadgeText({ tabId, text: String(voucherCount) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563EB' }); // Blue
    chrome.action.setTitle({ tabId, title: `SARAL Companion: ${voucherCount} partner voucher(s) available` });
  } else if (subscriptionCount > 0) {
    chrome.action.setBadgeText({ tabId, text: 'AUTO' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4F46E5' }); // Indigo
    chrome.action.setTitle({ tabId, title: 'SARAL Companion: Auto-Pay mandate active on this service' });
  } else if (isAuthenticated) {
    chrome.action.setBadgeText({ tabId, text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#10B981' }); // Emerald
    chrome.action.setTitle({ tabId, title: 'SARAL Companion (Connected)' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'SARAL Companion (Disconnected)' });
  }
}

// Track active tab domain changes for contextual readiness
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      await handleTabContext(tab.id, tab.url);
    }
  } catch {
    // Tab closed or inaccessible
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab && tab.url) {
    await handleTabContext(tabId, tab.url);
  }
});

/**
 * Parse domain and update badge + storage
 * @param {number} tabId
 * @param {string} rawUrl
 */
async function handleTabContext(tabId, rawUrl) {
  try {
    if (!rawUrl || rawUrl.startsWith('chrome://') || rawUrl.startsWith('edge://')) {
      return;
    }
    const url = new URL(rawUrl);
    const domain = url.hostname.replace(/^www\./, '').toLowerCase();

    // Cache current active domain
    await chrome.storage.local.set({ saral_current_domain: domain });

    const [settings, token] = await Promise.all([
      SaralStorage.getSettings(),
      SaralStorage.getToken()
    ]);

    let hasNag = false;
    let voucherCount = 0;
    let subscriptionCount = 0;

    // 1. Check Security Guardian Nag Status
    if (settings && settings.passwordAlertEnabled) {
      const creds = await saralApi.fetchVaultCredentials(domain, token);
      hasNag = creds.some(c => c.isBreached || c.ageDays > 90 || c.strengthScore <= 1);
    }

    // 2. Check Vouchers
    if (settings && settings.vouchersEnabled) {
      const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
      voucherCount = vouchers.length;
    }

    // 3. Check Subscriptions
    if (settings && settings.subscriptionsEnabled) {
      const subs = await saralApi.fetchSubscriptionsForDomain(domain, token);
      subscriptionCount = subs.length;
    }

    updateTabPriorityBadge(tabId, {
      hasNag,
      voucherCount,
      subscriptionCount,
      isAuthenticated: Boolean(token)
    });
  } catch (err) {
    console.warn('[handleTabContext Error]', err);
  }
}

/**
 * Central messaging router for popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // 1. Password Guardian: K-Anonymity Breach Lookup (Phase 4)
  if (message.type === 'CHECK_PASSWORD_BREACH') {
    (async () => {
      try {
        const password = message.password || '';
        if (!password) {
          sendResponse({ breached: false, count: 0 });
          return;
        }

        // Compute prefix for cache key
        const fullHash = await SaralCrypto.sha1Hex(password);
        const prefix = fullHash.substring(0, 5);

        if (breachLookupCache.has(fullHash)) {
          sendResponse(breachLookupCache.get(fullHash));
          return;
        }

        const result = await SaralCrypto.checkPasswordBreach(password);
        breachLookupCache.set(fullHash, result);
        sendResponse(result);
      } catch (err) {
        console.error('[CHECK_PASSWORD_BREACH Error]', err);
        sendResponse({ breached: false, count: 0, error: err.message });
      }
    })();
    return true; // Async channel
  }

  // 2. Password Guardian: Domain Security Check (Phase 4)
  if (message.type === 'CHECK_DOMAIN_SECURITY') {
    (async () => {
      try {
        const domain = (message.domain || '').replace(/^www\./, '').toLowerCase();
        const [settings, token] = await Promise.all([
          SaralStorage.getSettings(),
          SaralStorage.getToken()
        ]);

        if (!settings.passwordAlertEnabled) {
          sendResponse({ enabled: false, credentials: [], hasNag: false, domain });
          return;
        }

        const creds = await saralApi.fetchVaultCredentials(domain, token);
        const nagItem = creds.find(c => c.isBreached || c.ageDays > 90 || c.strengthScore <= 1);
        const hasNag = Boolean(nagItem);

        if (sender && sender.tab && sender.tab.id && hasNag) {
          updateTabPriorityBadge(sender.tab.id, { hasNag: true, isAuthenticated: Boolean(token) });
        }

        sendResponse({
          enabled: true,
          credentials: creds || [],
          hasNag,
          nagMessage: nagItem ? nagItem.nagMessage : null,
          domain
        });
      } catch (err) {
        sendResponse({ enabled: false, credentials: [], hasNag: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Password Guardian: Generate Secure Password
  if (message.type === 'GENERATE_STRONG_PASSWORD') {
    const pwd = SaralCrypto.generateStrongPassword(message.options || {});
    const strength = SaralCrypto.evaluatePasswordStrength(pwd);
    sendResponse({ password: pwd, strength });
    return false;
  }

  // 4. Password Guardian: Overall Vault Audit
  if (message.type === 'GET_SECURITY_AUDIT') {
    (async () => {
      try {
        const token = await SaralStorage.getToken();
        const audit = await saralApi.fetchSecurityAudit(token);
        sendResponse({ audit });
      } catch (err) {
        sendResponse({ audit: null, error: err.message });
      }
    })();
    return true;
  }

  // 5. Content Script: Check vouchers for domain
  if (message.type === 'CHECK_SITE_VOUCHERS') {
    (async () => {
      try {
        const domain = (message.domain || '').replace(/^www\./, '').toLowerCase();
        const [settings, token] = await Promise.all([
          SaralStorage.getSettings(),
          SaralStorage.getToken()
        ]);

        if (!settings.vouchersEnabled) {
          sendResponse({ enabled: false, vouchers: [], domain });
          return;
        }

        const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
        sendResponse({
          enabled: true,
          vouchers: vouchers || [],
          domain,
          isAuthenticated: Boolean(token)
        });
      } catch (err) {
        sendResponse({ enabled: false, vouchers: [], error: err.message });
      }
    })();
    return true;
  }

  // 6. Content Script: Check subscriptions for domain
  if (message.type === 'CHECK_SITE_SUBSCRIPTIONS') {
    (async () => {
      try {
        const domain = (message.domain || '').replace(/^www\./, '').toLowerCase();
        const [settings, token] = await Promise.all([
          SaralStorage.getSettings(),
          SaralStorage.getToken()
        ]);

        if (!settings.subscriptionsEnabled) {
          sendResponse({ enabled: false, subscriptions: [], domain });
          return;
        }

        const subscriptions = await saralApi.fetchSubscriptionsForDomain(domain, token);
        sendResponse({
          enabled: true,
          subscriptions: subscriptions || [],
          domain,
          isAuthenticated: Boolean(token)
        });
      } catch (err) {
        sendResponse({ enabled: false, subscriptions: [], error: err.message });
      }
    })();
    return true;
  }

  // 7. Get All Subscriptions
  if (message.type === 'GET_ALL_SUBSCRIPTIONS') {
    (async () => {
      try {
        const token = await SaralStorage.getToken();
        const subscriptions = await saralApi.getAllUserSubscriptions(token);
        const burnStats = saralApi.calculateMonthlyBurn(subscriptions);
        sendResponse({ subscriptions, burnStats });
      } catch (err) {
        sendResponse({ subscriptions: [], burnStats: { count: 0, formattedInr: '₹0' }, error: err.message });
      }
    })();
    return true;
  }

  // 8. Safe Deep-Link Handler
  if (message.type === 'OPEN_SARAL_MANAGE') {
    const targetUrl = message.url || saralApi.getDashboardActivityUrl();
    chrome.tabs.create({ url: targetUrl });
    sendResponse({ success: true, url: targetUrl });
    return false;
  }

  // 9. Auth State Changed
  if (message.type === 'SARAL_AUTH_STATE_CHANGED') {
    updateGlobalBadge(Boolean(message.isAuthenticated));
    sendResponse({ success: true });
    return false;
  }

  // 10. Query active tab domain
  if (message.type === 'SARAL_GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        try {
          const url = new URL(tabs[0].url);
          sendResponse({
            url: tabs[0].url,
            domain: url.hostname.replace(/^www\./, '').toLowerCase(),
            title: tabs[0].title
          });
        } catch {
          sendResponse({ url: tabs[0].url, domain: 'localhost', title: tabs[0].title });
        }
      } else {
        sendResponse({ domain: null });
      }
    });
    return true;
  }

  // 11. Merchant Card Footprint Check (Phase 5)
  if (message.type === 'CHECK_MERCHANT_CARD_FOOTPRINT') {
    (async () => {
      try {
        const domain = (message.domain || '').replace(/^www\./, '').toLowerCase();
        const token = await SaralStorage.getToken();
        const footprint = await saralApi.fetchMerchantCardFootprint(domain, token);
        sendResponse({ footprint: footprint || [], domain });
      } catch (err) {
        sendResponse({ footprint: [], error: err.message });
      }
    })();
    return true;
  }

  // 12. Privacy Controls: Clear Local Cache (Phase 5)
  if (message.type === 'CLEAR_LOCAL_CACHE') {
    (async () => {
      await SaralStorage.clearLocalCache();
      breachLookupCache.clear();
      sendResponse({ success: true });
    })();
    return true;
  }

  // 13. Privacy Controls: Purge Vault & Master Key (Phase 5)
  if (message.type === 'PURGE_LOCAL_VAULT') {
    (async () => {
      await SaralStorage.purgeVaultAndKeys();
      breachLookupCache.clear();
      sendResponse({ success: true });
    })();
    return true;
  }

  // 14. Ping check
  if (message.type === 'SARAL_PING') {
    sendResponse({ status: 'ok', version: '1.0.0', timestamp: Date.now() });
    return false;
  }

  return false;
});
