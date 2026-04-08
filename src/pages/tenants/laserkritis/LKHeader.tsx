import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  onNavClick: (id: string) => void;
}

export default function LKHeader({ onNavClick }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const links = [
    { label: 'Αρχική', target: 'lk-hero' },
    { label: 'Η Εταιρεία', target: 'lk-about' },
    { label: 'Τα Έργα Μας', target: 'lk-projects' },
    { label: 'Οι Υπηρεσίες Μας', target: 'lk-services' },
    { label: 'Επικοινωνία', target: 'lk-contact' },
  ];

  const handleNav = (target: string) => {
    setMenuOpen(false);
    onNavClick(target);
  };

  return (
    <>
      <header className={`lk-header ${scrolled ? 'lk-header--scrolled' : ''}`}>
        {/* Logo */}
        <div className="lk-logo" style={{ cursor: 'pointer' }} onClick={() => handleNav('lk-hero')}>
          <div className="lk-logo-text">
            <span>LASER </span><span>KRITIS</span>
          </div>
          <div className="lk-logo-line" />
        </div>

        {/* Desktop nav */}
        <nav className="lk-nav">
          {links.map((l) => (
            <a key={l.target} href={`#${l.target}`} onClick={(e) => { e.preventDefault(); handleNav(l.target); }}>
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop buttons */}
        <div className="lk-header-actions">
          <Link to="/el/quote" className="lk-btn lk-btn--primary lk-btn--sm">
            Ζητήστε Προσφορά
          </Link>
          {user ? (
            <Link to="/customer/dashboard" className="lk-btn lk-btn--outline lk-btn--sm">
              Ο Λογαριασμός Μου
            </Link>
          ) : (
            <Link to="/el/login" className="lk-btn lk-btn--outline lk-btn--sm">
              Σύνδεση / Εγγραφή
            </Link>
          )}
          {/* Hamburger (shown on mobile via CSS) */}
          <button
            className={`lk-hamburger ${menuOpen ? 'lk-open' : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
      <div className={`lk-mobile-menu ${menuOpen ? 'lk-open' : ''}`}>
        {links.map((l) => (
          <a key={l.target} href={`#${l.target}`} onClick={(e) => { e.preventDefault(); handleNav(l.target); }}>
            {l.label}
          </a>
        ))}
        <Link to="/el/quote" className="lk-btn lk-btn--primary" onClick={() => setMenuOpen(false)}>
          Ζητήστε Προσφορά
        </Link>
        {user ? (
          <Link to="/customer/dashboard" className="lk-btn lk-btn--outline" onClick={() => setMenuOpen(false)}>
            Ο Λογαριασμός Μου
          </Link>
        ) : (
          <Link to="/el/login" className="lk-btn lk-btn--outline" onClick={() => setMenuOpen(false)}>
            Σύνδεση / Εγγραφή
          </Link>
        )}
      </div>
    </>
  );
}
