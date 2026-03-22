/**
 * Multi-language manufacturing keywords for Microns Hub tender relevance scoring
 */

export const MANUFACTURING_KEYWORDS = {
  // English (IE, MT, CY, international)
  en: [
    'CNC machining', 'CNC milling', 'CNC turning', 'CNC lathe', 'CNC router',
    'sheet metal', 'sheet metal fabrication', 'laser cutting', 'plasma cutting', 'waterjet cutting',
    '3D printing', '3D printed', 'additive manufacturing', 'rapid prototyping', 'FDM', 'SLA', 'SLS', 'MJF', 'DMLS',
    'injection molding', 'injection moulding', 'plastic injection', 'die casting', 'vacuum casting',
    'precision parts', 'precision components', 'precision machining', 'precision manufacturing',
    'metal fabrication', 'metal components', 'metal parts', 'machined parts', 'machined components',
    'turned parts', 'milled parts', 'prototype', 'prototyping',
    'aluminum parts', 'aluminium parts', 'stainless steel parts', 'titanium parts', 'brass parts',
    'surface finishing', 'anodizing', 'anodising', 'powder coating', 'electroplating',
    'bending', 'welding', 'stamping', 'extrusion', 'casting',
    'CNC components', 'custom machining', 'batch production', 'low volume manufacturing',
    'metal enclosure', 'metal bracket', 'metal housing', 'custom fabrication',
  ],
  // German (DE, AT, parts of BE/LU)
  de: [
    'CNC-Bearbeitung', 'CNC-Fräsen', 'CNC-Drehen', 'CNC-Frästeile', 'CNC-Drehteile',
    'Blechbearbeitung', 'Blechverarbeitung', 'Laserschneiden', 'Plasmaschneiden', 'Wasserstrahlschneiden',
    '3D-Druck', '3D-Druck-Teile', 'additive Fertigung', 'Rapid Prototyping', 'Prototypenfertigung',
    'Spritzguss', 'Spritzgießen', 'Druckguss', 'Vakuumguss', 'Kunststoffspritzguss',
    'Präzisionsteile', 'Präzisionsbauteile', 'Präzisionsfertigung', 'Präzisionsbearbeitung',
    'Metallverarbeitung', 'Metallbauteile', 'Metallteile', 'Frästeile', 'Drehteile',
    'Zerspanungstechnik', 'Zerspanung', 'Feinmechanik', 'Prototypen',
    'Aluminiumteile', 'Edelstahlteile', 'Titanteile', 'Messingteile',
    'Oberflächenbehandlung', 'Eloxieren', 'Pulverbeschichtung', 'Galvanisierung',
    'Blechbiegen', 'Schweißen', 'Stanzen', 'Metallgehäuse', 'Blechgehäuse',
    'Maschinenbauteile', 'Sonderanfertigung', 'Kleinserien',
  ],
  // French (FR, parts of BE/LU)
  fr: [
    'usinage CNC', 'fraisage CNC', 'tournage CNC', 'pièces CNC', 'pièces fraisées',
    'tôlerie', 'travail de la tôle', 'découpe laser', 'découpe plasma', 'découpe jet d\'eau',
    'impression 3D', 'fabrication additive', 'prototypage rapide', 'prototype',
    'moulage par injection', 'injection plastique', 'moulage sous pression', 'coulée sous vide',
    'pièces de précision', 'composants de précision', 'usinage de précision',
    'fabrication métallique', 'pièces métalliques', 'composants métalliques', 'pièces usinées',
    'pièces tournées', 'pièces en aluminium', 'pièces inox', 'pièces titane',
    'traitement de surface', 'anodisation', 'revêtement en poudre', 'galvanisation',
    'pliage', 'soudage', 'emboutissage', 'boîtier métallique', 'fabrication sur mesure',
    'petites séries', 'production en faible volume',
  ],
  // Italian (IT)
  it: [
    'lavorazione CNC', 'fresatura CNC', 'tornitura CNC', 'pezzi CNC', 'componenti CNC',
    'lavorazione della lamiera', 'lamiera', 'taglio laser', 'taglio plasma', 'taglio a getto d\'acqua',
    'stampa 3D', 'produzione additiva', 'prototipazione rapida', 'prototipo',
    'stampaggio a iniezione', 'iniezione plastica', 'pressofusione', 'colata sottovuoto',
    'parti di precisione', 'componenti di precisione', 'lavorazione di precisione',
    'lavorazione metalli', 'componenti metallici', 'pezzi metallici', 'pezzi lavorati',
    'parti tornite', 'parti fresate', 'parti in alluminio', 'pezzi inox', 'pezzi in titanio',
    'trattamento superficiale', 'anodizzazione', 'verniciatura a polvere',
    'piegatura', 'saldatura', 'stampaggio', 'contenitore metallico', 'produzione su misura',
    'piccole serie', 'produzione in bassa quantità',
  ],
  // Spanish (ES)
  es: [
    'mecanizado CNC', 'fresado CNC', 'torneado CNC', 'piezas CNC', 'componentes CNC',
    'chapa metálica', 'trabajo en chapa', 'corte láser', 'corte plasma', 'corte por agua',
    'impresión 3D', 'fabricación aditiva', 'prototipado rápido', 'prototipo',
    'moldeo por inyección', 'inyección plástico', 'fundición a presión', 'colada al vacío',
    'piezas de precisión', 'componentes de precisión', 'mecanizado de precisión',
    'fabricación metálica', 'componentes metálicos', 'piezas metálicas', 'piezas mecanizadas',
    'piezas torneadas', 'piezas fresadas', 'piezas de aluminio', 'piezas de inox', 'piezas de titanio',
    'tratamiento superficial', 'anodizado', 'pintura en polvo', 'galvanizado',
    'doblado', 'soldadura', 'estampado', 'carcasa metálica', 'fabricación a medida',
    'pequeñas series', 'producción en bajo volumen',
  ],
  // Dutch (NL, parts of BE)
  nl: [
    'CNC-bewerking', 'CNC-frezen', 'CNC-draaien', 'CNC-onderdelen', 'verspaande onderdelen',
    'plaatwerk', 'plaatbewerking', 'lasersnijden', 'plasmaknippen', 'waterstraalsnijden',
    '3D-printen', '3D-printing', 'additieve productie', 'rapid prototyping', 'prototype',
    'spuitgieten', 'kunststof spuitgieten', 'drukgieten', 'vacuümgieten',
    'precisieonderdelen', 'precisiecomponenten', 'precisiefabricage', 'precisiebewerking',
    'metaalbewerking', 'metalen componenten', 'metalen onderdelen', 'bewerkte onderdelen',
    'gedraaide onderdelen', 'gefreesde onderdelen', 'aluminium onderdelen', 'RVS onderdelen',
    'oppervlaktebehandeling', 'anodiseren', 'poedercoating', 'galvaniseren',
    'buigen', 'lassen', 'stansen', 'metalen behuizing', 'maatwerk fabricage',
    'kleine series', 'laag volume productie', 'verspaning',
  ],
  // Polish (PL)
  pl: [
    'obróbka CNC', 'frezowanie CNC', 'toczenie CNC', 'części CNC', 'komponenty CNC',
    'obróbka blachy', 'blacharstwo', 'cięcie laserowe', 'cięcie plazmowe', 'cięcie wodne',
    'druk 3D', 'produkcja addytywna', 'szybkie prototypowanie', 'prototyp',
    'formowanie wtryskowe', 'wtrysk tworzyw', 'odlewanie ciśnieniowe', 'odlewanie próżniowe',
    'części precyzyjne', 'komponenty precyzyjne', 'obróbka precyzyjna',
    'obróbka metali', 'metalowe komponenty', 'metalowe części', 'obrobione części',
    'toczone części', 'frezowane części', 'części aluminiowe', 'części ze stali nierdzewnej',
    'obróbka powierzchni', 'anodowanie', 'malowanie proszkowe', 'galwanizacja',
    'gięcie', 'spawanie', 'tłoczenie', 'obudowa metalowa', 'produkcja na zamówienie',
    'małe serie', 'produkcja niskonakładowa',
  ],
  // Swedish (SE)
  sv: [
    'CNC-bearbetning', 'CNC-fräsning', 'CNC-svarvning', 'CNC-delar', 'bearbetade delar',
    'plåtbearbetning', 'plåtarbete', 'laserskärning', 'plasmaskärning', 'vattenstålskärning',
    '3D-utskrift', '3D-printing', 'additiv tillverkning', 'rapid prototyping', 'prototyp',
    'formsprutning', 'plastformsprutning', 'tryckkgjutning', 'vakuumgjutning',
    'precisionsdelar', 'precisionskomponenter', 'precisionstillverkning',
    'metallbearbetning', 'metallkomponenter', 'metalldelar', 'svarvade delar', 'frästa delar',
    'aluminiumdelar', 'rostfria delar', 'titandelar',
    'ytbehandling', 'anodisering', 'pulverlackning', 'galvanisering',
    'bockning', 'svetsning', 'stansning', 'metallhölje', 'specialtillverkning', 'småserie',
  ],
  // Danish (DK)
  da: [
    'CNC-bearbejdning', 'CNC-fræsning', 'CNC-drejning', 'CNC-dele', 'bearbejdede dele',
    'metalbearbejdning', 'plademetalsarbejde', 'laserskæring', 'plasmaskæring', 'vandstråle',
    '3D-print', '3D-printing', 'additiv fremstilling', 'rapid prototyping', 'prototype',
    'sprøjtestøbning', 'plastindsprøjtning', 'trykstøbning', 'vakuumstøbning',
    'præcisionsdele', 'præcisionskomponenter', 'præcisionsfremstilling',
    'metalkomponenter', 'metaldele', 'drejede dele', 'fræste dele',
    'aluminiumsdele', 'rustfrie stål dele', 'titandele',
    'overfladebehandling', 'anodisering', 'pulverlakering', 'galvanisering',
    'bukning', 'svejsning', 'stansning', 'metalkabinet', 'specialfremstilling', 'småserie',
  ],
  // Finnish (FI)
  fi: [
    'CNC-koneistus', 'CNC-jyrsintä', 'CNC-sorvaus', 'CNC-osat', 'koneistetut osat',
    'ohutlevytyö', 'levytyö', 'laserleikkaus', 'plasmaleikkaus', 'vesisuihkuleikkaus',
    '3D-tulostus', 'lisäävä valmistus', 'pikavalmistus', 'prototyyppi',
    'ruiskuvalu', 'muovien ruiskuvalu', 'painevalanta', 'tyhjiövalanta',
    'tarkkuusosat', 'tarkkuuskomponentit', 'tarkkuuskoneistus',
    'metallintyöstö', 'metalliosat', 'metallikomponentit', 'sorvausosat', 'jyrsintäosat',
    'alumiiniosat', 'ruostumaton teräs osat', 'titaaniosat',
    'pintakäsittely', 'anodisointi', 'jauhemaalaus', 'galvanointi',
    'taivutus', 'hitsaus', 'leimasin', 'metallikotelot', 'erikoisvalmistus', 'piensarjat',
  ],
  // Portuguese (PT)
  pt: [
    'maquinação CNC', 'fresagem CNC', 'torneamento CNC', 'peças CNC',
    'chapa metálica', 'trabalho em chapa', 'corte laser', 'corte plasma', 'corte a jato de água',
    'impressão 3D', 'fabrico aditivo', 'prototipagem rápida', 'protótipo',
    'moldagem por injeção', 'injeção de plástico', 'fundição sob pressão',
    'peças de precisão', 'componentes de precisão', 'maquinação de precisão',
    'fabrico metálico', 'componentes metálicos', 'peças metálicas', 'peças maquinadas',
    'peças de alumínio', 'peças em inox', 'peças de titânio',
    'tratamento de superfície', 'anodização', 'pintura a pó', 'galvanização',
    'dobragem', 'soldadura', 'estampagem', 'caixa metálica', 'fabrico personalizado',
    'pequenas séries', 'produção em baixo volume',
  ],
  // Romanian (RO)
  ro: [
    'prelucrare CNC', 'frezare CNC', 'strunjire CNC', 'piese CNC',
    'tablă metalică', 'prelucrare tablă', 'tăiere laser', 'tăiere plasmă',
    'imprimare 3D', 'fabricare aditivă', 'prototipare rapidă', 'prototip',
    'injecție plastic', 'turnare sub presiune', 'turnare în vid',
    'piese de precizie', 'componente de precizie', 'prelucrare de precizie',
    'prelucrare metale', 'componente metalice', 'piese metalice',
    'piese din aluminiu', 'piese din inox', 'piese din titan',
    'tratament de suprafață', 'anodizare', 'vopsire în pulbere',
    'îndoire', 'sudare', 'ștanțare', 'carcasă metalică', 'fabricație personalizată',
    'serii mici', 'producție volum redus',
  ],
  // Estonian (EE)
  et: [
    'CNC töötlemine', 'CNC freesimine', 'CNC treimismine', 'CNC osad',
    'lehtmetall', 'plekksepa', 'laserlõikus', 'plasmalõikus',
    '3D printimine', 'aditiivne tootmine', 'kiirprototüüpimine', 'prototüüp',
    'süstimisvalamine', 'plastvalamine', 'survevalu',
    'täppis osad', 'täppis komponendid', 'täppis töötlemine',
    'metallitöötlus', 'metallosad', 'metallkomponendid',
    'alumiiniumosad', 'roostevabast terasest osad',
    'pindade viimistlus', 'anodiseerimine', 'pulberkatmine',
    'painutamine', 'keevitamine', 'stantsimisamine',
  ],
  // Norwegian (NO)
  no: [
    'CNC maskinering', 'CNC fresing', 'CNC dreying', 'CNC deler',
    'platearbeid', 'platedeler', 'laserskjæring', 'plasmaskjæring', 'vannstråle',
    '3D-printing', 'additiv produksjon', 'rask prototyping', 'prototyp',
    'sprøytestøping', 'plastsprøyting', 'trykkstøping', 'vakuumstøping',
    'presisjonsbearbeiding', 'presisjonsdeler', 'presisjon komponenter',
    'metallbearbeiding', 'metalldeler', 'metallkomponenter', 'maskineringsdeler',
    'aluminiumsdeler', 'rustfritt stål deler',
    'overflatebehandling', 'anodisering', 'pulverlakkering', 'galvanisering',
    'bøying', 'sveising', 'stansing', 'metallkabinett', 'spesialtilvirkning',
  ],
  // Czech (CZ)
  cs: [
    'CNC obrábění', 'CNC frézování', 'CNC soustružení', 'CNC díly',
    'zpracování plechu', 'plechové díly', 'laserové řezání', 'plazmové řezání',
    '3D tisk', 'aditivní výroba', 'rychlé prototypování', 'prototyp',
    'vstřikování plastů', 'tlakové lití', 'vakuové lití',
    'přesné díly', 'přesné součásti', 'přesné obrábění',
    'obrábění kovů', 'kovové díly', 'kovové součásti', 'soustružené díly',
    'hliníkové díly', 'nerezové díly', 'titanové díly',
    'povrchová úprava', 'anodování', 'práškové lakování', 'galvanizace',
    'ohýbání', 'svařování', 'lisování', 'kovový kryt', 'kusová výroba',
  ],
  // Hungarian (HU)
  hu: [
    'CNC megmunkálás', 'CNC marás', 'CNC esztergálás', 'CNC alkatrészek',
    'lemezfeldolgozás', 'lemezalkatrészek', 'lézervágás', 'plazmavágás',
    '3D nyomtatás', 'additív gyártás', 'rapid prototípus', 'prototípus',
    'fröccsöntés', 'műanyag öntés', 'nyomásos öntés',
    'precíziós alkatrészek', 'precíziós megmunkálás',
    'fémfeldolgozás', 'fémalkatrészek', 'esztergált alkatrészek',
    'alumínium alkatrészek', 'rozsdamentes alkatrészek',
    'felületkezelés', 'anodizálás', 'porfestés', 'galvanizálás',
    'hajlítás', 'hegesztés', 'présalkatrészek', 'fémdoboz', 'egyedi gyártás',
  ],
  // Croatian (HR)
  hr: [
    'CNC obrada', 'CNC glodanje', 'CNC tokarenje', 'CNC dijelovi',
    'obrada limova', 'limarski radovi', 'lasersko rezanje', 'plazmeno rezanje',
    '3D ispis', 'aditivna proizvodnja', 'brzi prototip', 'prototip',
    'injekcijsko prešanje', 'tlačno lijevanje',
    'precizni dijelovi', 'precizna obrada',
    'obrada metala', 'metalni dijelovi', 'tokareni dijelovi',
    'aluminijski dijelovi', 'dijelovi od nehrđajućeg čelika',
    'površinska obrada', 'anodiziranje', 'praškasto lakiranje',
    'savijanje', 'zavarivanje', 'metalno kućište', 'maloserijska proizvodnja',
  ],
  // Slovak (SK)
  sk: [
    'CNC obrábanie', 'CNC frézovanie', 'CNC sústruženie', 'CNC diely',
    'spracovanie plechu', 'plechové diely', 'laserové rezanie', 'plazmové rezanie',
    '3D tlač', 'aditívna výroba', 'rýchle prototypovanie', 'prototyp',
    'vstrekovanie plastov', 'tlakové odlievanie',
    'presné diely', 'presné obrábanie',
    'obrábanie kovov', 'kovové diely', 'sústružené diely',
    'hliníkové diely', 'nerezové diely',
    'povrchová úprava', 'anodovanie', 'práškové lakovanie', 'galvanizácia',
    'ohýbanie', 'zváranie', 'lisovanie', 'kovový kryt', 'kusová výroba',
  ],
  // Slovenian (SI)
  sl: [
    'CNC obdelava', 'CNC rezkanje', 'CNC struženje', 'CNC deli',
    'obdelava pločevine', 'lasersko rezanje', 'plazemsko rezanje',
    '3D tiskanje', 'dodajalna proizvodnja', 'hitri prototip', 'prototip',
    'brizganje plastike', 'tlačno litje',
    'natančni deli', 'natančna obdelava',
    'obdelava kovin', 'kovinski deli', 'struženi deli',
    'aluminijasti deli', 'nerjavni deli',
    'površinska obdelava', 'anodiziranje', 'praškasto lakiranje',
    'upogibanje', 'varjenje', 'kovinski ohišje',
  ],
  // Bulgarian (BG)
  bg: [
    'CNC обработка', 'CNC фрезоване', 'CNC струговане', 'CNC детайли',
    'листов метал', 'обработка на ламарина', 'лазерно рязане', 'плазмено рязане',
    '3D печат', 'адитивно производство', 'бърз прототип', 'прототип',
    'инжекционно формоване', 'леене под налягане',
    'прецизни детайли', 'прецизна обработка',
    'обработка на метали', 'метални детайли', 'стругувани детайли',
    'алуминиеви детайли', 'неръждаеми детайли',
    'повърхностна обработка', 'анодиране', 'прахово боядисване',
    'огъване', 'заваряване', 'метален корпус',
  ],
  // Lithuanian (LT)
  lt: [
    'CNC apdirbimas', 'CNC frezavimas', 'CNC tekinimas', 'CNC detalės',
    'lakštinio metalo apdirbimas', 'lazerinis pjovimas', 'plazminis pjovimas',
    '3D spausdinimas', 'priedinis gamyba', 'greitas prototipas', 'prototipas',
    'injekcinis liejimas', 'spaudimo liejimas',
    'precizinės detalės', 'precizinis apdirbimas',
    'metalų apdirbimas', 'metalinės detalės', 'tekintos detalės',
    'aliuminio detalės', 'nerūdijančio plieno detalės',
    'paviršiaus apdaila', 'anodavimas', 'miltelinė danga',
    'lenkimas', 'suvirinimas', 'metalinis korpusas',
  ],
  // Latvian (LV)
  lv: [
    'CNC apstrāde', 'CNC frēzēšana', 'CNC virpošana', 'CNC detaļas',
    'lokšņu metāls', 'metāla loksnes apstrāde', 'lāzergriešana', 'plazmas griešana',
    '3D drukāšana', 'aditivā ražošana', 'ātrā prototipēšana', 'prototips',
    'injekcijas liešana', 'spiediena liešana',
    'precīzijas detaļas', 'precīzijas apstrāde',
    'metālu apstrāde', 'metāla detaļas', 'virpošanas detaļas',
    'alumīnija detaļas', 'nerūsējošā tērauda detaļas',
    'virsmas apstrāde', 'anodēšana', 'pulverlakošana',
    'locīšana', 'metināšana', 'metāla korpuss',
  ],
};

/**
 * All keywords flattened into one array (with language metadata)
 */
export function getAllKeywords() {
  const result = [];
  for (const [lang, keywords] of Object.entries(MANUFACTURING_KEYWORDS)) {
    for (const kw of keywords) {
      result.push({ keyword: kw, language: lang });
    }
  }
  return result;
}

/**
 * Get all unique keyword strings for matching
 */
export function getFlatKeywords() {
  return Object.values(MANUFACTURING_KEYWORDS).flat();
}
