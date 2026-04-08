import { useState } from 'react';

/* ── Inline SVG Icons ─────────────────────────────────────────────── */
const LaserIcon = () => (
  <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <line x1="4" y1="4" x2="20" y2="20" strokeLinecap="round" />
    <circle cx="24" cy="24" r="3" />
    <line x1="20" y1="28" x2="20" y2="34" strokeLinecap="round" />
    <line x1="28" y1="28" x2="32" y2="32" strokeLinecap="round" />
    <line x1="28" y1="20" x2="34" y2="20" strokeLinecap="round" />
    <path d="M2 10 L10 2" strokeLinecap="round" />
  </svg>
);

const PlasmaIcon = () => (
  <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 2 C18 2 10 14 10 22 A8 8 0 0 0 26 22 C26 14 18 2 18 2Z" />
    <path d="M18 12 C18 12 14 18 14 22 A4 4 0 0 0 22 22 C22 18 18 12 18 12Z" strokeDasharray="2 2" />
  </svg>
);

const PressIcon = () => (
  <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="2" width="28" height="6" rx="1" />
    <rect x="14" y="8" width="8" height="12" rx="1" />
    <path d="M4 24 L14 20 L22 20 L32 24" strokeLinejoin="round" />
    <line x1="4" y1="24" x2="4" y2="34" strokeLinecap="round" />
    <line x1="32" y1="24" x2="32" y2="34" strokeLinecap="round" />
    <line x1="2" y1="34" x2="34" y2="34" strokeLinecap="round" />
  </svg>
);

const ScissorsIcon = () => (
  <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="28" r="5" />
    <circle cx="28" cy="28" r="5" />
    <line x1="12" y1="24" x2="28" y2="4" strokeLinecap="round" />
    <line x1="24" y1="24" x2="8" y2="4" strokeLinecap="round" />
  </svg>
);

const DesignIcon = () => (
  <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 32 L28 4" strokeLinecap="round" />
    <polygon points="28,4 34,6 30,10" />
    <line x1="8" y1="28" x2="12" y2="24" strokeLinecap="round" />
    <rect x="20" y="20" width="12" height="12" rx="1" strokeDasharray="2 2" />
    <line x1="2" y1="34" x2="16" y2="34" strokeLinecap="round" />
    <line x1="2" y1="34" x2="2" y2="20" strokeLinecap="round" />
  </svg>
);

/* ── Service Data ─────────────────────────────────────────────────── */
interface Service {
  title: string;
  icon: JSX.Element;
  image: string;
  description: string;
  bullets?: string[];
  specs?: { label: string; value: string }[];
}

const services: Service[] = [
  {
    title: 'Κοπή με Fiber Laser',
    icon: <LaserIcon />,
    image: 'https://static.laserkritis.gr/filemanager/515x450/services/fiber.jpg',
    description:
      'Οι νέες πηγές Fiber Laser είναι η τελευταία εξέλιξη τεχνολογίας των μηχανών κοπής laser. Οι μηχανές Fiber Laser έχουν την δυνατότητα κοπής πολύ μικρών οπών και ταυτόχρονα έχουν πολύ μεγαλύτερη ταχύτητα κοπής σε σχέση με τις συμβατικές μηχανές Laser CO2.',
    bullets: [
      'Καθαρή ποιότητα κοπής (δεν χρειάζεται περαιτέρω επεξεργασία)',
      'Μεγάλη ταχύτητα κοπής',
      'Επαναληψιμότητα στις κοπές (μικρές / μεγάλες ποσότητες)',
      'Χαμηλό κόστος λειτουργίας (οικολογική λειτουργία)',
      'Απόλυτη ακρίβεια στις κοπές (απαιτητικά σχέδια)',
      'Πολύ μικρή θερμική καταπόνηση στα ελάσματα',
      'Υπηρεσία nesting για εξοικονόμηση υλικού',
    ],
  },
  {
    title: 'Κοπή με Πλάσμα',
    icon: <PlasmaIcon />,
    image: 'https://static.laserkritis.gr/filemanager/515x450/services/plasma.jpg',
    description:
      'Η LaserKritis διαθέτει ένα μηχάνημα Plasma High Definition για κοπές μετάλλων μεγάλου πάχους με πολύ καλή ακρίβεια. Εξοπλισμένο με τεχνολογίες TrueHole® και XDefinition® Technology.',
    specs: [
      { label: 'Μαύρη Λαμαρίνα', value: 'έως 70mm' },
      { label: 'Inox', value: 'έως 30mm' },
    ],
  },
  {
    title: 'Στράντζα',
    icon: <PressIcon />,
    image: 'https://static.laserkritis.gr/filemanager/515x450/services/strantza2.jpg',
    description:
      'Η στράντζα χρησιμοποιείται σε μεγάλο βαθμό στη βιομηχανία λόγω της ικανότητας να διαμορφώνει εύκολα μεγάλα ελάσματα και με ακρίβεια. Η LaserKritis διαθέτει σύγχρονο μηχάνημα διαμόρφωσης ελασμάτων με συνεχή ανανέωση καλουπιών.',
    bullets: [
      'Εξειδικευμένο προσωπικό',
      'Συνεχής ανανέωση καλουπιών',
      'Βέλτιστο τελικό αποτέλεσμα',
    ],
  },
  {
    title: 'Ψαλίδι',
    icon: <ScissorsIcon />,
    image: 'https://static.laserkritis.gr/filemanager/515x450/services/hq720.jpg',
    description:
      'Απαραίτητο εργαλείο σύγχρονων μονάδων επεξεργασίας μεταλλικών ελασμάτων. Στη LaserKritis μπορούμε να αναλάβουμε οποιαδήποτε εργασία διαμόρφωσης αλλά και παραγωγής τελικού προϊόντος.',
    specs: [
      { label: 'Μαύρη λαμαρίνα', value: '1mm έως 8mm' },
      { label: 'Ανοξείδωτο', value: '1mm έως 4mm' },
    ],
  },
  {
    title: 'Σχεδιασμός',
    icon: <DesignIcon />,
    image: 'https://static.laserkritis.gr/filemanager/515x450/services/sxediasmos.jpg',
    description:
      'Η ομάδα του Laserkritis αποτελείται από έμπειρους σχεδιαστές και μηχανικούς, με άριστη γνώση σχεδιαστικών προγραμμάτων και μεθόδων κατασκευής.',
    bullets: [
      'Σχεδιασμός ιδεών',
      'Ανάπτυξη πρωτοτύπου',
      'Δημιουργία πρωτοτύπου',
      'Τρισδιάστατη απεικόνιση των σχεδίων',
      'Ταχύτητα, ευελιξία και αποτελεσματικότητα',
    ],
  },
];

/* ── Component ────────────────────────────────────────────────────── */
export default function LKServices() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => {
    setOpenIndex(openIndex === i ? null : i);
  };

  return (
    <section className="lk-section lk-section--dark" id="lk-services">
      <div className="lk-container">
        <h2 className="lk-section-title lk-reveal">
          Οι <span className="lk-gold">Υπηρεσίες</span> Μας
        </h2>
        <div className="lk-gold-line lk-reveal" />

        <div className="lk-services-bento lk-stagger">
          {services.map((svc, i) => (
            <div key={i} className="lk-service-card lk-reveal" onClick={() => toggle(i)}>
              {/* Header */}
              <div className="lk-service-header">
                <div className="lk-service-header-left">
                  <div className="lk-service-icon">{svc.icon}</div>
                  <h3>{svc.title}</h3>
                </div>
                <button
                  className={`lk-service-toggle ${openIndex === i ? 'lk-open' : ''}`}
                  aria-label={openIndex === i ? 'Κλείσιμο' : 'Άνοιγμα'}
                  onClick={(e) => { e.stopPropagation(); toggle(i); }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>

              {/* Expandable body */}
              <div className={`lk-service-body ${openIndex === i ? 'lk-open' : ''}`}>
                <div className="lk-service-body-inner">
                  <img
                    src={svc.image}
                    alt={svc.title}
                    loading="lazy"
                  />
                  <div>
                    <p>{svc.description}</p>
                    {svc.bullets && (
                      <ul className="lk-service-bullets">
                        {svc.bullets.map((b, j) => (
                          <li key={j}>{b}</li>
                        ))}
                      </ul>
                    )}
                    {svc.specs && (
                      <div className="lk-service-specs">
                        {svc.specs.map((sp, j) => (
                          <p key={j}>
                            <strong>{sp.label}:</strong> {sp.value}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
