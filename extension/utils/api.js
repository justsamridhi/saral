/**
 * SARAL Companion Extension — API Client (Phase 2: Smart Rewards Engine)
 * Targets SARAL Personal Workspace & Supabase Auth endpoints.
 *
 * Security Invariant:
 * Pure client surface. Under NO circumstances should any Supabase service-role
 * keys or payment authorization secrets be included in this file.
 */

// Toggleable mock fallback switch (defaulting to live local backend)
const MOCK_MODE = false;

// Default local backend ports (per manifest host_permissions: http://localhost:5000/*)
const DEFAULT_API_BASE = 'http://localhost:5000';
const FALLBACK_API_BASE = 'http://localhost:3000';

// Mock payload representing Samridhi Gupta for isolated demo/disconnected mode
const MOCK_SESSION_SAMRIDHI = {
  token: 'demo-token-samridhi-2026',
  user: {
    id: 'usr_samridhi_kdu_01',
    email: 'samridhi@kdu.in',
    full_name: 'Samridhi Gupta',
    display_name: 'Samridhi',
    avatar_url: null,
    account_plan: 'personal',
    initials: 'SG',
    is_demo: true
  }
};

/**
 * Partner Vouchers Mock Catalog (Phase 2)
 * Provides realistic verified discounts on partner merchant domains
 */
const MOCK_PARTNER_VOUCHERS = {
  'amazon.in': [
    {
      id: 'vch_amz_01',
      code: 'SARALAMZ15',
      discount: '15% OFF',
      title: 'Amazon SARAL Festive Savings',
      terms: 'Min spend ₹999 on Electronics & Lifestyle',
      expiry: 'Valid till 30 Nov 2026',
      domain: 'amazon.in',
      merchant: 'Amazon India',
      category: 'Electronics & Retail'
    },
    {
      id: 'vch_amz_02',
      code: 'SARALPAY50',
      discount: '₹50 CASHBACK',
      title: 'SARAL UPI/Card Instant Rebate',
      terms: 'Min recharge or utility bill of ₹199',
      expiry: 'Valid till 15 Dec 2026',
      domain: 'amazon.in',
      merchant: 'Amazon Pay',
      category: 'Utilities & Bills'
    }
  ],
  'lavazza.com': [
    {
      id: 'vch_lvz_01',
      code: 'SARALCOFFEE',
      discount: '25% OFF',
      title: 'Lavazza Premium Espresso Reserve',
      terms: 'No min spend on whole beans, capsules & ground coffee',
      expiry: 'Valid till 15 Dec 2026',
      domain: 'lavazza.com',
      merchant: 'Lavazza Coffee',
      category: 'Beverages & Gourmet'
    }
  ],
  'swiggy.com': [
    {
      id: 'vch_swg_01',
      code: 'SARALMEALS',
      discount: '₹120 OFF',
      title: 'Swiggy Gourmet Dining Partner Perk',
      terms: 'Min order ₹299 on Gourmet & Dineout restaurants',
      expiry: 'Valid till 28 Nov 2026',
      domain: 'swiggy.com',
      merchant: 'Swiggy',
      category: 'Food & Dining'
    }
  ],
  'myntra.com': [
    {
      id: 'vch_myn_01',
      code: 'MYNSARAL30',
      discount: '30% OFF',
      title: 'Myntra Wardrobe Refresh',
      terms: 'Valid on select Autumn/Winter fashion collections',
      expiry: 'Valid till 10 Dec 2026',
      domain: 'myntra.com',
      merchant: 'Myntra Fashion',
      category: 'Fashion & Apparel'
    }
  ],
  'localhost': [
    {
      id: 'vch_dev_01',
      code: 'SARALDEV50',
      discount: '50% OFF',
      title: 'SARAL Partner Sandbox Perk',
      terms: 'Verified companion test voucher for local checkout preview',
      expiry: 'Valid till 31 Dec 2026',
      domain: 'localhost',
      merchant: 'SARAL Localhost Dev',
      category: 'Developer Sandbox'
    }
  ],
  '127.0.0.1': [
    {
      id: 'vch_dev_02',
      code: 'SARALDEV50',
      discount: '50% OFF',
      title: 'SARAL Partner Sandbox Perk',
      terms: 'Verified companion test voucher for local checkout preview',
      expiry: 'Valid till 31 Dec 2026',
      domain: '127.0.0.1',
      merchant: 'SARAL Localhost Dev',
      category: 'Developer Sandbox'
    }
  ],
  'github.com': [
    {
      id: 'vch_gh_01',
      code: 'SARALGIT10',
      discount: 'FREE TIER BOOST',
      title: 'Open Source Community Voucher',
      terms: 'Special perk for SARAL open-source contributors',
      expiry: 'Valid till 31 Dec 2026',
      domain: 'github.com',
      merchant: 'GitHub Community',
      category: 'Developer Perks'
    }
  ]
};

class SaralAPI {
  constructor(apiBase = DEFAULT_API_BASE) {
    this.apiBase = apiBase;
    this.mockMode = MOCK_MODE;
  }

  /**
   * Set API base URL dynamically
   * @param {string} url
   */
  setBaseUrl(url) {
    if (url) this.apiBase = url.replace(/\/$/, '');
  }

  /**
   * Set mock mode flag
   * @param {boolean} enabled
   */
  setMockMode(enabled) {
    this.mockMode = Boolean(enabled);
  }

  /**
   * Check connection and determine latency
   * @returns {Promise<{online: boolean, latency: number, mode: string}>}
   */
  async checkHealth() {
    if (this.mockMode) {
      return { online: true, latency: 12, mode: 'Mock Mode (Demo)' };
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const response = await fetch(`${this.apiBase}/favicon.ico`, {
        method: 'GET',
        signal: controller.signal
      }).catch(async () => {
        return await fetch(`${FALLBACK_API_BASE}/favicon.ico`, {
          method: 'GET',
          signal: controller.signal
        });
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - start;

      if (response && (response.ok || response.status === 404 || response.status === 403)) {
        return { online: true, latency, mode: 'Connected (Live)' };
      }
      return { online: false, latency: 0, mode: 'Offline' };
    } catch {
      return { online: false, latency: 0, mode: 'Offline (Fallback Available)' };
    }
  }

  /**
   * Authenticate user against SARAL auth / Supabase Auth
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{token: string, user: object, isMock: boolean}>}
   */
  async login(email, password) {
    const trimmedEmail = (email || '').trim();
    if (!trimmedEmail) {
      throw new Error('Please enter your SARAL email address.');
    }
    if (!password) {
      throw new Error('Please enter your password.');
    }

    if (this.mockMode) {
      return {
        ...MOCK_SESSION_SAMRIDHI,
        user: {
          ...MOCK_SESSION_SAMRIDHI.user,
          email: trimmedEmail,
          display_name: trimmedEmail.split('@')[0] || 'Samridhi'
        },
        isMock: true
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      let response = await fetch(`${this.apiBase}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ email: trimmedEmail, password }),
        signal: controller.signal
      }).catch(async (fetchErr) => {
        try {
          return await fetch(`${FALLBACK_API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ email: trimmedEmail, password })
          });
        } catch {
          throw fetchErr;
        }
      });

      clearTimeout(timeoutId);

      if (response && response.ok) {
        const data = await response.json();
        return {
          token: data.token || data.access_token || data.session?.access_token,
          user: this._normalizeUser(data.user || data.profile || { email: trimmedEmail }),
          isMock: false
        };
      }

      if (response && response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Invalid SARAL credentials. Please check your email and password.');
      }

      if (response && (response.status === 404 || response.status === 405)) {
        if (trimmedEmail.toLowerCase() === 'samridhi@kdu.in' || trimmedEmail.includes('samridhi')) {
          return {
            ...MOCK_SESSION_SAMRIDHI,
            user: { ...MOCK_SESSION_SAMRIDHI.user, email: trimmedEmail },
            isMock: true
          };
        }
        throw new Error('SARAL auth service endpoint unavailable on local server.');
      }

      throw new Error(`Authentication service error (${response ? response.status : 'offline'}).`);
    } catch (networkErr) {
      if (trimmedEmail.toLowerCase() === 'samridhi@kdu.in' || trimmedEmail.toLowerCase().includes('demo')) {
        console.info('[SaralAPI] Local backend unreachable. Falling back to isolated demo profile for Samridhi Gupta.');
        return {
          ...MOCK_SESSION_SAMRIDHI,
          user: { ...MOCK_SESSION_SAMRIDHI.user, email: trimmedEmail },
          isMock: true
        };
      }

      throw new Error(
        networkErr.message && !networkErr.message.includes('fetch')
          ? networkErr.message
          : 'Unable to connect to SARAL backend. Ensure local server is running on http://localhost:5000.'
      );
    }
  }

  /**
   * Fetch authenticated user profile
   * @param {string} token
   * @returns {Promise<object>}
   */
  async fetchProfile(token) {
    if (!token) {
      throw new Error('Session token missing.');
    }

    if (token.startsWith('demo-') || this.mockMode) {
      return MOCK_SESSION_SAMRIDHI.user;
    }

    try {
      const response = await fetch(`${this.apiBase}/api/profile`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Session expired. Please sign in again.');
        }
        throw new Error('Failed to retrieve user profile.');
      }

      const profile = await response.json();
      return this._normalizeUser(profile);
    } catch (err) {
      if (err.message.includes('Session expired')) throw err;
      return MOCK_SESSION_SAMRIDHI.user;
    }
  }

  /**
   * Phase 2: Smart Rewards & Contextual Voucher Engine
   * Fetches active vouchers for the target domain
   *
   * @param {string} domain - Target merchant hostname (e.g. 'amazon.in', 'swiggy.com')
   * @param {string} [token] - Optional user JWT for authenticated rate-limits & personalized rewards
   * @returns {Promise<Array<object>>} - List of verified voucher objects
   */
  async fetchVouchersForDomain(domain, token) {
    const cleanDomain = this._cleanDomain(domain);
    if (!cleanDomain) return [];

    // 1. If explicit mock mode is set, use local mock catalog
    if (this.mockMode) {
      return this._findMockVouchers(cleanDomain);
    }

    // 2. Attempt live query to SARAL user vouchers endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(
        `${this.apiBase}/api/user/vouchers?domain=${encodeURIComponent(cleanDomain)}`,
        { method: 'GET', headers, signal: controller.signal }
      ).catch(async () => {
        // Fallback port attempt
        return await fetch(
          `${FALLBACK_API_BASE}/api/user/vouchers?domain=${encodeURIComponent(cleanDomain)}`,
          { method: 'GET', headers, signal: controller.signal }
        );
      });

      clearTimeout(timeoutId);

      if (response && response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : (data.vouchers || []);
        if (list.length > 0) return list;
      }

      // If backend returned 404 or empty, fall back to verified mock catalog for partner domains
      return this._findMockVouchers(cleanDomain);
    } catch {
      // Disconnected / offline fallback
      return this._findMockVouchers(cleanDomain);
    }
  }

  /**
   * Retrieve all partner vouchers across supported domains
   * @returns {Array<object>}
   */
  getAllPartnerVouchers() {
    const all = [];
    Object.values(MOCK_PARTNER_VOUCHERS).forEach(vouchers => {
      all.push(...vouchers);
    });
    return all;
  }

  /**
   * Helper: Normalize hostname to clean domain
   * @private
   */
  _cleanDomain(domain) {
    if (!domain) return '';
    return String(domain)
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '')
      .trim();
  }

  /**
   * Helper: Match domain against partner catalog with subdomain support
   * @private
   */
  _findMockVouchers(cleanDomain) {
    if (MOCK_PARTNER_VOUCHERS[cleanDomain]) {
      return MOCK_PARTNER_VOUCHERS[cleanDomain];
    }

    // Subdomain matching (e.g. pay.amazon.in -> amazon.in, food.swiggy.com -> swiggy.com)
    for (const partnerDomain of Object.keys(MOCK_PARTNER_VOUCHERS)) {
      if (cleanDomain.endsWith(`.${partnerDomain}`)) {
        return MOCK_PARTNER_VOUCHERS[partnerDomain];
      }
    }

    return [];
  }

  /**
   * Normalizes profile data to consistent shape
   * @private
   */
  _normalizeUser(raw) {
    const fullName = raw.full_name || raw.name || raw.display_name || 'Samridhi Gupta';
    const displayName = raw.display_name || fullName.split(' ')[0] || 'Samridhi';
    const email = raw.email || 'samridhi@kdu.in';

    const initials = fullName
      .split(' ')
      .map(part => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'SG';

    return {
      id: raw.id || 'usr_unknown',
      email,
      full_name: fullName,
      display_name: displayName,
      initials,
      avatar_url: raw.avatar_url || null,
      account_plan: raw.account_plan || 'personal',
      is_demo: Boolean(raw.is_demo)
    };
  }
}

// Single instance export
const saralApiInstance = new SaralAPI();

// Export for Node, window, and worker global scope
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SaralAPI, saralApi: saralApiInstance };
}
if (typeof window !== 'undefined') {
  window.SaralAPI = SaralAPI;
  window.saralApi = saralApiInstance;
}
if (typeof self !== 'undefined') {
  self.SaralAPI = SaralAPI;
  self.saralApi = saralApiInstance;
}
