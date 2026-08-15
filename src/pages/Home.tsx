import api from '../lib/axios';
import { useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { motion, useInView } from 'framer-motion';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Search, User, ShoppingBag, Play, ArrowRight } from 'lucide-react';
import QuickViewModal from '../components/QuickViewModal';
import { useCart } from '../context/CartContext';
import axios from 'axios';

gsap.registerPlugin(ScrollTrigger);

/* ───────────────────────────── FADE-IN WRAPPER ────────────────────────────── */
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 50, filter: 'blur(12px)' }}
      animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
      transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ────────────────────────────── CAMPAIGN VIDEO ────────────────────────────── */
function CampaignVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) videoRef.current?.play().catch(() => {});
        else videoRef.current?.pause();
      }),
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="campaign-film" ref={sectionRef} data-theme="dark" className="relative h-screen w-full overflow-hidden bg-black flex items-center justify-center">
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        poster="/hero_campaign_1782146135055.png"
        className="absolute inset-0 w-full h-full object-cover opacity-50"
        src="/first%20Option.mp4"
      />
      <h2 className="font-serif italic text-white text-[100px] md:text-[150px] lg:text-[200px] leading-none absolute z-10 opacity-[0.1] pointer-events-none select-none">
        INFAMOUS
      </h2>
    </section>
  );
}

/* ══════════════════════════════ MAIN APP ══════════════════════════════════ */
export default function Home() {
  const horizontalRef = useRef<HTMLDivElement>(null);
  const parallaxRef = useRef<HTMLImageElement>(null);
  const [navDark, setNavDark] = useState(false);
  const [productStack, setProductStack] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    // Fetch products dynamically from the API
    api.get('/api/products')
      .then(response => {
        setProducts(response.data.products || []);
      })
      .catch(error => console.error("Failed to fetch dynamic products:", error));
  }, []);

  // Lock body scroll when ANY modal is open
  useEffect(() => {
    if (productStack.length > 0) {
      lenisRef.current?.stop();
      const originalOverflow = document.body.style.overflow;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      const originalPaddingRight = document.body.style.paddingRight;
      
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
        lenisRef.current?.start();
      };
    }
  }, [productStack.length]);
  const lenisRef = useRef<Lenis | null>(null);
  const { setIsCartOpen, items } = useCart();

  useEffect(() => {
    /* ── Lenis smooth scroll ── */
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });
    lenisRef.current = lenis;
    function raf(time: number) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);

    // Sync Lenis with GSAP ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    /* ── Nav color: detect if nav overlaps a dark section ── */
    const handleScroll = () => {
      const navY = 40; // nav ~40px from top of viewport
      const darkSections = document.querySelectorAll('[data-theme="dark"]');
      let overDark = false;
      darkSections.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top <= navY && rect.bottom >= navY) overDark = true;
      });
      setNavDark(!overDark); // navDark=true means dark TEXT (for light bgs)
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    /* ── Horizontal scroll (product showcase) ── */
    const ctx = gsap.context(() => {
      if (horizontalRef.current) {
        const totalWidth = horizontalRef.current.scrollWidth;
        const viewportWidth = window.innerWidth;
        gsap.to(horizontalRef.current, {
          x: -(totalWidth - viewportWidth),
          ease: 'none',
          scrollTrigger: {
            trigger: '#campaigns',
            pin: true,
            scrub: 1,
            end: () => '+=' + (totalWidth - viewportWidth),
            invalidateOnRefresh: true,
          },
        });
      }

      /* ── Parallax on featured collection ── */
      if (parallaxRef.current) {
        gsap.to(parallaxRef.current, {
          yPercent: 25,
          ease: 'none',
          scrollTrigger: {
            trigger: '#collections',
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        });
      }
    });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      lenis.destroy();
      ctx.revert();
    };
  }, []);

  return (
    <div className="bg-background min-h-screen text-textPrimary overflow-x-hidden">

      {/* ════════════════════ NAVIGATION ════════════════════ */}
      <nav className={`fixed top-5 left-1/2 -translate-x-1/2 w-[92%] z-50 flex items-center justify-between transition-colors duration-500 ${navDark ? 'text-textPrimary' : 'text-white'}`}>
        <div className="font-serif italic text-[32px] tracking-[-2px]">INFAMOUS</div>

        <div className={`hidden md:flex items-center gap-8 px-8 py-4 rounded-[24px] border transition-all duration-500 backdrop-blur-[20px] ${navDark ? 'bg-white/75 border-black/[0.08] shadow-glass' : 'bg-white/10 border-white/[0.12]'}`}>
          {['Home', 'Collections', 'Lookbook', 'Campaigns', 'About', 'Contact'].map((link) => (
            <a key={link} href={`#${link.toLowerCase()}`} onClick={(e) => {
              e.preventDefault();
              const target = document.getElementById(link.toLowerCase());
              if (target) lenisRef.current?.scrollTo(target, { offset: -80, duration: 1.5 });
            }} className="text-sm font-medium hover:opacity-60 transition-opacity cursor-pointer">{link}</a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link to="/auth/login" className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 backdrop-blur-[20px] border ${navDark ? 'bg-white/75 border-black/[0.08] hover:bg-white text-inherit' : 'bg-white/10 border-white/[0.12] hover:bg-white/20 text-inherit'}`}>
            <User size={20} />
          </Link>
          <button 
            onClick={() => setIsCartOpen(true)}
            className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 backdrop-blur-[20px] border ${navDark ? 'bg-white/75 border-black/[0.08] hover:bg-white' : 'bg-white/10 border-white/[0.12] hover:bg-white/20'}`}
          >
            <ShoppingBag size={20} />
            {items.length > 0 && (
              <span className="absolute top-0 right-0 w-4 h-4 bg-textPrimary text-white text-[10px] font-medium flex items-center justify-center rounded-full">
                {items.length}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* ════════════════════ SECTION 1 — HERO ════════════════════ */}
      <section id="home" data-theme="dark" className="relative h-screen w-full flex items-center justify-center overflow-hidden bg-black">
        <img src="/hero_campaign_1782146135055.png" alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
        <video autoPlay muted loop playsInline poster="/hero_campaign_1782146135055.png"
          className="absolute inset-0 w-full h-full object-cover z-[1]"
          src="/hero-video.mp4"
        />
        <div className="absolute inset-0 bg-black/25 z-[2]" />

        <div className="relative z-10 w-full max-w-[1200px] px-6 flex flex-col items-start pt-20">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }}
            className="border border-white/20 bg-white/10 backdrop-blur-md rounded-full px-5 py-1.5 mb-8 text-white text-xs tracking-[1.5px] font-medium">
            EST. STREET CULTURE
          </motion.div>

          <div className="font-serif italic text-white text-[72px] md:text-[110px] lg:text-[160px] leading-[0.85] tracking-[-6px] flex flex-wrap">
            {'INFAMOUS'.split('').map((letter, i) => (
              <motion.span key={i}
                initial={{ opacity: 0, y: 80, filter: 'blur(20px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 1.2, delay: 0.3 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="inline-block">
                {letter}
              </motion.span>
            ))}
          </div>

          <motion.p initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 text-white/90 text-lg font-light leading-[1.6] max-w-[550px]">
            Built for those who refuse ordinary.<br />
            Premium streetwear crafted with attitude, culture, and timeless design.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 1.1, ease: [0.16, 1, 0.3, 1] }}
            className="mt-12 flex items-center gap-6">
            <button 
              onClick={(e) => {
                e.preventDefault();
                const target = document.getElementById('campaigns');
                if (target) lenisRef.current?.scrollTo(target, { offset: 0, duration: 1.5 });
              }}
              className="glass-button h-14 px-8 rounded-full text-white font-medium flex items-center gap-2 hover:bg-white hover:text-black transition-all duration-500"
            >
              Explore Collection
            </button>
            <button 
              onClick={(e) => {
                e.preventDefault();
                const target = document.getElementById('campaign-film');
                if (target) lenisRef.current?.scrollTo(target, { offset: 0, duration: 1.5 });
              }}
              className="flex items-center gap-3 text-white font-medium hover:text-white/70 transition-colors"
            >
              <span className="glass-button w-12 h-12 rounded-full flex items-center justify-center"><Play size={16} fill="currentColor" /></span>
              Watch Campaign
            </button>
          </motion.div>
        </div>
      </section>

      {/* ════════════════════ SECTION 2 — FEATURED COLLECTION ════════════════════ */}
      <section id="collections" className="min-h-[120vh] w-full flex flex-col md:flex-row overflow-hidden bg-background">
        <div className="w-full md:w-[60%] h-[60vh] md:h-[120vh] overflow-hidden relative">
          <img ref={parallaxRef} src="/featured_collection_1782146151168.png" alt="Featured Collection"
            className="absolute -top-[15%] left-0 w-full h-[130%] object-cover" />
        </div>
        <div className="w-full md:w-[40%] flex flex-col justify-center px-12 lg:px-24 py-20">
          <Reveal>
            <p className="text-textSecondary text-sm tracking-[2px] font-medium mb-6">NEW ARRIVAL</p>
            <h2 className="font-serif italic text-6xl md:text-[96px] leading-[0.9] mb-8">SUMMER<br />2026</h2>
          </Reveal>
          <Reveal delay={0.15}>
            <p className="text-textSecondary text-lg font-light leading-relaxed max-w-sm mb-12">
              A brutalist approach to modern luxury.
              Heavyweight cottons, technical nylons,
              and architectural silhouettes designed
              for the concrete landscape.
            </p>
          </Reveal>
          <Reveal delay={0.3}>
            <button 
              onClick={(e) => {
                e.preventDefault();
                const target = document.getElementById('campaigns');
                if (target) lenisRef.current?.scrollTo(target, { offset: 0, duration: 1.5 });
              }}
              className="group flex items-center gap-4 text-xl font-medium w-fit"
            >
              View Collection
              <span className="w-12 h-12 rounded-full border border-black/10 flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all duration-500">
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </Reveal>
        </div>
      </section>

      {/* ════════════════════ SECTION 3 — LOOKBOOK ════════════════════ */}
      <section id="lookbook" data-theme="dark" className="bg-[#111111] text-white min-h-[200vh] py-32 px-6 lg:px-12">
        <div className="max-w-[1600px] mx-auto">
          {/* Row 1 */}
          <div className="flex flex-col md:flex-row items-end gap-12 mb-32">
            <Reveal className="w-full md:w-[70%]">
              <img src="/lookbook_1_1782146168251.png" alt="Lookbook 1" className="w-full h-auto object-cover rounded-[24px]" />
            </Reveal>
            <Reveal className="w-full md:w-[30%] pb-12" delay={0.2}>
              <h3 className="font-serif italic text-[60px] lg:text-[120px] leading-[0.8] opacity-90">MORE THAN<br />CLOTHING</h3>
            </Reveal>
          </div>

          {/* Row 2 */}
          <div className="flex flex-col-reverse md:flex-row items-center gap-12 mb-32">
            <Reveal className="w-full md:w-[30%]" delay={0.15}>
              <p className="text-white/60 font-light text-xl max-w-sm">
                Redefining the boundaries between high fashion and street culture. Every stitch tells a story.
              </p>
            </Reveal>
            <Reveal className="w-full md:w-[70%]">
              <img src="/lookbook_2_1782146201135.png" alt="Lookbook 2" className="w-full h-[80vh] object-cover rounded-[24px]" />
            </Reveal>
          </div>


        </div>
      </section>

      {/* ════════════════════ SECTION 4 — PRODUCT SHOWCASE ════════════════════ */}
      <section id="campaigns" className="h-screen w-full bg-secondary overflow-hidden">
        <div className="h-full flex items-center">
          <div ref={horizontalRef} className="flex gap-10 pl-[10vw] pr-[10vw]" style={{ width: 'max-content' }}>
            {products.length > 0 ? products.map((product, i) => (
              <div key={product.id || i} className="w-[400px] shrink-0 group cursor-pointer flex flex-col">
                <div className="w-full h-[480px] rounded-[24px] overflow-hidden bg-white/50 relative">
                  <img src={product.images?.cover || product.img} alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-[600ms] group-hover:scale-105" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-500 flex items-end justify-center pb-6">
                    <button 
                      onClick={() => setProductStack(prev => [...prev, product])}
                      className="glass-button px-6 py-3 rounded-full opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 font-medium text-sm"
                    >
                      Quick View
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-end pt-5">
                  <h4 className="font-medium text-lg">{product.name}</h4>
                  <span className="font-medium text-textSecondary">₹{product.price || (product.variants && product.variants.length > 0 ? product.variants[0].price : 0)}</span>
                </div>
              </div>
            )) : (
              <div className="w-full text-center text-white py-20 flex justify-center items-center h-[480px]">
                 <p className="text-xl">Loading dynamic products...</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ════════════════════ SECTION 5 — BRAND PHILOSOPHY ════════════════════ */}
      <section id="about" className="h-screen w-full flex items-center justify-center px-6 text-center bg-background">
        <Reveal>
          <h2 className="font-serif italic text-[48px] md:text-[90px] lg:text-[140px] leading-[0.85] text-textPrimary">
            WE DON'T FOLLOW<br /> TRENDS.<br />
            WE CREATE CULTURE.
          </h2>
        </Reveal>
      </section>

      {/* ════════════════════ SECTION 6 — CAMPAIGN FILM ════════════════════ */}
      <CampaignVideo />

      {/* ════════════════════ SECTION 7 — TESTIMONIALS ════════════════════ */}
      <section className="min-h-screen bg-background py-32 flex flex-col justify-center">
        <div className="max-w-[1400px] mx-auto w-full px-6">
          <Reveal>
            <p className="text-textSecondary text-sm tracking-[2px] font-medium mb-4 text-center">PRESS</p>
            <h2 className="font-serif italic text-5xl md:text-7xl text-center mb-20">What They Say</h2>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { quote: 'The most vital new voice in luxury streetwear. Unapologetic and refined.', author: 'VOGUE' },
              { quote: 'Infamous bridges the gap between high fashion showrooms and the pavement.', author: 'HYPEBEAST' },
              { quote: 'A masterclass in silhouette and fabrication. They are setting the new standard.', author: 'GQ STYLE' },
            ].map((item, i) => (
              <Reveal key={i} delay={i * 0.12}>
                <div className="glass-card p-12 flex flex-col justify-between min-h-[380px] relative" style={{ marginTop: i === 1 ? '40px' : '0' }}>
                  <span className="font-serif text-[100px] leading-none text-black/[0.06] absolute top-4 left-8">&ldquo;</span>
                  <p className="text-xl font-light leading-relaxed mt-10 relative z-10">{item.quote}</p>
                  <div className="font-medium tracking-[3px] text-xs mt-8 text-textSecondary">— {item.author}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* ════════════════════ FOOTER ════════════════════ */}
      <footer data-theme="dark" className="min-h-[70vh] bg-[#111111] text-white relative flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col md:flex-row px-12 lg:px-24 pt-24 gap-12 justify-between relative z-10">
          <div>
            <h4 className="text-white/40 text-xs tracking-[3px] mb-8">EXPLORE</h4>
            <div className="flex flex-col gap-5">
              {['Collections', 'Lookbook', 'Campaigns', 'About', 'Contact'].map((link) => (
                <a key={link} href="#" className="text-xl font-light hover:text-white/60 transition-colors">{link}</a>
              ))}
            </div>
          </div>

          <div className="text-right">
            <h4 className="text-white/40 text-xs tracking-[3px] mb-8">SOCIAL</h4>
            <div className="flex flex-col gap-5">
              {['Instagram'].map((link) => (
                <a key={link} href="#" className="text-white/60 hover:text-white transition-colors">{link}</a>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full flex justify-center pb-12 relative z-10">
          <p className="text-white/25 text-sm tracking-widest">© 2026 INFAMOUS. ALL RIGHTS RESERVED.</p>
        </div>

        <div className="absolute bottom-[-5%] left-1/2 -translate-x-1/2 w-full text-center pointer-events-none select-none">
          <span className="font-serif italic text-[18vw] leading-none opacity-[0.06] whitespace-nowrap">INFAMOUS</span>
        </div>
      </footer>

      {productStack.map((product, index) => (
        <QuickViewModal 
          key={`${product.id}-${index}`}
          product={product} 
          onClose={() => setProductStack(prev => prev.filter((_, i) => i !== index))}
          onSelectProduct={(p) => setProductStack(prev => [...prev, p])}
          zIndex={999 + index}
          isTopmost={index === productStack.length - 1}
        />
      ))}
    </div>
  );
}
