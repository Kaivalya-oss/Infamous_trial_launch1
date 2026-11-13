# INFAMOUS – Vercel preview checklist

Run on the **Vercel preview URL** of the `fix/launch-hardening` PR, with the Render backend, Razorpay in **TEST mode**.
Tick each box. Stop and report anything that fails (note the page, what you did, and the browser console / network error).

## 0. Setup (once)
- [ ] Render env vars set: `NODE_ENV=production`, `JWT_ACCESS_SECRET`, `FIREBASE_PROJECT_ID`, `RAZORPAY_KEY_ID/SECRET` (test keys), `RAZORPAY_WEBHOOK_SECRET`, `DATABASE_URL`
- [ ] Email vars on Render: `SMTP_HOST/PORT/USER/PASS`, `SMTP_FROM_EMAIL`, `EMAIL_FROM_NAME`, `APP_BASE_URL` (= the preview/production storefront URL), `ADMIN_NOTIFICATION_EMAIL`
- [ ] Render `CORS_ALLOWED_ORIGINS` includes the **exact preview URL** (e.g. `https://infamous-trial-launch1-xxxx.vercel.app`). In production the API no longer accepts arbitrary `*.vercel.app` origins, so without this the preview shows CORS errors and every request fails
- [ ] Render redeployed after setting variables; `https://<render>/` responds
- [ ] Firebase → Authentication → Settings → Authorized domains includes the preview domain
- [ ] Razorpay (test) webhook → `https://<render>/api/webhooks/razorpay`, events `payment.captured`, `order.paid`; secret equals `RAZORPAY_WEBHOOK_SECRET`; auto-capture ON
- [ ] Use a **test customer account** and a **test admin**; never the old `admin@infamous.com`

## 1. Page loads and security headers
- [ ] Home, Collections, a product page, Contact load with no red errors in the console
- [ ] **No "Refused to load / violates Content Security Policy" errors** anywhere (images, fonts, Razorpay, Firebase, Google sign-in). If any appear, note the blocked URL
- [ ] Footer Instagram link opens https://www.instagram.com/infamousonline.in
- [ ] Mobile width: menu opens, logo goes home

## 2. Email sign-up, verification
- [ ] Register with a real inbox you can read
- [ ] Verification email arrives (check spam), sender name is INFAMOUS, link points at the storefront
- [ ] Clicking the link shows "Email verified"; clicking it a second time shows "Link not valid"
- [ ] Profile → Personal Info: no "not verified" banner after verifying
- [ ] Change the email on the profile → banner appears, new verification email arrives at the **new** address, "Resend verification email" works
- [ ] Weak password at sign-up ("abc12") is rejected with a clear message

## 3. Login, logout, lockout
- [ ] Email + password login works; refresh keeps you signed in
- [ ] 11 wrong passwords for one account → "Too many attempts" (429); wait is ~15 min
- [ ] From a **different network (phone data)** the same site and other accounts still log in. If *everyone* is blocked, raise `TRUST_PROXY_HOPS` on Render
- [ ] Phone OTP tab is **not shown**

## 4. Google sign-in
- [ ] "Continue with Google" completes, no `auth/unauthorized-domain` and no COOP/popup errors
- [ ] Signing in with a Google account whose email already exists with a verified password account links to that account (no duplicate)

## 5. Password reset
- [ ] Forgot password with the real inbox → email within ~1 minute; link opens "Choose a new password"
- [ ] Unknown email shows the same "Check your email" screen and sends nothing
- [ ] Weak password rejected; valid one succeeds; old password fails, new works
- [ ] Confirmation "password was changed" email arrives
- [ ] Using the same link again fails ("invalid or expired")
- [ ] Other signed-in devices were signed out
- [ ] 4th request for the same email within an hour shows the "Too many reset requests" message

## 6. Cart, checkout, Razorpay (TEST mode only)
- [ ] Add to cart, out-of-stock sizes cannot be added
- [ ] Checkout with a test card (Razorpay test card, any future expiry/CVV) → success page, order appears in Orders
- [ ] Order confirmation email arrives; admin owner mailbox gets the new-order email
- [ ] Close the tab right after paying (before redirect) → within ~5 min the order still appears (webhook / reconciler)
- [ ] Failed / cancelled payment leaves no order and no charge
- [ ] COD order places successfully

## 7. Admin panel
- [ ] Admin login works; a normal customer cannot open `/admin` or admin API calls
- [ ] Mark the test order SHIPPED with a tracking number → customer gets "Your order has shipped"
- [ ] OUT_FOR_DELIVERY, DELIVERED emails arrive; the order cannot be moved backwards
- [ ] CANCEL a paid test order → stock restored, refund shows in Razorpay test dashboard, customer gets the cancellation email
- [ ] Suspend the test customer → their next request shows the suspended message; unsuspend afterwards
- [ ] Admin → payment issues list loads

## 8. Returns and exchanges
- [ ] On a DELIVERED order request a return; admin moves it to PICKUP_SCHEDULED → customer gets an email
- [ ] Request an exchange; approve → email; fee payment (test mode) confirms the exchange

## 9. Email deliverability (needs the client's domain)
- [ ] SPF, DKIM, DMARC records published; provider shows the domain as verified
- [ ] Send to a Gmail and an Outlook address: lands in **inbox**, not spam (check "Show original" → SPF/DKIM = PASS)

## 10. Before switching to live
- [ ] Old admin account rotated or deleted; GitHub repo private
- [ ] Firebase test phone numbers deleted; billing budget alert set
- [ ] Razorpay KYC complete; **live** keys and live webhook secret set on Render; `VITE_RAZORPAY_KEY_ID` set to the live key on Vercel
- [ ] One real low-value live payment, then refund it from the admin/ Razorpay dashboard
- [ ] Real catalogue, prices, shipping charge, and policy pages (privacy, terms, returns, shipping) in place
