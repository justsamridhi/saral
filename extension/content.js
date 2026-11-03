/**
 * SARAL Companion — Content Script (Phase 4: Password Guardian & Security Habit Coach)
 * Detects merchant domains, queries verified rewards, active mandates,
 * and passively monitors password forms to surface the "Security Nag" habit coach.
 *
 * Security & Integrity Invariants:
 * 1. Plaintext passwords NEVER transmitted to servers or logs.
 * 2. Breach checking uses local SHA-1 prefix k-anonymity.
 * 3. Scoped strictly within isolated Shadow DOM.
 * 4. Respects [Vouchers], [Subscriptions], and [Password Alert] toggles in real time.
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

  // Internal state
  let currentContext = {
    vouchers: [],
    subscriptions: [],
    security: { enabled: true, hasNag: false, nagMessage: null, credentials: [] },
    domain: cleanDomain,
    livePasswordNag: null // Set if user types weak/breached password
  };

  /**
   * Query background worker for vouchers, subscriptions, and security habit status
   */
  async function inspectPageContext() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }

    try {
      const [voucherRes, subRes, secRes] = await Promise.all([
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
        }),
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'CHECK_DOMAIN_SECURITY', domain: cleanDomain },
            (res) => resolve(chrome.runtime.lastError ? null : res)
          );
        })
      ]);

      currentContext.vouchers = (voucherRes && voucherRes.enabled && Array.isArray(voucherRes.vouchers))
        ? voucherRes.vouchers
        : [];

      currentContext.subscriptions = (subRes && subRes.enabled && Array.isArray(subRes.subscriptions))
        ? subRes.subscriptions
        : [];

      currentContext.security = (secRes && secRes.enabled)
        ? secRes
        : { enabled: false, hasNag: false, nagMessage: null, credentials: [] };

      if (
        currentContext.vouchers.length > 0 ||
        currentContext.subscriptions.length > 0 ||
        currentContext.security.hasNag ||
        currentContext.livePasswordNag
      ) {
        mountCompanionWidget();
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
  function mountCompanionWidget() {
    removeExistingWidget();

    const host = document.createElement('div');
    host.id = 'saral-companion-host';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content.css');
    shadow.appendChild(styleLink);

    const container = document.createElement('div');
    container.id = 'saral-companion-root';
    shadow.appendChild(container);

    let isExpanded = false;
    let generatedPassword = '';

    // Generate initial strong password candidate
    if (typeof SaralCrypto !== 'undefined') {
      generatedPassword = SaralCrypto.generateStrongPassword({ length: 16 });
    } else {
      generatedPassword = 'Srl$' + Math.random().toString(36).substring(2, 10).toUpperCase() + '#99';
    }

    const { vouchers, subscriptions, security, livePasswordNag } = currentContext;
    const hasVouchers = vouchers.length > 0;
    const hasSubs = subscriptions.length > 0;
    const hasNag = Boolean(security.hasNag || livePasswordNag);
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

        if (hasNag) {
          // Priority 1: Security Habit Coach Nag
          pill.innerHTML = `
            <span class="saral-pill-dot saral-pill-dot-red"></span>
            <span class="saral-pill-logo">saral</span>
            <span class="saral-pill-badge saral-pill-badge-nag">
              ⚠️ Password Rotation Due
            </span>
            <span class="saral-pill-arrow">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd"/>
              </svg>
            </span>
          `;
        } else if (hasSubs && !hasVouchers) {
          // Priority 2: Standalone Subscription Pill
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
          // Priority 3: Rewards Voucher Pill
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

        let tagText = 'Smart Rewards';
        let tagClass = 'saral-header-tag';

        if (hasNag) {
          tagText = 'Password Guardian';
          tagClass = 'saral-header-tag saral-header-tag-red';
        } else if (hasSubs && !hasVouchers) {
          tagText = 'Auto-Pay Guardian';
          tagClass = 'saral-header-tag saral-header-tag-indigo';
        }

        // Header
        const header = document.createElement('div');
        header.className = 'saral-card-header';
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

        // 1. Password Guardian Security Nag Banner (Phase 4)
        if (hasNag) {
          const nagBanner = document.createElement('div');
          nagBanner.className = 'saral-security-nag-banner';
          const nagMsg = livePasswordNag || security.nagMessage || 'Password Rotation Due: Stale or reused credential detected on this site.';

          nagBanner.innerHTML = `
            <div class="saral-nag-header">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
              <span>Security Habit Coach ("The Nag")</span>
            </div>
            <div class="saral-nag-msg">${escapeHTML(nagMsg)}</div>
            <div class="saral-generator-box">
              <div class="saral-gen-display-row">
                <span class="saral-gen-pwd-text" id="gen-pwd-display">${escapeHTML(generatedPassword)}</span>
                <button type="button" class="saral-btn-refresh-pwd" id="btn-refresh-pwd" title="Generate another strong password">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
                  </svg>
                </button>
              </div>
              <button type="button" class="saral-btn-copy-pwd" id="btn-copy-generated">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                  <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/>
                </svg>
                <span>Copy Strong Password</span>
              </button>
            </div>
          `;

          nagBanner.querySelector('#btn-refresh-pwd').addEventListener('click', () => {
            if (typeof SaralCrypto !== 'undefined') {
              generatedPassword = SaralCrypto.generateStrongPassword({ length: 16 });
            } else {
              generatedPassword = 'Srl$' + Math.random().toString(36).substring(2, 10).toUpperCase() + '#99';
            }
            nagBanner.querySelector('#gen-pwd-display').textContent = generatedPassword;
          });

          const btnCopyPwd = nagBanner.querySelector('#btn-copy-generated');
          btnCopyPwd.addEventListener('click', () => {
            copyToClipboard(generatedPassword, btnCopyPwd);
          });

          body.appendChild(nagBanner);
        }

        // 2. Integrated Auto-Pay Banner
        if (hasSubs && primarySub && !hasNag) {
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

        // 3. Voucher items
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
            Zero Plaintext Leakage
          </span>
          <span>Web Crypto k-Anonymity</span>
        `;
        card.appendChild(footer);

        container.appendChild(card);
      }
    }

    render();
  }

  /**
   * Passive Form Inspection (Phase 4):
   * Monitors password input fields on page. If user focuses or enters a password,
   * checks for weak entropy or breach exposure via local k-anonymity.
   */
  function setupPassivePasswordInspection() {
    let breachDebounce = null;

    document.addEventListener('focusin', (e) => {
      const target = e.target;
      if (target && target.tagName === 'INPUT' && target.type === 'password') {
        // If domain has known stale credentials, trigger nag on focus
        if (currentContext.security.hasNag && !sessionStorage.getItem(DISMISS_KEY)) {
          mountCompanionWidget();
        }
      }
    }, true);

    document.addEventListener('input', (e) => {
      const target = e.target;
      if (target && target.tagName === 'INPUT' && target.type === 'password') {
        const val = target.value;
        if (!val || val.length < 5) return;

        clearTimeout(breachDebounce);
        breachDebounce = setTimeout(async () => {
          if (typeof SaralCrypto !== 'undefined') {
            const strength = SaralCrypto.evaluatePasswordStrength(val);
            if (strength.score <= 1) {
              currentContext.livePasswordNag = `⚠️ Weak Password (${strength.label}): ${strength.issues[0] || 'Low entropy'}. Let SARAL generate a strong replacement.`;
              mountCompanionWidget();
              return;
            }

            // K-Anonymity breach check
            const breach = await SaralCrypto.checkPasswordBreach(val);
            if (breach && breach.breached) {
              currentContext.livePasswordNag = `⚠️ Compromised Password! Seen in ${breach.count.toLocaleString()} data breaches. Change to a fresh uncompromised password immediately.`;
              mountCompanionWidget();
            }
          }
        }, 600);
      }
    }, true);
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
    document.addEventListener('DOMContentLoaded', () => {
      inspectPageContext();
      setupPassivePasswordInspection();
    });
  } else {
    inspectPageContext();
    setupPassivePasswordInspection();
  }

  // Real-time toggle change sync
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.saral_extension_settings) {
        inspectPageContext();
      }
    });
  }
})();
