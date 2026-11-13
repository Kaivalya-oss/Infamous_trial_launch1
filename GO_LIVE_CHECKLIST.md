# INFAMOUS – Go-live checklist (Day 3)

Do this only after `PREVIEW_CHECKLIST.md` is fully ticked. Owners: **[You]** = developer, **[Client]** = business owner / account holder, **[Claude]** = code change I can make on request.

## A. Code and repo gates (T-1 day)
- [ ] [You] PR `fix/launch-hardening` reviewed and merged to `main`; Vercel + Render deploy from `main`
- [ ] [You] Old admin account `admin@infamous.com` deleted or its password rotated; create the real admin with `server/create_admin.js` using env vars (never commit credentials)
- [ ] [You] GitHub repo set to **private** (old admin password is in git history)
- [ ] [You] Delete leftover dev scripts' access: `server/test_merge.js` signs an admin token and calls production. Delete the file or confirm it is not deployed, and rotate `JWT_ACCESS_SECRET` if it was ever run with the production secret
- [x] CORS tightened: with `NODE_ENV=production` only `FRONTEND_URL`, `APP_BASE_URL` and `CORS_ALLOWED_ORIGINS` may call the API; wildcard `*.vercel.app` and localhost are rejected
- [ ] [You] Render: `FRONTEND_URL` and `APP_BASE_URL` set to the real storefront origin (without them the real domain is blocked by CORS); `CORS_ALLOWED_ORIGINS` empty (or only origins you really need)

## B. Accounts under the owner mailbox (client request: "everything on one email")
Create/transfer so the **business owner** owns each, with 2-step verification on. Keep the developer as an added member, not the owner.
- [ ] [Client] Google account / Firebase project (Authentication, billing: Blaze + **budget alert**)
- [ ] [Client] Vercel team, Render account, Neon project, Cloudinary, GitHub org/repo
- [ ] [Client] Razorpay account (KYC below)
- [ ] [Client] Domain registrar and DNS (Cloudflare or registrar)
- [ ] [Client] SMTP provider account (Brevo / Resend / SES / Zoho / Hostinger mail)
- [ ] [Client] Shared mailbox created (e.g. `orders@`, `support@`) and used for `ADMIN_NOTIFICATION_EMAIL`, `SMTP_FROM_EMAIL`, Razorpay, Firebase and the contact page
- [ ] Password manager holds every login; recovery email/phone is the owner's

## C. Domain and DNS
- [ ] [Client] Domain bought; storefront on `www.<domain>` (apex redirects to www)
- [ ] [You] Vercel: add domain, HTTPS issued, `www` is primary
- [ ] [You] (Optional) API on `api.<domain>` pointing at Render. If you do this, add it to `connect-src` in `vercel.json` (currently only `*.onrender.com`) and to `VITE_API_URL`
- [ ] [You] Render `FRONTEND_URL` and `APP_BASE_URL` = `https://www.<domain>` (CORS and email links depend on these)
- [ ] [You] Firebase → Authorized domains: add `www.<domain>` (and remove preview/old domains you don't need)
- [ ] [You] Google Cloud OAuth client (used by Firebase Google sign-in): authorised JavaScript origins include the new domain
- [ ] [Client/You] Email DNS on the domain: **SPF, DKIM, DMARC** (start DMARC at `p=none`, move to `quarantine` after a week of clean reports)
- [ ] Test mail from the production sender lands in Gmail **and** Outlook inbox (Show original → SPF/DKIM PASS)

## D. Razorpay live switch
- [ ] [Client] KYC approved, live mode activated, settlement bank account verified
- [ ] [Client] Payment methods and automatic capture ON (refunds need captured payments)
- [ ] [You] Create **live** API keys; on Render set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (live)
- [ ] [You] On Vercel set `VITE_RAZORPAY_KEY_ID` (live key id) and **redeploy** (Vite reads it at build time)
- [ ] [You] Create the **live** webhook `https://<api-host>/api/webhooks/razorpay` for `payment.captured`, `order.paid`; copy its secret into Render `RAZORPAY_WEBHOOK_SECRET`
- [ ] [You] Render redeployed after changing keys; test keys are no longer present anywhere
- [ ] [You+Client] One real low-value order (₹1–10 item or temporary price): order created, confirmation email arrives, webhook shows 200 in Razorpay dashboard
- [ ] [You] Refund that order from the admin cancel flow; money returns and the customer email arrives. Then restore the real price

## E. Production environment (Render + Vercel)
Render (backend) must have: `NODE_ENV=production`, `DATABASE_URL`, `JWT_ACCESS_SECRET` (long random, not reused), `FIREBASE_PROJECT_ID`, `RAZORPAY_KEY_ID/SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`, `SMTP_HOST/PORT/USER/PASS`, `SMTP_FROM_EMAIL`, `EMAIL_FROM_NAME`, `APP_BASE_URL`, `FRONTEND_URL`, `ADMIN_NOTIFICATION_EMAIL`, `TRUST_PROXY_HOPS` (1 behind Render only; 2 if Cloudflare proxies the API).
- [ ] All of the above set; none contain test/placeholder values
- [ ] Do **not** set `DISABLE_PAYMENT_RECONCILER` (the 5-minute payment recovery must run)
- [ ] Render plan does not sleep (free instances spin down: first request after idle is slow and the payment poller pauses). Use a paid always-on instance for launch
- [ ] Neon: production branch has backups/point-in-time restore enabled; connection limit suits the Render instance
Vercel (frontend) must have: `VITE_API_URL`, `VITE_FIREBASE_*` (6 values), `VITE_RAZORPAY_KEY_ID`, `VITE_INSTAGRAM_URL`. Leave `VITE_ENABLE_PHONE_LOGIN` unset.
- [ ] All set for **Production** scope, and a fresh production deploy was made after the last change

## F. Firebase / SMS cleanup
- [ ] Delete Firebase **test phone numbers** (they accept a fixed code, e.g. 123456, as a login)
- [ ] Billing budget alert on the Google Cloud project; Fraud Defense remains in AUDIT or is disabled unless properly configured
- [ ] Phone OTP stays hidden (flag unset); only re-enable after SMS delivery in India is confirmed

## G. Content and business readiness
- [ ] [Client] Real products, images, descriptions, sizes and stock loaded; test products deleted
- [ ] [Client] Policies live and linked in the footer: Privacy, Terms, Shipping, Returns/Exchange, Contact (Indian e-commerce and Razorpay require these)
- [ ] [Client] Shipping charge policy decided (flat / free above a value / by pincode) and shown at checkout *(still open from earlier)*
- [ ] [Client] Business name, address, GSTIN (if applicable) in footer/invoices
- [ ] Contact page email and phone are real and monitored

## H. Final smoke test on the production domain (T-0)
Repeat the essentials from `PREVIEW_CHECKLIST.md` on `https://www.<domain>`:
- [ ] Home / collection / product load; no CSP errors in the console
- [ ] Register → verification email → verify; forgot password → reset
- [ ] Google sign-in
- [ ] Real payment (above) and COD order; admin sees both; status emails arrive
- [ ] Admin login; customer cannot reach admin
- [ ] Mobile Safari and Chrome Android pass the purchase path

## I. Launch and watch (first 48 hours)
- [ ] Announce only after section H passes
- [ ] Watch Render logs for `[PAYMENT]`, `[EMAIL] Failed`, `MANUAL REFUND REQUIRED`; the admin panel notifications and the owner mailbox also receive payment-issue alerts
- [ ] Razorpay dashboard: webhook delivery 200s, no stuck captured-but-unfulfilled payments
- [ ] Check `GET /api/admin/payments/issues` (admin) shows nothing pending after day 1
- [ ] Email provider dashboard: bounce and spam-complaint rates near zero
- [ ] Uptime monitor (UptimeRobot or similar) on the storefront and the API root

## J. Rollback plan
- [ ] Vercel: promote the previous deployment (Instant Rollback). Render: redeploy the previous commit. Know both before launch
- [ ] Neon: note the restore point/time before launch (changes are additive migrations, so code rollback does not need a DB rollback)
- [ ] If payments misbehave: in Razorpay disable the live payment methods temporarily, and set the storefront to COD-only or take the site down behind a maintenance page while investigating
- [ ] Keep the test-mode Razorpay keys saved separately in the password manager so you can switch back for debugging
