import { useMemo } from 'react';

interface Props {
  onNavClick: (id: string) => void;
}

export default function LKHero({ onNavClick }: Props) {
  // Generate spark particles with deterministic random-looking values
  const sparks = useMemo(() => {
    const items: { left: string; top: string; size: number; dur: string; peak: string; drift: string; delay: string }[] = [];
    for (let i = 0; i < 18; i++) {
      const seed = (i * 137 + 42) % 100;
      items.push({
        left: `${(seed * 7 + i * 13) % 100}%`,
        top: `${(seed * 3 + i * 17) % 100}%`,
        size: 2 + (seed % 3),
        dur: `${2.5 + (seed % 4)}s`,
        peak: `${0.3 + (seed % 5) * 0.1}`,
        drift: `${-15 - (seed % 20)}px`,
        delay: `${(i * 0.4) % 5}s`,
      });
    }
    return items;
  }, []);

  return (
    <section className="lk-hero" id="lk-hero">
      {/* Animated laser beam */}
      <div className="lk-hero-beam" />

      {/* Spark particles */}
      {sparks.map((s, i) => (
        <div
          key={i}
          className="lk-spark"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            '--dur': s.dur,
            '--peak': s.peak,
            '--drift': s.drift,
            animationDelay: s.delay,
          } as React.CSSProperties}
        />
      ))}

      {/* Content */}
      <div className="lk-hero-content lk-reveal">
        <h1>
          <span className="lk-gold">Βήματα Μπροστά</span> στην Τεχνολογία
        </h1>
        <p className="lk-hero-subtitle">
          Υπερσύγχρονη μονάδα κοπής &amp; διαμόρφωσης μετάλλου στο Ηράκλειο Κρήτης
        </p>
        <div className="lk-hero-ctas">
          <a
            href="#lk-services"
            className="lk-btn lk-btn--primary"
            onClick={(e) => { e.preventDefault(); onNavClick('lk-services'); }}
          >
            Οι Υπηρεσίες Μας →
          </a>
          <a
            href="#lk-contact"
            className="lk-btn lk-btn--outline"
            onClick={(e) => { e.preventDefault(); onNavClick('lk-contact'); }}
          >
            Επικοινωνήστε Μαζί Μας
          </a>
        </div>
      </div>
    </section>
  );
}
