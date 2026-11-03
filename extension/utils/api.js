/**
 * SARAL Companion Extension — API Client (Phase 3: Active Subscription & Auto-Pay Tracker)
 * Targets SARAL Personal Workspace, Supabase Auth & Consumer Modules.
 *
 * Security Invariants:
 * Pure client surface. Under NO circumstances should any Supabase service-role
 * keys, payment card secrets, CVVs, or bank authorization tokens be handled here.
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

/**
 * Active Subscriptions & Mandates Mock Catalog (Phase 3)
 * Surfacing recurring auto-pay commitments authorized via SARAL Personal Workspace
 */
const MOCK_SUBSCRIPTIONS = [
  {
    id: 'sub_cld_01',
    service: 'Anthropic Claude Pro',
    plan: 'Pro Subscription',
    amount: '$20.00',
    amountInr: 1680,
    currency: 'USD',
    frequency: 'month',
    renewalDate: 'Nov 14, 2026',
    daysUntilRenewal: 10,
    autoPayStatus: 'Active',
    autoPayMethod: 'SARAL UPI (autopay@saral)',
    domain: 'claude.ai',
    domains: ['claude.ai', 'anthropic.com'],
    category: 'AI & Productivity',
    isImminent: true
  },
  {
    id: 'sub_nflx_01',
    service: 'Netflix Premium',
    plan: 'Premium 4K + HDR',
    amount: '₹649',
    amountInr: 649,
    currency: 'INR',
    frequency: 'month',
    renewalDate: 'Nov 22, 2026',
    daysUntilRenewal: 18,
    autoPayStatus: 'Active',
    autoPayMethod: 'SARAL Virtual Card (•• 4291)',
    domain: 'netflix.com',
    domains: ['netflix.com'],
    category: 'Streaming & Video',
    isImminent: false
  },
  {
    id: 'sub_sptf_01',
    service: 'Spotify Individual',
    plan: 'Premium Individual',
    amount: '₹119',
    amountInr: 119,
    currency: 'INR',
    frequency: 'month',
    renewalDate: 'Nov 18, 2026',
    daysUntilRenewal: 14,
    autoPayStatus: 'Active',
    autoPayMethod: 'SARAL Wallet Auto-Debit',
    domain: 'spotify.com',
    domains: ['spotify.com'],
    category: 'Music & Audio',
    isImminent: false
  },
  {
    id: 'sub_gpt_01',
    service: 'ChatGPT Plus',
    plan: 'Plus Subscription',
    amount: '$20.00',
    amountInr: 1680,
    currency: 'USD',
    frequency: 'month',
    renewalDate: 'Nov 29, 2026',
    daysUntilRenewal: 25,
    autoPayStatus: 'Active',
    autoPayMethod: 'SARAL Virtual Card (•• 8814)',
    domain: 'chatgpt.com',
    domains: ['chatgpt.com', 'openai.com'],
    category: 'AI & Productivity',
    isImminent: false
  },
  {
    id: 'sub_amz_01',
    service: 'Amazon Prime Annual',
    plan: 'Prime 1-Year Membership',
    amount: '₹1,499',
    amountInr: 125, // amortized monthly INR
    currency: 'INR',
    frequency: 'year',
    renewalDate: 'Jan 05, 2027',
    daysUntilRenewal: 62,
    autoPayStatus: 'Active',
    autoPayMethod: 'SARAL UPI Mandate (annual-mandate@upi)',
    domain: 'amazon.in',
    domains: ['amazon.in', 'amazon.com'],
    category: 'Delivery & Video',
    isImminent: false
  },
  {
    id: 'sub_dev_01',
    service: 'SARAL Developer Cloud',
    plan: 'Sandbox Pro Tier',
    amount: '₹499',
    amountInr: 499,
    currency: 'INR',
    frequency: 'month',
    renewalDate: 'Nov 30, 2026',
    daysUntilRenewal: 26,
    autoPayStatus: 'Active',
    autoPayMethod: 'SARAL Sandbox Vault',
    domain: 'localhost',
    domains: ['localhost', '127.0.0.1'],
    category: 'Developer Sandbox',
    isImminent: false
  }
];

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
   * Safe deep-link URL to SARAL dashboard Activity / Subscriptions view
   * @returns {string}
   */
  getDashboardActivityUrl() {
    return `${this.apiBase}/saral.html#activity`;
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
   * Phase 2: Fetch verified vouchers for target domain
   * @param {string} domain
   * @param {string} [token]
   * @returns {Promise<Array<object>>}
   */
  async fetchVouchersForDomain(domain, token) {
    const cleanDomain = this._cleanDomain(domain);
    if (!cleanDomain) return [];

    if (this.mockMode) {
      return this._findMockVouchers(cleanDomain);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(
        `${this.apiBase}/api/user/vouchers?domain=${encodeURIComponent(cleanDomain)}`,
        { method: 'GET', headers, signal: controller.signal }
      ).catch(async () => {
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

      return this._findMockVouchers(cleanDomain);
    } catch {
      return this._findMockVouchers(cleanDomain);
    }
  }

  /**
   * Retrieve all partner vouchers
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
   * Phase 3: Fetch active recurring subscriptions / mandates for domain
   * @param {string} domain - Target merchant hostname
   * @param {string} [token] - Authenticated user JWT
   * @returns {Promise<Array<object>>} - List of subscription mandate objects
   */
  async fetchSubscriptionsForDomain(domain, token) {
    const cleanDomain = this._cleanDomain(domain);
    if (!cleanDomain) return [];

    if (this.mockMode) {
      return this._findMockSubscriptions(cleanDomain);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(
        `${this.apiBase}/api/user/subscriptions?domain=${encodeURIComponent(cleanDomain)}`,
        { method: 'GET', headers, signal: controller.signal }
      ).catch(async () => {
        return await fetch(
          `${FALLBACK_API_BASE}/api/user/subscriptions?domain=${encodeURIComponent(cleanDomain)}`,
          { method: 'GET', headers, signal: controller.signal }
        );
      });

      clearTimeout(timeoutId);

      if (response && response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : (data.subscriptions || []);
        if (list.length > 0) return list;
      }

      return this._findMockSubscriptions(cleanDomain);
    } catch {
      return this._findMockSubscriptions(cleanDomain);
    }
  }

  /**
   * Phase 3: Retrieve all active user subscriptions to calculate burn & overview
   * @param {string} [token]
   * @returns {Promise<Array<object>>}
   */
  async getAllUserSubscriptions(token) {
    if (this.mockMode) {
      return MOCK_SUBSCRIPTIONS;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${this.apiBase}/api/user/subscriptions`, {
        method: 'GET',
        headers,
        signal: controller.signal
      }).catch(async () => {
        return await fetch(`${FALLBACK_API_BASE}/api/user/subscriptions`, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
      });

      clearTimeout(timeoutId);

      if (response && response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : (data.subscriptions || []);
        if (list.length > 0) return list;
      }

      return MOCK_SUBSCRIPTIONS;
    } catch {
      return MOCK_SUBSCRIPTIONS;
    }
  }

  /**
   * Compute monthly burn stats from subscription array
   * @param {Array<object>} subscriptions
   * @returns {{count: number, estimatedMonthlyInr: number, formattedInr: string}}
   */
  calculateMonthlyBurn(subscriptions = []) {
    const count = subscriptions.length;
    let totalInr = 0;

    subscriptions.forEach(sub => {
      if (sub.amountInr) {
        totalInr += Number(sub.amountInr);
      } else if (sub.currency === 'USD') {
        const num = parseFloat(String(sub.amount).replace(/[^0-9.]/g, '')) || 0;
        totalInr += Math.round(num * 84);
      } else {
        const num = parseFloat(String(sub.amount).replace(/[^0-9.]/g, '')) || 0;
        if (sub.frequency === 'year') {
          totalInr += Math.round(num / 12);
        } else {
          totalInr += Math.round(num);
        }
      }
    });

    return {
      count,
      estimatedMonthlyInr: totalInr,
      formattedInr: `₹${totalInr.toLocaleString('en-IN')}`
    };
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
    for (const partnerDomain of Object.keys(MOCK_PARTNER_VOUCHERS)) {
      if (cleanDomain.endsWith(`.${partnerDomain}`)) {
        return MOCK_PARTNER_VOUCHERS[partnerDomain];
      }
    }
    return [];
  }

  /**
   * Helper: Match domain against subscriptions catalog
   * @private
   */
  _findMockSubscriptions(cleanDomain) {
    return MOCK_SUBSCRIPTIONS.filter(sub => {
      if (sub.domain === cleanDomain) return true;
      if (sub.domains && sub.domains.includes(cleanDomain)) return true;
      if (sub.domains && sub.domains.some(d => cleanDomain.endsWith(`.${d}`))) return true;
      return false;
    });
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
