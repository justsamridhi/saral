# SARAL — Supabase Setup, Database Migration & Security Verification Guide

This guide provides complete instructions for configuring Supabase backend authentication, applying database schemas with Row Level Security (RLS), resolving email delivery and SMTP rate-limiting edge cases, and running verification tests for SARAL.

---

## 1. Prerequisites & API Configuration

1. Create a free account or sign in at [Supabase.com](https://supabase.com).
2. Create a new project (e.g. `saral-services`).
3. Note your **Project URL** and **Publishable (anon) API key** from:
   **Project Settings** $\to$ **API** $\to$ **Project URL** and **Project API keys (`anon` public)**.

> [!WARNING]
> **Never** expose your `service_role` or secret API key in browser code or client files. SARAL only requires the client-side `anon` public key.

4. Open `E:\saral\supabase-config.js` and paste your project credentials:
   ```javascript
   window.SARAL_SUPABASE_CONFIG = {
     url: 'https://YOUR_PROJECT_ID.supabase.co',
     anonKey: 'YOUR_SUPABASE_ANON_PUBLIC_KEY'
   };
   ```
   *(Note: `supabase-config.js` is excluded from Git via `.gitignore` to prevent credential exposure).*

---

## 2. Password Policy Configuration

SARAL frontend and Supabase Auth are configured to enforce a strong password policy:
- **Minimum length**: 12 characters
- **Lowercase letters**: Required (`[a-z]`)
- **Uppercase letters**: Required (`[A-Z]`)
- **Numbers**: Required (`[0-9]`)
- **Symbols**: Required (`[^a-zA-Z0-9]`)

### Supabase Dashboard Setup:
1. In your Supabase Dashboard, go to **Authentication** $\to$ **Security**.
2. Under **Password requirements**:
   - Minimum password length: Set to **12**.
   - Enable **Require lowercase characters**.
   - Enable **Require uppercase characters**.
   - Enable **Require numbers**.
   - Enable **Require symbols**.
3. Save changes.

---

## 3. Database Schema & Hardened RLS Migration

SARAL requires a persistent `public.profiles` table to store onboarding completion, user identity, spending caps, and preferences.

### Execution Instructions:
1. Go to your **Supabase Dashboard** $\to$ **SQL Editor**.
2. Click **New query**.
3. Open `E:\saral\schema.sql` in your editor, copy the entire SQL script, and paste it into the Supabase SQL Editor.
4. Click **Run**.

### Schema Summary:
* **Table `public.profiles`**:
  * `id` (`UUID` Primary Key, references `auth.users.id` with `ON DELETE CASCADE`)
  * `full_name` (`TEXT`)
  * `display_name` (`TEXT`)
  * `avatar_url` (`TEXT`)
  * `account_plan` (`TEXT` default `'both'`, checked `in ('personal', 'business', 'both')`)
  * `spending_limit` (`NUMERIC(10, 2)` default `500.00`, checked `>= 0 AND <= 10000`)
  * `daily_limit` (`NUMERIC(10, 2)` default `2000.00`, checked `>= 0 AND <= 50000`)
  * `notifications_enabled` (`BOOLEAN` default `true`)
  * `voice_assistant_enabled` (`BOOLEAN` default `true`)
  * `onboarding_completed` (`BOOLEAN` default `false`)
  * `onboarding_profile_done` (`BOOLEAN` default `false`)
  * `onboarding_prefs_done` (`BOOLEAN` default `false`)
  * `created_at` (`TIMESTAMPTZ` default UTC `now()`)
  * `updated_at` (`TIMESTAMPTZ` default UTC `now()`)
* **Hardened Trigger Function `handle_new_user()`**:
  * Configured with `SECURITY DEFINER` and **fixed safe search_path** (`SET search_path = public, pg_temp;`) to eliminate search path hijacking.
  * Public execution revoked (`REVOKE EXECUTE ... FROM public; GRANT EXECUTE ... TO postgres, service_role;`).
  * Wrapped in an exception handler (`EXCEPTION WHEN OTHERS THEN ...`) so a profile provisioning warning never blocks user creation in `auth.users`.
* **Row Level Security (RLS)**:
  * Strict `ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;`
  * **SELECT Policy**: `Users can view own profile` (`auth.uid() = id`)
  * **INSERT Policy**: `Users can insert own profile` (`auth.uid() = id`)
  * **UPDATE Policy**: `Users can update own profile` (`auth.uid() = id` with check `auth.uid() = id`), guaranteeing that a user cannot spoof or reassign their profile ID.

---

## 4. RLS Automated Isolation Testing

To mathematically prove tenant isolation, open `E:\saral\test-rls.sql` in your **Supabase SQL Editor** and execute it.

The script runs a safe transactional test suite (`ROLLBACK` at the end) testing:
1. **Anonymous Access**: Confirms anonymous queries return 0 rows.
2. **User A Own Read**: Confirms User A can select their own profile.
3. **User A Reading User B**: Confirms User A querying User B's ID returns 0 rows.
4. **User A Writing to User B**: Confirms User A cannot update User B's profile.
5. **ID Spoofing**: Confirms User A attempting to update `id = User B's id` fails with policy violation.

---

## 5. Email Authentication, OTP & SMTP Configuration

### Distinction Between Resend Cooldown and Code Expiry:
- **Resend Cooldown**: A client-side 60-second timer to avoid hammering the SMTP gateway.
- **Code Expiry**: A Supabase server-side setting (`mailer_otp_exp`, default 3600 seconds / 60 minutes) after which an OTP is rejected as expired.

### Resolving `AuthRetryableFetchError: Error sending confirmation email`:
- **Free Gateway Rate Limit**: Supabase shared SMTP limits free projects to **3 to 4 emails/hour**. Multiple test signups trigger `500: Error sending confirmation email`.
- **Custom SMTP Setup**:
  1. Go to **Project Settings** $\to$ **Authentication** $\to$ **SMTP Settings**.
  2. Toggle **Enable Custom SMTP** to **ON**.
  3. Enter credentials from Resend, SendGrid, Amazon SES, or Brevo.

### OTP Email Template:
1. Go to **Authentication** $\to$ **Email Templates** $\to$ **Confirm signup**.
2. Body should include the numeric token:
   ```html
   <h2>Confirm your registration</h2>
   <p>Your 6-digit verification code is:</p>
   <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">{{ .Token }}</p>
   <p>This code will expire in 60 minutes.</p>
   ```

---

## 6. Google OAuth Status & Configuration

> [!NOTE]
> Google OAuth is currently **absent** from the client application. Per design integrity principles, decorative or non-functional OAuth buttons are prohibited.

If you choose to enable Google OAuth in a future milestone:
1. **Google Cloud Console**: Create an OAuth 2.0 Client ID with Authorized Redirect URI:
   `https://<YOUR_PROJECT_ID>.supabase.co/auth/v1/callback`
2. **Supabase Dashboard**: Go to **Authentication** $\to$ **Providers** $\to$ **Google**, toggle to **ON**, and enter your Google Client ID & Secret.
3. **Frontend Wiring**: Implement `client.auth.signInWithOAuth({ provider: 'google' })`.
