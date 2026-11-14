import { Link } from 'react-router-dom';
import { PolicyPage, Section, Bullets, SupportEmail, SupportPhone } from '../../components/PolicyLayout';

const link = 'underline underline-offset-2 hover:text-textPrimary';

export default function ReturnsRefunds() {
  return (
    <PolicyPage
      title="Returns, Refunds & Exchanges"
      intro="We want you to be happy with your order. This page explains how cancellations, returns, exchanges, refunds and store credit work."
    >
      <Section title="1. Cancelling an Order">
        <Bullets items={[
          <>To request a cancellation, contact customer support at <SupportEmail /> or <SupportPhone /> with your order number.</>,
          'A cancellation can be accepted only before the order has been shipped. Once an order has been shipped or dispatched, a cancellation request may not be accepted; you can request a return after delivery instead.',
          'If a cancellation is accepted, any amount you paid online is refunded to your original payment method, and any store credit you used on the order is returned to your store credit balance.',
        ]} />
      </Section>

      <Section title="2. Returns">
        <Bullets items={[
          'All product categories are eligible for return, subject to the conditions below.',
          'A return request must be submitted within 7 days of delivery.',
          'Products must be unworn, unwashed and undamaged.',
          'Original tags and packaging must be retained and returned with the product.',
        ]} />
        <p>
          <strong>How to request a return:</strong> log in and open the “Exchanges” section of your account, which also handles
          returns. Choose the item, tell us the reason, and choose how you would like to be refunded. Our team will then
          contact you to arrange the pickup of the item.
        </p>
        <p>
          <strong>Inspection:</strong> submitting a request does not by itself approve a refund. Returned products are inspected
          when we receive them. If the product meets the conditions above, your refund or store credit is issued. If it does
          not, we will inform you of the reason by email and no refund or store credit is issued.
        </p>
      </Section>

      <Section title="3. Refunds">
        <Bullets items={[
          'Refunds are based on the amount you actually paid for the item. If you bought it at a sale or discounted price, that is the amount refunded.',
          'Approved refunds are initiated after the returned product has been received, inspected and approved.',
          'When you request a return you choose between a refund to your original payment method and store credit.',
          <><strong>Online payments:</strong> the refund is sent to the original payment method through our payment provider. The time it takes for the amount to appear depends on your payment provider or financial institution.</>,
          <><strong>Cash on Delivery orders:</strong> there is no online payment to reverse, so a refund is arranged by our team by bank transfer or UPI. Our support team may contact you and ask for the details required to send it. Please share such details only with our official support contacts listed on the <Link to="/contact" className={link}>Contact Us</Link> page. Alternatively, you can choose store credit.</>,
          'If you paid for part of an order with store credit, that part of a refund is returned as store credit.',
        ]} />
        <p>
          <strong>Payments that did not become an order:</strong> if an amount was deducted but your order was not confirmed, we
          initiate a full refund of that payment. If you need help, contact customer support with your payment reference.
        </p>
      </Section>

      <Section title="4. Store Credit">
        <Bullets items={[
          'Store credit does not expire.',
          'Store credit can be used for full or partial payment on eligible orders at checkout.',
          'Store credit cannot be withdrawn as cash and cannot be transferred to another customer.',
          'Store credit cannot be used to pay exchange charges.',
          'If an order on which you used store credit is cancelled, the credit used is returned to your balance.',
          'You can see your balance and its history under “Store Credit” in your account.',
        ]} />
      </Section>

      <Section title="5. Exchanges">
        <Bullets items={[
          'You may request an exchange for a different size or a different product within 7 days of delivery, subject to availability. The same conditions as returns apply: the product must be unworn, unwashed and undamaged, with its original tags and packaging.',
          'Each item can be exchanged once.',
          'If the replacement costs more than the item you are exchanging, you pay the difference before the exchange proceeds.',
          'If the replacement costs less than the item you are exchanging, the difference is not refunded and is not issued as store credit.',
          'Any amount payable for an exchange, including any exchange charge, is shown to you before you confirm the exchange request, and is paid online.',
          'Exchanges are requested from the “Exchanges” section of your account.',
        ]} />
      </Section>

      <Section title="6. Help">
        <p>
          If you need help with a cancellation, return, exchange or refund, contact customer support at <SupportEmail /> or{' '}
          <SupportPhone />. If you are not satisfied with the outcome, you can write to our Grievance Officer; the details and
          procedure are on the <Link to="/contact" className={link}>Contact Us</Link> page.
        </p>
      </Section>
    </PolicyPage>
  );
}
