import { Link } from 'react-router-dom';
import { PolicyPage, Section, Bullets, SupportEmail, SupportPhone } from '../../components/PolicyLayout';

const link = 'underline underline-offset-2 hover:text-textPrimary';

export default function ShippingPolicy() {
  return (
    <PolicyPage
      title="Shipping & Delivery"
      intro="Shipping is free on every INFAMOUS order. This page explains where we deliver, how long delivery is expected to take, and what to do if something goes wrong."
    >
      <Section title="1. Free Shipping">
        <p>
          We do not charge for shipping. No shipping or delivery fee is added to your order, whichever payment method you choose.
          The amount shown at checkout is the amount you pay.
        </p>
      </Section>

      <Section title="2. Where We Deliver">
        <p>
          We deliver to addresses in India, subject to the serviceability of the delivery pincode. If we are unable to deliver
          to your address, we will contact you using the details on your order.
        </p>
      </Section>

      <Section title="3. Delivery Estimates">
        <Bullets items={[
          <><strong>Mumbai, orders placed before 5:00 PM IST:</strong> same-day delivery.</>,
          <><strong>Mumbai, orders placed after 5:00 PM IST:</strong> delivery within 24 hours.</>,
          <><strong>Outside Mumbai:</strong> estimated delivery in 4–6 days.</>,
        ]} />
        <p>
          The 5:00 PM cutoff is based on Indian Standard Time at the moment your order is placed. The estimate that applies to
          your order is shown at checkout, included in your order confirmation and saved with your order.
        </p>
        <p>
          These are estimates, not guarantees. Delivery is subject to serviceability, operational conditions and unforeseen
          delays, such as weather, transport disruptions or other events outside our control.
        </p>
      </Section>

      <Section title="4. Cash on Delivery">
        <p>
          Cash on Delivery is available at checkout. You pay the order amount shown at checkout when your order is delivered.
          If you used store credit on the order, only the remaining amount is payable on delivery.
        </p>
      </Section>

      <Section title="5. Order Status and Tracking">
        <p>
          You can follow your order under “Orders &amp; Tracking” in your account. We also email you when your order is shipped,
          out for delivery and delivered. Order status and any tracking number are updated by our team; where a tracking
          number is available, it is included in the shipping email.
        </p>
      </Section>

      <Section title="6. Delivery Issues">
        <Bullets items={[
          <><strong>Address:</strong> please check your delivery address and phone number carefully at checkout. An incorrect or incomplete address may delay or prevent delivery.</>,
          <><strong>Missed delivery:</strong> if a delivery could not be completed, contact customer support so we can help arrange the next steps.</>,
          <><strong>Damaged or incorrect item:</strong> contact customer support, or request a return or exchange from your account. See our <Link to="/returns-refunds" className={link}>Returns &amp; Refunds</Link> page.</>,
        ]} />
      </Section>

      <Section title="7. Help">
        <p>
          For any delivery question, write to <SupportEmail /> or call <SupportPhone />. Please include your order number.
        </p>
      </Section>
    </PolicyPage>
  );
}
