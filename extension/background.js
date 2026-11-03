/**
 * SARAL Companion Extension — Background Service Worker (Manifest V3)
 * Phase 3: Active Subscription & Auto-Pay Tracker
 * Coordinates lifecycle, domain inspection, badge prioritization, and secure routing.
 *
 * Security Invariant:
 * Pure client surface. Under NO circumstances should any Supabase service-role
 * keys, payment card secrets, CVVs, or bank authorization tokens be held here.
 */

// Import storage & API helpers into service worker scope
importScripts('utils/storage.js', 'utils/api.js');

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
 * Update tab-specific badge following Phase 3 priority rules:
 * 1. If active vouchers exist -> show voucher count (Blue)
 * 2. Else if active subscription mandate exists -> show "AUTO" (Indigo)
 * 3. Else if authenticated -> show "ON" (Green)
 * 4. Else -> clear badge
 *
 * @param {number} tabId
 * @param {number} voucherCount
 * @param {number} subscriptionCount
 * @param {boolean} isAuthenticated
 */
function updateTabPriorityBadge(tabId, voucherCount, subscriptionCount, isAuthenticated) {
  if (!chrome.action || !tabId) return;

  if (voucherCount > 0) {
    chrome.action.setBadgeText({ tabId, text: String(voucherCount) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563EB' }); // Blue
    chrome.action.setTitle({ tabId, title: `SARAL Companion: ${voucherCount} partner voucher(s) available` });
  } else if (subscriptionCount > 0) {
    chrome.action.setBadgeText({ tabId, text: 'AUTO' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4F46E5' }); // Indigo
    chrome.action.setTitle({ tabId, title: `SARAL Companion: Auto-Pay mandate active on this service` });
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

    // Check user preferences and session
    const [settings, token] = await Promise.all([
      SaralStorage.getSettings(),
      SaralStorage.getToken()
    ]);

    let voucherCount = 0;
    let subscriptionCount = 0;

    if (settings && settings.vouchersEnabled) {
      const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
      voucherCount = vouchers.length;
    }

    if (settings && settings.subscriptionsEnabled) {
      const subs = await saralApi.fetchSubscriptionsForDomain(domain, token);
      subscriptionCount = subs.length;
    }

    updateTabPriorityBadge(tabId, voucherCount, subscriptionCount, Boolean(token));
  } catch (err) {
    console.warn('[handleTabContext Error]', err);
  }
}

/**
 * Central messaging router for popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // 1. Content Script: Check vouchers for domain
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

        // Also check subscriptions for badge calculation
        let subCount = 0;
        if (settings.subscriptionsEnabled) {
          const subs = await saralApi.fetchSubscriptionsForDomain(domain, token);
          subCount = subs.length;
        }

        if (sender && sender.tab && sender.tab.id) {
          updateTabPriorityBadge(sender.tab.id, vouchers.length, subCount, Boolean(token));
        }

        sendResponse({
          enabled: true,
          vouchers: vouchers || [],
          domain,
          isAuthenticated: Boolean(token)
        });
      } catch (err) {
        console.error('[CHECK_SITE_VOUCHERS Error]', err);
        sendResponse({ enabled: false, vouchers: [], error: err.message });
      }
    })();
    return true; // Async channel
  }

  // 2. Content Script: Check subscriptions for domain (Phase 3)
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

        // Also check vouchers for badge synchronization
        let voucherCount = 0;
        if (settings.vouchersEnabled) {
          const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
          voucherCount = vouchers.length;
        }

        if (sender && sender.tab && sender.tab.id) {
          updateTabPriorityBadge(sender.tab.id, voucherCount, subscriptions.length, Boolean(token));
        }

        sendResponse({
          enabled: true,
          subscriptions: subscriptions || [],
          domain,
          isAuthenticated: Boolean(token)
        });
      } catch (err) {
        console.error('[CHECK_SITE_SUBSCRIPTIONS Error]', err);
        sendResponse({ enabled: false, subscriptions: [], error: err.message });
      }
    })();
    return true;
  }

  // 3. Popup: Get all monitored user subscriptions
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

  // 4. Safe Deep-Link Handler: Open SARAL web dashboard Activity/Subscriptions tab
  if (message.type === 'OPEN_SARAL_MANAGE') {
    const targetUrl = message.url || saralApi.getDashboardActivityUrl();
    chrome.tabs.create({ url: targetUrl });
    sendResponse({ success: true, url: targetUrl });
    return false;
  }

  // 5. Auth State Changed
  if (message.type === 'SARAL_AUTH_STATE_CHANGED') {
    updateGlobalBadge(Boolean(message.isAuthenticated));
    sendResponse({ success: true });
    return false;
  }

  // 6. Query active tab domain
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

  // 7. Ping check
  if (message.type === 'SARAL_PING') {
    sendResponse({ status: 'ok', version: '0.3.0', timestamp: Date.now() });
    return false;
  }

  return false;
});
