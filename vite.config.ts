import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// All supported languages and their URL slugs
// (from src/locales/{lang}/translation.json url_slug_* keys)
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'] as const;

const SLUGS: Record<string, Record<string, string>> = {
	en: { services: 'services', about: 'about', contact: 'contact', quote: 'quote', industries: 'industries', ourWork: 'our-work', blog: 'blog', cnc: 'cnc-machining', sheetMetal: 'sheet-metal', printing: '3d-printing', injection: 'injection-molding', surface: 'surface-finishes', rapid: 'rapid-prototyping' },
	de: { services: 'dienstleistungen', about: 'ueber-uns', contact: 'kontakt', quote: 'angebot', industries: 'branchen', ourWork: 'unsere-arbeit', blog: 'blog', cnc: 'cnc-bearbeitung', sheetMetal: 'blechbearbeitung', printing: '3d-druck', injection: 'spritzguss', surface: 'oberflaechenveredelung', rapid: 'rapid-prototyping' },
	fr: { services: 'services', about: 'a-propos', contact: 'contact', quote: 'devis', industries: 'secteurs', ourWork: 'notre-travail', blog: 'blog', cnc: 'usinage-cnc', sheetMetal: 'tolerie', printing: 'impression-3d', injection: 'injection-plastique', surface: 'finition-surface', rapid: 'prototypage-rapide' },
	es: { services: 'servicios', about: 'sobre-nosotros', contact: 'contacto', quote: 'cotizacion', industries: 'industrias', ourWork: 'nuestro-trabajo', blog: 'blog', cnc: 'mecanizado-cnc', sheetMetal: 'chapa-metalica', printing: 'impresion-3d', injection: 'moldeo-por-inyeccion', surface: 'acabados-superficie', rapid: 'prototipado-rapido' },
	it: { services: 'servizi', about: 'chi-siamo', contact: 'contatto', quote: 'preventivo', industries: 'settori', ourWork: 'i-nostri-lavori', blog: 'blog', cnc: 'lavorazione-cnc', sheetMetal: 'lavorazione-lamiera', printing: 'stampa-3d', injection: 'stampaggio-iniezione', surface: 'finitura-superficie', rapid: 'prototipazione-rapida' },
	nl: { services: 'diensten', about: 'over-ons', contact: 'contact', quote: 'offerte', industries: 'branches', ourWork: 'ons-werk', blog: 'blog', cnc: 'cnc-bewerking', sheetMetal: 'plaatbewerking', printing: '3d-printen', injection: 'spuitgieten', surface: 'oppervlakteafwerking', rapid: 'rapid-prototyping' },
	pl: { services: 'uslugi', about: 'o-nas', contact: 'kontakt', quote: 'wycena', industries: 'branze', ourWork: 'nasza-praca', blog: 'blog', cnc: 'obrobka-cnc', sheetMetal: 'obrobka-bluzy', printing: 'druk-3d', injection: 'wtrysk-tworzywa', surface: 'wykonczenie-powierzchni', rapid: 'szybkie-prototypowanie' },
	pt: { services: 'servicos', about: 'sobre-nos', contact: 'contato', quote: 'orcamento', industries: 'industrias', ourWork: 'nosso-trabalho', blog: 'blog', cnc: 'usinagem-cnc', sheetMetal: 'chapa-metalica', printing: 'impressao-3d', injection: 'moldagem-injecao', surface: 'acabamento-superficie', rapid: 'prototipagem-rapida' },
	sv: { services: 'tjanster', about: 'om-oss', contact: 'kontakt', quote: 'offert', industries: 'branscher', ourWork: 'vart-arbete', blog: 'blogg', cnc: 'cnc-bearbetning', sheetMetal: 'platbearbetning', printing: '3d-skrivning', injection: 'formsprutning', surface: 'ytbehandling', rapid: 'snabb-prototypering' },
	da: { services: 'tjenester', about: 'om-os', contact: 'kontakt', quote: 'tilbud', industries: 'brancher', ourWork: 'vores-arbejde', blog: 'blog', cnc: 'cnc-bearbejdning', sheetMetal: 'pladearbejde', printing: '3d-printing', injection: 'sprojtestobning', surface: 'overfladebehandling', rapid: 'hurtig-prototypering' },
	fi: { services: 'palvelut', about: 'meista', contact: 'yhteys', quote: 'tarjous', industries: 'toimialat', ourWork: 'tyomme', blog: 'blogi', cnc: 'cnc-työstö', sheetMetal: 'levytyöstö', printing: '3d-tulostus', injection: 'ruiskupuristus', surface: 'pinnan-viimeistely', rapid: 'nopea-prototyyppaus' },
	nb: { services: 'tjenester', about: 'om-oss', contact: 'kontakt', quote: 'tilbud', industries: 'bransjer', ourWork: 'vart-arbeid', blog: 'blogg', cnc: 'cnc-bearbeiding', sheetMetal: 'platarbeid', printing: '3d-printing', injection: 'sproytestoping', surface: 'overflatebehandling', rapid: 'rask-prototyping' },
	hu: { services: 'szolgaltatasok', about: 'rolunk', contact: 'kapcsolat', quote: 'ajanlat', industries: 'iparagak', ourWork: 'munkaink', blog: 'blog', cnc: 'cnc-megmunkalas', sheetMetal: 'lemezfeldolgozas', printing: '3d-nyomtas', injection: 'frccsnyomas', surface: 'feluletkezeles', rapid: 'gyors-prototipus' },
	cs: { services: 'sluzby', about: 'o-nas', contact: 'kontakt', quote: 'nabidka', industries: 'prumysl', ourWork: 'nase-prace', blog: 'blog', cnc: 'cnc-obrabeni', sheetMetal: 'obrabeni-plechu', printing: '3d-tisk', injection: 'vstrekovani', surface: 'uprava-povrchu', rapid: 'rychle-prototypovani' },
};

// Generate all prerender routes: 14 languages × 15 page types = 210 URLs
// Uses TRANSLATED slugs (canonical URLs) so Google indexes the correct canonical pages
function buildPrerenderRoutes(): string[] {
	const routes: string[] = [];
	for (const lang of LANGUAGES) {
		const s = SLUGS[lang];
		routes.push(`/${lang}`);
		routes.push(`/${lang}/${s.services}`);
		routes.push(`/${lang}/${s.services}/${s.cnc}`);
		routes.push(`/${lang}/${s.services}/${s.sheetMetal}`);
		routes.push(`/${lang}/${s.services}/${s.printing}`);
		routes.push(`/${lang}/${s.services}/${s.injection}`);
		routes.push(`/${lang}/${s.services}/${s.surface}`);
		routes.push(`/${lang}/${s.services}/${s.rapid}`);
		routes.push(`/${lang}/${s.industries}`);
		routes.push(`/${lang}/${s.about}`);
		routes.push(`/${lang}/${s.contact}`);
		routes.push(`/${lang}/${s.ourWork}`);
		routes.push(`/${lang}/${s.blog}`);
		routes.push(`/${lang}/${s.quote}`);
		routes.push(`/${lang}/quote-request`);
	}
	return routes;
}

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
	// Load env file based on `mode` in the current working directory.
	// Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
	const env = loadEnv(mode, process.cwd(), '');

	console.log('Loaded environment variables:', {
		region: env.VITE_AWS_REGION,
		bucket: env.VITE_AWS_BUCKET_NAME,
		hasAccessKey: !!env.VITE_AWS_ACCESS_KEY_ID,
		hasSecretKey: !!env.VITE_AWS_SECRET_ACCESS_KEY
	});

	// Load prerender plugin only for production builds (not dev/preview)
	// Requires Chromium to be available (set PUPPETEER_SKIP_DOWNLOAD=false on Vercel)
	const prerenderPlugin = await (async () => {
		if (mode !== 'production') return null;
		try {
			const [{ default: PrerenderPlugin }, { default: JSDomRenderer }] = await Promise.all([
				import('@prerenderer/rollup-plugin'),
				import('@prerenderer/renderer-jsdom'),
			]);
			return PrerenderPlugin({
				routes: buildPrerenderRoutes(),
				renderer: new JSDomRenderer({
					renderAfterTime: 5000,
				}),
				server: {
					port: 19001,
				},
			});
		} catch (e) {
			console.warn('[vite] Prerendering skipped — @prerenderer/rollup-plugin or jsdom not available:', (e as Error).message ?? e);
			return null;
		}
	})();

	return {
		server: {
			host: "::",
			port: 8080,
		},
		preview: {
			port: 8080,
		},
		build: {
			target: 'es2020',
			sourcemap: false,
			minify: 'esbuild',
			cssCodeSplit: true,
			rollupOptions: {
				output: {
					// Split heavy / rarely-used dependencies into their own chunks so the
					// initial bundle stays small and Lighthouse "unused JavaScript" drops.
					manualChunks(id) {
						if (!id.includes('node_modules')) return undefined;
						if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router')) return 'vendor-react';
						if (id.includes('@radix-ui')) return 'vendor-radix';
						if (id.includes('@supabase')) return 'vendor-supabase';
						if (id.includes('@tanstack')) return 'vendor-query';
						if (id.includes('react-i18next') || id.includes('i18next')) return 'vendor-i18n';
						if (id.includes('lucide-react')) return 'vendor-icons';
						// Heavy editor / 3D / PDF / file-processing libs are only needed on
						// specific routes — split them so they aren't in the homepage bundle.
						if (id.includes('three') || id.includes('@react-three') || id.includes('postprocessing')) return 'vendor-three';
						if (id.includes('jspdf') || id.includes('html2pdf') || id.includes('html2canvas') || id.includes('pdf-lib')) return 'vendor-pdf';
						if (id.includes('xlsx') || id.includes('papaparse') || id.includes('jszip')) return 'vendor-data';
						if (id.includes('react-quill') || id.includes('quill')) return 'vendor-editor';
						if (id.includes('@aws-sdk')) return 'vendor-aws';
						if (id.includes('occt-import-js') || id.includes('makerjs') || id.includes('dxf-parser') || id.includes('clipper-lib') || id.includes('@gltf-transform')) return 'vendor-cad';
						if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
						if (id.includes('formik') || id.includes('react-hook-form') || id.includes('yup') || id.includes('zod') || id.includes('@hookform')) return 'vendor-forms';
						return 'vendor';
					},
				},
			},
		},
		plugins: [
			react(),
			mode === 'development' && componentTagger(),
			// Prerender plugin: generates static HTML for all 210 routes at build time
			// so crawlers (Googlebot, Bing, social preview fetchers) see full page content
			// without needing to execute JavaScript.
			...(prerenderPlugin ? [prerenderPlugin] : []),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
		define: {
			'process.env': env,
			'import.meta.env': env
		}
	};
});
