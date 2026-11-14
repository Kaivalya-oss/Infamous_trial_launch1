import { Link } from 'react-router-dom';
import { PolicyPage, Section, Bullets, SupportEmail, SupportPhone } from '../../components/PolicyLayout';
import { BUSINESS } from '../../lib/business';

const link = 'underline underline-offset-2 hover:text-textPrimary';

export default function TermsAndConditions() {
  const go = BUSINESS.grievanceOfficer;
  return (
    <PolicyPage
      title="Terms & Conditions"
      intro="These Terms & Conditions apply to your use of the INFAMOUS website and to orders placed through it. Please read them carefully."
    >
      <Section title="1. Introduction and Acceptance">
        <p>
          This website is operated under the business name {BUSINESS.name}, {BUSINESS.addressOneLine}. By accessing the
          website, creating an account or placing an order, you agree to these Terms &amp; Conditions and to our{' '}
          <Link to="/privacy-policy" className={link}>Privacy Policy</Link>,{' '}
          <Link to="/shipping-policy" className={link}>Shipping &amp; Delivery</Link> policy and{' '}
          <Link to="/returns-refunds" className={link}>Returns, Refunds &amp; Exchanges</Link> policy, which form part of these terms.
        </p>
      </Section>

      <Section title="2. Age Eligibility">
        <p>
          INFAMOUS is intended for individuals who are 18 years of age or older. By using this website or placing an order,
          you confirm that you are at least 18 years old and legally capable of entering into a binding agreement under
          applicable law. INFAMOUS does not knowingly intend its services for individuals under the age of 18.
        </p>
      </Section>

      <Section title="3. Account Registration and Security">
        <Bullets items={[
          'You need an account to place an order. You can register with an email address and password or sign in with Google.',
          'You are responsible for keeping your login details confidential and for activity that takes place under your account.',
          'Tell us promptly if you believe your account has been used without your permission.',
          'We may suspend an account that is used fraudulently, abusively or in breach of these terms.',
        ]} />
      </Section>

      <Section title="4. Accurate Customer Information">
        <p>
          You agree to provide accurate and complete information, including your name, email address, phone number and
          delivery address, and to keep it up to date. We rely on this information to process, deliver and communicate about
          your orders.
        </p>
      </Section>

      <Section title="5. Product Descriptions, Images and Availability">
        <Bullets items={[
          'We try to describe and show our products accurately. Colours and details may look slightly different on different screens.',
          'All orders are subject to availability. If an item you ordered is not available, we will inform you and refund any amount you paid for it.',
          'We may limit the quantity of a product that can be ordered.',
        ]} />
      </Section>

      <Section title="6. Pricing and Payment">
        <Bullets items={[
          'Prices are shown in Indian Rupees (₹). The amount payable for your order is shown at checkout before you pay.',
          'During a sale, the sale price and the original price are shown. The price that applies is the price at the time your order is placed.',
          'If a price or listing is shown incorrectly because of an error, we may cancel the affected order and refund any amount you paid for it.',
          'You can pay online, by Cash on Delivery, with store credit, or with a combination of store credit and another method, as offered at checkout.',
        ]} />
      </Section>

      <Section title="7. Cash on Delivery">
        <p>
          Where Cash on Delivery is offered at checkout, you agree to pay the amount shown for the order when it is delivered.
        </p>
      </Section>

      <Section title="8. Online Payments">
        <Bullets items={[
          'Online payments are processed by our payment gateway partner, Razorpay, using the payment methods it makes available at checkout.',
          'We do not store your card, UPI or bank account credentials.',
          'If an amount is deducted but your order is not confirmed, we initiate a refund of that payment. The time it takes to appear depends on your payment provider or financial institution.',
        ]} />
      </Section>

      <Section title="9. Store Credit">
        <Bullets items={[
          'Store credit may be issued when you choose it as the refund for a returned item, or may be added to your account by INFAMOUS.',
          'Store credit does not expire. It can be used for full or partial payment on eligible orders.',
          'Store credit cannot be withdrawn as cash, cannot be transferred to another customer and cannot be used to pay exchange charges.',
          'If an order on which store credit was used is cancelled, the credit used is returned to your balance.',
        ]} />
      </Section>

      <Section title="10. Shipping and Delivery">
        <p>
          Shipping is free. Delivery estimates are set out in our <Link to="/shipping-policy" className={link}>Shipping &amp; Delivery</Link> policy.
          They are estimates and are subject to serviceability, operational conditions and unforeseen delays.
        </p>
      </Section>

      <Section title="11. Returns, Refunds and Exchanges">
        <p>
          Returns and exchanges may be requested within 7 days of delivery, subject to the conditions in our{' '}
          <Link to="/returns-refunds" className={link}>Returns, Refunds &amp; Exchanges</Link> policy. Refunds and store credit
          are issued after the returned product has been received, inspected and approved.
        </p>
      </Section>

      <Section title="12. Cancellation Requests">
        <p>
          To request the cancellation of an order, contact customer support at <SupportEmail /> or <SupportPhone />. A
          cancellation can be accepted only before the order has been shipped, and may not be accepted once it has been
          shipped or dispatched.
        </p>
      </Section>

      <Section title="13. Intellectual Property">
        <p>
          The content of this website, including the INFAMOUS name and logo, text, graphics and images, belongs to INFAMOUS or
          is used with permission, and is protected by applicable intellectual property laws. You may not copy, reproduce or
          distribute it without our written permission.
        </p>
      </Section>

      <Section title="14. Prohibited Use">
        <p>You agree not to:</p>
        <Bullets items={[
          'use the website for any unlawful or fraudulent purpose;',
          'provide false information or impersonate another person;',
          'attempt to gain unauthorised access to the website, other accounts or our systems;',
          'interfere with the operation or security of the website; or',
          'post reviews or other content that is unlawful, abusive or misleading.',
        ]} />
      </Section>

      <Section title="15. Limitation of Liability">
        <p>
          To the extent permitted by applicable law, INFAMOUS is not liable for indirect or consequential losses arising from
          the use of the website, and our liability in connection with an order is limited to the amount you paid for that
          order. Nothing in these terms excludes or limits any right or remedy that you have under applicable
          consumer-protection law or any liability that cannot be excluded or limited by law.
        </p>
      </Section>

      <Section title="16. Changes to Products, Pricing and Terms">
        <p>
          We may change the products we offer and their prices at any time; such changes do not affect orders that have
          already been confirmed. We may update these terms from time to time. The updated version will be published on this
          page with a new “last updated” date and applies to orders placed after that date.
        </p>
      </Section>

      <Section title="17. Governing Law and Jurisdiction">
        <p>These Terms &amp; Conditions shall be governed by and interpreted in accordance with the laws of India.</p>
        <p>
          Subject to applicable consumer-protection laws and other mandatory legal provisions, the courts having competent
          jurisdiction in {BUSINESS.jurisdiction}, shall have jurisdiction over disputes arising out of or relating to the use of
          the INFAMOUS website and its services.
        </p>
      </Section>

      <Section title="18. Grievance Redressal">
        <p>
          If you have a complaint, you can contact our Grievance Officer, {go.name}, at{' '}
          <a href={`mailto:${go.email}`} className={`${link} break-all`}>{go.email}</a> or{' '}
          <a href={go.phoneHref} className={`${link} whitespace-nowrap`}>{go.phone}</a>. Please include your order number and a clear
          description of your concern. Complaints are acknowledged within 48 hours and addressed within one month, in
          accordance with applicable requirements. Full details are on the <Link to="/contact" className={link}>Contact Us</Link> page.
        </p>
      </Section>
    </PolicyPage>
  );
}
