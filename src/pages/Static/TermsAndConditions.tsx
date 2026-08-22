export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12 text-textPrimary">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif italic text-4xl md:text-5xl mb-8">Terms & Conditions</h1>
        
        <div className="space-y-8 font-light leading-relaxed">
          <section>
            <h2 className="text-xl font-medium mb-4">1. Introduction</h2>
            <p className="text-textSecondary">
              Welcome to INFAMOUS. By accessing or using our website, you agree to be bound by these Terms and Conditions. Please read them carefully before using our services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">2. Eligibility</h2>
            <p className="text-textSecondary">
              You must be of legal age in your jurisdiction to use this website and place orders. By using this site, you represent that you meet this requirement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">3. Account Responsibilities</h2>
            <p className="text-textSecondary">
              When you create an account, you are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use of your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">4. Products, Pricing, and Availability</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>All product descriptions and images are provided for informational purposes. We strive for accuracy but do not warrant that descriptions are error-free.</li>
              <li>Prices are displayed in INR (₹) and are subject to change without notice.</li>
              <li>All orders are subject to product availability. We reserve the right to limit the quantities of any products or services that we offer.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">5. Orders and Payment</h2>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>Placing an order constitutes an offer to purchase. We reserve the right to accept or reject any order at our discretion.</li>
              <li>Payments are processed securely via our payment gateway partner, Razorpay. We accept applicable credit/debit cards, UPI, and net banking as enabled by Razorpay.</li>
              <li>In the event of a failed payment where funds are deducted but the order is not created, the payment gateway will automatically initiate a reversal based on standard banking timelines.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">6. Intellectual Property</h2>
            <p className="text-textSecondary">
              All content on this website, including but not limited to the INFAMOUS logo, text, graphics, and images, is the property of INFAMOUS and is protected by copyright and intellectual property laws. You may not use, reproduce, or distribute any content without our explicit permission.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">7. Limitation of Liability</h2>
            <p className="text-textSecondary">
              INFAMOUS shall not be liable for any indirect, incidental, or consequential damages arising from the use of our website or products. Our total liability shall not exceed the amount paid by you for the specific product giving rise to the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">8. Changes to Terms</h2>
            <p className="text-textSecondary">
              We reserve the right to update or modify these Terms and Conditions at any time without prior notice. Your continued use of the website following any changes constitutes acceptance of those changes.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
