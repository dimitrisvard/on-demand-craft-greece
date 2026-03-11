-- Create impressum_settings table to store editable legal notice content
CREATE TABLE IF NOT EXISTS public.impressum_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Universal fields (same across all languages)
  operator_name text NOT NULL DEFAULT 'Dimitrios Vardalachakis',
  company_name text NOT NULL DEFAULT 'MICRONS HUB DV Ε.Ε.',
  address_street text NOT NULL DEFAULT 'Industrial Area Street B Number 4',
  address_zip_city text NOT NULL DEFAULT '71601 Heraklion',
  address_country text NOT NULL DEFAULT 'Griechenland',
  phone text NOT NULL DEFAULT '+302104447830',
  email text NOT NULL DEFAULT 'info@micronshub.eu',
  -- Per-language translated details stored as JSONB
  -- Structure: { "en": { "legal_form_detail": "...", "register_detail": "...", ... }, "de": { ... }, ... }
  translations jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.impressum_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (public legal notice data)
CREATE POLICY "impressum_settings_public_read"
  ON public.impressum_settings FOR SELECT
  USING (true);

-- Allow authenticated users (admins) to insert/update
CREATE POLICY "impressum_settings_auth_write"
  ON public.impressum_settings FOR ALL
  USING (auth.role() = 'authenticated');

-- Insert default row with seed data for all 14 supported languages
INSERT INTO public.impressum_settings (
  operator_name,
  company_name,
  address_street,
  address_zip_city,
  address_country,
  phone,
  email,
  translations
) VALUES (
  'Dimitrios Vardalachakis',
  'MICRONS HUB DV Ε.Ε.',
  'Industrial Area Street B Number 4',
  '71601 Heraklion',
  'Griechenland',
  '+302104447830',
  'info@micronshub.eu',
  jsonb_build_object(
    'en', jsonb_build_object(
      'legal_form_detail', 'Sole Proprietorship (Greek: EE)',
      'register_detail', 'Registered in the General Commercial Register (G.E.MI.) Registration Number: 190254227000',
      'vat_detail', 'VAT Identification Number according to § 27 a Value Added Tax Act: EL803129638',
      'eu_dispute_text', 'The European Commission provides a platform for online dispute resolution (ODR): https://ec.europa.eu/consumers/odr/. You can find our email address in the legal notice above.',
      'consumer_dispute_text', 'We are not willing or obliged to participate in dispute resolution proceedings before a consumer arbitration board.'
    ),
    'de', jsonb_build_object(
      'legal_form_detail', 'Einzelunternehmen (griechisch: EE)',
      'register_detail', 'Eingetragen im Allgemeinen Handelsregister (G.E.MI.) Registernummer: 190254227000',
      'vat_detail', 'Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz: EL803129638',
      'eu_dispute_text', 'Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: https://ec.europa.eu/consumers/odr/. Unsere E-Mail-Adresse finden Sie oben im Impressum.',
      'consumer_dispute_text', 'Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.'
    ),
    'fr', jsonb_build_object(
      'legal_form_detail', 'Entreprise individuelle (grec : EE)',
      'register_detail', 'Inscrit au registre du commerce général (G.E.MI.) Numéro d''enregistrement : 190254227000',
      'vat_detail', 'Numéro d''identification TVA selon l''article 27 a de la loi sur la taxe sur la valeur ajoutée : EL803129638',
      'eu_dispute_text', 'La Commission européenne fournit une plateforme de règlement en ligne des litiges (ODR) : https://ec.europa.eu/consumers/odr/. Vous pouvez trouver notre adresse e-mail dans les mentions légales ci-dessus.',
      'consumer_dispute_text', 'Nous ne sommes pas disposés ou obligés à participer à des procédures de règlement des litiges devant une commission d''arbitrage des consommateurs.'
    ),
    'it', jsonb_build_object(
      'legal_form_detail', 'Ditta individuale (greco: EE)',
      'register_detail', 'Iscritto nel registro commerciale generale (G.E.MI.) Numero di registrazione: 190254227000',
      'vat_detail', 'Numero di identificazione IVA secondo l''articolo 27 a della legge sull''imposta sul valore aggiunto: EL803129638',
      'eu_dispute_text', 'La Commissione europea fornisce una piattaforma per la risoluzione delle controversie online (ODR): https://ec.europa.eu/consumers/odr/. Puoi trovare il nostro indirizzo email nelle note legali sopra.',
      'consumer_dispute_text', 'Non siamo disposti né obbligati a partecipare a procedure di risoluzione delle controversie davanti a una commissione arbitrale dei consumatori.'
    ),
    'pl', jsonb_build_object(
      'legal_form_detail', 'Jednoosobowa działalność gospodarcza (grecki: EE)',
      'register_detail', 'Wpisany do ogólnego rejestru handlowego (G.E.MI.) Numer rejestracyjny: 190254227000',
      'vat_detail', 'Numer identyfikacyjny VAT zgodnie z § 27 a ustawy o podatku od wartości dodanej: EL803129638',
      'eu_dispute_text', 'Komisja Europejska zapewnia platformę do rozstrzygania sporów online (ODR): https://ec.europa.eu/consumers/odr/. Nasz adres e-mail można znaleźć w informacjach prawnych powyżej.',
      'consumer_dispute_text', 'Nie jesteśmy gotowi ani zobowiązani do udziału w postępowaniach dotyczących rozstrzygania sporów przed komisją arbitrażową konsumentów.'
    ),
    'pt', jsonb_build_object(
      'legal_form_detail', 'Empresa individual (grego: EE)',
      'register_detail', 'Registrado no Registro Comercial Geral (G.E.MI.) Número de registro: 190254227000',
      'vat_detail', 'Número de identificação de IVA de acordo com o § 27 a da Lei do Imposto sobre o Valor Agregado: EL803129638',
      'eu_dispute_text', 'A Comissão Europeia fornece uma plataforma para resolução de disputas online (ODR): https://ec.europa.eu/consumers/odr/. Você pode encontrar nosso endereço de e-mail no aviso legal acima.',
      'consumer_dispute_text', 'Não estamos dispostos nem obrigados a participar de procedimentos de resolução de disputas perante uma comissão de arbitragem de consumidores.'
    ),
    'es', jsonb_build_object(
      'legal_form_detail', 'Empresa individual (griego: EE)',
      'register_detail', 'Registrado en el Registro Comercial General (G.E.MI.) Número de registro: 190254227000',
      'vat_detail', 'Número de identificación del IVA según el artículo 27 a de la Ley del Impuesto sobre el Valor Añadido: EL803129638',
      'eu_dispute_text', 'La Comisión Europea proporciona una plataforma para la resolución de disputas en línea (ODR): https://ec.europa.eu/consumers/odr/. Puede encontrar nuestra dirección de correo electrónico en el aviso legal anterior.',
      'consumer_dispute_text', 'No estamos dispuestos ni obligados a participar en procedimientos de resolución de disputas ante una junta de arbitraje de consumidores.'
    ),
    'nl', jsonb_build_object(
      'legal_form_detail', 'Eenmanszaak (Grieks: EE)',
      'register_detail', 'Ingeschreven in het algemene handelsregister (G.E.MI.) Registratienummer: 190254227000',
      'vat_detail', 'BTW-identificatienummer volgens artikel 27 a van de wet op de omzetbelasting: EL803129638',
      'eu_dispute_text', 'De Europese Commissie biedt een platform voor online geschillenbeslechting (ODR): https://ec.europa.eu/consumers/odr/. U kunt ons e-mailadres vinden in de juridische mededeling hierboven.',
      'consumer_dispute_text', 'Wij zijn niet bereid of verplicht om deel te nemen aan geschillenbeslechtingsprocedures voor een consumentenarbitragecommissie.'
    ),
    'cs', jsonb_build_object(
      'legal_form_detail', 'Soukromá firma (řecky: EE)',
      'register_detail', 'Zapsáno v obecném obchodním rejstříku (G.E.MI.) Registrační číslo: 190254227000',
      'vat_detail', 'Identifikační číslo pro DPH podle § 27 a zákona o DPH: EL803129638',
      'eu_dispute_text', 'Evropská komise poskytuje platformu pro online řešení sporů (ODR): https://ec.europa.eu/consumers/odr/. Naši e-mailovou adresu najdete v právním upozornění výše.',
      'consumer_dispute_text', 'Nejsme ochotni ani povinni se účastnit řízení o řešení sporů před spotřebitelskou rozhodčí komisí.'
    ),
    'hu', jsonb_build_object(
      'legal_form_detail', 'Egyéni vállalkozás (görög: EE)',
      'register_detail', 'Bejegyezve az általános kereskedelmi nyilvántartásba (G.E.MI.) Regisztrációs szám: 190254227000',
      'vat_detail', 'ÁFA azonosítószám az általános forgalmi adóról szóló törvény 27. a § szerint: EL803129638',
      'eu_dispute_text', 'Az Európai Bizottság online vitarendezési platformot biztosít (ODR): https://ec.europa.eu/consumers/odr/. E-mail címünket a fenti jogi közleményben találja.',
      'consumer_dispute_text', 'Nem vagyunk hajlandóak vagy kötelezettek részt venni fogyasztói választottbíróság előtti vitarendezési eljárásokban.'
    ),
    'sv', jsonb_build_object(
      'legal_form_detail', 'Enskild firma (grekiska: EE)',
      'register_detail', 'Registrerad i allmänna handelsregistret (G.E.MI.) Registreringsnummer: 190254227000',
      'vat_detail', 'Momsregistreringsnummer enligt § 27 a mervärdesskattelagen: EL803129638',
      'eu_dispute_text', 'Europeiska kommissionen tillhandahåller en plattform för onlinetvistlösning (ODR): https://ec.europa.eu/consumers/odr/. Du kan hitta vår e-postadress i den juridiska informationen ovan.',
      'consumer_dispute_text', 'Vi är inte villiga eller skyldiga att delta i tvistlösningsförfaranden inför en konsumentskiljedomstol.'
    ),
    'nb', jsonb_build_object(
      'legal_form_detail', 'Enkeltpersonforetak (gresk: EE)',
      'register_detail', 'Registrert i det generelle handelsregisteret (G.E.MI.) Registreringsnummer: 190254227000',
      'vat_detail', 'MVA-identifikasjonsnummer i henhold til § 27 a merverdiavgiftsloven: EL803129638',
      'eu_dispute_text', 'Den europeiske kommisjonen gir en plattform for onlinetvistløsning (ODR): https://ec.europa.eu/consumers/odr/. Du kan finne vår e-postadresse i den juridiske informasjonen ovenfor.',
      'consumer_dispute_text', 'Vi er ikke villige eller forpliktet til å delta i tvistløsningsprosedyrer foran en forbrukervoldgiftskommisjon.'
    ),
    'fi', jsonb_build_object(
      'legal_form_detail', 'Yksityinen yritys (kreikka: EE)',
      'register_detail', 'Rekisteröity yleiseen kaupparekisteriin (G.E.MI.) Rekisterinumero: 190254227000',
      'vat_detail', 'Arvonlisäverotunnusnumeron § 27 a arvonlisäverolain mukaisesti: EL803129638',
      'eu_dispute_text', 'Euroopan komissio tarjoaa alustan online-riitojen ratkaisemiseen (ODR): https://ec.europa.eu/consumers/odr/. Löydät sähköpostiosoitteemme yllä olevista oikeudellisista huomautuksista.',
      'consumer_dispute_text', 'Emme ole halukkaita tai velvollisia osallistumaan riitojen ratkaisumenettelyihin kuluttajavälimieslautakunnan edessä.'
    ),
    'da', jsonb_build_object(
      'legal_form_detail', 'Enkeltmandsvirksomhed (græsk: EE)',
      'register_detail', 'Registreret i det generelle handelsregister (G.E.MI.) Registreringsnummer: 190254227000',
      'vat_detail', 'Momsregistreringsnummer i henhold til § 27 a moms lov: EL803129638',
      'eu_dispute_text', 'Den Europæiske Kommission giver en platform til onlinetvistløsning (ODR): https://ec.europa.eu/consumers/odr/. Du kan finde vores e-mailadresse i den juridiske information ovenfor.',
      'consumer_dispute_text', 'Vi er ikke villige eller forpligtet til at deltage i tvistløsningsprocedurer foran en forbruger-voldgiftskommission.'
    )
  )
);
