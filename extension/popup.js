/**
 * SARAL Companion Extension — Popup Controller (Phase 2: Smart Rewards Engine)
 * Manages View A (Sign In) and View B (Companion Hub) states,
 * contextual voucher inspection, accordion dropdown, and responsive UI interactions.
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
  const subsMetricText = document.getElementById('subs-metric-text');
  const securityMetricText = document.getElementById('security-metric-text');

  // Toggles
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
    viewLoggedOut.style.display = 'none';
    viewLoggedIn.style.display = 'flex';

    // Populate user profile
    const displayName = user?.display_name || 'Samridhi';
    const initials = user?.initials || 'SG';
    userDisplayName.textContent = displayName;
    userAvatarInitials.textContent = initials;

    // Load user preferences into toggles
    await loadToggleSettings();

    // Inspect active tab domain and load vouchers
    await inspectCurrentDomain();

    // Run connection ping and environment detection
    checkConnectionStatus(user);
  }

  /**
   * Display error alert banner in View A
   * @param {string} message
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
   * @param {boolean} isLoading
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
   * Inspect current active tab and query contextual vouchers
   */
  async function inspectCurrentDomain() {
    let domain = 'localhost';

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await new Promise(resolve => {
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

    // Check if user enabled voucher inspection
    const settings = await SaralStorage.getSettings();
    if (!settings.vouchersEnabled) {
      rewardsMetricText.textContent = 'Vouchers paused in settings';
      rewardsCardBadge.textContent = 'PAUSED';
      rewardsCardBadge.className = 'card-tag';
      return;
    }

    // Fetch verified vouchers for this domain
    rewardsMetricText.textContent = `Checking vouchers for ${domain}...`;
    try {
      const token = await SaralStorage.getToken();
      const vouchers = await saralApi.fetchVouchersForDomain(domain, token);
      activeTabVouchers = vouchers || [];
      isShowingAllStores = false;

      renderRewardsSummary(domain, activeTabVouchers);
      renderVoucherList(activeTabVouchers, domain);
    } catch (err) {
      console.warn('[Popup] Voucher lookup failed:', err);
      rewardsMetricText.textContent = `0 active vouchers for ${domain}`;
      rewardsCardBadge.textContent = '0 DEALS';
      rewardsCardBadge.className = 'card-tag';
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
   * Render voucher list inside the accordion panel
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
   * Toggle Accordion Dropdown on clicking Rewards Card
   */
  if (cardRewards) {
    cardRewards.addEventListener('click', () => {
      const isVisible = rewardsDropdownPanel.style.display !== 'none';
      if (isVisible) {
        rewardsDropdownPanel.style.display = 'none';
        rewardsChevronContainer.classList.remove('expanded');
      } else {
        rewardsDropdownPanel.style.display = 'block';
        rewardsChevronContainer.classList.add('expanded');
      }
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
  partnerChips.forEach(chip => {
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
   * Load and bind quick toggle controls to storage
   */
  async function loadToggleSettings() {
    try {
      const settings = await SaralStorage.getSettings();
      toggleVouchers.checked = Boolean(settings.vouchersEnabled);
      toggleSubs.checked = Boolean(settings.subscriptionsEnabled);
      togglePasswords.checked = Boolean(settings.passwordAlertEnabled);
    } catch (e) {
      console.warn('[Popup] Failed to load settings:', e);
    }
  }

  async function handleToggleChange() {
    const updated = {
      vouchersEnabled: toggleVouchers.checked,
      subscriptionsEnabled: toggleSubs.checked,
      passwordAlertEnabled: togglePasswords.checked
    };
    await SaralStorage.saveSettings(updated);

    // Refresh rewards display on toggle change
    await inspectCurrentDomain();
  }

  toggleVouchers.addEventListener('change', handleToggleChange);
  toggleSubs.addEventListener('change', handleToggleChange);
  togglePasswords.addEventListener('change', handleToggleChange);

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

      // Determine environment mode
      if (user?.is_demo || health.mode.includes('Mock')) {
        footerEnvIndicator.textContent = 'Demo Mode';
        footerEnvIndicator.style.color = '#B45309'; // Amber
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
