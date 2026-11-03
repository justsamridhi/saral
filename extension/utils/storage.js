/**
 * SARAL Companion Extension — Storage Client
 * Typed, async wrapper around chrome.storage.local with browser fallback.
 *
 * Security Invariant:
 * Only public profile metadata and short-lived JWT session tokens are stored.
 * Never store service-role keys or payment authorization secrets.
 */

const STORAGE_KEYS = {
  SESSION_TOKEN: 'saral_session_token',
  USER_PROFILE: 'saral_user_profile',
  SETTINGS: 'saral_extension_settings'
};

const DEFAULT_SETTINGS = {
  vouchersEnabled: true,
  subscriptionsEnabled: true,
  passwordAlertEnabled: true,
  mockMode: false
};

class SaralStorage {
  /**
   * Internal helper to determine storage engine
   */
  static isChromeStorageAvailable() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    );
  }

  /**
   * Low-level read from storage engine
   * @param {string} key
   * @returns {Promise<any>}
   */
  static async get(key) {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] !== undefined ? result[key] : null);
        });
      });
    }

    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  }

  /**
   * Low-level write to storage engine
   * @param {string} key
   * @param {any} value
   * @returns {Promise<void>}
   */
  static async set(key, value) {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[SaralStorage] LocalStorage write failed:', e);
    }
  }

  /**
   * Low-level remove from storage engine
   * @param {string} key
   * @returns {Promise<void>}
   */
  static async remove(key) {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove([key], resolve);
      });
    }

    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('[SaralStorage] LocalStorage remove failed:', e);
    }
  }

  /**
   * Retrieve current Supabase / SARAL auth session token
   * @returns {Promise<string|null>}
   */
  static async getToken() {
    return await this.get(STORAGE_KEYS.SESSION_TOKEN);
  }

  /**
   * Store session token
   * @param {string} token
   * @returns {Promise<void>}
   */
  static async setToken(token) {
    if (!token) {
      await this.remove(STORAGE_KEYS.SESSION_TOKEN);
    } else {
      await this.set(STORAGE_KEYS.SESSION_TOKEN, token);
    }
  }

  /**
   * Retrieve cached authenticated user profile
   * @returns {Promise<{id: string, email: string, full_name?: string, display_name?: string, is_demo?: boolean}|null>}
   */
  static async getUser() {
    return await this.get(STORAGE_KEYS.USER_PROFILE);
  }

  /**
   * Store user profile metadata
   * @param {object} user
   * @returns {Promise<void>}
   */
  static async setUser(user) {
    if (!user) {
      await this.remove(STORAGE_KEYS.USER_PROFILE);
    } else {
      await this.set(STORAGE_KEYS.USER_PROFILE, user);
    }
  }

  /**
   * Retrieve extension toggle settings
   * @returns {Promise<{vouchersEnabled: boolean, subscriptionsEnabled: boolean, passwordAlertEnabled: boolean, mockMode: boolean}>}
   */
  static async getSettings() {
    const saved = await this.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(saved || {}) };
  }

  /**
   * Save extension toggle settings
   * @param {object} settings
   * @returns {Promise<void>}
   */
  static async saveSettings(settings) {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await this.set(STORAGE_KEYS.SETTINGS, updated);
    return updated;
  }

  /**
   * Clear all authenticated session data (Disconnect / Logout)
   * Preserves non-sensitive toggle settings.
   * @returns {Promise<void>}
   */
  static async clearSession() {
    await this.remove(STORAGE_KEYS.SESSION_TOKEN);
    await this.remove(STORAGE_KEYS.USER_PROFILE);
  }
}

// Export for ES modules and window object for script tag loading
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SaralStorage;
}
if (typeof window !== 'undefined') {
  window.SaralStorage = SaralStorage;
}
