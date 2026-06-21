# Product Completion Plan

This project is intended to become a production-grade configuration sales platform for Iran and international markets. The goal is not only selling VPN configs, but running a fast, secure, auditable SaaS-style operation with admin workflows, server automation, and multi-currency billing.

## North Star

- Sell plans in IRR and foreign currencies with separate pricing, gateways, discounts, taxes/fees, and invoices.
- Give admins a complete panel for plans, prices, copy/text, users, orders, servers, tickets, fraud, broadcasts, and settings.
- Prepare infrastructure for fast node provisioning, health checks, migrations, capacity control, and credential rotation.
- Keep the codebase clean enough that adding new gateways, protocols, countries, and admin roles does not create fragile patches.

## Phase 1: Production Foundation

- Fix and enforce linting, formatting, and tests in CI.
- Add tests for auth, payments, subscription lifecycle, node-agent signing, plan CRUD, and admin RBAC.
- Move inline route logic into controllers/services with request validation.
- Protect production-only operational endpoints such as `/metrics`.
- Remove default production credentials and require strong seed credentials.
- Add structured audit logging for every admin mutation.

## Phase 2: Complete Admin Panel

- Plan management: create, edit, archive, clone, reorder, regional pricing, USD/IRR pricing, volume, duration, max links, trial rules, renewal rules.
- Content management: bot texts, payment instructions, support messages, purchase copy, FAQ entries, maintenance banners.
- User management: wallet, subscriptions, sessions, traffic usage, bans, refunds, notes, tags, fraud status, support history.
- Server management: add server, bootstrap command, status, health, load, sales toggle, region, protocol, migration, credential rotation.
- Role management: superadmin, finance, support, ops, analyst, marketer, custom permissions.
- Finance: receipts, manual approval, Stripe/card-to-card/crypto-ready abstractions, invoices, revenue reports, refunds, chargebacks.

## Phase 3: Sales And Billing

- Separate product catalog from plan implementation so the same plan can have IRR and USD offers.
- Add gateway adapters for local card-to-card/manual receipt, Stripe, and future crypto/stablecoin payments.
- Add promo rules: percent, fixed amount, first purchase, renewals, country, plan, expiry, usage limits.
- Add automated renewal reminders, low-bandwidth warnings, expired subscription cleanup, and failed payment workflows.
- Add fraud rules for receipt reuse, suspicious referrals, abnormal traffic, shared account behavior, and velocity checks.

## Phase 4: Infrastructure Automation

- Make bootstrap route and agent signing part of automated tests.
- Add node credential rotation and revocation workflows in the admin panel.
- Add queue-backed remote commands for creating/removing users, syncing Xray users, restarting services, and updating configs.
- Add capacity-aware load balancing by region, latency, load, sales state, and protocol support.
- Add safe migration flow for users from unhealthy or overloaded servers.
- Add deployment docs for backend, MongoDB, Redis, reverse proxy, TLS, backups, and node-agent.

## Phase 5: Speed And Reliability

- Use Redis-backed rate limits, sessions/cache, and queue state in production.
- Add indexes for high-volume queries: subscriptions, receipts, transactions, sessions, metrics, audit logs.
- Add pagination and filters to all large admin tables.
- Add caching for plan catalog, settings, server summaries, and dashboard metrics.
- Add background jobs for metrics cleanup, subscription expiry, notifications, and retryable provisioning.

## Phase 6: Security Hardening

- Enforce strong CSP and remove inline admin scripts over time.
- Add MFA enforcement for privileged admin roles.
- Add IP allowlist or private network access for metrics and internal APIs.
- Add signed webhooks for every payment provider.
- Add immutable audit logs for sensitive mutations.
- Add secrets rotation playbooks for JWT, node tokens, gateway keys, and admin sessions.
- Add backup/restore drills and database encryption guidance.

## Definition Of Complete

- `npm run lint` passes.
- `npm test` passes with meaningful coverage for the critical flows.
- Admin can manage plans, prices, texts, users, tickets, servers, payments, and roles without direct database access.
- A new node can be bootstrapped from the panel and starts reporting health automatically.
- A customer can buy, pay, receive config, renew, and get support in both local and international flows.
- Every sensitive admin action is permission-checked and audit-logged.
- Production deployment has documented environment variables, services, reverse proxy, backups, and monitoring.
