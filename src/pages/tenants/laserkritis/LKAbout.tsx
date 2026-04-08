export default function LKAbout() {
  return (
    <>
      {/* ── About Section ──────────────────────────────────────────── */}
      <section className="lk-section lk-section--darker" id="lk-about">
        <div className="lk-container">
          <h2 className="lk-section-title lk-reveal">
            Η <span className="lk-gold">Εταιρεία</span> Μας
          </h2>
          <div className="lk-gold-line lk-reveal" />

          <div className="lk-about-grid">
            <div className="lk-about-text lk-reveal">
              <p>
                Το LaserKritis αποτελεί μια υπερσύγχρονη μονάδα κοπής και
                διαμόρφωσης μετάλλου με έδρα το Ηράκλειο Κρήτης. Από το 2020
                υπηρετούμε τις ανάγκες των πελατών μας, με γνώμονα την ακρίβεια
                και τον επαγγελματισμό!
              </p>

              <div className="lk-stats-inline lk-stagger">
                <div className="lk-stat-box lk-reveal">
                  <div className="lk-stat-number">4+</div>
                  <div className="lk-stat-label">Χρόνια Εμπειρίας</div>
                </div>
                <div className="lk-stat-box lk-reveal">
                  <div className="lk-stat-number">9</div>
                  <div className="lk-stat-label">Ειδικοί Συνεργάτες</div>
                </div>
                <div className="lk-stat-box lk-reveal">
                  <div className="lk-stat-number">1000+</div>
                  <div className="lk-stat-label">Ολοκληρωμένα Έργα</div>
                </div>
              </div>
            </div>

            <div className="lk-about-img lk-reveal">
              <img
                src="https://static.laserkritis.gr/files/company/company.jpg"
                alt="Εγκαταστάσεις LaserKritis στο Ηράκλειο Κρήτης"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Philosophy Section ─────────────────────────────────────── */}
      <section className="lk-section lk-section--dark">
        <div className="lk-container">
          <h2 className="lk-section-title lk-reveal">
            Η <span className="lk-gold">Φιλοσοφία</span> Μας
          </h2>
          <div className="lk-gold-line lk-reveal" />

          <div className="lk-philosophy-grid">
            <div className="lk-philosophy-img lk-reveal">
              <img
                src="https://static.laserkritis.gr/files/philosophy/philosophy.jpg"
                alt="Φιλοσοφία LaserKritis"
                loading="lazy"
              />
            </div>

            <div className="lk-philosophy-text lk-reveal">
              <p>
                Στόχος μας είναι να δημιουργήσουμε σχέση εμπιστοσύνης με τους
                πελάτες - συνεργάτες μας και αυτό αποδεικνύεται μέσα από τα
                έργα μας. Όπου τα χαρακτηρίζει η ποιότητα και η ταχύτητα.
                Συνεχή μας μέριμνα είναι να εξελίσσουμε το εύρος της
                τεχνολογίας μας μέσα από νέες συνεργασίες και επενδύσεις στον
                τομέα της κοπής και επεξεργασίας μετάλλων.
              </p>

              <div className="lk-highlight-boxes lk-stagger">
                <div className="lk-highlight-box lk-reveal">
                  <h4>Στόχος Μας</h4>
                  <p>Η εμπιστοσύνη με τους πελάτες &amp; συνεργάτες μας.</p>
                </div>
                <div className="lk-highlight-box lk-reveal">
                  <h4>Μέριμνα Μας</h4>
                  <p>Να εξελίσσουμε τη τεχνολογία μας.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats Strip ────────────────────────────────────────────── */}
      <div className="lk-stats-strip">
        <div className="lk-stats-strip-inner">
          <div className="lk-strip-stat">
            <div className="lk-strip-stat-number">4+</div>
            <div className="lk-strip-stat-label">Χρόνια Εμπειρίας</div>
          </div>
          <div className="lk-strip-stat">
            <div className="lk-strip-stat-number">9</div>
            <div className="lk-strip-stat-label">Ειδικοί Συνεργάτες</div>
          </div>
          <div className="lk-strip-stat">
            <div className="lk-strip-stat-number">1000+</div>
            <div className="lk-strip-stat-label">Ολοκληρωμένα Έργα</div>
          </div>
        </div>
      </div>
    </>
  );
}
