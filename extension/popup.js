/**
 * SARAL Companion Extension — Popup Controller (Phase 1)
 * Manages View A (Sign In) and View B (Companion Hub) states,
 * session lifecycle, and responsive UI interactions.
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
  const rewardsMetricText = document.getElementById('rewards-metric-text');
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

  /**
   * Safe message dispatcher to background script
   */
  function notifyBackground(type, payload = {}) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type, ...payload }, () => {
        // Suppress lastError if background was sleeping
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
    loadToggleSettings();

    // Inspect active tab domain
    inspectCurrentDomain();

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
   * Inspect current active tab and update contextual strip
   */
  function inspectCurrentDomain() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url) {
          try {
            const url = new URL(tabs[0].url);
            const domain = url.hostname.replace(/^www\./, '');
            if (domain && !domain.includes('extension') && !domain.startsWith('chrome')) {
              activeDomainName.textContent = domain;
              rewardsMetricText.textContent = `0 active vouchers for ${domain}`;
              return;
            }
          } catch {
            // fallback below
          }
        }
        activeDomainName.textContent = 'No web page active';
        rewardsMetricText.textContent = '0 active vouchers for current domain';
      });
    } else {
      activeDomainName.textContent = 'localhost (preview)';
      rewardsMetricText.textContent = '0 active vouchers for current domain';
    }
  }

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
      // Authenticate via SaralAPI client
      const authResult = await saralApi.login(email, password);

      // Persist session token and sanitized user profile
      await SaralStorage.setToken(authResult.token);
      await SaralStorage.setUser(authResult.user);

      // Notify background service worker to update extension badge
      notifyBackground('SARAL_AUTH_STATE_CHANGED', { isAuthenticated: true });

      // Immediate transition to View B
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

  /**
   * INITIALIZATION SEQUENCE
   * Check storage for existing session token and auto-mount View B or View A
   */
  try {
    const existingToken = await SaralStorage.getToken();
    if (existingToken) {
      // Token found: Attempt profile fetch or fallback to cached profile
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

    // Default to View A if no valid token
    notifyBackground('SARAL_AUTH_STATE_CHANGED', { isAuthenticated: false });
    showLoggedOutView();
  } catch (initErr) {
    console.error('[Popup Init Error]', initErr);
    showLoggedOutView();
  }
});

