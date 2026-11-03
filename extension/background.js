/**
 * SARAL Companion Extension — Background Service Worker (Manifest V3)
 * Handles lifecycle events, tab context tracking, and secure inter-process messaging.
 *
 * Security Invariant:
 * Pure client surface. Under NO circumstances should any Supabase service-role
 * keys or payment authorization secrets be held in memory or storage.
 */

// Initialize default settings and state on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.info('[SARAL Companion] Extension installed/updated:', details.reason);

  try {
    const existing = await chrome.storage.local.get(['saral_extension_settings']);
    if (!existing.saral_extension_settings) {
      await chrome.storage.local.set({
        saral_extension_settings: {
          vouchersEnabled: true,
          subscriptionsEnabled: true,
          passwordAlertEnabled: true,
          mockMode: false
        }
      });
      console.info('[SARAL Companion] Default preferences initialized.');
    }
  } catch (err) {
    console.error('[SARAL Companion] Failed to initialize default storage:', err);
  }

  // Set default inactive badge
  updateBadge(false);
});

/**
 * Update the browser action badge status
 * @param {boolean} isAuthenticated
 */
function updateBadge(isAuthenticated) {
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

// Track active tab domain changes for contextual readiness
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      handleTabChange(tab.url);
    }
  } catch (e) {
    // Suppress tab access errors for internal pages
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    handleTabChange(tab.url);
  }
});

/**
 * Parse current domain and store minimal context for voucher inspection
 * @param {string} rawUrl
 */
function handleTabChange(rawUrl) {
  try {
    if (!rawUrl || rawUrl.startsWith('chrome://') || rawUrl.startsWith('edge://')) {
      return;
    }
    const url = new URL(rawUrl);
    const domain = url.hostname.replace(/^www\./, '');
    // In Phase 2, this will trigger voucher lookup for supported merchants
    chrome.storage.local.set({ saral_current_domain: domain });
  } catch {
    // Non-standard URL format ignored
  }
}

// Handle messages from popup or future content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'SARAL_AUTH_STATE_CHANGED':
      updateBadge(Boolean(message.isAuthenticated));
      sendResponse({ success: true });
      break;

    case 'SARAL_GET_ACTIVE_TAB':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          try {
            const url = new URL(tabs[0].url);
            sendResponse({
              url: tabs[0].url,
              domain: url.hostname.replace(/^www\./, ''),
              title: tabs[0].title
            });
          } catch {
            sendResponse({ url: tabs[0].url, domain: 'localhost', title: tabs[0].title });
          }
        } else {
          sendResponse({ domain: null });
        }
      });
      return true; // Keep message channel open for async query

    case 'SARAL_PING':
      sendResponse({ status: 'ok', version: '0.1.0', timestamp: Date.now() });
      break;

    default:
      sendResponse({ unknown: true });
      break;
  }
});

