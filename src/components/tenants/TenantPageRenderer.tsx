import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTenant } from '@/contexts/TenantContext';
import type {
  TenantPageContent,
  TenantPageSection,
  SectionStyles,
  HeroSection,
  ServicesSection,
  StatsSection,
  CtaBannerSection,
  TestimonialsSection,
  FaqSection,
  FeaturesGridSection,
  TimelineSection,
  TeamSection,
  GallerySection,
  LogoCloudSection,
  PricingSection,
  VideoSection,
  ContactInfoSection,
  RichTextSection,
} from '@/types/tenant';
import { useState } from 'react';
import {
  ChevronDown, ChevronUp, Mail, Phone, MapPin,
  CheckCircle2, Play, Quote as QuoteIcon, ArrowRight,
} from 'lucide-react';

// ─── Main Renderer ──────────────────────────────────────────────────────────

interface Props {
  content: TenantPageContent;
}

export default function TenantPageRenderer({ content }: Props) {
  const { tenant } = useTenant();
  const primary = tenant?.primaryColor || '#2563EB';
  const secondary = tenant?.secondaryColor || '#1E40AF';

  return (
    <div className="min-h-screen">
      {content.sections.map((section, idx) => (
        <SectionRenderer
          key={idx}
          section={section}
          primary={primary}
          secondary={secondary}
          tenant={tenant}
        />
      ))}
    </div>
  );
}

// ─── Section Dispatcher ─────────────────────────────────────────────────────

function SectionRenderer(props: {
  section: TenantPageSection;
  primary: string;
  secondary: string;
  tenant: any;
}) {
  const { section, primary, secondary, tenant } = props;
  const p = { primary, secondary, tenant };

  switch (section.type) {
    case 'hero':            return <HeroRenderer s={section} {...p} />;
    case 'services':        return <ServicesRenderer s={section} {...p} />;
    case 'stats':           return <StatsRenderer s={section} {...p} />;
    case 'cta_banner':      return <CtaBannerRenderer s={section} {...p} />;
    case 'testimonials':    return <TestimonialsRenderer s={section} {...p} />;
    case 'faq':             return <FaqRenderer s={section} {...p} />;
    case 'features_grid':   return <FeaturesGridRenderer s={section} {...p} />;
    case 'timeline':        return <TimelineRenderer s={section} {...p} />;
    case 'team':            return <TeamRenderer s={section} {...p} />;
    case 'gallery':         return <GalleryRenderer s={section} {...p} />;
    case 'logo_cloud':      return <LogoCloudRenderer s={section} {...p} />;
    case 'pricing':         return <PricingRenderer s={section} {...p} />;
    case 'video':           return <VideoRenderer s={section} {...p} />;
    case 'contact_info':    return <ContactInfoRenderer s={section} {...p} />;
    case 'rich_text':       return <RichTextRenderer s={section} {...p} />;
    default:                return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type SP = { primary: string; secondary: string; tenant: any };

function sectionStyle(styles?: SectionStyles, fallbackBg?: string): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (styles?.bg_gradient) s.background = styles.bg_gradient;
  else if (styles?.bg_color) s.backgroundColor = styles.bg_color;
  else if (fallbackBg) s.backgroundColor = fallbackBg;
  if (styles?.padding_y) { s.paddingTop = styles.padding_y; s.paddingBottom = styles.padding_y; }
  return s;
}

function isDark(styles?: SectionStyles) {
  return styles?.text_color === 'light';
}

function textClass(styles?: SectionStyles) {
  return isDark(styles) ? 'text-white' : 'text-gray-900';
}

function subTextClass(styles?: SectionStyles) {
  return isDark(styles) ? 'text-white/80' : 'text-gray-600';
}

function containerClass(styles?: SectionStyles) {
  const mw = styles?.max_width;
  if (mw === 'narrow') return 'container mx-auto px-4 max-w-4xl';
  if (mw === 'wide') return 'container mx-auto px-4 max-w-7xl';
  return 'container mx-auto px-4';
}

function cols(n?: number) {
  switch (n) {
    case 2: return 'grid-cols-1 md:grid-cols-2';
    case 4: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    default: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  }
}

// ─── 1. HERO ────────────────────────────────────────────────────────────────

function HeroRenderer({ s, primary, secondary }: { s: HeroSection } & SP) {
  const variant = s.variant || 'left';
  const style = sectionStyle(s.styles, undefined);
  if (!s.styles?.bg_gradient && !s.styles?.bg_color) {
    style.background = `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`;
  }

  const content = (
    <>
      {s.badge_text && (
        <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white mb-4">
          {s.badge_text}
        </span>
      )}
      <h1 className={`font-bold mb-6 ${variant === 'centered' ? 'text-4xl md:text-5xl lg:text-6xl' : 'text-4xl md:text-5xl lg:text-6xl'}`}>
        {s.headline}
      </h1>
      <p className="text-lg md:text-xl mb-8 text-white/90">{s.subheadline}</p>
      <div className="flex flex-wrap gap-4">
        <Link to={s.cta_link}>
          <Button size="lg" className="bg-white text-gray-900 hover:bg-white/90 font-semibold px-8">
            {s.cta_text}
          </Button>
        </Link>
        {s.secondary_cta_text && s.secondary_cta_link && (
          <Link to={s.secondary_cta_link}>
            <Button size="lg" variant="outline" className="border-white text-white hover:bg-white/10 font-semibold px-8">
              {s.secondary_cta_text}
            </Button>
          </Link>
        )}
      </div>
    </>
  );

  return (
    <section className="relative py-24 md:py-32 text-white" style={style}>
      {s.background_image && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${s.background_image})`,
            opacity: s.styles?.bg_overlay_opacity ?? 0.2,
          }}
        />
      )}
      <div className={`${containerClass(s.styles)} relative z-10`}>
        {variant === 'centered' ? (
          <div className="text-center max-w-3xl mx-auto">{content}</div>
        ) : variant === 'split' ? (
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>{content}</div>
            <div className="hidden md:block" />
          </div>
        ) : (
          <div className="max-w-3xl">{content}</div>
        )}
      </div>
    </section>
  );
}

// ─── 2. SERVICES ────────────────────────────────────────────────────────────

function ServicesRenderer({ s, primary }: { s: ServicesSection } & SP) {
  const variant = s.variant || 'cards';

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#ffffff')}>
      <div className={containerClass(s.styles)}>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">{s.title}</h2>
          {s.subtitle && <p className={`text-lg ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        </div>
        <div className={`grid ${cols(s.columns)} gap-8`}>
          {s.items.map((item, i) => {
            if (variant === 'minimal') {
              return (
                <div key={i} className="text-center py-4">
                  <h3 className="text-lg font-semibold mb-2 capitalize">{item.capability.replace(/_/g, ' ')}</h3>
                  <p className={`text-sm ${subTextClass(s.styles)}`}>{item.description}</p>
                </div>
              );
            }
            if (variant === 'icons') {
              return (
                <div key={i} className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: primary }}>
                    {item.icon || item.capability.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1 capitalize">{item.capability.replace(/_/g, ' ')}</h3>
                    <p className={`text-sm ${subTextClass(s.styles)}`}>{item.description}</p>
                  </div>
                </div>
              );
            }
            // cards (default)
            return (
              <div key={i} className="p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow bg-white">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg mb-4" style={{ backgroundColor: primary }}>
                  {item.icon || item.capability.charAt(0).toUpperCase()}
                </div>
                <h3 className="text-lg font-semibold mb-2 capitalize text-gray-900">{item.capability.replace(/_/g, ' ')}</h3>
                <p className="text-gray-600 text-sm">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── 3. STATS ───────────────────────────────────────────────────────────────

function StatsRenderer({ s, primary }: { s: StatsSection } & SP) {
  const variant = s.variant || 'simple';

  return (
    <section className={`py-16 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#f9fafb')}>
      <div className={containerClass(s.styles)}>
        {s.title && <h2 className="text-3xl font-bold text-center mb-12">{s.title}</h2>}
        <div className={`grid grid-cols-2 md:grid-cols-${Math.min(s.items.length, 4)} gap-8`}>
          {s.items.map((item, i) => {
            if (variant === 'cards') {
              return (
                <div key={i} className="text-center p-6 rounded-xl bg-white shadow-sm border border-gray-100">
                  <p className="text-3xl md:text-4xl font-bold" style={{ color: primary }}>{item.value}{item.suffix || ''}</p>
                  <p className="text-gray-600 mt-2 text-sm">{item.label}</p>
                </div>
              );
            }
            if (variant === 'bordered') {
              return (
                <div key={i} className="text-center p-6 border-l-4" style={{ borderColor: primary }}>
                  <p className="text-3xl md:text-4xl font-bold" style={{ color: primary }}>{item.value}{item.suffix || ''}</p>
                  <p className={`mt-2 ${subTextClass(s.styles)}`}>{item.label}</p>
                </div>
              );
            }
            // simple
            return (
              <div key={i} className="text-center">
                <p className="text-3xl md:text-4xl font-bold" style={{ color: primary }}>{item.value}{item.suffix || ''}</p>
                <p className={`mt-2 ${subTextClass(s.styles)}`}>{item.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── 4. CTA BANNER ──────────────────────────────────────────────────────────

function CtaBannerRenderer({ s, primary, secondary }: { s: CtaBannerSection } & SP) {
  const variant = s.variant || 'solid';
  const style = sectionStyle(s.styles, undefined);

  if (variant === 'gradient' && !s.styles?.bg_gradient && !s.styles?.bg_color) {
    style.background = `linear-gradient(135deg, ${primary}, ${secondary})`;
  } else if (!s.styles?.bg_gradient && !s.styles?.bg_color) {
    style.backgroundColor = primary;
  }

  const isOutlined = variant === 'outlined';

  return (
    <section
      className={`py-16 md:py-20 ${isOutlined ? '' : 'text-white'}`}
      style={isOutlined ? sectionStyle(s.styles, '#ffffff') : style}
    >
      <div className={`${containerClass(s.styles)} text-center`}>
        {isOutlined ? (
          <div className="border-2 rounded-2xl p-12" style={{ borderColor: primary }}>
            <h2 className="text-3xl font-bold mb-3" style={{ color: primary }}>{s.headline}</h2>
            {s.subheadline && <p className="text-gray-600 mb-6 text-lg">{s.subheadline}</p>}
            <Link to={s.cta_link}>
              <Button size="lg" className="font-semibold px-8 text-white" style={{ backgroundColor: primary }}>{s.cta_text}</Button>
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-3xl font-bold mb-3">{s.headline}</h2>
            {s.subheadline && <p className="text-white/80 mb-6 text-lg">{s.subheadline}</p>}
            <Link to={s.cta_link}>
              <Button size="lg" className="bg-white text-gray-900 hover:bg-white/90 font-semibold px-8">{s.cta_text}</Button>
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

// ─── 5. TESTIMONIALS ────────────────────────────────────────────────────────

function TestimonialsRenderer({ s, primary }: { s: TestimonialsSection } & SP) {
  const [activeIdx, setActiveIdx] = useState(0);
  if (s.items.length === 0) return null;
  const variant = s.variant || 'cards';

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#ffffff')}>
      <div className={containerClass(s.styles)}>
        {s.title && <h2 className="text-3xl font-bold text-center mb-12">{s.title || 'What Our Customers Say'}</h2>}

        {variant === 'single' ? (
          <div className="max-w-2xl mx-auto text-center">
            <QuoteIcon className="h-10 w-10 mx-auto mb-6 opacity-20" />
            <p className="text-xl italic mb-6">"{s.items[activeIdx].quote}"</p>
            <p className="font-semibold">{s.items[activeIdx].name}</p>
            {s.items[activeIdx].role && <p className="text-sm text-gray-500">{s.items[activeIdx].role}</p>}
            <p className="text-sm text-gray-500">{s.items[activeIdx].company}</p>
            {s.items.length > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                {s.items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className="w-3 h-3 rounded-full transition-colors"
                    style={{ backgroundColor: i === activeIdx ? primary : '#d1d5db' }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : variant === 'quotes' ? (
          <div className="space-y-8 max-w-3xl mx-auto">
            {s.items.map((item, i) => (
              <div key={i} className="flex gap-4">
                <div className="shrink-0 w-1 rounded-full" style={{ backgroundColor: primary }} />
                <div>
                  <p className="text-lg italic mb-2">"{item.quote}"</p>
                  <p className="font-semibold text-sm">{item.name} {item.role ? `— ${item.role}` : ''}, {item.company}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`grid ${cols(Math.min(s.items.length, 3) as 2 | 3)} gap-8`}>
            {s.items.map((item, i) => (
              <div key={i} className="p-6 rounded-xl border border-gray-100 shadow-sm bg-white">
                <div className="flex items-center gap-3 mb-4">
                  {item.avatar ? (
                    <img src={item.avatar} alt={item.name} className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: primary }}>
                      {item.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">{item.name}</p>
                    {item.role && <p className="text-xs text-gray-500">{item.role}</p>}
                    <p className="text-xs text-gray-500">{item.company}</p>
                  </div>
                </div>
                <p className="text-gray-600 italic text-sm">"{item.quote}"</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── 6. FAQ ─────────────────────────────────────────────────────────────────

function FaqRenderer({ s, primary }: { s: FaqSection } & SP) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (s.items.length === 0) return null;

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#f9fafb')}>
      <div className={containerClass(s.styles)} style={{ maxWidth: '768px' }}>
        {s.title && <h2 className="text-3xl font-bold text-center mb-3">{s.title}</h2>}
        {s.subtitle && <p className={`text-center mb-10 ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        {!s.title && <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>}
        <div className="space-y-3">
          {s.items.map((item, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
              <button
                className="w-full flex justify-between items-center p-5 text-left hover:bg-gray-50 transition-colors"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span className="font-medium pr-4">{item.question}</span>
                {openIndex === i
                  ? <ChevronUp className="h-5 w-5 shrink-0" style={{ color: primary }} />
                  : <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" />}
              </button>
              {openIndex === i && (
                <div className="px-5 pb-5 text-gray-600 leading-relaxed">{item.answer}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 7. FEATURES GRID ───────────────────────────────────────────────────────

function FeaturesGridRenderer({ s, primary }: { s: FeaturesGridSection } & SP) {
  const variant = s.variant || 'icons_top';

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#ffffff')}>
      <div className={containerClass(s.styles)}>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">{s.title}</h2>
          {s.subtitle && <p className={`text-lg ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        </div>
        <div className={`grid ${cols(s.columns)} gap-8`}>
          {s.items.map((item, i) => {
            if (variant === 'numbered') {
              return (
                <div key={i} className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ backgroundColor: primary }}>
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className={`text-sm ${subTextClass(s.styles)}`}>{item.description}</p>
                  </div>
                </div>
              );
            }
            if (variant === 'icons_left') {
              return (
                <div key={i} className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${primary}15`, color: primary }}>
                    <span className="text-lg font-bold">{item.icon || item.title.charAt(0)}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className={`text-sm ${subTextClass(s.styles)}`}>{item.description}</p>
                  </div>
                </div>
              );
            }
            // icons_top (default)
            return (
              <div key={i} className="text-center p-6">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${primary}15`, color: primary }}>
                  <span className="text-2xl font-bold">{item.icon || item.title.charAt(0)}</span>
                </div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className={`text-sm ${subTextClass(s.styles)}`}>{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── 8. TIMELINE ────────────────────────────────────────────────────────────

function TimelineRenderer({ s, primary }: { s: TimelineSection } & SP) {
  const isHorizontal = s.variant === 'horizontal';

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#ffffff')}>
      <div className={containerClass(s.styles)}>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">{s.title}</h2>
          {s.subtitle && <p className={`text-lg ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        </div>

        {isHorizontal ? (
          <div className="flex overflow-x-auto gap-6 pb-4">
            {s.items.map((item, i) => (
              <div key={i} className="min-w-[220px] flex-shrink-0 text-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold mx-auto mb-3" style={{ backgroundColor: primary }}>
                  {item.step || String(i + 1)}
                </div>
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className={`text-sm ${subTextClass(s.styles)}`}>{item.description}</p>
                {i < s.items.length - 1 && (
                  <ArrowRight className="h-5 w-5 mx-auto mt-3 text-gray-300" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {s.items.map((item, i) => (
              <div key={i} className="flex gap-4 mb-8 last:mb-0">
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ backgroundColor: primary }}>
                    {item.step || String(i + 1)}
                  </div>
                  {i < s.items.length - 1 && <div className="w-0.5 flex-1 mt-2" style={{ backgroundColor: `${primary}30` }} />}
                </div>
                <div className="pb-8">
                  <h3 className="font-semibold mb-1">{item.title}</h3>
                  <p className={`text-sm ${subTextClass(s.styles)}`}>{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── 9. TEAM ────────────────────────────────────────────────────────────────

function TeamRenderer({ s, primary }: { s: TeamSection } & SP) {
  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#f9fafb')}>
      <div className={containerClass(s.styles)}>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">{s.title}</h2>
          {s.subtitle && <p className={`text-lg ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        </div>
        <div className={`grid ${cols(Math.min(s.items.length, 4) as 2 | 3 | 4)} gap-8`}>
          {s.items.map((member, i) => (
            <div key={i} className="text-center">
              {member.image ? (
                <img src={member.image} alt={member.name} className="w-32 h-32 rounded-full object-cover mx-auto mb-4" />
              ) : (
                <div className="w-32 h-32 rounded-full flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4" style={{ backgroundColor: primary }}>
                  {member.name.charAt(0)}
                </div>
              )}
              <h3 className="font-semibold">{member.name}</h3>
              <p className="text-sm" style={{ color: primary }}>{member.role}</p>
              {member.bio && <p className={`text-sm mt-2 ${subTextClass(s.styles)}`}>{member.bio}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 10. GALLERY ────────────────────────────────────────────────────────────

function GalleryRenderer({ s }: { s: GallerySection } & SP) {
  if (s.items.length === 0) return null;

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#ffffff')}>
      <div className={containerClass(s.styles)}>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">{s.title}</h2>
          {s.subtitle && <p className={`text-lg ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        </div>
        <div className={`grid ${cols(s.columns)} gap-4`}>
          {s.items.map((item, i) => (
            <div key={i} className="group relative overflow-hidden rounded-lg aspect-video bg-gray-100">
              <img
                src={item.image_url}
                alt={item.alt || item.caption || ''}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              {item.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                  <p className="text-white text-sm">{item.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 11. LOGO CLOUD ─────────────────────────────────────────────────────────

function LogoCloudRenderer({ s }: { s: LogoCloudSection } & SP) {
  if (s.items.length === 0) return null;

  return (
    <section className={`py-12 md:py-16 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#f9fafb')}>
      <div className={containerClass(s.styles)}>
        {s.title && <h2 className="text-xl font-semibold text-center mb-2">{s.title}</h2>}
        {s.subtitle && <p className={`text-center text-sm mb-8 ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12">
          {s.items.map((item, i) => {
            const img = (
              <img
                src={item.logo_url}
                alt={item.name}
                className="h-10 md:h-12 object-contain grayscale hover:grayscale-0 opacity-60 hover:opacity-100 transition-all"
              />
            );
            return item.link ? (
              <a key={i} href={item.link} target="_blank" rel="noopener noreferrer">{img}</a>
            ) : (
              <div key={i}>{img}</div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── 12. PRICING ────────────────────────────────────────────────────────────

function PricingRenderer({ s, primary }: { s: PricingSection } & SP) {
  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#ffffff')}>
      <div className={containerClass(s.styles)}>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">{s.title}</h2>
          {s.subtitle && <p className={`text-lg ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        </div>
        <div className={`grid ${cols(Math.min(s.items.length, 3) as 2 | 3)} gap-8 max-w-5xl mx-auto`}>
          {s.items.map((plan, i) => (
            <div
              key={i}
              className={`rounded-2xl border p-8 flex flex-col ${
                plan.is_featured ? 'border-2 shadow-lg scale-105' : 'border-gray-200 shadow-sm'
              }`}
              style={plan.is_featured ? { borderColor: primary } : {}}
            >
              {plan.is_featured && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full text-white self-start mb-4" style={{ backgroundColor: primary }}>
                  Most Popular
                </span>
              )}
              <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
              <div className="mb-4">
                <span className="text-4xl font-bold" style={{ color: primary }}>{plan.price}</span>
                {plan.period && <span className={`text-sm ${subTextClass(s.styles)}`}> / {plan.period}</span>}
              </div>
              {plan.description && <p className={`text-sm mb-6 ${subTextClass(s.styles)}`}>{plan.description}</p>}
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: primary }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to={plan.cta_link}>
                <Button className="w-full font-semibold text-white" style={{ backgroundColor: primary }}>
                  {plan.cta_text}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 13. VIDEO ──────────────────────────────────────────────────────────────

function VideoRenderer({ s, primary }: { s: VideoSection } & SP) {
  const [playing, setPlaying] = useState(false);

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#111827')}>
      <div className={containerClass(s.styles)} style={{ maxWidth: '960px' }}>
        {s.title && <h2 className={`text-3xl font-bold text-center mb-3 ${isDark(s.styles) || !s.styles ? 'text-white' : ''}`}>{s.title}</h2>}
        {s.subtitle && <p className="text-center text-gray-400 mb-8">{s.subtitle}</p>}
        <div className="relative aspect-video rounded-xl overflow-hidden bg-black shadow-2xl">
          {playing ? (
            <iframe
              src={s.video_url}
              className="w-full h-full"
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          ) : (
            <button
              onClick={() => setPlaying(true)}
              className="w-full h-full flex items-center justify-center group"
            >
              {s.poster_image && (
                <img src={s.poster_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors" />
              <div className="relative w-20 h-20 rounded-full flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: primary }}>
                <Play className="h-8 w-8 ml-1" fill="white" />
              </div>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── 14. CONTACT INFO ───────────────────────────────────────────────────────

function ContactInfoRenderer({ s, primary, tenant }: { s: ContactInfoSection } & SP) {
  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#f9fafb')}>
      <div className={containerClass(s.styles)} style={{ maxWidth: '768px' }}>
        {s.title && <h2 className="text-3xl font-bold text-center mb-3">{s.title}</h2>}
        {s.subtitle && <p className={`text-center mb-10 ${subTextClass(s.styles)}`}>{s.subtitle}</p>}
        <div className="grid md:grid-cols-3 gap-8">
          {(s.show_email !== false) && tenant?.contactEmail && (
            <div className="text-center p-6 rounded-xl bg-white shadow-sm border border-gray-100">
              <Mail className="h-6 w-6 mx-auto mb-3" style={{ color: primary }} />
              <p className="font-semibold mb-1">Email</p>
              <p className="text-sm text-gray-600">{tenant.contactEmail}</p>
            </div>
          )}
          {(s.show_phone !== false) && tenant?.contactPhone && (
            <div className="text-center p-6 rounded-xl bg-white shadow-sm border border-gray-100">
              <Phone className="h-6 w-6 mx-auto mb-3" style={{ color: primary }} />
              <p className="font-semibold mb-1">Phone</p>
              <p className="text-sm text-gray-600">{tenant.contactPhone}</p>
            </div>
          )}
          {(s.show_address !== false) && tenant?.address && (
            <div className="text-center p-6 rounded-xl bg-white shadow-sm border border-gray-100">
              <MapPin className="h-6 w-6 mx-auto mb-3" style={{ color: primary }} />
              <p className="font-semibold mb-1">Address</p>
              <p className="text-sm text-gray-600">{tenant.address}</p>
            </div>
          )}
        </div>
        {s.custom_fields && s.custom_fields.length > 0 && (
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            {s.custom_fields.map((f, i) => (
              <div key={i} className="flex justify-between p-3 bg-white rounded-lg border border-gray-100">
                <span className="font-medium text-sm">{f.label}</span>
                <span className="text-sm text-gray-600">{f.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── 15. RICH TEXT ──────────────────────────────────────────────────────────

function RichTextRenderer({ s }: { s: RichTextSection } & SP) {
  const align = s.text_align || 'left';

  return (
    <section className={`py-16 md:py-24 ${textClass(s.styles)}`} style={sectionStyle(s.styles, '#ffffff')}>
      <div className={containerClass(s.styles)} style={{ maxWidth: '768px' }}>
        {s.title && (
          <h2 className={`text-3xl font-bold mb-6 ${align === 'center' ? 'text-center' : ''}`}>{s.title}</h2>
        )}
        <div className={`prose prose-gray max-w-none ${align === 'center' ? 'text-center' : ''}`}>
          {s.content.split('\n').map((para, i) => (
            para.trim() ? <p key={i} className={subTextClass(s.styles)}>{para}</p> : <br key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
