/**
 * SARAL Companion — Content Script (Phase 3: Active Subscription & Auto-Pay Tracker)
 * Detects active merchant domains, checks verified vouchers & recurring mandates,
 * and surfaces an isolated, non-intrusive smart overlay.
 *
 * Security & Integrity Invariants:
 * 1. Do NOT handle card numbers, CVVs, or bank authorization tokens.
 * 2. Mandate modifications/cancellations occur solely via SARAL web dashboard.
 * 3. Scoped strictly within Shadow DOM to prevent host style conflicts.
 * 4. Respects [Vouchers] and [Subscriptions] toggles in real time.
 */

(function () {
  if (window.__saral_companion_injected) return;
  window.__saral_companion_injected = true;

  const rawHost = window.location.hostname || '';
  const cleanDomain = rawHost.replace(/^www\./, '').toLowerCase();

  if (!cleanDomain || cleanDomain.includes('chrome-extension')) {
    return;
  }

  // Session dismissal check
  const DISMISS_KEY = `saral_dismissed_${cleanDomain}`;
  if (sessionStorage.getItem(DISMISS_KEY)) {
    return;
  }

  /**
   * Query background worker for vouchers and subscriptions on this domain
   */
  async function inspectPageContext() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }

    try {
      // Parallel queries to background worker
      const [voucherRes, subRes] = await Promise.all([
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'CHECK_SITE_VOUCHERS', domain: cleanDomain },
            (res) => resolve(chrome.runtime.lastError ? null : res)
          );
        }),
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'CHECK_SITE_SUBSCRIPTIONS', domain: cleanDomain },
            (res) => resolve(chrome.runtime.lastError ? null : res)
          );
        })
      ]);

      const vouchers = (voucherRes && voucherRes.enabled && Array.isArray(voucherRes.vouchers))
        ? voucherRes.vouchers
        : [];

      const subscriptions = (subRes && subRes.enabled && Array.isArray(subRes.subscriptions))
        ? subRes.subscriptions
        : [];

      if (vouchers.length > 0 || subscriptions.length > 0) {
        mountCompanionWidget({ vouchers, subscriptions, domain: cleanDomain });
      } else {
        removeExistingWidget();
      }
    } catch (e) {
      console.warn('[SARAL Companion Content Script]', e);
    }
  }

  function removeExistingWidget() {
    const existing = document.getElementById('saral-companion-host');
    if (existing) existing.remove();
  }

  /**
   * Mounts the floating widget inside an isolated Shadow DOM
   */
  function mountCompanionWidget({ vouchers, subscriptions, domain }) {
    removeExistingWidget();

    const host = document.createElement('div');
    host.id = 'saral-companion-host';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // Link scoped stylesheet inside shadow root
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content.css');
    shadow.appendChild(styleLink);

    // Root container
    const container = document.createElement('div');
    container.id = 'saral-companion-root';
    shadow.appendChild(container);

    let isExpanded = false;
    const hasVouchers = vouchers.length > 0;
    const hasSubs = subscriptions.length > 0;
    const primarySub = hasSubs ? subscriptions[0] : null;

    function render() {
      container.innerHTML = '';

      if (!isExpanded) {
        // ========================================================
        // MINIMIZED FLOATING PILL
        // ========================================================
        const pill = document.createElement('div');
        pill.className = 'saral-pill-minimized';
        pill.title = 'Click to open SARAL Companion';

        if (hasSubs && !hasVouchers) {
          // Standalone Subscription Pill (e.g. claude.ai, netflix.com)
          pill.innerHTML = `
            <span class="saral-pill-dot saral-pill-dot-indigo"></span>
            <span class="saral-pill-logo">saral</span>
            <span class="saral-pill-badge saral-pill-badge-autopay">
              ⚡ Auto-Pay Active • ${escapeHTML(primarySub.renewalDate)}
            </span>
            <span class="saral-pill-arrow">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd"/>
              </svg>
            </span>
          `;
        } else {
          // Voucher (or Dual) Pill
          const topDiscount = vouchers[0]?.discount || 'Deals Available';
          pill.innerHTML = `
            <span class="saral-pill-dot"></span>
            <span class="saral-pill-logo">saral</span>
            <span class="saral-pill-badge">${escapeHTML(topDiscount)}</span>
            ${hasSubs ? `<span class="saral-pill-dot saral-pill-dot-indigo" title="Auto-Pay Active"></span>` : ''}
            <span class="saral-pill-arrow">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd"/>
              </svg>
            </span>
          `;
        }

        pill.addEventListener('click', () => {
          isExpanded = true;
          render();
        });
        container.appendChild(pill);

      } else {
        // ========================================================
        // EXPANDED CARD
        // ========================================================
        const card = document.createElement('div');
        card.className = 'saral-card-expanded';

        // Header
        const header = document.createElement('div');
        header.className = 'saral-card-header';
        const tagText = (hasSubs && !hasVouchers) ? 'Auto-Pay Guardian' : 'Smart Rewards';
        const tagClass = (hasSubs && !hasVouchers) ? 'saral-header-tag saral-header-tag-indigo' : 'saral-header-tag';

        header.innerHTML = `
          <div class="saral-brand-group">
            <span class="saral-header-title">saral</span>
            <span class="${tagClass}">${tagText}</span>
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

        // Body
        const body = document.createElement('div');
        body.className = 'saral-card-body';

        // 1. Integrated Auto-Pay Banner (if both vouchers & sub exist on site, e.g. amazon.in)
        if (hasSubs && hasVouchers && primarySub) {
          const banner = document.createElement('div');
          banner.className = 'saral-integrated-mandate-banner';
          banner.innerHTML = `
            <div class="saral-mandate-badge-row">
              <span class="saral-mandate-pill">⚡ Auto-Pay Mandate Active</span>
              <span class="saral-sub-frequency">${escapeHTML(primarySub.amount)} / ${escapeHTML(primarySub.frequency)}</span>
            </div>
            <div class="saral-mandate-details">
              ${escapeHTML(primarySub.service)} renews on <strong>${escapeHTML(primarySub.renewalDate)}</strong>
            </div>
            <div class="saral-mandate-subtext">
              Billed automatically via ${escapeHTML(primarySub.autoPayMethod)}
            </div>
            <button type="button" class="saral-btn-manage-inline">
              <span>Manage on SARAL</span>
              <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h4a.75.75 0 010 1.5h-4z" clip-rule="evenodd"/>
                <path fill-rule="evenodd" d="M6.19 13.81a.75.75 0 010-1.06l6.47-6.47H9.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V7.06l-6.25 6.25a.75.75 0 01-1.06 0z" clip-rule="evenodd"/>
              </svg>
            </button>
          `;
          banner.querySelector('.saral-btn-manage-inline').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'OPEN_SARAL_MANAGE' });
          });
          body.appendChild(banner);
        }

        // 2. Standalone Subscription Card View (e.g. claude.ai, netflix.com)
        if (hasSubs && !hasVouchers && primarySub) {
          const subCard = document.createElement('div');
          subCard.className = 'saral-subscription-card-content';
          subCard.innerHTML = `
            <div class="saral-sub-main-info">
              <div class="saral-sub-service-name">${escapeHTML(primarySub.service)}</div>
              <div class="saral-sub-price-row">
                <span class="saral-sub-price">${escapeHTML(primarySub.amount)}</span>
                <span class="saral-sub-frequency">per ${escapeHTML(primarySub.frequency)}</span>
              </div>
              <div class="saral-sub-meta-grid">
                <div class="saral-sub-meta-item">
                  <span class="saral-sub-meta-label">Plan Tier</span>
                  <span class="saral-sub-meta-val">${escapeHTML(primarySub.plan || 'Active')}</span>
                </div>
                <div class="saral-sub-meta-item">
                  <span class="saral-sub-meta-label">Next Renewal</span>
                  <span class="saral-sub-meta-val saral-sub-renewal-highlight">${escapeHTML(primarySub.renewalDate)}</span>
                </div>
                <div class="saral-sub-meta-item">
                  <span class="saral-sub-meta-label">Payment Channel</span>
                  <span class="saral-sub-meta-val">${escapeHTML(primarySub.autoPayMethod)}</span>
                </div>
              </div>
            </div>
            <button type="button" class="saral-btn-manage-primary">
              <span>Manage on SARAL Dashboard</span>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h4a.75.75 0 010 1.5h-4z" clip-rule="evenodd"/>
                <path fill-rule="evenodd" d="M6.19 13.81a.75.75 0 010-1.06l6.47-6.47H9.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V7.06l-6.25 6.25a.75.75 0 01-1.06 0z" clip-rule="evenodd"/>
              </svg>
            </button>
          `;
          subCard.querySelector('.saral-btn-manage-primary').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'OPEN_SARAL_MANAGE' });
          });
          body.appendChild(subCard);
        }

        // 3. Voucher items (if present)
        if (hasVouchers) {
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

            const btnCopy = item.querySelector('.saral-btn-copy');
            btnCopy.addEventListener('click', () => {
              copyToClipboard(v.code, btnCopy);
            });

            body.appendChild(item);
          });
        }

        card.appendChild(body);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'saral-card-footer';
        footer.innerHTML = `
          <span class="saral-safe-notice">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="#10B981">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
            Verified SARAL Surface
          </span>
          <span>Zero Secret Exposure</span>
        `;
        card.appendChild(footer);

        container.appendChild(card);
      }
    }

    render();
  }

  /**
   * Safe copy helper
   */
  async function copyToClipboard(text, btn) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
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

  // Trigger inspection on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inspectPageContext);
  } else {
    inspectPageContext();
  }

  // Listen for storage/toggle changes in real time
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.saral_extension_settings) {
        inspectPageContext();
      }
    });
  }
})();
