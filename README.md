# SARAL — AI-Powered Digital Services Ecosystem with PayPal Trust Gate

> **"One intelligent interface. Multiple everyday services. Transparent, user-controlled transactions."**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Supabase: Auth & PostgreSQL RLS](https://img.shields.io/badge/Supabase-Auth%20%26%20RLS-3ECF8E?logo=supabase)](https://supabase.com)
[![PayPal: Orders v2 Pre-Auth](https://img.shields.io/badge/PayPal-Sandbox%20v2-00457C?logo=paypal)](https://developer.paypal.com)
[![Node.js: Express Gateway](https://img.shields.io/badge/Node.js-Express%20v4-339933?logo=node.js)](https://nodejs.org)

SARAL resolves the fundamental vulnerability of autonomous agentic commerce: **unauthorized financial liability and agent hallucination**. Instead of allowing AI to autonomously charge payment credentials, SARAL enforces a cryptographically audited **Trust Gate** protocol ("Hold $\to$ Verify $\to$ Pay") with explicit user approval before funds can be committed.

---

## 1. Product Architecture & Surfaces

### A. SARAL Personal Workspace
- **Ask SARAL AI Agent**: Understands conversational intent across everyday services (Cinema, Power Bank, Mobile Recharge, Utilities). Formulates structured proposals without autonomous charge permissions.
- **Trust Gate Verification**: Verifies 0% price drift, merchant integrity, and user spending guardrails before funds commitment.
- **Pre-Authorization Deposit Protocol**: Implements two-phase PayPal authorization (`INTENT=AUTHORIZE`) enabling refundable rental holds (e.g. power banks) and ticket reservations.
- **Activity Ledger**: Append-only audit record of all authorizations, captures, voids, and Trust Gate compliance scores.

### B. SARAL Business Reseller Workspace
- **Canonical Inventory**: Single source of truth for high-value merchandise (vintage cameras, audio equipment, refurbished laptops).
- **Buyer Memory CRM**: Structured buyer intelligence tracking collector preferences, past spending, and price tolerances.
- **Marketplace Intelligence**: Real-time cross-channel fee and net take-home price recommendations (eBay vs Mercari vs Direct PayPal Checkout).
- **PayPal Sandbox Checkout**: Direct invoice creation and payment reconciliation.

### C. Connected Mini-Apps
1. **Cinema**: Live 6x6 interactive seating matrix, IMAX ticket checkout, concession add-ons.
2. **Portable Power Bank**: Automated pre-auth deposit hold protocol ($18.00) with live duration counter and automatic reconciliation upon return.
3. **Mobile Recharge**: Telecom prepaid plans and high-speed 5G packs with instant carrier confirmation.
4. **Utility Payments**: Municipal electricity, water, and broadband bill consolidation.

---

## 2. Trust Gate & PayPal Authorization Lifecycle

```
[User Intent] ---> (Ask SARAL AI Agent)
                           |
                           v
               [Structured Transaction Proposal]
                           |
                           v
              < Trust Gate Verification >
              - 0% Price Drift & Slippage Check
              - Per-Transaction Guardrail ($500 Cap)
              - Cumulative Daily Spend Limit ($2,000 Cap)
              - Merchant Integrity & Service Validation
                           |
        +------------------+------------------+
        |                                     |
   [Declined]                            [Approved]
        |                                     |
   (Proposal Cancelled)            (User Explicit Confirmation)
                                              |
                                              v
                              < PayPal Orders v2 API >
                              intent = "AUTHORIZE"
                                              |
                                              v
                             [Active Authorization Hold]
                             Funds Reserved (Not Captured)
                                              |
                       +----------------------+----------------------+
                       |                                             |
            [Service Delivered / Returned]             [Cancelled / Unconsumed]
                       |                                             |
                       v                                             v
          < PayPal Capture API >                        < PayPal Void API >
          capture_id Generated                          Authorization Released
          Ledger: "Captured & Completed"                Ledger: "Voided & Released"
          Proposal: "completed"                         $0.00 Net Charged
```

---

## 3. Security & Database Specifications

### Supabase Database & PostgreSQL RLS
- **`schema.sql`**: Configures `public.profiles` storing display name, avatar, account plan, spending limits, and onboarding state.
- **Row Level Security (RLS)**: Enforces strict tenant isolation:
  - `SELECT`: `auth.uid() = id`
  - `INSERT`: `with check (auth.uid() = id)`
  - `UPDATE`: `using (auth.uid() = id) with check (auth.uid() = id)` (spoof-proof against primary key tampering).
- **Hardened Function `handle_new_user()`**: `SECURITY DEFINER` with fixed `SET search_path = public, pg_temp;` and execution revoked from `public`.
- **`schema-payments.sql`**:
  - `proposals`: Structured proposal details with `amount_minor` (USD cents) and expiration.
  - `payments`: Tracks PayPal `order_id`, `authorization_id`, `capture_id`, and status (`pending`, `authorized`, `captured`, `voided`).
  - `webhook_events`: Idempotent processing with unique `event_id` constraint.
  - `audit_events`: Tamper-resistant append-only ledger.
  - `committed_today_minor(user_uuid)`: Stored procedure calculating UTC cumulative daily spend.

---

## 4. Quick Start & Local Execution

### Prerequisites
- Node.js 18+ installed
- Modern Web Browser (Chrome, Firefox, Edge, Safari)

### 1. Clone & Configure Environment
```bash
cd E:\saral
cp .env.example .env
```
Fill in your credentials in `.env`:
```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=your-paypal-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-paypal-sandbox-client-secret
PAYPAL_WEBHOOK_ID=your-webhook-id
```

*(Note: For instant local testing without backend configuration, SARAL includes an offline Prototype Demo mode accessible directly from the welcome screen).*

### 2. Install Dependencies & Launch
```bash
npm install
npm start
```
The server will start at `http://localhost:3000`.

### 3. Run Test Suite
```bash
npm test
```
Executes mathematical minor unit verification, spending limit checks, and API health assertions.

---

## 5. Under 3-Minute Hackathon Demo Sequence

Follow these steps for an optimal judge demonstration:

1. **Access Welcome Screen (`0:00 - 0:30`)**:
   - Open `http://localhost:3000` (or `saral.html`).
   - Click **"Skip straight to Dashboard (Prototype Demo)"** for instant access, or create an account with 12+ char password verification and numeric OTP.
2. **Interact with AI Agent (`0:30 - 1:00`)**:
   - Click **"Ask SARAL"** in the top navigation.
   - Enter: `"Book 2 cinema tickets for Dune 2 tonight"`.
   - Observe how the AI refuses to charge funds autonomously and generates a structured proposal with merchant details ($38.00) within configured spending caps.
3. **Trigger Trust Gate (`1:00 - 1:45`)**:
   - Click **"Review in Trust Gate →"**.
   - Review the 4-point verification shield: 0% price drift, $500 guardrail, merchant validation, and explicit confirmation.
   - Click **"Approve & Authorize $38.00 (PayPal Protected)"**.
4. **Experience PayPal Pre-Auth Hold Lifecycle (`1:45 - 2:30`)**:
   - View the active **PayPal Authorization Hold** state with Authorization ID.
   - Click **"Finalize & Capture Payment"** to simulate ticket fulfillment and capture.
   - Download the verified receipt or view the updated entry in the **Activity Ledger**.
   - Optionally test **"Cancel & Void Pre-Auth Hold"** to prove that $0.00 is charged when an order or rental deposit is cancelled.
5. **Switch to SARAL Business (`2:30 - 3:00`)**:
   - Click **"Business"** in the workspace switcher.
   - Inspect **Canonical Inventory** and **Buyer Memory CRM** (Marcus Vance / Leica M3).
   - Show how the dual-workspace architecture connects personal everyday transactions with reseller commerce.

---

## License

SARAL is open-source software licensed under the [MIT License](LICENSE).

