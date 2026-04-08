import { useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import LKHeader from './LKHeader';
import LKHero from './LKHero';
import LKAbout from './LKAbout';
import LKProjects from './LKProjects';
import LKServices from './LKServices';
import LKFooter from './LKFooter';
import './laserkritis.css';

export default function LaserKritisLanding() {
  /* ── Smooth scroll to section ──────────────────────────────────── */
  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  /* ── Scroll-reveal observer ────────────────────────────────────── */
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.lk-reveal');
    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('lk-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lk-page">
      <Helmet>
        <title>LaserKritis | Επεξεργασία &amp; Κοπή Μετάλλων με Fiber Laser</title>
        <meta
          name="description"
          content="Υπερσύγχρονη μονάδα κοπής και διαμόρφωσης μετάλλου με Fiber Laser στο Ηράκλειο Κρήτης. Κοπή, στράντζα, πλάσμα, σχεδιασμός."
        />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </Helmet>

      <LKHeader onNavClick={scrollTo} />
      <LKHero onNavClick={scrollTo} />
      <LKAbout />
      <LKProjects />
      <LKServices />
      <LKFooter />
    </div>
  );
}
