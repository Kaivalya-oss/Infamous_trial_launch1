import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BUSINESS } from '../lib/business';

// Shared frame for the customer-facing policy pages: same typography and spacing everywhere.
export function PolicyPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12 text-textPrimary">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif italic text-4xl md:text-5xl mb-3">{title}</h1>
        <p className="text-xs uppercase tracking-[1px] text-textSecondary mb-8">Last updated: {BUSINESS.policiesUpdated}</p>
        {intro && <p className="text-textSecondary text-lg font-light leading-relaxed mb-10">{intro}</p>}
        <div className="space-y-10 font-light leading-relaxed">{children}</div>
        <ContactBlock />
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-medium mb-4">{title}</h2>
      <div className="space-y-3 text-textSecondary">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-2 text-textSecondary">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

export const SupportEmail = () => (
  <a href={`mailto:${BUSINESS.supportEmail}`} className="underline underline-offset-2 hover:text-textPrimary transition-colors break-all">{BUSINESS.supportEmail}</a>
);
export const SupportPhone = () => (
  <a href={BUSINESS.supportPhoneHref} className="underline underline-offset-2 hover:text-textPrimary transition-colors whitespace-nowrap">{BUSINESS.supportPhone}</a>
);

// Closing block on every policy page: who to contact, and where the grievance procedure is.
function ContactBlock() {
  return (
    <div className="mt-14 pt-8 border-t border-black/10 text-sm text-textSecondary font-light leading-relaxed">
      <p className="text-textPrimary font-medium mb-2">{BUSINESS.name}</p>
      <p>{BUSINESS.addressOneLine}</p>
      <p className="mt-2">Customer support: <SupportEmail /> · <SupportPhone /></p>
      <p className="mt-2">
        Grievance Officer: {BUSINESS.grievanceOfficer.name}. See the <Link to="/contact" className="underline underline-offset-2 hover:text-textPrimary">Contact Us</Link> page for the grievance procedure.
      </p>
    </div>
  );
}
