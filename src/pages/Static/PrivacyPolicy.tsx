export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12 text-textPrimary">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif italic text-4xl md:text-5xl mb-8">Privacy Policy</h1>
        
        <div className="space-y-8 font-light leading-relaxed">
          <section>
            <h2 className="text-xl font-medium mb-4">1. Information We Collect</h2>
            <p className="mb-4">We collect information that you provide directly to us when using the INFAMOUS website, including:</p>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>Name and contact information (email address, phone number).</li>
              <li>Shipping and billing addresses.</li>
              <li>Account credentials.</li>
              <li>Order history and preferences.</li>
              <li>Device and browser information collected automatically for security and functionality.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">2. How We Use Your Information</h2>
            <p className="mb-4">The information collected is used for the following purposes:</p>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li>Processing and fulfilling your orders.</li>
              <li>Managing your INFAMOUS account.</li>
              <li>Communicating with you regarding deliveries and customer support.</li>
              <li>Preventing fraud and securing our platform.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">3. Payment Information</h2>
            <p className="text-textSecondary">
              INFAMOUS does not directly collect, process, or store your credit card, debit card, UPI, or banking information on our servers. All online payment transactions are processed securely through our authorized third-party payment gateway, Razorpay. Please refer to Razorpay's privacy policy for details on how your payment information is handled.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">4. Third-Party Services</h2>
            <p className="mb-4 text-textSecondary">We may share your information with trusted third-party service providers essential to our operations:</p>
            <ul className="list-disc pl-5 space-y-2 text-textSecondary">
              <li><strong>Razorpay:</strong> For secure payment processing.</li>
              <li><strong>Cloudinary:</strong> For media and asset delivery.</li>
              <li><strong>Google/Firebase:</strong> For authentication and secure access.</li>
              <li><strong>Logistics Partners:</strong> To deliver your orders.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">5. Cookies and Session Technologies</h2>
            <p className="text-textSecondary">
              We use standard session management technologies (such as JSON Web Tokens) and local storage to maintain your login state, preserve your shopping cart, and ensure a seamless browsing experience. We do not use aggressive tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">6. Data Security and Retention</h2>
            <p className="text-textSecondary">
              We implement industry-standard security measures to protect your personal data. Your information is retained only for as long as necessary to fulfill the purposes outlined in this policy or as required by applicable laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-4">7. Contact Us</h2>
            <p className="text-textSecondary">
              If you have any questions regarding this Privacy Policy, please contact us via our Contact page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
