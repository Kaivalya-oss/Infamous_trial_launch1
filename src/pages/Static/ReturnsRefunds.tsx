export default function ReturnsRefunds() {
  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12 text-textPrimary">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif italic text-4xl md:text-5xl mb-8">Returns & Refunds</h1>
        
        <div className="space-y-8 font-light leading-relaxed">
          <section>
            <h2 className="text-xl font-medium mb-4">1. Returns Eligibility</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>Returns must be initiated within the time window specified on the product page or upon delivery.</li>
              <li>Products must be returned in their original condition: unworn, unwashed, and undamaged.</li>
              <li>All original tags, labels, and packaging must be intact and included with the return.</li>
              <li>Certain items, such as intimate wear or clearance sale products, may be marked as non-returnable.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">2. Exchanges</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>You may request an exchange for a different size or a completely different product, subject to inventory availability.</li>
              <li>If the exchanged product has a different price, the difference will be calculated. You will either be refunded the excess amount or required to pay the balance before the new item is dispatched.</li>
              <li>Exchanges can be initiated via the "Exchanges" section in your Profile dashboard.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">3. Order Cancellations</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>Customers can cancel their orders directly from the "Orders & Tracking" dashboard before the order has been processed or shipped.</li>
              <li>Once an order has entered the shipping phase, it cannot be canceled. You will need to wait for delivery and then initiate a return.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">4. Refunds</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>Refunds are initiated only after the returned product is received and successfully passes our quality inspection.</li>
              <li>Approved refunds will be processed back to the original payment method used during checkout.</li>
              <li>The timeline for the refund to reflect in your account depends entirely on your bank or payment provider (typically 5-10 business days).</li>
              <li>In the event of duplicate or failed payments where the order is not confirmed, Razorpay automatically initiates a refund.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">5. Customer Support</h2>
            <p className="text-textSecondary">
              If you require assistance with a return, exchange, or refund that cannot be resolved through your account dashboard, please reach out to our support team via the Contact page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
