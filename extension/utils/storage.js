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
  SETTINGS: 'saral_extension_settings',
  VAULT_RECORDS: 'saral_vault_records',
  VAULT_SALT: 'saral_vault_salt',
  SECURITY_AUDIT: 'saral_security_audit'
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

  /**
   * Retrieve encrypted or active local vault records
   * @returns {Promise<Array<object>>}
   */
  static async getVaultRecords() {
    const records = await this.get(STORAGE_KEYS.VAULT_RECORDS);
    return Array.isArray(records) ? records : [];
  }

  /**
   * Save or update a vault credential record
   * @param {object} record
   * @returns {Promise<Array<object>>}
   */
  static async saveVaultRecord(record) {
    if (!record || !record.id) return [];
    const list = await this.getVaultRecords();
    const index = list.findIndex(r => r.id === record.id);
    if (index >= 0) {
      list[index] = { ...list[index], ...record, updatedAt: Date.now() };
    } else {
      list.push({ ...record, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await this.set(STORAGE_KEYS.VAULT_RECORDS, list);
    return list;
  }

  /**
   * Delete vault record by ID
   * @param {string} id
   * @returns {Promise<Array<object>>}
   */
  static async deleteVaultRecord(id) {
    const list = await this.getVaultRecords();
    const filtered = list.filter(r => r.id !== id);
    await this.set(STORAGE_KEYS.VAULT_RECORDS, filtered);
    return filtered;
  }

  /**
   * Get or initialize master cryptographic salt
   * @returns {Promise<string>} Hex representation of 16-byte salt
   */
  static async getMasterSalt() {
    let saltHex = await this.get(STORAGE_KEYS.VAULT_SALT);
    if (!saltHex) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
      await this.set(STORAGE_KEYS.VAULT_SALT, saltHex);
    }
    return saltHex;
  }

  /**
   * Retrieve cached security habit audit summary
   * @returns {Promise<{healthScore: number, reusedCount: number, staleCount: number, totalPasswords: number}|null>}
   */
  static async getSecurityAuditSummary() {
    return await this.get(STORAGE_KEYS.SECURITY_AUDIT);
  }

  /**
   * Persist security habit audit summary
   * @param {object} summary
   * @returns {Promise<void>}
   */
  static async saveSecurityAuditSummary(summary) {
    await this.set(STORAGE_KEYS.SECURITY_AUDIT, summary);
  }

  /**
   * Phase 5: Clear local caches and cached domain context
   * Preserves session credentials and master key.
   * @returns {Promise<void>}
   */
  static async clearLocalCache() {
    await this.remove(STORAGE_KEYS.SECURITY_AUDIT);
    await this.remove('saral_current_domain');
  }

  /**
   * Phase 5: Complete purge of local encrypted vault records and derived keys
   * @returns {Promise<void>}
   */
  static async purgeVaultAndKeys() {
    await this.remove(STORAGE_KEYS.VAULT_RECORDS);
    await this.remove(STORAGE_KEYS.VAULT_SALT);
    await this.remove(STORAGE_KEYS.SECURITY_AUDIT);
  }
}

// Export for ES modules and window/worker global scope
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SaralStorage;
}
if (typeof window !== 'undefined') {
  window.SaralStorage = SaralStorage;
}
if (typeof self !== 'undefined') {
  self.SaralStorage = SaralStorage;
}

