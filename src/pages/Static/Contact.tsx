import { BUSINESS } from '../../lib/business';

const linkClass = 'underline underline-offset-2 hover:text-textPrimary transition-colors';
const labelClass = 'text-textPrimary font-medium text-sm uppercase tracking-wider mb-1';

export default function Contact() {
  const go = BUSINESS.grievanceOfficer;
  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12 text-textPrimary">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif italic text-4xl md:text-5xl mb-3">Contact Us</h1>
        <p className="text-xs uppercase tracking-[1px] text-textSecondary mb-8">Last updated: {BUSINESS.policiesUpdated}</p>

        <div className="space-y-12 font-light leading-relaxed">
          <p className="text-textSecondary text-lg">
            Questions about an order, sizing, a return or anything else? Write to us or call, and our team will help.
            Please include your order number and a clear description of your concern so we can assist you quickly.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <section>
              <h2 className="text-xl font-medium mb-4">{BUSINESS.name}</h2>
              <div className="space-y-5 text-textSecondary">
                <div>
                  <h3 className={labelClass}>Address</h3>
                  <address className="not-italic">
                    {BUSINESS.addressLines.map(line => <span key={line} className="block">{line}</span>)}
                  </address>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-medium mb-4">Customer Support</h2>
              <div className="space-y-5 text-textSecondary">
                <div>
                  <h3 className={labelClass}>Email</h3>
                  <a href={`mailto:${BUSINESS.supportEmail}`} className={`${linkClass} break-all`}>{BUSINESS.supportEmail}</a>
                </div>
                <div>
                  <h3 className={labelClass}>Phone</h3>
                  <a href={BUSINESS.supportPhoneHref} className={linkClass}>{BUSINESS.supportPhone}</a>
                </div>
              </div>
            </section>
          </div>

          <section>
            <h2 className="text-xl font-medium mb-4">Grievance Officer</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-5 text-textSecondary">
              <div>
                <h3 className={labelClass}>Name</h3>
                <p>{go.name}</p>
              </div>
              <div>
                <h3 className={labelClass}>Designation</h3>
                <p>{go.designation}</p>
              </div>
              <div>
                <h3 className={labelClass}>Email</h3>
                <a href={`mailto:${go.email}`} className={`${linkClass} break-all`}>{go.email}</a>
              </div>
              <div>
                <h3 className={labelClass}>Phone</h3>
                <a href={go.phoneHref} className={linkClass}>{go.phone}</a>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">Grievance Redressal</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>If you have a complaint, write to the Grievance Officer at the email address above, or call the number above.</li>
              <li>Please provide your order number (if your complaint relates to an order) and a clear description of your concern.</li>
              <li>We acknowledge complaints within 48 hours of receiving them.</li>
              <li>We address complaints within one month of receiving them, in accordance with applicable requirements.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">Cancellations, Returns and Exchanges</h2>
            <p className="text-textSecondary">
              To request the cancellation of an order, contact customer support using the details above. Returns and exchanges
              can be requested from the “Exchanges” section of your account. See our Returns &amp; Refunds page for the conditions.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
