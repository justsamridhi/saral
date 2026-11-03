/**
 * SARAL Companion Extension — Background Service Worker (Manifest V3)
 * Phase 2: Smart Rewards & Contextual Voucher Engine
 * Handles lifecycle, tab domain inspection, voucher routing, and badge sync.
 *
 * Security Invariant:
 * Pure client surface. Under NO circumstances should any Supabase service-role
 * keys or payment authorization secrets be held in memory or storage.
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
 * Update tab-specific voucher badge
 * @param {number} tabId
 * @param {number} count
 * @param {boolean} isAuthenticated
 */
function updateTabVoucherBadge(tabId, count, isAuthenticated) {
  if (!chrome.action || !tabId) return;

  if (count > 0) {
    chrome.action.setBadgeText({ tabId, text: String(count) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563EB' }); // Blue
    chrome.action.setTitle({ tabId, title: `SARAL Companion: ${count} partner voucher(s) available` });
  } else if (isAuthenticated) {
    chrome.action.setBadgeText({ tabId, text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#10B981' });
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

    // Check voucher toggle and auth status
    const [settings, token] = await Promise.all([
      SaralStorage.getSettings(),
      SaralStorage.getToken()
    ]);

    if (settings && settings.vouchersEnabled) {
      const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
      updateTabVoucherBadge(tabId, vouchers.length, Boolean(token));
    } else {
      updateTabVoucherBadge(tabId, 0, Boolean(token));
    }
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

        // Respect user's toggle setting
        if (!settings.vouchersEnabled) {
          if (sender && sender.tab && sender.tab.id) {
            updateTabVoucherBadge(sender.tab.id, 0, Boolean(token));
          }
          sendResponse({ enabled: false, vouchers: [], domain });
          return;
        }

        // Fetch vouchers through API client
        const vouchers = await saralApi.fetchVouchersForDomain(domain, token);

        // Update badge for this tab
        if (sender && sender.tab && sender.tab.id) {
          updateTabVoucherBadge(sender.tab.id, vouchers.length, Boolean(token));
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
    return true; // Keep message channel open for async response
  }

  // 2. Popup: Query vouchers for current domain
  if (message.type === 'GET_DOMAIN_VOUCHERS') {
    (async () => {
      try {
        const domain = (message.domain || '').replace(/^www\./, '').toLowerCase();
        const token = await SaralStorage.getToken();
        const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
        sendResponse({ vouchers: vouchers || [], domain });
      } catch (err) {
        sendResponse({ vouchers: [], error: err.message });
      }
    })();
    return true;
  }

  // 3. Popup: Fetch all partner vouchers
  if (message.type === 'GET_ALL_PARTNER_VOUCHERS') {
    const all = saralApi.getAllPartnerVouchers();
    sendResponse({ vouchers: all });
    return false;
  }

  // 4. Auth State Changed
  if (message.type === 'SARAL_AUTH_STATE_CHANGED') {
    updateGlobalBadge(Boolean(message.isAuthenticated));
    sendResponse({ success: true });
    return false;
  }

  // 5. Query active tab domain
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

  // 6. Ping check
  if (message.type === 'SARAL_PING') {
    sendResponse({ status: 'ok', version: '0.2.0', timestamp: Date.now() });
    return false;
  }

  return false;
});
