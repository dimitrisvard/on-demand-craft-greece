const projects = [
  { title: 'Βιομηχανικές Εφαρμογές', img: 'https://static.laserkritis.gr/files/projects/biomechanika.jpg' },
  { title: 'Επιγραφές', img: 'https://static.laserkritis.gr/files/projects/signs.jpg' },
  { title: 'Φωτοβολταϊκά', img: 'https://static.laserkritis.gr/files/projects/pexels-kelly-l-4320475.jpg' },
  { title: 'Γεωργικά Μηχανήματα', img: 'https://static.laserkritis.gr/files/projects/ergalia.jpg' },
  { title: 'Διακόσμηση Εσωτερικών Χώρων', img: 'https://static.laserkritis.gr/files/projects/esoterikon-xoron.jpg' },
  { title: 'Σκάλες', img: 'https://static.laserkritis.gr/files/projects/skala.png' },
  { title: 'Διάφορα Σχέδια', img: 'https://static.laserkritis.gr/files/projects/diafora.jpg' },
  { title: 'Πέργκολες', img: 'https://static.laserkritis.gr/files/projects/pergola.jpg' },
  { title: 'Γκαραζόπορτες - Αυλόπορτες', img: 'https://static.laserkritis.gr/files/projects/garazoporta.jpg' },
  { title: 'Διακοσμητικά Είδη', img: 'https://static.laserkritis.gr/files/projects/diakosmitika.jpg' },
  { title: 'Κάγκελα', img: 'https://static.laserkritis.gr/files/projects/kagela.jpg' },
  { title: 'Φωτιστικά', img: 'https://static.laserkritis.gr/files/projects/ezgif.com-gif-maker.jpg' },
  { title: 'Φράχτες', img: 'https://static.laserkritis.gr/files/projects/phrachtes.jpg' },
  { title: 'Διακόσμηση Εξωτερικών Χώρων', img: 'https://static.laserkritis.gr/files/projects/exoterikon-xoron.jpg' },
  { title: 'Κατασκευή Επίπλων', img: 'https://static.laserkritis.gr/files/projects/epipla.jpg' },
];

export default function LKProjects() {
  return (
    <section className="lk-section lk-section--darker" id="lk-projects">
      <div className="lk-container">
        <h2 className="lk-section-title lk-reveal">
          Τα <span className="lk-gold">Έργα</span> Μας
        </h2>
        <p className="lk-section-subtitle lk-reveal">
          Δείγματα κοπής &amp; κατασκευής σε Fiber Laser
        </p>
        <div className="lk-gold-line lk-reveal" />

        <div className="lk-projects-grid lk-stagger">
          {projects.map((p, i) => (
            <div key={i} className="lk-project-item lk-reveal">
              <img
                src={p.img}
                alt={p.title}
                loading="lazy"
              />
              <div className="lk-project-overlay">
                <span>{p.title}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
