# Requirements Document

## Introduction

پلن تکمیل پروژه HORNET شامل شش فاز برای رساندن پلتفرم فروش اشتراک VPN به حالت Production-Ready است.
HORNET یک SaaS برای فروش کانفیگ Xray است که از بات تلگرام (Telegraf)، REST API (Express)، سیستم صورت‌حساب (Wallet + Stripe)، node-agent روی هر VPS، و MongoDB + Redis + BullMQ استفاده می‌کند.
هدف: مدیریت کامل پلن‌ها، کاربران، سرورها، پرداخت‌ها و امنیت بدون نیاز به دسترسی مستقیم به دیتابیس.

## Glossary

- **System**: پلتفرم HORNET به‌عنوان یک کل
- **API**: سرویس REST بر پایه Express
- **Bot**: بات تلگرام بر پایه Telegraf
- **Admin**: کاربر با نقش superadmin، finance، support، ops یا analyst
- **Superadmin**: ادمین با بالاترین سطح دسترسی
- **User**: کاربر نهایی تلگرام با نقش user یا reseller
- **Plan**: تعریف یک محصول VPN شامل حجم، مدت، تعداد لینک و قیمت
- **Subscription**: اشتراک فعال یک User برای یک Plan
- **TunnelConfig**: لینک/کانفیگ Xray تولیدشده برای یک Subscription
- **Server**: VPS/نود فیزیکی که node-agent روی آن نصب است
- **NodeAgent**: سرویس سبک‌وزن روی هر Server که Xray را مدیریت می‌کند
- **Receipt**: رسید بارگذاری‌شده توسط User برای پرداخت کارت‌به‌کارت
- **Transaction**: رکورد مالی یک پرداخت یا برداشت از Wallet
- **Wallet**: موجودی داخلی ریالی یا ارزی هر User
- **PromoCode**: کد تخفیف با قوانین اعمال‌پذیر
- **AuditLog**: رکورد تغییرات ادمین در سیستم
- **MFA**: احراز هویت چندمرحله‌ای
- **RBAC**: کنترل دسترسی مبتنی بر نقش
- **BullMQ**: صف پردازش پس‌زمینه
- **Validator**: ماژول اعتبارسنجی ورودی‌های API
- **RateLimiter**: محدودکننده نرخ درخواست بر پایه Redis
- **SMSParser**: ماژول پارس پیامک بانک ملی
- **WebhookVerifier**: ماژول بررسی امضای وب‌هوک درگاه‌های پرداخت
- **CredentialRotator**: ماژول چرخش اعتبارنامه‌های node-agent
- **LoadBalancer**: ماژول توزیع بار بین Server ها


## Requirements

---

## Phase 1: Production Foundation

### Requirement 1: Automated Test Coverage

**User Story:** As a developer, I want automated tests for critical flows, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE System SHALL include integration tests covering auth, subscription lifecycle (create → renew → expire → cancel), Plan CRUD, payment processing, and Admin RBAC.
2. WHEN `npm test` is executed, THE System SHALL run all test suites and report pass/fail with coverage metrics.
3. WHEN a test suite for auth is executed, THE System SHALL verify that unauthenticated requests to protected routes return HTTP 401.
4. WHEN a test suite for admin RBAC is executed, THE System SHALL verify that a User without the required role receives HTTP 403.
5. WHEN a test suite for subscription lifecycle is executed, THE System SHALL verify that status transitions follow the allowed state machine (trial → active → expired/suspended/cancelled).
6. WHEN a test suite for Plan CRUD is executed, THE System SHALL verify that creating, reading, updating, and archiving a Plan produces consistent data.
7. FOR ALL valid Subscription state machines, the allowed transitions defined in SubscriptionEngine SHALL be the only reachable states from any given state (invariant property).


### Requirement 2: Structured Audit Logging

**User Story:** As a Superadmin, I want every admin mutation to be audit-logged, so that I can trace who changed what and when.

#### Acceptance Criteria

1. WHEN an Admin performs any create, update, or delete mutation on Plan, User, Server, PromoCode, or Setting, THE System SHALL write an AuditLog record containing adminId, action, targetType, targetId, oldValue, newValue, and IP address.
2. THE AuditLog SHALL be append-only; THE System SHALL reject any attempt to update or delete existing AuditLog documents.
3. WHEN an AuditLog record is created, THE System SHALL store a hash of (action + targetId + newValue + timestamp) to enable tamper detection.
4. THE System SHALL expose a paginated admin API endpoint that returns AuditLog entries filterable by adminId, targetType, action, and date range.
5. IF an Admin mutation fails before completing, THEN THE System SHALL not write a partial AuditLog entry.


### Requirement 3: Request Body Validation

**User Story:** As a developer, I want all API request bodies validated at the route layer, so that invalid data never reaches business logic.

#### Acceptance Criteria

1. THE Validator SHALL validate every incoming request body against a defined schema before passing it to the controller.
2. IF a request body fails validation, THEN THE API SHALL return HTTP 400 with a structured error response containing the field name and violation reason.
3. THE Validator SHALL reject requests with unknown extra fields not defined in the schema (strict mode).
4. WHEN a required field is missing from a request body, THE Validator SHALL include that field's name in the error response.
5. FOR ALL admin and user-facing API endpoints, request body validation SHALL be applied before authentication middleware runs on public endpoints and after authentication on protected endpoints.

---

## Phase 2: Complete Admin Panel

### Requirement 4: Plan Management

**User Story:** As an Admin, I want to fully manage VPN plans, so that I can control the product catalog without database access.

#### Acceptance Criteria

1. THE Admin SHALL be able to create a Plan with title, subtitle, description, type, baseVolumeGB, durationDays, maxSubLinks, sortOrder, visibility, allowedRegions, allowedProtocols, isTrial, autoRenewEnabled, and purchaseLimitPerUser.
2. THE Admin SHALL be able to edit any field of an existing Plan.
3. WHEN an Admin archives a Plan, THE System SHALL set isArchived to true and prevent new Subscriptions from being created against it while preserving existing active Subscriptions.
4. WHEN an Admin clones a Plan, THE System SHALL create a new Plan document with identical fields except for a new _id, title suffixed with " (کپی)", and isArchived set to false.
5. THE Admin SHALL be able to set pricing for a Plan in IRR, IRT, USD, EUR, AED, TRY, and USDT independently, each with an optional compareAtAmount and gateway assignment.
6. THE Admin SHALL be able to reorder Plans by setting sortOrder values; THE System SHALL return Plans sorted by sortOrder ascending in the public catalog.
7. WHEN a Plan is archived, THE Bot SHALL no longer display it in the purchase menu.


### Requirement 5: Content Management

**User Story:** As an Admin, I want to manage bot messages and support texts, so that I can update copy without a deployment.

#### Acceptance Criteria

1. THE Admin SHALL be able to create, read, update, and delete Setting documents that store bot message templates, support contact info, FAQ entries, purchase instructions, and maintenance banner text.
2. WHEN the Bot renders a user-facing message, THE Bot SHALL fetch the relevant Setting value from the database (or Redis cache) rather than using hardcoded strings.
3. THE System SHALL cache Setting values in Redis with a TTL of 60 seconds to reduce database reads.
4. IF a requested Setting key does not exist, THEN THE System SHALL return a defined default value rather than an empty string or error.

### Requirement 6: User Management

**User Story:** As an Admin, I want to manage users' wallets, subscriptions, bans, and fraud status, so that I can handle support cases and enforce policy.

#### Acceptance Criteria

1. THE Admin SHALL be able to view a paginated, filterable list of Users with columns: telegramId, role, walletBalance, rank, totalSpent, joinedAt, and fraud status.
2. THE Admin SHALL be able to adjust a User's walletBalance by a signed delta amount with a mandatory reason string, which THE System SHALL record as a Transaction with category 'admin_adjustment'.
3. WHEN an Admin bans a User, THE System SHALL set the User's role to 'banned' and suspend all of the User's active Subscriptions.
4. WHEN an Admin issues a refund for a Transaction, THE System SHALL credit the User's Wallet by the refund amount and create a Transaction record with category 'refund'.
5. THE Admin SHALL be able to set a User's fraud status flag and attach a note; THE System SHALL record this as an AuditLog entry.
6. THE Admin SHALL be able to view a User's full Subscription history, Transaction history, and support Ticket history.


### Requirement 7: Server Management

**User Story:** As an Admin, I want to manage VPS nodes from the panel, so that I can add, monitor, migrate, and rotate credentials without SSH access.

#### Acceptance Criteria

1. THE Admin SHALL be able to register a new Server with name, ipAddress, port, xrayApiPort, maxCapacity, region, and protocol support.
2. WHEN a Server is registered, THE System SHALL generate a nodeToken and return a bootstrap command that the admin can run on the VPS to install node-agent.
3. THE Admin SHALL be able to view a list of Servers with status, healthStatus, loadPercent, currentActiveUsers, lastHeartbeat, and region.
4. THE Admin SHALL be able to toggle a Server's salesEnabled flag to stop new Subscriptions being assigned without affecting existing ones.
5. WHEN an Admin initiates credential rotation for a Server, THE System SHALL generate a new nodeToken, push the new token to the NodeAgent via the existing queue, and update lastCredentialRotation.
6. WHEN an Admin initiates a user migration from a source Server to a destination Server, THE System SHALL re-assign all active TunnelConfigs from the source Server to the destination Server and notify affected Users via the Bot.
7. IF a Server reports consecutiveFailures ≥ 3, THEN THE System SHALL set its healthStatus to 'unhealthy' and alert Superadmin via the Bot.


---

## Phase 3: Sales & Billing

### Requirement 8: Card-to-Card / Manual Receipt Gateway

**User Story:** As a User, I want to pay via card-to-card transfer and upload a receipt, so that I can use local Iranian banking.

#### Acceptance Criteria

1. WHEN a User selects card-to-card payment, THE Bot SHALL display the destination card number, amount, and reference instructions fetched from Settings.
2. WHEN a User uploads a Receipt photo, THE System SHALL store the photoFileId, userId, planId, and amount and set status to 'pending'.
3. WHEN an Admin approves a Receipt, THE System SHALL credit the User's Wallet by the receipt amount, set Receipt status to 'approved', and trigger Subscription creation.
4. WHEN an Admin rejects a Receipt, THE System SHALL set Receipt status to 'rejected' and notify the User with the rejection reason via the Bot.
5. IF a Receipt is submitted with the same photoFileId as an existing approved or pending Receipt, THEN THE System SHALL reject it as a duplicate and set FraudLog entry.

### Requirement 9: Bank SMS Parser

**User Story:** As an Admin, I want the system to auto-match incoming Bank Melli SMS notifications to pending receipts, so that approvals are faster and require less manual work.

#### Acceptance Criteria

1. WHEN THE SMSParser receives a Bank Melli SMS body via the internal API endpoint, THE SMSParser SHALL extract amount, card last-four digits, and timestamp from the SMS text.
2. WHEN the extracted amount and card last-four digits match a pending Receipt submitted within 30 minutes, THE System SHALL automatically set the Receipt status to 'sms_matched', credit the User's Wallet, and trigger Subscription creation.
3. IF no matching pending Receipt is found for an incoming SMS, THEN THE System SHALL log the unmatched SMS and alert Superadmin.
4. THE SMSParser SHALL reject incoming requests that do not include a valid SMS_SECRET header.
5. FOR ALL valid Bank Melli SMS formats, parsing then re-serializing the extracted fields SHALL produce equivalent data (round-trip property).


### Requirement 10: Promo Code Rules

**User Story:** As an Admin, I want to configure promo codes with advanced rules, so that I can run targeted discount campaigns.

#### Acceptance Criteria

1. THE Admin SHALL be able to create a PromoCode with code, discountPercent, maxDiscountAmount, expiresAt, usageLimit, allowed planIds (optional), first-purchase-only flag, and renewal-only flag.
2. WHEN a User applies a PromoCode at checkout, THE System SHALL verify the code is active, not expired, not exhausted, and satisfies all rule constraints before applying the discount.
3. WHEN a PromoCode is applied, THE System SHALL atomically increment usedCount and apply the discount to the transaction amount.
4. IF a User attempts to apply a first-purchase-only PromoCode and has an existing Subscription, THEN THE System SHALL reject the code and return a descriptive error.
5. IF a PromoCode has a maxDiscountAmount, THEN THE System SHALL cap the discount at that value regardless of the calculated percentage discount.
6. WHEN a PromoCode reaches its usageLimit, THE System SHALL automatically set isActive to false.

### Requirement 11: Renewal and Low-Volume Alerts

**User Story:** As a User, I want to receive alerts before my subscription expires or my data runs low, so that I can renew in time.

#### Acceptance Criteria

1. WHEN a Subscription has 3 or fewer days remaining until expireDate, THE Bot SHALL send a renewal reminder to the User via Telegram.
2. WHEN a Subscription's usedVolumeBytes exceeds 80% of totalVolumeBytes and notified80Percent is false, THE Bot SHALL send a low-data warning to the User and THE System SHALL set notified80Percent to true.
3. THE System SHALL check expiring subscriptions every 6 hours via the scheduled job and send at most one reminder per notification threshold.
4. WHEN a Subscription expires, THE Bot SHALL send an expiry notification to the User with a direct renewal button.


---

## Phase 4: Infrastructure Automation

### Requirement 12: Credential Rotation

**User Story:** As a Superadmin, I want to rotate node credentials from the admin panel, so that compromised tokens can be revoked without server downtime.

#### Acceptance Criteria

1. WHEN an Admin initiates credential rotation for a Server, THE CredentialRotator SHALL generate a new nodeToken using cryptographically secure random bytes.
2. THE CredentialRotator SHALL push the new nodeToken to the NodeAgent via a BullMQ job in the 'node-commands' queue before invalidating the old token.
3. WHEN the NodeAgent acknowledges the new token, THE System SHALL invalidate the old nodeToken and update Server.lastCredentialRotation.
4. IF the NodeAgent does not acknowledge the new token within 60 seconds, THEN THE System SHALL retain the old token and set the rotation job status to 'failed' with an alert to Superadmin.
5. THE System SHALL record credential rotation events in AuditLog with targetType 'Server' and action 'credential_rotation'.

### Requirement 13: Region-Aware Load Balancing

**User Story:** As the System, I want to assign new subscriptions to the least-loaded server in the appropriate region, so that no single server becomes overloaded.

#### Acceptance Criteria

1. WHEN a new TunnelConfig is created, THE LoadBalancer SHALL select the Server with the lowest loadPercent among active, salesEnabled Servers that match the Plan's allowedRegions and allowedProtocols.
2. WHILE a Server's loadPercent is ≥ 90%, THE LoadBalancer SHALL exclude it from assignment for new TunnelConfigs.
3. IF no eligible Server is available for a given region, THEN THE System SHALL return an error to the User and notify Superadmin.
4. THE LoadBalancer SHALL respect Server.salesEnabled; WHEN salesEnabled is false, THE LoadBalancer SHALL not assign new TunnelConfigs to that Server.


### Requirement 14: Safe User Migration

**User Story:** As an Admin, I want to migrate users from an unhealthy server to a healthy one, so that service continuity is maintained.

#### Acceptance Criteria

1. WHEN an Admin initiates migration from a source Server, THE System SHALL identify all active TunnelConfigs on the source Server.
2. THE System SHALL use THE LoadBalancer to select an eligible destination Server for each TunnelConfig based on region and protocol.
3. WHEN migrating a TunnelConfig, THE System SHALL provision the new config on the destination Server before deactivating the old config on the source Server.
4. IF provisioning on the destination Server fails for a TunnelConfig, THEN THE System SHALL retain the original TunnelConfig on the source Server and log the failure.
5. WHEN migration completes, THE Bot SHALL notify each affected User with the new config details.
6. THE System SHALL record the migration event in AuditLog with adminId, sourceServerId, destinationServerId, and count of migrated TunnelConfigs.

---

## Phase 5: Speed & Reliability

### Requirement 15: Redis-Backed Rate Limiting

**User Story:** As an operator, I want Redis-backed rate limiting on all API routes, so that abuse and DDoS are mitigated.

#### Acceptance Criteria

1. THE RateLimiter SHALL limit each IP address to 200 requests per 60-second window on all `/api` routes.
2. IF a request exceeds the rate limit, THEN THE API SHALL return HTTP 429 with a Retry-After header indicating when the window resets.
3. THE RateLimiter SHALL use Redis as the shared counter store so limits are enforced consistently across multiple API instances.
4. WHERE stricter limits are configured for specific endpoints (e.g., `/api/auth`), THE RateLimiter SHALL apply the stricter limit over the global limit.
5. IF Redis is unavailable, THEN THE RateLimiter SHALL fall back to an in-memory counter and log a warning.


### Requirement 16: Pagination and Filtering for Admin Tables

**User Story:** As an Admin, I want paginated and filterable lists of Users, Subscriptions, Transactions, and Receipts, so that large datasets are manageable.

#### Acceptance Criteria

1. THE Admin SHALL be able to query Users, Subscriptions, Transactions, AuditLogs, and Receipts via API with page, pageSize (max 100), sort field, sort direction, and at least two filter fields per entity.
2. WHEN a paginated query is executed, THE API SHALL return a response containing items, total count, current page, and total pages.
3. THE System SHALL use MongoDB cursor-based or skip/limit queries with compound indexes to serve paginated admin queries within 500ms for datasets up to 1,000,000 documents.
4. IF pageSize exceeds 100, THEN THE API SHALL return HTTP 400 with a descriptive validation error.

### Requirement 17: Plan Catalog Caching

**User Story:** As a developer, I want the plan catalog and settings to be cached in Redis, so that high-frequency reads don't hit the database on every request.

#### Acceptance Criteria

1. THE System SHALL cache the active, public Plan catalog in Redis with a TTL of 300 seconds.
2. WHEN an Admin creates, updates, archives, or reorders a Plan, THE System SHALL invalidate the Plan catalog cache immediately.
3. THE System SHALL cache Setting values in Redis with a TTL of 60 seconds.
4. WHEN a Setting is updated, THE System SHALL invalidate only the affected Setting key in Redis.
5. IF the Redis cache is unavailable, THEN THE System SHALL fall back to a direct MongoDB query and log a warning.


---

## Phase 6: Security Hardening

### Requirement 18: MFA for Privileged Roles

**User Story:** As a Superadmin, I want MFA enforced for privileged admin roles, so that compromised credentials alone cannot grant admin access.

#### Acceptance Criteria

1. THE System SHALL enforce MFA for Admin accounts with roles superadmin and finance before granting access to protected admin API endpoints.
2. WHEN an Admin with a privileged role attempts to authenticate without a valid MFA token, THE API SHALL return HTTP 403 with a descriptive error.
3. THE System SHALL support TOTP-based MFA (RFC 6238) as the primary MFA method.
4. WHEN an Admin successfully completes MFA, THE System SHALL issue a short-lived session token with a maximum TTL of 8 hours.
5. IF an Admin's MFA token is entered incorrectly 5 consecutive times, THEN THE System SHALL lock the Admin account and alert Superadmin.

### Requirement 19: Webhook Signature Verification

**User Story:** As a developer, I want all payment provider webhooks to be signature-verified, so that forged webhook events cannot trigger fraudulent subscription activations.

#### Acceptance Criteria

1. THE WebhookVerifier SHALL verify the HMAC-SHA256 signature of every incoming Stripe webhook using the configured stripe.webhookSecret.
2. THE WebhookVerifier SHALL verify the signature of every incoming card-to-card / manual gateway webhook using the configured gateway-specific secret.
3. IF a webhook request fails signature verification, THEN THE API SHALL return HTTP 400 and log the failure with source IP.
4. THE WebhookVerifier SHALL reject webhook requests with a timestamp more than 5 minutes old to prevent replay attacks.
5. WHEN a webhook is successfully verified, THE System SHALL process the event exactly once using idempotency keys based on the event ID.


### Requirement 20: Immutable Audit Logs

**User Story:** As a Superadmin, I want audit logs to be tamper-proof, so that audit evidence is reliable for compliance and dispute resolution.

#### Acceptance Criteria

1. THE System SHALL reject any HTTP request that attempts to update or delete an AuditLog document and return HTTP 405.
2. WHEN an AuditLog entry is written, THE System SHALL compute and store an integrity hash using SHA-256 over (adminId + action + targetId + newValue + createdAt).
3. THE System SHALL provide an admin API endpoint that verifies the integrity hash of all AuditLog entries in a date range and returns a report of any entries with hash mismatches.
4. THE System SHALL apply a MongoDB collection-level write concern of majority to AuditLog inserts to prevent data loss on primary failover.
5. WHERE an immutable storage backend (e.g., MongoDB with oplog) is configured, THE System SHALL route AuditLog writes to that backend.

