/* Social SVG icons */
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
  </svg>
);
const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="17.5" cy="6.5" r="1.2" />
  </svg>
);
const MessengerIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.907 1.432 5.502 3.68 7.2V22l3.364-1.846A11.25 11.25 0 0012 20.486c5.523 0 10-4.145 10-9.243S17.523 2 12 2z" />
    <path d="M8 13l3-3 2 2 3-3" fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
  </svg>
);

const MailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M22 7l-10 7L2 7" />
  </svg>
);

const MapPinIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const MAPS_EMBED =
  'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d31870.355272585937!2d25.156813984625806!3d35.34096063322517!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x149a59a76a706211%3A0x60a3f567883094d5!2zTGFzZXJLcml0aXMgzpzOn86lzqHOpM6WzpHOms6XzqMgzprOqc6dzqPOpM6Rzp3OpM6Zzp3On86j!5e0!3m2!1sel!2sgr!4v1775207087618!5m2!1sel!2sgr';

export default function LKFooter() {
  return (
    <div id="lk-contact">
      {/* Section title */}
      <section className="lk-section lk-section--darker" style={{ paddingBottom: 0 }}>
        <div className="lk-container">
          <h2 className="lk-section-title lk-reveal">
            <span className="lk-gold">Επικοινωνία</span>
          </h2>
          <div className="lk-gold-line lk-reveal" />
        </div>
      </section>

      {/* Google Map */}
      <div className="lk-map-wrapper">
        <iframe
          src={MAPS_EMBED}
          title="LaserKritis τοποθεσία στον χάρτη"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>

      {/* Footer columns */}
      <footer className="lk-footer">
        <div className="lk-footer-grid">
          {/* Column 1 — Address */}
          <div className="lk-footer-col lk-reveal">
            <h4>Η Έδρα Μας</h4>
            <p style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <span style={{ flexShrink: 0, marginTop: 4 }}><MapPinIcon /></span>
              Οδός Ρ τετράγωνο 4, ΒΙ.ΠΕ. Ηρακλείου,<br />
              Τ.Κ.71100, Ηράκλειο Κρήτης
            </p>
          </div>

          {/* Column 2 — Contact */}
          <div className="lk-footer-col lk-reveal">
            <h4>Επικοινωνία</h4>
            <a href="tel:+302810380912">
              <PhoneIcon /> 2810 380 912
            </a>
            <a href="mailto:info@laserkritis.gr">
              <MailIcon /> info@laserkritis.gr
            </a>
          </div>

          {/* Column 3 — Social */}
          <div className="lk-footer-col lk-reveal">
            <h4>Social Media</h4>
            <div className="lk-social-links">
              <a
                href="https://www.facebook.com/laserkritis/"
                target="_blank"
                rel="noopener noreferrer"
                className="lk-social-link"
                aria-label="Facebook"
              >
                <FacebookIcon />
              </a>
              <a
                href="https://www.instagram.com/laserkritis/"
                target="_blank"
                rel="noopener noreferrer"
                className="lk-social-link"
                aria-label="Instagram"
              >
                <InstagramIcon />
              </a>
              <a
                href="https://m.me/laserkritis"
                target="_blank"
                rel="noopener noreferrer"
                className="lk-social-link"
                aria-label="Messenger"
              >
                <MessengerIcon />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="lk-footer-bottom">
          <p>&copy; 2022 - 2026 laserkritis.gr</p>
          <div className="lk-footer-mini-logo">
            <span>LASER </span><span>KRITIS</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
