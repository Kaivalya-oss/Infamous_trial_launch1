export default function ShippingPolicy() {
  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12 text-textPrimary">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif italic text-4xl md:text-5xl mb-8">Shipping & Delivery</h1>
        
        <div className="space-y-8 font-light leading-relaxed">
          <section>
            <h2 className="text-xl font-medium mb-4">1. Shipping Locations</h2>
            <p className="text-textSecondary mb-4">
              INFAMOUS currently ships across India. We partner with reliable logistics providers to ensure your orders reach you safely and efficiently.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">2. Order Processing & Timelines</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li><strong>Processing Time:</strong> All orders are typically processed within 1-2 business days.</li>
              <li><strong>Mumbai Deliveries:</strong> Orders shipped within Mumbai are typically delivered within 2-3 business days after processing.</li>
              <li><strong>Outside Mumbai:</strong> Orders shipped outside Mumbai are generally delivered within 5-7 business days, depending on the destination.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">3. Shipping Charges</h2>
            <p className="text-textSecondary">
              Shipping charges are calculated dynamically based on your delivery address and order weight/volume. The exact shipping fee applicable to your order will be displayed during the checkout process before you make the payment.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">4. Order Tracking</h2>
            <p className="text-textSecondary">
              Once your order is shipped, you can track its status by logging into your INFAMOUS account and visiting the "Orders & Tracking" section under your Profile. Tracking details will be updated as soon as they are provided by our logistics partners.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">5. Delivery Issues</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li><strong>Delays:</strong> While we strive to meet estimated delivery timelines, unforeseen circumstances (such as weather conditions or logistical issues) may cause delays.</li>
              <li><strong>Incorrect Address:</strong> Please ensure your shipping address is entered correctly at checkout. We are not responsible for orders delivered to incorrect addresses provided by the customer.</li>
              <li><strong>Failed Attempts:</strong> Our logistics partners will typically make multiple attempts to deliver your package. If delivery fails, the package may be returned to us, and additional shipping charges may apply for re-dispatch.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
