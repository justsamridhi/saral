/**
 * SARAL Companion Extension — API Client
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
        // Try fallback port if 5000 was unreachable
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

    // 1. Explicit mock mode check
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

    // 2. Attempt live authentication with local SARAL backend
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
        // Check secondary port if primary timed out
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

      // If backend responded with 401/400
      if (response && response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Invalid SARAL credentials. Please check your email and password.');
      }

      // If endpoint not implemented yet on server or returned 404, fallback to demo verification
      // if credentials match standard demo identity
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
      // Graceful fallback: If user uses the demo email when backend is disconnected
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

    // Isolated demo tokens return mock metadata directly
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
      // If server unreachable but token exists, return fallback user
      return MOCK_SESSION_SAMRIDHI.user;
    }
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SaralAPI, saralApi: saralApiInstance };
}
if (typeof window !== 'undefined') {
  window.SaralAPI = SaralAPI;
  window.saralApi = saralApiInstance;
}

