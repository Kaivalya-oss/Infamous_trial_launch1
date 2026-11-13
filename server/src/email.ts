import nodemailer from 'nodemailer';

// Provider-agnostic SMTP sender. Works with any provider (Brevo, Resend, SES, Zoho, Hostinger mail, Gmail
// app password...) purely through environment variables, so changing provider never needs a code change.
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   connection
//   SMTP_FROM_EMAIL                              sender address (must be allowed by the provider)
//   EMAIL_FROM_NAME                              sender display name (default "INFAMOUS")
//   APP_BASE_URL                                 public storefront URL used in links
//   ADMIN_NOTIFICATION_EMAIL                     owner mailbox for order / payment alerts

let transporter: nodemailer.Transporter | null | undefined;
function getTransporter() {
  if (transporter === undefined) {
    transporter = process.env.SMTP_HOST
      ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_PORT === '465',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        })
      : null;
  }
  return transporter;
}

export const emailEnabled = () => !!process.env.SMTP_HOST;

// Escape everything that comes from users (names, product names, addresses) before placing it in HTML.
export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const appBaseUrl = () => (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

const fromAddress = () => `"${process.env.EMAIL_FROM_NAME || 'INFAMOUS'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`;

// Never throws: email problems must not break orders or sign-in. Returns whether the message was accepted.
export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) { console.log(`[EMAIL] SMTP not configured, skipped "${subject}"`); return false; }
  if (!to) return false;
  try {
    await t.sendMail({ from: fromAddress(), to, subject, html, text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    console.log(`[EMAIL] Sent "${subject}"`);
    return true;
  } catch (err: any) {
    console.error(`[EMAIL] Failed to send "${subject}":`, err?.message || err);
    return false;
  }
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#111;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;display:inline-block">${esc(label)}</a></p>` +
  `<p style="color:#888;font-size:12px">If the button does not work, copy this link into your browser:<br>${esc(href)}</p>`;

const layout = (body: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#222"><h1 style="font-style:italic;letter-spacing:1px">INFAMOUS</h1>${body}<hr style="border:none;border-top:1px solid #eee;margin:32px 0 12px"><p style="color:#888;font-size:12px">You received this email because of activity on your INFAMOUS account. If this was not you, you can ignore it.</p></div>`;

export const emailTemplates = {
  verifyEmail: (name: string, link: string) => ({
    subject: 'Verify your email — INFAMOUS',
    html: layout(`<p>Hi ${esc(name || 'there')},</p><p>Please confirm your email address to finish setting up your account. This link is valid for 24 hours.</p>${button(link, 'Verify email')}`),
  }),
  resetPassword: (name: string, link: string) => ({
    subject: 'Reset your password — INFAMOUS',
    html: layout(`<p>Hi ${esc(name || 'there')},</p><p>We received a request to reset your password. This link is valid for 30 minutes and can be used once.</p>${button(link, 'Reset password')}<p>If you did not ask for this, your password has not changed and you can ignore this email.</p>`),
  }),
  passwordChanged: (name: string) => ({
    subject: 'Your password was changed — INFAMOUS',
    html: layout(`<p>Hi ${esc(name || 'there')},</p><p>Your INFAMOUS password was just changed and all devices were signed out. If this was not you, reset your password again immediately and contact us.</p>`),
  }),
  orderConfirmation: (order: any, customer: any, items: any[]) => {
    const rows = items.map((i) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${esc(i.product_name)}</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(i.sku)}</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(i.quantity)}</td><td style="padding:8px;border-bottom:1px solid #eee">₹${esc(i.price)}</td></tr>`).join('');
    return {
      subject: `Order Confirmed — #${order.order_number}`,
      html: layout(`<p>Hi ${esc(customer.name || 'there')},</p><p>Your order <strong>#${esc(order.order_number)}</strong> has been confirmed.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Product</th><th style="padding:8px;text-align:left">SKU</th><th style="padding:8px;text-align:left">Qty</th><th style="padding:8px;text-align:left">Price</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Total: ₹${esc(order.total_amount)}</strong></p><p><strong>Payment: ${esc(order.payment_method || 'N/A')}</strong></p><p>Thank you for shopping with INFAMOUS.</p>`),
    };
  },
  adminOrder: (order: any, customer: any) => ({
    subject: `New Order #${order.order_number} — ₹${order.total_amount}`,
    html: layout(`<h2>New Order Received</h2><p><strong>Order:</strong> #${esc(order.order_number)}</p><p><strong>Customer:</strong> ${esc(customer.name)} (${esc(customer.email)})</p><p><strong>Total:</strong> ₹${esc(order.total_amount)}</p><p><strong>Payment:</strong> ${esc(order.payment_method || 'N/A')}</p>`),
  }),
  adminAlert: (title: string, message: string) => ({
    subject: `[INFAMOUS] ${title}`,
    html: layout(`<h2>${esc(title)}</h2><p>${esc(message)}</p><p>Open the admin panel to review.</p>`),
  }),
};

export async function sendTemplate(to: string, t: { subject: string; html: string }) {
  return sendEmail(to, t.subject, t.html);
}
