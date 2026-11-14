// Business and contact details shown to customers. Single source of truth for the footer, the Contact page and
// every policy page, so they can never disagree.
// No GSTIN is displayed: none has been supplied, and one must not be shown unless a real registration exists.
export const BUSINESS = {
  name: 'INFAMOUS',
  addressLines: ['145, Jaipur House,', 'Agra, Uttar Pradesh – 282010, India'],
  addressOneLine: '145, Jaipur House, Agra, Uttar Pradesh – 282010, India',
  supportEmail: 'contact.infamous24@gmail.com',
  supportPhone: '+91 9675666878',
  supportPhoneHref: 'tel:+919675666878',
  grievanceOfficer: {
    name: 'Prakhar Jain',
    designation: 'Grievance Officer',
    email: 'prakhar6283@gmail.com',
    phone: '+91 9675666878',
    phoneHref: 'tel:+919675666878',
  },
  jurisdiction: 'Agra, Uttar Pradesh',
  // Shown as the "last updated" date on every policy page. Update when the wording changes.
  policiesUpdated: '14 November 2026',
} as const;
