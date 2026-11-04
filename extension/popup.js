/**
 * SARAL Companion Extension — Popup Controller (Phase 5: Release Finalization & Privacy Controls)
 * Coordinates View A (Sign In), View B (Hub), and View C (Privacy Center) states, contextual voucher engine,
 * subscription auto-pay tracking, security habit coaching ("The Nag"), crypto password generation, and merchant card footprint.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM References: Panels
  const viewLoggedOut = document.getElementById('view-logged-out');
  const viewLoggedIn = document.getElementById('view-logged-in');

  // DOM References: View A (Sign In)
  const authForm = document.getElementById('auth-form');
  const inputEmail = document.getElementById('input-email');
  const inputPassword = document.getElementById('input-password');
  const btnTogglePassword = document.getElementById('btn-toggle-password');
  const eyeIconShow = document.getElementById('eye-icon-show');
  const eyeIconHide = document.getElementById('eye-icon-hide');
  const btnSubmitLogin = document.getElementById('btn-submit-login');
  const btnSpinner = btnSubmitLogin.querySelector('.btn-spinner');
  const btnText = btnSubmitLogin.querySelector('.btn-text');
  const authAlert = document.getElementById('auth-alert');
  const authAlertMessage = document.getElementById('auth-alert-message');

  // DOM References: View B (Hub)
  const userAvatarInitials = document.getElementById('user-avatar-initials');
  const userDisplayName = document.getElementById('user-display-name');
  const btnSignOut = document.getElementById('btn-sign-out');
  const activeDomainName = document.getElementById('active-domain-name');

  // Rewards Accordion Elements (Phase 2)
  const cardRewards = document.getElementById('card-rewards');
  const rewardsCardBadge = document.getElementById('rewards-card-badge');
  const rewardsChevronContainer = cardRewards ? cardRewards.querySelector('.card-chevron-container') : null;
  const rewardsMetricText = document.getElementById('rewards-metric-text');
  const rewardsDropdownPanel = document.getElementById('rewards-dropdown-panel');
  const accordionDomainTitle = document.getElementById('accordion-domain-title');
  const btnBrowseAllPerks = document.getElementById('btn-browse-all-perks');
  const popupVoucherList = document.getElementById('popup-voucher-list');
  const popupVoucherEmpty = document.getElementById('popup-voucher-empty');
  const partnerChips = document.querySelectorAll('.partner-chip');

  // Subscriptions Accordion Elements (Phase 3)
  const cardSubscriptions = document.getElementById('card-subscriptions');
  const subsCardBadge = document.getElementById('subs-card-badge');
  const subsChevronContainer = cardSubscriptions ? cardSubscriptions.querySelector('.card-chevron-container') : null;
  const subsMetricText = document.getElementById('subs-metric-text');
  const subscriptionsDropdownPanel = document.getElementById('subscriptions-dropdown-panel');
  const subsAccordionTitle = document.getElementById('subs-accordion-title');
  const btnOpenSaralActivity = document.getElementById('btn-open-saral-activity');
  const popupSubsList = document.getElementById('popup-subs-list');
  const popupSubsEmpty = document.getElementById('popup-subs-empty');
  const btnViewAllMandates = document.getElementById('btn-view-all-mandates');

  // Password Guardian Accordion Elements (Phase 4)
  const cardSecurity = document.getElementById('card-security');
  const securityCardBadge = document.getElementById('security-card-badge');
  const securityChevronContainer = cardSecurity ? cardSecurity.querySelector('.card-chevron-container') : null;
  const securityMetricText = document.getElementById('security-metric-text');
  const securityDropdownPanel = document.getElementById('security-dropdown-panel');
  const auditHealthScore = document.getElementById('audit-health-score');
  const auditScoreBar = document.getElementById('audit-score-bar');
  const auditReusedTag = document.getElementById('audit-reused-tag');
  const auditStaleTag = document.getElementById('audit-stale-tag');
  const auditBreachedTag = document.getElementById('audit-breached-tag');
  const domainCredBox = document.getElementById('domain-credential-box');
  const domainCredTitle = document.getElementById('domain-cred-title');
  const domainCredStatus = document.getElementById('domain-cred-status');
  const domainCredUser = document.getElementById('domain-cred-user');
  const domainCredNag = document.getElementById('domain-cred-nag');

  // Generator Widget Elements
  const popupGenPwd = document.getElementById('popup-gen-pwd');
  const btnRefreshPopupPwd = document.getElementById('btn-refresh-popup-pwd');
  const popupGenLenSlider = document.getElementById('popup-gen-len-slider');
  const popupGenLenVal = document.getElementById('popup-gen-len-val');
  const popupGenSymbolsCheck = document.getElementById('popup-gen-symbols-check');
  const btnCopyPopupGen = document.getElementById('btn-copy-popup-gen');

  // Card 4: Merchant Card Footprint Elements (Phase 5)
  const cardFootprint = document.getElementById('card-footprint');
  const footprintCardBadge = document.getElementById('footprint-card-badge');
  const footprintChevronContainer = cardFootprint ? cardFootprint.querySelector('.card-chevron-container') : null;
  const footprintMetricText = document.getElementById('footprint-metric-text');
  const footprintDropdownPanel = document.getElementById('footprint-dropdown-panel');
  const footprintDomainTitle = document.getElementById('footprint-domain-title');
  const popupFootprintList = document.getElementById('popup-footprint-list');
  const popupFootprintEmpty = document.getElementById('popup-footprint-empty');

  // View C (Privacy Center & Settings) Elements (Phase 5)
  const viewPrivacy = document.getElementById('view-privacy');
  const btnOpenPrivacy = document.getElementById('btn-open-privacy');
  const btnBackFromPrivacy = document.getElementById('btn-back-from-privacy');
  const privacyToast = document.getElementById('privacy-toast');
  const privacyToastMsg = document.getElementById('privacy-toast-msg');
  const togglePrivacyVouchers = document.getElementById('toggle-privacy-vouchers');
  const togglePrivacySubs = document.getElementById('toggle-privacy-subs');
  const togglePrivacyPasswords = document.getElementById('toggle-privacy-passwords');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnPurgeVault = document.getElementById('btn-purge-vault');

  // Toggles (Hub View)
  const toggleVouchers = document.getElementById('toggle-vouchers');
  const toggleSubs = document.getElementById('toggle-subs');
  const togglePasswords = document.getElementById('toggle-passwords');

  // Footer Indicators
  const footerPingDot = document.getElementById('footer-ping-dot');
  const footerPingText = document.getElementById('footer-ping-text');
  const footerEnvIndicator = document.getElementById('footer-env-indicator');

  // State cache for popup session
  let currentDomainName = '';
  let activeTabVouchers = [];
  let isShowingAllStores = false;

  let activeDomainSubs = [];
  let allMonitoredSubs = [];

  let activeDomainCreds = [];
  let currentGeneratedPassword = '';

  /**
   * Safe message dispatcher to background script
   */
  function notifyBackground(type, payload = {}) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type, ...payload }, () => {
        if (chrome.runtime.lastError) { /* no-op */ }
      });
    }
  }

  /**
   * Mount View A (Logged Out)
   */
  function showLoggedOutView() {
    if (viewPrivacy) viewPrivacy.style.display = 'none';
    viewLoggedIn.style.display = 'none';
    viewLoggedOut.style.display = 'flex';
    hideError();
    inputPassword.value = '';
    setButtonLoading(false);
  }

  /**
   * Mount View B (Logged In Hub)
   * @param {object} user
   */
  async function showLoggedInView(user) {
    if (viewPrivacy) viewPrivacy.style.display = 'none';
    viewLoggedOut.style.display = 'none';
    viewLoggedIn.style.display = 'flex';

    // Populate user profile — always from the authenticated user object
    const displayName = user?.display_name || user?.full_name?.split(' ')[0] || 'User';
    const initials = user?.initials || (user?.full_name || user?.display_name || 'U').substring(0, 2).toUpperCase();
    userDisplayName.textContent = displayName;
    userAvatarInitials.textContent = initials;

    // Load user preferences into toggles
    await loadToggleSettings();

    // Generate initial strong password for the generator widget
    generatePopupPassword();

    // Inspect active tab domain, vouchers, subscriptions, and security habit status
    await inspectCurrentDomain();

    // Run connection ping and environment detection
    checkConnectionStatus(user);
  }

  /**
   * Display error alert banner in View A
   */
  function showError(message) {
    authAlertMessage.textContent = message;
    authAlert.style.display = 'flex';
  }

  /**
   * Hide error banner
   */
  function hideError() {
    authAlert.style.display = 'none';
    authAlertMessage.textContent = '';
  }

  /**
   * Toggle button loading spinner state
   */
  function setButtonLoading(isLoading) {
    if (isLoading) {
      btnSubmitLogin.disabled = true;
      btnSpinner.style.display = 'inline-block';
      btnText.textContent = 'Signing in...';
    } else {
      btnSubmitLogin.disabled = false;
      btnSpinner.style.display = 'none';
      btnText.textContent = 'Sign In';
    }
  }

  /**
   * Inspect current active tab, rewards, subscriptions, and password security
   */
  async function inspectCurrentDomain() {
    let domain = 'localhost';

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });

      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          const rawHost = url.hostname.replace(/^www\./, '').toLowerCase();
          if (rawHost && !rawHost.includes('extension') && !rawHost.startsWith('chrome')) {
            domain = rawHost;
          }
        } catch {
          domain = 'localhost';
        }
      }
    }

    currentDomainName = domain;
    activeDomainName.textContent = domain;

    const token = await SaralStorage.getToken();
    const settings = await SaralStorage.getSettings();

    // 1. REWARDS / VOUCHERS INSPECTION
    if (!settings.vouchersEnabled) {
      rewardsMetricText.textContent = 'Vouchers paused in settings';
      rewardsCardBadge.textContent = 'PAUSED';
      rewardsCardBadge.className = 'card-tag';
    } else {
      rewardsMetricText.textContent = `Checking vouchers for ${domain}...`;
      try {
        const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
        activeTabVouchers = vouchers || [];
        isShowingAllStores = false;

        renderRewardsSummary(domain, activeTabVouchers);
        renderVoucherList(activeTabVouchers, domain);
      } catch (err) {
        rewardsMetricText.textContent = `0 active vouchers for ${domain}`;
        rewardsCardBadge.textContent = '0 DEALS';
        rewardsCardBadge.className = 'card-tag';
      }
    }

    // 2. SUBSCRIPTIONS & AUTO-PAY INSPECTION (PHASE 3)
    if (!settings.subscriptionsEnabled) {
      subsMetricText.textContent = 'Subscriptions paused in settings';
      subsCardBadge.textContent = 'PAUSED';
      subsCardBadge.className = 'card-tag';
    } else {
      subsMetricText.textContent = `Checking auto-pay mandates...`;
      try {
        const [domainSubs, allSubs] = await Promise.all([
          saralApi.fetchSubscriptionsForDomain(domain, token),
          saralApi.getAllUserSubscriptions(token)
        ]);

        activeDomainSubs = domainSubs || [];
        allMonitoredSubs = allSubs || [];

        const burnStats = saralApi.calculateMonthlyBurn(allMonitoredSubs);
        renderSubscriptionSummary(domain, activeDomainSubs, burnStats);

        if (activeDomainSubs.length > 0) {
          renderSubscriptionList(activeDomainSubs, domain, false);
        } else {
          renderSubscriptionList(allMonitoredSubs, 'All Services', true);
        }
      } catch (err) {
        subsMetricText.textContent = `0 auto-pay mandates detected`;
        subsCardBadge.textContent = 'MONITORED';
        subsCardBadge.className = 'card-tag';
      }
    }

    // 3. PASSWORD GUARDIAN & "THE NAG" COACH (PHASE 4)
    if (!settings.passwordAlertEnabled) {
      securityMetricText.textContent = 'Password alerts paused in settings';
      securityCardBadge.textContent = 'PAUSED';
      securityCardBadge.className = 'card-tag';
    } else {
      securityMetricText.textContent = `Assessing password security habits...`;
      try {
        const [creds, audit] = await Promise.all([
          saralApi.fetchVaultCredentials(domain, token),
          saralApi.fetchSecurityAudit(token)
        ]);

        activeDomainCreds = creds || [];
        renderSecurityHabitSummary(domain, activeDomainCreds, audit);
      } catch (err) {
        securityMetricText.textContent = 'Security Coach Active';
        securityCardBadge.textContent = 'ACTIVE';
        securityCardBadge.className = 'card-tag';
      }
    }

    // 4. MERCHANT CARD FOOTPRINT INSPECTION (PHASE 5)
    try {
      const footprint = await saralApi.fetchMerchantCardFootprint(domain, token);
      renderFootprintSummary(domain, footprint);
      renderFootprintList(footprint, domain);
    } catch (err) {
      if (footprintMetricText) footprintMetricText.textContent = `No payment history found for ${domain}`;
      if (footprintCardBadge) {
        footprintCardBadge.textContent = 'PCI SAFE';
        footprintCardBadge.className = 'card-tag';
      }
    }
  }

  /**
   * Update the Rewards Card summary text and badge
   */
  function renderRewardsSummary(domain, vouchers) {
    if (!rewardsMetricText || !rewardsCardBadge) return;

    if (vouchers && vouchers.length > 0) {
      const count = vouchers.length;
      rewardsMetricText.textContent = `${count} active voucher${count > 1 ? 's' : ''} for ${domain}`;
      rewardsCardBadge.textContent = `${count} ACTIVE`;
      rewardsCardBadge.className = 'card-tag card-tag-green';
    } else {
      rewardsMetricText.textContent = `0 active vouchers for ${domain}`;
      rewardsCardBadge.textContent = '0 DEALS';
      rewardsCardBadge.className = 'card-tag';
    }
  }

  /**
   * Update the Subscriptions Card summary text and badge
   */
  function renderSubscriptionSummary(domain, domainSubs, burnStats) {
    if (!subsMetricText || !subsCardBadge) return;

    if (domainSubs && domainSubs.length > 0) {
      const count = domainSubs.length;
      subsMetricText.textContent = `${count} Auto-Pay Active for ${domain}`;
      subsCardBadge.textContent = 'ACTIVE';
      subsCardBadge.className = 'card-tag card-tag-green';
    } else {
      subsMetricText.textContent = `Total: ${burnStats.count} Monitored Mandates (~${burnStats.formattedInr}/mo)`;
      subsCardBadge.textContent = 'MONITORED';
      subsCardBadge.className = 'card-tag card-tag-indigo';
    }
  }

  /**
   * Update Password Guardian Header and Accordion Details (Phase 4)
   */
  function renderSecurityHabitSummary(domain, creds, audit) {
    if (!securityMetricText || !securityCardBadge) return;

    // Render Overall Vault Audit Score
    if (audit) {
      auditHealthScore.textContent = audit.healthScore || 78;
      auditScoreBar.style.width = `${audit.healthScore || 78}%`;
      auditReusedTag.textContent = `${audit.reusedCount || 1} Reused`;
      auditStaleTag.textContent = `${audit.staleCount || 1} >90d Old`;
      auditBreachedTag.textContent = `${audit.breachedCount || 1} Breached`;
    }

    // Render Active Domain Credential Status
    if (creds && creds.length > 0) {
      const primaryCred = creds[0];
      const isRisky = primaryCred.isBreached || primaryCred.ageDays > 90 || primaryCred.strengthScore <= 1;

      domainCredBox.style.display = 'flex';
      domainCredTitle.textContent = `${domain} Credential`;
      domainCredUser.textContent = primaryCred.username || '';

      if (isRisky) {
        securityMetricText.textContent = `${domain} • 1 Saved Credential (Needs Rotation)`;
        securityCardBadge.textContent = 'BREACH RISK';
        securityCardBadge.className = 'card-tag card-tag-danger';

        domainCredStatus.textContent = primaryCred.status || 'NEEDS ROTATION';
        domainCredStatus.className = 'domain-status-pill pill-danger';
        domainCredNag.style.display = 'block';
        domainCredNag.textContent = `⚠️ ${primaryCred.nagMessage || 'Password rotation due. Reused credential exposed in public breaches.'}`;
      } else {
        securityMetricText.textContent = `${domain} • 1 Saved Credential (Clean)`;
        securityCardBadge.textContent = 'SAFE';
        securityCardBadge.className = 'card-tag card-tag-green';

        domainCredStatus.textContent = 'SAFE';
        domainCredStatus.className = 'domain-status-pill pill-safe';
        domainCredNag.style.display = 'none';
      }
    } else {
      // Domain with no saved credential
      domainCredBox.style.display = 'none';
      securityMetricText.textContent = `Security Coach Active • Overall Health: ${audit?.healthScore || 78}/100`;
      securityCardBadge.textContent = 'HEALTHY';
      securityCardBadge.className = 'card-tag card-tag-green';
    }
  }

  /**
   * Update Card Footprint Header summary (Phase 5)
   */
  function renderFootprintSummary(domain, footprint) {
    if (!footprintMetricText || !footprintCardBadge) return;
    const cards = Array.isArray(footprint) ? footprint : (footprint?.cards || []);
    if (cards.length > 0) {
      const primary = cards[0];
      const brand = primary.brand || primary.cardBrand || 'Card';
      const last4 = primary.last4 || '••••';
      footprintMetricText.textContent = `${brand} (••${last4}) used on ${domain}`;
      footprintCardBadge.textContent = `${cards.length} RECORD${cards.length > 1 ? 'S' : ''}`;
      footprintCardBadge.className = 'card-tag card-tag-green';
    } else {
      footprintMetricText.textContent = `No payment history found for ${domain}`;
      footprintCardBadge.textContent = 'CLEAN';
      footprintCardBadge.className = 'card-tag';
    }
  }

  /**
   * Render previous card usage history inside the footprint dropdown panel (Phase 5)
   */
  function renderFootprintList(footprint, domain) {
    if (!popupFootprintList || !popupFootprintEmpty) return;
    if (footprintDomainTitle) {
      footprintDomainTitle.textContent = `${domain} Payment Records`;
    }

    const cards = Array.isArray(footprint) ? footprint : (footprint?.cards || []);
    popupFootprintList.innerHTML = '';

    if (!cards || cards.length === 0) {
      popupFootprintList.style.display = 'none';
      popupFootprintEmpty.style.display = 'block';
      return;
    }

    popupFootprintList.style.display = 'flex';
    popupFootprintEmpty.style.display = 'none';

    cards.forEach((card) => {
      const item = document.createElement('div');
      item.className = 'popup-footprint-item';
      const brand = card.brand || card.cardBrand || 'Card';
      const last4 = card.last4 || '••••';
      const lastUsed = card.lastUsed || 'Recent';

      item.innerHTML = `
        <div class="popup-footprint-card-name">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
          <span>${escapeHTML(brand)} (••${escapeHTML(last4)})</span>
        </div>
        <span class="popup-footprint-date">${escapeHTML(lastUsed)}</span>
      `;
      popupFootprintList.appendChild(item);
    });
  }

  /**
   * Strong Password Generator Controller (Phase 4)
   */
  function generatePopupPassword() {
    const length = parseInt(popupGenLenSlider?.value || '16', 10);
    const symbols = Boolean(popupGenSymbolsCheck?.checked);

    if (popupGenLenVal) {
      popupGenLenVal.textContent = String(length);
    }

    if (typeof SaralCrypto !== 'undefined') {
      currentGeneratedPassword = SaralCrypto.generateStrongPassword({
        length,
        symbols,
        uppercase: true,
        lowercase: true,
        numbers: true
      });
    } else {
      currentGeneratedPassword = 'Srl$' + Math.random().toString(36).substring(2, 10).toUpperCase() + '#99';
    }

    if (popupGenPwd) {
      popupGenPwd.textContent = currentGeneratedPassword;
    }
  }

  if (popupGenLenSlider) {
    popupGenLenSlider.addEventListener('input', generatePopupPassword);
  }
  if (popupGenSymbolsCheck) {
    popupGenSymbolsCheck.addEventListener('change', generatePopupPassword);
  }
  if (btnRefreshPopupPwd) {
    btnRefreshPopupPwd.addEventListener('click', (e) => {
      e.stopPropagation();
      generatePopupPassword();
    });
  }
  if (btnCopyPopupGen) {
    btnCopyPopupGen.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCopyCode(currentGeneratedPassword, btnCopyPopupGen);
    });
  }

  /**
   * Render voucher list inside the rewards accordion panel
   */
  function renderVoucherList(vouchers, domainTitle) {
    if (!popupVoucherList || !popupVoucherEmpty) return;

    accordionDomainTitle.textContent = isShowingAllStores
      ? 'All Partner Perks'
      : `Vouchers for ${domainTitle}`;
    btnBrowseAllPerks.textContent = isShowingAllStores ? 'This Site' : 'All Stores';

    popupVoucherList.innerHTML = '';

    if (!vouchers || vouchers.length === 0) {
      popupVoucherList.style.display = 'none';
      popupVoucherEmpty.style.display = 'flex';
      return;
    }

    popupVoucherList.style.display = 'flex';
    popupVoucherEmpty.style.display = 'none';

    vouchers.forEach((v) => {
      const item = document.createElement('div');
      item.className = 'popup-voucher-item';
      item.innerHTML = `
        <div class="popup-voucher-top">
          <span class="popup-discount-badge">${escapeHTML(v.discount || 'Special Offer')}</span>
          <span class="popup-voucher-expiry">${escapeHTML(v.expiry || 'Active')}</span>
        </div>
        <div class="popup-voucher-title">${escapeHTML(v.title || v.merchant || 'Partner Voucher')}</div>
        <div class="popup-voucher-terms">${escapeHTML(v.terms || 'Valid on eligible orders')}</div>
        <div class="popup-code-row">
          <div class="popup-code-box">${escapeHTML(v.code)}</div>
          <button type="button" class="btn-popup-copy" data-code="${escapeHTML(v.code)}">
            <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/>
            </svg>
            <span>Copy</span>
          </button>
        </div>
      `;

      const btnCopy = item.querySelector('.btn-popup-copy');
      btnCopy.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCopyCode(v.code, btnCopy);
      });

      popupVoucherList.appendChild(item);
    });
  }

  /**
   * Render subscriptions list inside the subscriptions accordion panel
   */
  function renderSubscriptionList(subscriptions, title, isOverview = false) {
    if (!popupSubsList || !popupSubsEmpty) return;

    subsAccordionTitle.textContent = isOverview
      ? `All Monitored Mandates (${subscriptions.length})`
      : `Auto-Pay for ${title}`;

    popupSubsList.innerHTML = '';

    if (!subscriptions || subscriptions.length === 0) {
      popupSubsList.style.display = 'none';
      popupSubsEmpty.style.display = 'flex';
      return;
    }

    popupSubsList.style.display = 'flex';
    popupSubsEmpty.style.display = 'none';

    subscriptions.forEach((sub) => {
      const item = document.createElement('div');
      item.className = 'popup-sub-item';
      item.innerHTML = `
        <div class="popup-sub-top">
          <span class="popup-sub-title">${escapeHTML(sub.service)}</span>
          <span class="popup-sub-amount">${escapeHTML(sub.amount)} <small style="font-size:10px;font-weight:400;color:#64748B">/${escapeHTML(sub.frequency)}</small></span>
        </div>
        <div class="popup-sub-mid">
          <span class="popup-sub-renewal">Renews ${escapeHTML(sub.renewalDate)}</span>
          <span class="popup-sub-method">${escapeHTML(sub.autoPayMethod)}</span>
        </div>
        <div class="popup-sub-bottom">
          <span class="popup-sub-plan">${escapeHTML(sub.plan || 'Active')}</span>
          <button type="button" class="btn-sub-manage" title="Manage mandate in SARAL dashboard">
            <span>Manage</span>
            <svg width="9" height="9" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h4a.75.75 0 010 1.5h-4z" clip-rule="evenodd"/>
              <path fill-rule="evenodd" d="M6.19 13.81a.75.75 0 010-1.06l6.47-6.47H9.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V7.06l-6.25 6.25a.75.75 0 01-1.06 0z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
      `;

      const btnManage = item.querySelector('.btn-sub-manage');
      btnManage.addEventListener('click', (e) => {
        e.stopPropagation();
        notifyBackground('OPEN_SARAL_MANAGE');
      });

      popupSubsList.appendChild(item);
    });
  }

  /**
   * Handle safe clipboard copy with visual feedback
   */
  async function handleCopyCode(code, btn) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }

      const origHtml = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
        </svg>
        <span>Copied!</span>
      `;

      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = origHtml;
      }, 2000);
    } catch (e) {
      console.warn('[Popup] Copy failed:', e);
    }
  }

  /**
   * Accordion Toggle: Rewards Card
   */
  if (cardRewards) {
    cardRewards.addEventListener('click', () => {
      const isVisible = rewardsDropdownPanel.style.display !== 'none';
      rewardsDropdownPanel.style.display = isVisible ? 'none' : 'block';
      rewardsChevronContainer?.classList.toggle('expanded', !isVisible);
    });
  }

  /**
   * Accordion Toggle: Subscriptions Card
   */
  if (cardSubscriptions) {
    cardSubscriptions.addEventListener('click', () => {
      const isVisible = subscriptionsDropdownPanel.style.display !== 'none';
      subscriptionsDropdownPanel.style.display = isVisible ? 'none' : 'block';
      subsChevronContainer?.classList.toggle('expanded', !isVisible);
    });
  }

  /**
   * Accordion Toggle: Password Guardian Card (Phase 4)
   */
  if (cardSecurity) {
    cardSecurity.addEventListener('click', () => {
      const isVisible = securityDropdownPanel.style.display !== 'none';
      securityDropdownPanel.style.display = isVisible ? 'none' : 'block';
      securityChevronContainer?.classList.toggle('expanded', !isVisible);
    });
  }

  /**
   * Accordion Toggle: Merchant Card Footprint Card (Phase 5)
   */
  if (cardFootprint) {
    cardFootprint.addEventListener('click', () => {
      const isVisible = footprintDropdownPanel.style.display !== 'none';
      footprintDropdownPanel.style.display = isVisible ? 'none' : 'block';
      footprintChevronContainer?.classList.toggle('expanded', !isVisible);
    });
  }

  /**
   * Navigation: Open Privacy Center & Settings (Phase 5)
   */
  if (btnOpenPrivacy) {
    btnOpenPrivacy.addEventListener('click', (e) => {
      e.stopPropagation();
      viewLoggedIn.style.display = 'none';
      viewPrivacy.style.display = 'flex';
    });
  }

  /**
   * Navigation: Back to Dashboard from Privacy Center (Phase 5)
   */
  if (btnBackFromPrivacy) {
    btnBackFromPrivacy.addEventListener('click', (e) => {
      e.stopPropagation();
      viewPrivacy.style.display = 'none';
      viewLoggedIn.style.display = 'flex';
    });
  }

  /**
   * Display temporary toast notification inside Privacy Center (Phase 5)
   */
  function showPrivacyToast(message) {
    if (!privacyToast || !privacyToastMsg) return;
    privacyToastMsg.textContent = message;
    privacyToast.style.display = 'block';
    setTimeout(() => {
      privacyToast.style.display = 'none';
    }, 2800);
  }

  /**
   * Manage on SARAL Deep-Link Button
   */
  if (btnOpenSaralActivity) {
    btnOpenSaralActivity.addEventListener('click', (e) => {
      e.stopPropagation();
      notifyBackground('OPEN_SARAL_MANAGE');
    });
  }

  /**
   * View all mandates button in empty state
   */
  if (btnViewAllMandates) {
    btnViewAllMandates.addEventListener('click', (e) => {
      e.stopPropagation();
      renderSubscriptionList(allMonitoredSubs, 'All Services', true);
    });
  }

  /**
   * Toggle between Current Site Vouchers and All Partner Perks
   */
  if (btnBrowseAllPerks) {
    btnBrowseAllPerks.addEventListener('click', (e) => {
      e.stopPropagation();
      isShowingAllStores = !isShowingAllStores;
      if (isShowingAllStores) {
        const all = saralApi.getAllPartnerVouchers();
        renderVoucherList(all, 'All Stores');
      } else {
        renderVoucherList(activeTabVouchers, currentDomainName);
      }
    });
  }

  /**
   * Partner store chip clicks
   */
  partnerChips.forEach((chip) => {
    chip.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = chip.dataset.domain;
      if (domain) {
        const vouchers = await saralApi.fetchVouchersForDomain(domain);
        isShowingAllStores = false;
        renderVoucherList(vouchers, domain);
      }
    });
  });

  /**
   * Load and bind quick toggle controls to storage (Syncs Hub & Privacy views)
   */
  async function loadToggleSettings() {
    try {
      const settings = await SaralStorage.getSettings();
      const vouchersOn = Boolean(settings.vouchersEnabled);
      const subsOn = Boolean(settings.subscriptionsEnabled);
      const passwordsOn = Boolean(settings.passwordAlertEnabled);

      if (toggleVouchers) toggleVouchers.checked = vouchersOn;
      if (toggleSubs) toggleSubs.checked = subsOn;
      if (togglePasswords) togglePasswords.checked = passwordsOn;

      if (togglePrivacyVouchers) togglePrivacyVouchers.checked = vouchersOn;
      if (togglePrivacySubs) togglePrivacySubs.checked = subsOn;
      if (togglePrivacyPasswords) togglePrivacyPasswords.checked = passwordsOn;
    } catch (e) {
      console.warn('[Popup] Failed to load settings:', e);
    }
  }

  async function handleToggleChange(source = 'hub') {
    let vouchersVal, subsVal, passwordsVal;

    if (source === 'privacy') {
      vouchersVal = Boolean(togglePrivacyVouchers?.checked);
      subsVal = Boolean(togglePrivacySubs?.checked);
      passwordsVal = Boolean(togglePrivacyPasswords?.checked);

      if (toggleVouchers) toggleVouchers.checked = vouchersVal;
      if (toggleSubs) toggleSubs.checked = subsVal;
      if (togglePasswords) togglePasswords.checked = passwordsVal;
    } else {
      vouchersVal = Boolean(toggleVouchers?.checked);
      subsVal = Boolean(toggleSubs?.checked);
      passwordsVal = Boolean(togglePasswords?.checked);

      if (togglePrivacyVouchers) togglePrivacyVouchers.checked = vouchersVal;
      if (togglePrivacySubs) togglePrivacySubs.checked = subsVal;
      if (togglePrivacyPasswords) togglePrivacyPasswords.checked = passwordsVal;
    }

    const updated = {
      vouchersEnabled: vouchersVal,
      subscriptionsEnabled: subsVal,
      passwordAlertEnabled: passwordsVal
    };
    await SaralStorage.saveSettings(updated);
    notifyBackground('SETTINGS_UPDATED', { settings: updated });
    await inspectCurrentDomain();
  }

  if (toggleVouchers) toggleVouchers.addEventListener('change', () => handleToggleChange('hub'));
  if (toggleSubs) toggleSubs.addEventListener('change', () => handleToggleChange('hub'));
  if (togglePasswords) togglePasswords.addEventListener('change', () => handleToggleChange('hub'));

  if (togglePrivacyVouchers) togglePrivacyVouchers.addEventListener('change', () => handleToggleChange('privacy'));
  if (togglePrivacySubs) togglePrivacySubs.addEventListener('change', () => handleToggleChange('privacy'));
  if (togglePrivacyPasswords) togglePrivacyPasswords.addEventListener('change', () => handleToggleChange('privacy'));

  /**
   * Data Sanitization: Clear Local Domain & Voucher Cache (Phase 5)
   */
  if (btnClearCache) {
    btnClearCache.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (typeof SaralStorage !== 'undefined' && SaralStorage.clearLocalCache) {
          await SaralStorage.clearLocalCache();
        }
        notifyBackground('CLEAR_LOCAL_CACHE');
        showPrivacyToast('Local domain & voucher cache cleared successfully.');
        await inspectCurrentDomain();
      } catch (err) {
        showPrivacyToast('Cache cleared.');
      }
    });
  }

  /**
   * Data Sanitization: Purge Local Encrypted Vault & Reset PIN (Phase 5)
   */
  if (btnPurgeVault) {
    btnPurgeVault.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = window.confirm('Are you sure you want to purge all locally encrypted credentials and keys? This action cannot be undone.');
      if (!confirmed) return;

      try {
        if (typeof SaralStorage !== 'undefined' && SaralStorage.purgeVaultAndKeys) {
          await SaralStorage.purgeVaultAndKeys();
        }
        notifyBackground('PURGE_LOCAL_VAULT');
        showPrivacyToast('Encrypted vault and master PIN purged.');
        await inspectCurrentDomain();
      } catch (err) {
        showPrivacyToast('Vault purged.');
      }
    });
  }

  /**
   * Health ping and environment indicator
   */
  async function checkConnectionStatus(user) {
    try {
      const health = await saralApi.checkHealth();
      if (health.online) {
        footerPingDot.classList.remove('offline');
        footerPingText.textContent = `${health.latency}ms ping`;
      } else {
        footerPingDot.classList.add('offline');
        footerPingText.textContent = 'Offline';
      }

      if (user?.is_demo || health.mode.includes('Mock')) {
        footerEnvIndicator.textContent = 'Demo Mode';
        footerEnvIndicator.style.color = '#B45309';
      } else {
        footerEnvIndicator.textContent = 'Live API';
        footerEnvIndicator.style.color = '#0F172A';
      }
    } catch {
      footerPingDot.classList.add('offline');
      footerPingText.textContent = 'Offline';
      footerEnvIndicator.textContent = 'Local Standalone';
    }
  }

  /**
   * Password Visibility Toggle
   */
  btnTogglePassword.addEventListener('click', () => {
    const isPassword = inputPassword.type === 'password';
    inputPassword.type = isPassword ? 'text' : 'password';
    eyeIconShow.style.display = isPassword ? 'none' : 'block';
    eyeIconHide.style.display = isPassword ? 'block' : 'none';
  });

  /**
   * Form Submit: Sign In
   */
  
  // Quick Pair Button Handler (View A)
  const inputPairingCode = document.getElementById('input-pairing-code');
  const btnSubmitPairCode = document.getElementById('btn-submit-pair-code');

  if (btnSubmitPairCode && inputPairingCode) {
    btnSubmitPairCode.addEventListener('click', async () => {
      const code = inputPairingCode.value.trim().toUpperCase();
      if (!code || !code.startsWith('SARAL-')) {
        showError('Enter a valid SARAL pairing code (e.g. SARAL-1234-AB).');
        return;
      }

      setButtonLoading(true);
      hideError();

      try {
        // Step 1: Clear any stale session and cached data before pairing
        await chrome.storage.local.clear();

        // Step 2: Resolve the code against the backend to get the real authenticated user
        let resolvedToken = null;
        let resolvedUser = null;
        let pairError = null;

        const apiBase = saralApi.apiBase || 'http://localhost:3000';
        const fallbackBase = 'http://localhost:5000';

        for (const base of [apiBase, fallbackBase]) {
          try {
            const res = await fetch(`${base}/api/companion/pair`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ code }),
              signal: AbortSignal.timeout(5000)
            });

            if (res.ok) {
              const data = await res.json();
              resolvedToken = data.token;
              resolvedUser = saralApi._normalizeUser(data.user || {});
              pairError = null;
              break;
            }

            const errData = await res.json().catch(() => ({}));
            pairError = errData.error || `Server responded with ${res.status}`;
          } catch (fetchErr) {
            pairError = fetchErr.name === 'TimeoutError'
              ? 'Server timed out. Ensure SARAL is running.'
              : fetchErr.message;
          }
        }

        // Step 3: If backend resolved, use real credentials; else try localStorage handoff
        if (!resolvedToken || !resolvedUser) {
          // localStorage handoff: written by saral.html autoPairExtension postMessage handler
          try {
            const lsToken = localStorage.getItem('saral_companion_paired_token');
            const lsUserStr = localStorage.getItem('saral_companion_paired_user');
            if (lsToken && lsUserStr) {
              const lsUser = JSON.parse(lsUserStr);
              const lsCode = localStorage.getItem('saral_companion_paired_code');
              // Only accept if the code matches what saral.html set
              if (!lsCode || lsCode === code) {
                resolvedToken = lsToken;
                resolvedUser = saralApi._normalizeUser(lsUser);
                pairError = null;
              }
            }
          } catch (e) {}
        }

        if (!resolvedToken || !resolvedUser) {
          throw new Error(pairError || 'Could not resolve pairing code. Please generate a new code from SARAL Settings.');
        }

        // Step 4: Persist the real, user-specific session
        await SaralStorage.setToken(resolvedToken);
        await SaralStorage.setUser(resolvedUser);
        notifyBackground('SARAL_AUTH_STATE_CHANGED', {
          isAuthenticated: true,
          token: resolvedToken,
          user: resolvedUser
        });

        // Clear localStorage pairing handoff to prevent replay
        try {
          localStorage.removeItem('saral_companion_paired_token');
          localStorage.removeItem('saral_companion_paired_user');
          localStorage.removeItem('saral_companion_paired_at');
          localStorage.removeItem('saral_companion_paired_code');
        } catch (e) {}

        await showLoggedInView(resolvedUser);
      } catch (err) {
        showError('Pairing failed: ' + err.message);
      } finally {
        setButtonLoading(false);
      }
    });
  }

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const email = inputEmail.value.trim();
    const password = inputPassword.value;

    if (!email) {
      showError('Please enter your email address.');
      inputEmail.focus();
      return;
    }
    if (!password) {
      showError('Please enter your password.');
      inputPassword.focus();
      return;
    }

    setButtonLoading(true);

    try {
      const authResult = await saralApi.login(email, password);
      await SaralStorage.setToken(authResult.token);
      await SaralStorage.setUser(authResult.user);
      notifyBackground('SARAL_AUTH_STATE_CHANGED', { isAuthenticated: true });
      await showLoggedInView(authResult.user);
    } catch (err) {
      console.error('[Popup Login]', err);
      showError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setButtonLoading(false);
    }
  });

  /**
   * Sign Out / Disconnect Action
   */
  btnSignOut.addEventListener('click', async () => {
    try {
      await SaralStorage.clearSession();
      notifyBackground('SARAL_AUTH_STATE_CHANGED', { isAuthenticated: false });
      showLoggedOutView();
    } catch (err) {
      console.error('[Popup SignOut]', err);
      showLoggedOutView();
    }
  });

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * INITIALIZATION SEQUENCE
   */
  try {
    const existingToken = await SaralStorage.getToken();
    if (existingToken) {
      try {
        const cachedUser = await SaralStorage.getUser();
        const profile = await saralApi.fetchProfile(existingToken);
        const resolvedUser = profile || cachedUser;
        if (resolvedUser) {
          await SaralStorage.setUser(resolvedUser);
          notifyBackground('SARAL_AUTH_STATE_CHANGED', { isAuthenticated: true });
          await showLoggedInView(resolvedUser);
          return;
        }
      } catch (profileErr) {
        console.warn('[Popup] Session token validation failed:', profileErr);
        await SaralStorage.clearSession();
      }
    }

    notifyBackground('SARAL_AUTH_STATE_CHANGED', { isAuthenticated: false });
    showLoggedOutView();
  } catch (initErr) {
    console.error('[Popup Init Error]', initErr);
    showLoggedOutView();
  }
});
