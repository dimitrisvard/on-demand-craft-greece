// Localized copy for the site-wide timed quote popup.
//
// The project's i18n catalog (src/locales/<lang>/translation.json) is large and
// shared across many features, so the popup keeps its strings self-contained
// here. The keys line up 1:1 with the 14 languages registered in src/i18n.ts.
export type PopupLocale =
  | "en" | "de" | "fr" | "es" | "it" | "nl" | "pt"
  | "fi" | "sv" | "da" | "nb" | "cs" | "pl" | "hu";

export interface PopupCopy {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  micro: string;   // file types + "no account needed"
  later: string;
  close: string;   // aria-label for the × button
}

export const QUOTE_POPUP_COPY: Record<PopupLocale, PopupCopy> = {
  en: {
    eyebrow: "MADE IN EUROPE · ON-DEMAND MANUFACTURING",
    title: "Need a part manufactured in Europe?",
    body: "Upload your CAD and get a fixed quote within 24 hours — CNC machining, sheet metal and 3D printing, delivered across Europe.",
    cta: "Get a free quote",
    micro: "STEP · IGES · DXF · STL — no account needed",
    later: "Maybe later",
    close: "Close",
  },
  de: {
    eyebrow: "HERGESTELLT IN EUROPA · FERTIGUNG AUF ABRUF",
    title: "Brauchen Sie ein in Europa gefertigtes Teil?",
    body: "Laden Sie Ihre CAD-Datei hoch und erhalten Sie innerhalb von 24 Stunden ein verbindliches Angebot – CNC-Bearbeitung, Blechfertigung und 3D-Druck, europaweit geliefert.",
    cta: "Kostenloses Angebot anfordern",
    micro: "STEP · IGES · DXF · STL – kein Konto erforderlich",
    later: "Vielleicht später",
    close: "Schließen",
  },
  fr: {
    eyebrow: "FABRIQUÉ EN EUROPE · FABRICATION À LA DEMANDE",
    title: "Besoin d'une pièce fabriquée en Europe ?",
    body: "Téléchargez votre fichier CAO et recevez un devis ferme sous 24 heures — usinage CNC, tôlerie et impression 3D, livrés partout en Europe.",
    cta: "Obtenir un devis gratuit",
    micro: "STEP · IGES · DXF · STL — sans création de compte",
    later: "Plus tard",
    close: "Fermer",
  },
  es: {
    eyebrow: "FABRICADO EN EUROPA · FABRICACIÓN BAJO DEMANDA",
    title: "¿Necesita una pieza fabricada en Europa?",
    body: "Suba su archivo CAD y reciba un presupuesto cerrado en 24 horas: mecanizado CNC, chapa metálica e impresión 3D, con entrega en toda Europa.",
    cta: "Solicitar presupuesto gratis",
    micro: "STEP · IGES · DXF · STL — sin necesidad de cuenta",
    later: "Quizás más tarde",
    close: "Cerrar",
  },
  it: {
    eyebrow: "PRODOTTO IN EUROPA · PRODUZIONE ON-DEMAND",
    title: "Ti serve un pezzo prodotto in Europa?",
    body: "Carica il tuo file CAD e ricevi un preventivo definito entro 24 ore: lavorazione CNC, lamiera e stampa 3D, con consegna in tutta Europa.",
    cta: "Richiedi un preventivo gratuito",
    micro: "STEP · IGES · DXF · STL — senza registrazione",
    later: "Forse più tardi",
    close: "Chiudi",
  },
  nl: {
    eyebrow: "GEMAAKT IN EUROPA · PRODUCTIE OP AANVRAAG",
    title: "Een onderdeel nodig, gemaakt in Europa?",
    body: "Upload uw CAD-bestand en ontvang binnen 24 uur een vaste offerte — CNC-verspaning, plaatwerk en 3D-printen, geleverd in heel Europa.",
    cta: "Vraag een gratis offerte aan",
    micro: "STEP · IGES · DXF · STL — geen account nodig",
    later: "Misschien later",
    close: "Sluiten",
  },
  pt: {
    eyebrow: "FABRICADO NA EUROPA · FABRICO A PEDIDO",
    title: "Precisa de uma peça fabricada na Europa?",
    body: "Carregue o seu ficheiro CAD e receba um orçamento fixo em 24 horas — maquinação CNC, chapa metálica e impressão 3D, com entrega em toda a Europa.",
    cta: "Pedir orçamento gratuito",
    micro: "STEP · IGES · DXF · STL — sem necessidade de conta",
    later: "Talvez mais tarde",
    close: "Fechar",
  },
  fi: {
    eyebrow: "VALMISTETTU EUROOPASSA · VALMISTUS TILAUKSESTA",
    title: "Tarvitsetko Euroopassa valmistetun osan?",
    body: "Lataa CAD-tiedostosi ja saat kiinteän tarjouksen 24 tunnissa — CNC-koneistus, ohutlevy ja 3D-tulostus, toimitus kaikkialle Eurooppaan.",
    cta: "Pyydä ilmainen tarjous",
    micro: "STEP · IGES · DXF · STL — ei tiliä tarvita",
    later: "Ehkä myöhemmin",
    close: "Sulje",
  },
  sv: {
    eyebrow: "TILLVERKAD I EUROPA · TILLVERKNING PÅ BEGÄRAN",
    title: "Behöver du en detalj tillverkad i Europa?",
    body: "Ladda upp din CAD-fil och få en fast offert inom 24 timmar — CNC-bearbetning, plåt och 3D-printing, levererat i hela Europa.",
    cta: "Få en kostnadsfri offert",
    micro: "STEP · IGES · DXF · STL — inget konto behövs",
    later: "Kanske senare",
    close: "Stäng",
  },
  da: {
    eyebrow: "FREMSTILLET I EUROPA · PRODUKTION PÅ FORESPØRGSEL",
    title: "Har du brug for en del fremstillet i Europa?",
    body: "Upload din CAD-fil og få et fast tilbud inden for 24 timer — CNC-bearbejdning, pladearbejde og 3D-print, leveret i hele Europa.",
    cta: "Få et gratis tilbud",
    micro: "STEP · IGES · DXF · STL — ingen konto nødvendig",
    later: "Måske senere",
    close: "Luk",
  },
  nb: {
    eyebrow: "PRODUSERT I EUROPA · PRODUKSJON PÅ BESTILLING",
    title: "Trenger du en del produsert i Europa?",
    body: "Last opp CAD-filen din og få et fast tilbud innen 24 timer — CNC-maskinering, platearbeid og 3D-printing, levert i hele Europa.",
    cta: "Få et gratis tilbud",
    micro: "STEP · IGES · DXF · STL — ingen konto nødvendig",
    later: "Kanskje senere",
    close: "Lukk",
  },
  cs: {
    eyebrow: "VYROBENO V EVROPĚ · VÝROBA NA VYŽÁDÁNÍ",
    title: "Potřebujete součást vyrobenou v Evropě?",
    body: "Nahrajte svůj CAD soubor a do 24 hodin získáte pevnou cenovou nabídku — CNC obrábění, plechové díly a 3D tisk, doručení po celé Evropě.",
    cta: "Získat nezávaznou nabídku",
    micro: "STEP · IGES · DXF · STL — bez registrace",
    later: "Možná později",
    close: "Zavřít",
  },
  pl: {
    eyebrow: "WYPRODUKOWANE W EUROPIE · PRODUKCJA NA ŻĄDANIE",
    title: "Potrzebujesz części wyprodukowanej w Europie?",
    body: "Prześlij plik CAD i otrzymaj wiążącą wycenę w ciągu 24 godzin — obróbka CNC, blacha i druk 3D, dostawa w całej Europie.",
    cta: "Zamów bezpłatną wycenę",
    micro: "STEP · IGES · DXF · STL — bez zakładania konta",
    later: "Może później",
    close: "Zamknij",
  },
  hu: {
    eyebrow: "EURÓPÁBAN GYÁRTVA · IGÉNY SZERINTI GYÁRTÁS",
    title: "Európában gyártott alkatrészre van szüksége?",
    body: "Töltse fel a CAD-fájlt, és 24 órán belül fix árajánlatot kap — CNC-megmunkálás, lemezmegmunkálás és 3D-nyomtatás, kiszállítás egész Európába.",
    cta: "Kérjen ingyenes árajánlatot",
    micro: "STEP · IGES · DXF · STL — regisztráció nélkül",
    later: "Talán később",
    close: "Bezárás",
  },
};
