/**
 * SARAL Companion — Content Script (Phase 2: Smart Rewards Engine)
 * Injected on document_idle to detect active merchant domains and display
 * verified voucher perks via a safe, non-intrusive floating pill.
 *
 * Security & Integrity Invariants:
 * 1. Do NOT auto-submit merchant checkout forms or tamper with merchant DOM.
 * 2. Scoped inside Shadow DOM to avoid host CSS pollution.
 * 3. Respects user's [Vouchers] toggle setting from SaralStorage.
 */

(function () {
  // Prevent duplicate execution
  if (window.__saral_companion_injected) return;
  window.__saral_companion_injected = true;

  const rawHost = window.location.hostname || '';
  const cleanDomain = rawHost.replace(/^www\./, '').toLowerCase();

  // Ignore internal/empty domains
  if (!cleanDomain || cleanDomain.includes('chrome-extension') || cleanDomain.startsWith('localhost:')) {
    // Note: 'localhost' without port or '127.0.0.1' is allowed for testing
  }

  // Session dismissal check
  const DISMISS_KEY = `saral_dismissed_${cleanDomain}`;
  if (sessionStorage.getItem(DISMISS_KEY)) {
    return;
  }

  // Safe runtime message helper
  function checkVouchers() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'CHECK_SITE_VOUCHERS', domain: cleanDomain },
      (response) => {
        if (chrome.runtime.lastError) {
          // Extension reloaded or inactive
          return;
        }

        if (response && response.enabled && Array.isArray(response.vouchers) && response.vouchers.length > 0) {
          mountVoucherWidget(response.vouchers, cleanDomain);
        }
      }
    );
  }

  /**
   * Mounts the floating voucher widget inside an isolated Shadow DOM
   * @param {Array<object>} vouchers
   * @param {string} domain
   */
  function mountVoucherWidget(vouchers, domain) {
    // Remove if already exists
    const existing = document.getElementById('saral-companion-host');
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = 'saral-companion-host';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject stylesheet link into shadow root
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content.css');
    shadow.appendChild(styleLink);

    // Root container
    const container = document.createElement('div');
    container.id = 'saral-companion-root';
    shadow.appendChild(container);

    let isExpanded = false;

    // Render State
    function render() {
      container.innerHTML = '';

      if (!isExpanded) {
        // MINIMIZED PILL
        const topDiscount = vouchers[0]?.discount || 'Deals Available';
        const pill = document.createElement('div');
        pill.className = 'saral-pill-minimized';
        pill.title = 'Click to view SARAL partner rewards';
        pill.innerHTML = `
          <span class="saral-pill-dot"></span>
          <span class="saral-pill-logo">saral</span>
          <span class="saral-pill-badge">${escapeHTML(topDiscount)}</span>
          <span class="saral-pill-arrow">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd"/>
            </svg>
          </span>
        `;
        pill.addEventListener('click', () => {
          isExpanded = true;
          render();
        });
        container.appendChild(pill);
      } else {
        // EXPANDED CARD
        const card = document.createElement('div');
        card.className = 'saral-card-expanded';

        // Header
        const header = document.createElement('div');
        header.className = 'saral-card-header';
        header.innerHTML = `
          <div class="saral-brand-group">
            <span class="saral-header-title">saral</span>
            <span class="saral-header-tag">Smart Rewards</span>
          </div>
          <div class="saral-actions-group">
            <button type="button" class="saral-icon-btn btn-minimize" title="Minimize">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </button>
            <button type="button" class="saral-icon-btn btn-close" title="Dismiss for session">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </button>
          </div>
        `;

        header.querySelector('.btn-minimize').addEventListener('click', () => {
          isExpanded = false;
          render();
        });

        header.querySelector('.btn-close').addEventListener('click', () => {
          sessionStorage.setItem(DISMISS_KEY, 'true');
          host.remove();
        });

        card.appendChild(header);

        // Body: Voucher items list
        const body = document.createElement('div');
        body.className = 'saral-card-body';

        vouchers.forEach((v) => {
          const item = document.createElement('div');
          item.className = 'saral-voucher-item';
          item.innerHTML = `
            <div class="saral-voucher-headline">
              <span class="saral-discount-badge">${escapeHTML(v.discount || 'Partner Perk')}</span>
              <span class="saral-expiry-text">${escapeHTML(v.expiry || 'Active')}</span>
            </div>
            <div class="saral-voucher-title">${escapeHTML(v.title || v.merchant || 'Special Discount')}</div>
            <div class="saral-voucher-terms">${escapeHTML(v.terms || 'Valid on eligible orders')}</div>
            <div class="saral-code-container">
              <div class="saral-code-box">${escapeHTML(v.code)}</div>
              <button type="button" class="saral-btn-copy" data-code="${escapeHTML(v.code)}">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                  <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/>
                </svg>
                <span>Copy</span>
              </button>
            </div>
          `;

          // Handle Copy button
          const btnCopy = item.querySelector('.saral-btn-copy');
          btnCopy.addEventListener('click', () => {
            copyToClipboard(v.code, btnCopy);
          });

          body.appendChild(item);
        });

        card.appendChild(body);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'saral-card-footer';
        footer.innerHTML = `
          <span class="saral-safe-notice">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="#10B981">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
            Verified Partner Perk
          </span>
          <span>Safe Manual Copy</span>
        `;
        card.appendChild(footer);

        container.appendChild(card);
      }
    }

    // Initial render
    render();
  }

  /**
   * Safe copy helper with instant visual feedback
   * @param {string} text
   * @param {HTMLButtonElement} btn
   */
  async function copyToClipboard(text, btn) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }

      const originalHtml = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
        </svg>
        <span>Copied!</span>
      `;

      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = originalHtml;
      }, 2000);
    } catch (e) {
      console.warn('[SARAL Companion] Copy failed:', e);
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Run voucher detection on document idle
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkVouchers);
  } else {
    checkVouchers();
  }

  // Listen for storage/toggle changes in real time
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.saral_extension_settings) {
        const newSettings = changes.saral_extension_settings.newValue;
        if (newSettings && !newSettings.vouchersEnabled) {
          const host = document.getElementById('saral-companion-host');
          if (host) host.remove();
        } else if (newSettings && newSettings.vouchersEnabled) {
          checkVouchers();
        }
      }
    });
  }
})();
