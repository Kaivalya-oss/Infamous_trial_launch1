export default function Contact() {
  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12 text-textPrimary">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif italic text-4xl md:text-5xl mb-8">Contact Us</h1>
        
        <div className="space-y-8 font-light leading-relaxed">
          <section>
            <p className="text-textSecondary text-lg mb-8">
              We're here to help. Whether you have a question about an order, need assistance with sizing, or want to learn more about our collections, our team is ready to assist you.
            </p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <section>
              <h2 className="text-xl font-medium mb-4">Customer Support</h2>
              <div className="space-y-4 text-textSecondary">
                <div>
                  <h3 className="text-textPrimary font-medium text-sm uppercase tracking-wider mb-1">Email</h3>
                  <a href="mailto:support@infamous.com" className="hover:text-textPrimary transition-colors">
                    support@infamous.com
                  </a>
                </div>
                <div>
                  <h3 className="text-textPrimary font-medium text-sm uppercase tracking-wider mb-1">Business Hours</h3>
                  <p>Monday - Friday</p>
                  <p>10:00 AM - 6:00 PM (IST)</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-medium mb-4">Send us a Message</h2>
              <p className="text-textSecondary mb-6">
                Currently, direct messaging via the website is disabled while we upgrade our systems. Please reach out to us via the support email provided above for all inquiries.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
