import { Link } from 'react-router-dom';
import { PolicyPage, Section, Bullets, SupportEmail } from '../../components/PolicyLayout';
import { BUSINESS } from '../../lib/business';

const link = 'underline underline-offset-2 hover:text-textPrimary';

export default function PrivacyPolicy() {
  const go = BUSINESS.grievanceOfficer;
  return (
    <PolicyPage
      title="Privacy Policy"
      intro="This policy explains what personal information INFAMOUS collects when you use our website, why we collect it, who it is shared with and the choices you have."
    >
      <Section title="1. Who We Are">
        <p>
          This website is operated under the business name {BUSINESS.name}, {BUSINESS.addressOneLine}. For any privacy
          question or request, write to <SupportEmail />.
        </p>
      </Section>

      <Section title="2. Information We Collect">
        <p><strong>Information you give us</strong></p>
        <Bullets items={[
          'Name, email address and phone number.',
          'Delivery addresses.',
          'Your password, if you register with an email address and password. Passwords are stored in hashed form; we cannot read them.',
          'Reviews you post, return and exchange requests, and messages you send to customer support.',
        ]} />
        <p><strong>Information from Google sign-in</strong></p>
        <p>
          If you choose to sign in with Google, we receive your name, email address, profile picture and a Google account
          identifier, so that we can create and recognise your account.
        </p>
        <p><strong>Information created when you use the website</strong></p>
        <Bullets items={[
          'Account identifiers and sign-in records, such as the time of your last sign-in.',
          'Your cart, orders and transaction records, including payment references, the delivery estimate for each order and order status history.',
          'Your store credit balance and its transaction history.',
          'Technical information that your browser sends when it connects to us, such as your IP address and browser type. We use it to keep the website secure, for example to limit repeated failed sign-in attempts.',
        ]} />
      </Section>

      <Section title="3. How We Use Your Information">
        <Bullets items={[
          'Creating your account and signing you in.',
          'Processing your orders.',
          'Handling payments and refunds.',
          'Shipping and delivery.',
          'Returns and exchanges.',
          'Administering store credit.',
          'Customer support and grievance redressal.',
          'Fraud prevention and the security of the website.',
          'Complying with legal and regulatory obligations.',
        ]} />
        <p>
          We send you emails that relate to your account and orders, such as email verification, password reset, order
          confirmation and order status updates. We do not currently send marketing emails or marketing text messages.
        </p>
      </Section>

      <Section title="4. Payment Information">
        <p>
          Online payments are processed by our payment gateway partner. Your card, UPI and bank account credentials are entered
          with and handled by the payment gateway; INFAMOUS does not store them. We keep a record of the payment, such as its
          reference, amount and status, so that we can confirm your order and process refunds.
        </p>
        <p>
          If a refund for a Cash on Delivery order has to be sent by bank transfer or UPI, our support team may ask you for
          the details needed to send it. We use those details only for that refund.
        </p>
      </Section>

      <Section title="5. Who We Share Information With">
        <p>
          We do not sell your personal information. We share it only with service providers who help us run the website and
          fulfil your orders, and only to the extent needed for the purposes described above. These fall into the following categories:
        </p>
        <Bullets items={[
          <><strong>Payment processing providers,</strong> to take payments and issue refunds.</>,
          <><strong>Account authentication and security providers,</strong> for example when you sign in with Google.</>,
          <><strong>Website hosting and cloud infrastructure providers,</strong> who host the website and store its data on our behalf.</>,
          <><strong>Image and media delivery providers,</strong> who store and deliver images used on the website.</>,
          <><strong>Delivery and logistics personnel or partners,</strong> who need your name, address and phone number to deliver your order.</>,
          <><strong>Transactional communication providers,</strong> who deliver the account and order emails we send you.</>,
        ]} />
        <p>
          Some of these providers may process information on systems located outside India. We may also disclose information
          where the law requires it, or to protect our rights, our customers or the security of the website.
        </p>
      </Section>

      <Section title="6. Cookies and Browser Storage">
        <Bullets items={[
          'We use your browser’s local storage to keep you signed in (sign-in tokens) and to remember your cart. These are necessary for the website to work.',
          'We do not currently use advertising or analytics tracking tools on this website.',
          'Some features are provided by third-party services, such as sign-in, online payment and the fonts used on the website. When your browser loads these services, they may use their own cookies or similar technologies and receive technical information such as your IP address.',
          'You can clear cookies and local storage through your browser settings. Doing so signs you out and may empty a cart saved on your device.',
        ]} />
      </Section>

      <Section title="7. Retention">
        <p>
          We keep personal information only for as long as it is reasonably necessary for the purposes described in this
          policy, and for as long as we are required to keep it by applicable law, for example records of orders and
          transactions.
        </p>
      </Section>

      <Section title="8. Your Choices and Rights">
        <Bullets items={[
          'You can view and update your name, email address, phone number and address in your account.',
          <>You can ask us for access to the personal information we hold about you, or ask us to correct or delete it, by writing to <SupportEmail />. We may need to verify your identity before acting on a request.</>,
          'We may need to keep some information where the law requires it, or where it is needed to complete an order, refund or dispute, even after a deletion request.',
          'There is currently no self-service option in the account to delete your account or download your data; these requests are handled by our team by email.',
          <>If you have a concern about how your information is handled, you can contact our Grievance Officer. The details are in section 12 and on the <Link to="/contact" className={link}>Contact Us</Link> page.</>,
        ]} />
      </Section>

      <Section title="9. Age Eligibility">
        <p>
          INFAMOUS is intended for individuals who are 18 years of age or older. By using this website or placing an order,
          you confirm that you are at least 18 years old and legally capable of entering into a binding agreement under
          applicable law. INFAMOUS does not knowingly intend its services for individuals under the age of 18.
        </p>
        <p>
          We do not knowingly intend to collect personal information from individuals under 18. If we become aware that such
          information has been provided to us, we will take appropriate action, subject to applicable law.
        </p>
      </Section>

      <Section title="10. Security">
        <p>
          We use reasonable technical and organisational measures to protect personal information, including encrypted
          connections to the website, hashed passwords and restricted access to customer data. No method of transmission or
          storage is completely secure, so we cannot guarantee absolute security. Please keep your password confidential and
          tell us promptly if you suspect unauthorised use of your account.
        </p>
      </Section>

      <Section title="11. Changes to This Policy">
        <p>
          We may update this policy from time to time. The updated version will be published on this page with a new “last
          updated” date.
        </p>
      </Section>

      <Section title="12. Contact and Grievances">
        <p>
          Privacy questions and requests: <SupportEmail />.
        </p>
        <p>
          Grievance Officer: {go.name}, <a href={`mailto:${go.email}`} className={`${link} break-all`}>{go.email}</a>,{' '}
          <a href={go.phoneHref} className={`${link} whitespace-nowrap`}>{go.phone}</a>. Complaints are acknowledged within 48 hours and
          addressed within one month, in accordance with applicable requirements.
        </p>
      </Section>
    </PolicyPage>
  );
}
