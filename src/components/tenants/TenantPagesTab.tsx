import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Sparkles, Eye, Pencil, Globe, Layers } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { getTenantPages, upsertTenantPage, publishTenantPage } from '@/utils/tenantApi';
import TenantPageRenderer from '@/components/tenants/TenantPageRenderer';
import type { TenantPage, TenantPageContent } from '@/types/tenant';

interface Props {
  tenantId: string;
  tenantName: string;
}

interface GenForm {
  description: string;
  audience: string;
  selling_points: string;
  tone: 'professional' | 'friendly' | 'technical';
  language: string;
  style: 'modern' | 'classic' | 'bold';
  include_team: boolean;
  include_testimonials: boolean;
  include_pricing: boolean;
  include_timeline: boolean;
  include_video: boolean;
  video_url: string;
  team_size: string;
  years_experience: string;
}

export default function TenantPagesTab({ tenantId, tenantName }: Props) {
  const [pages, setPages] = useState<TenantPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editPage, setEditPage] = useState<TenantPage | null>(null);
  const [editJson, setEditJson] = useState('');
  const [previewPage, setPreviewPage] = useState<TenantPage | null>(null);
  const { toast } = useToast();

  const [genForm, setGenForm] = useState<GenForm>({
    description: '',
    audience: '',
    selling_points: '',
    tone: 'professional',
    language: 'en',
    style: 'modern',
    include_team: false,
    include_testimonials: true,
    include_pricing: false,
    include_timeline: true,
    include_video: false,
    video_url: '',
    team_size: '',
    years_experience: '',
  });

  useEffect(() => { loadPages(); }, [tenantId]);

  const loadPages = async () => {
    try {
      setLoading(true);
      const data = await getTenantPages(tenantId);
      setPages(data);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const pageTemplates = [
        { slug: 'home', title: 'Homepage' },
        { slug: 'about', title: 'About Us' },
        { slug: 'services', title: 'Services' },
        { slug: 'contact', title: 'Contact' },
      ];

      for (const template of pageTemplates) {
        const content = generatePageContent(template.slug, tenantName, genForm);
        await upsertTenantPage({
          tenant_id: tenantId,
          slug: template.slug,
          title: template.title,
          content,
          language: genForm.language,
          is_published: false,
        });
      }

      toast({ title: 'Pages generated', description: '4 pages created with all selected sections. Preview and publish when ready.' });
      loadPages();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async (pageId: string) => {
    try {
      await publishTenantPage(pageId);
      toast({ title: 'Published' });
      loadPages();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleEditSave = async () => {
    if (!editPage) return;
    try {
      const content = JSON.parse(editJson);
      await upsertTenantPage({
        ...editPage,
        content,
        version: editPage.version + 1,
      });
      toast({ title: 'Page updated' });
      setEditPage(null);
      loadPages();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error instanceof SyntaxError ? 'Invalid JSON format' : error.message,
        variant: 'destructive',
      });
    }
  };

  const set = <K extends keyof GenForm>(key: K, val: GenForm[K]) =>
    setGenForm((prev) => ({ ...prev, [key]: val }));

  return (
    <div className="space-y-6">
      {/* AI Generation Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Landing Page Generator
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure options below and generate 4 branded pages (Homepage, About, Services, Contact).
            Each page uses 8-12 section types with your tenant's brand colors.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Row 1: Core info */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Company Description *</Label>
              <Textarea value={genForm.description} onChange={(e) => set('description', e.target.value)}
                placeholder="We are a precision CNC manufacturing company specializing in aerospace and automotive parts..."
                rows={3} />
            </div>
            <div>
              <Label>Target Audience</Label>
              <Textarea value={genForm.audience} onChange={(e) => set('audience', e.target.value)}
                placeholder="Mechanical engineers, procurement managers at automotive OEMs..."
                rows={3} />
            </div>
            <div>
              <Label>Key Selling Points</Label>
              <Textarea value={genForm.selling_points} onChange={(e) => set('selling_points', e.target.value)}
                placeholder="ISO 9001 certified, 5-axis CNC, 48h express delivery, 15+ materials..."
                rows={3} />
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Years Experience</Label>
                  <Input value={genForm.years_experience} onChange={(e) => set('years_experience', e.target.value)}
                    placeholder="10" type="number" />
                </div>
                <div>
                  <Label>Team Size</Label>
                  <Input value={genForm.team_size} onChange={(e) => set('team_size', e.target.value)}
                    placeholder="25" type="number" />
                </div>
              </div>
              <div>
                <Label>Video URL (YouTube/Vimeo embed)</Label>
                <Input value={genForm.video_url} onChange={(e) => set('video_url', e.target.value)}
                  placeholder="https://www.youtube.com/embed/..." />
              </div>
            </div>
          </div>

          {/* Row 2: Style & Tone */}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Visual Style</Label>
              <Select value={genForm.style} onValueChange={(v: any) => set('style', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="modern">Modern (gradient hero, clean cards)</SelectItem>
                  <SelectItem value="classic">Classic (solid colors, bordered stats)</SelectItem>
                  <SelectItem value="bold">Bold (dark backgrounds, large text)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tone</Label>
              <Select value={genForm.tone} onValueChange={(v: any) => set('tone', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Language</Label>
              <Select value={genForm.language} onValueChange={(v) => set('language', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="el">Greek</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="it">Italian</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 3: Section toggles */}
          <div>
            <Label className="mb-3 block">Include Sections</Label>
            <div className="flex flex-wrap gap-6">
              <SwitchField label="Process Timeline" checked={genForm.include_timeline} onChange={(v) => set('include_timeline', v)} />
              <SwitchField label="Testimonials" checked={genForm.include_testimonials} onChange={(v) => set('include_testimonials', v)} />
              <SwitchField label="Team Section" checked={genForm.include_team} onChange={(v) => set('include_team', v)} />
              <SwitchField label="Pricing Table" checked={genForm.include_pricing} onChange={(v) => set('include_pricing', v)} />
              <SwitchField label="Video Section" checked={genForm.include_video} onChange={(v) => set('include_video', v)} />
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={generating} className="gap-2">
            <Sparkles className="h-4 w-4" />
            {generating ? 'Generating 4 pages...' : 'Generate Landing Pages'}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Pages */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="h-5 w-5" /> Generated Pages
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : pages.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No pages yet. Use the generator above to create branded landing pages.
            </p>
          ) : (
            <div className="space-y-2">
              {pages.map((page) => (
                <div key={page.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{page.title}</p>
                      <p className="text-xs text-muted-foreground">
                        /{page.slug} · v{page.version} · {page.language.toUpperCase()} ·{' '}
                        {(page.content as TenantPageContent).sections?.length || 0} sections
                      </p>
                    </div>
                    <Badge variant={page.is_published ? 'default' : 'outline'}>
                      {page.is_published ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPreviewPage(page)} className="gap-1">
                      <Eye className="h-3 w-3" /> Preview
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setEditPage(page); setEditJson(JSON.stringify(page.content, null, 2)); }} className="gap-1">
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    {!page.is_published && (
                      <Button variant="outline" size="sm" onClick={() => handlePublish(page.id)} className="gap-1">
                        <Globe className="h-3 w-3" /> Publish
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewPage} onOpenChange={() => setPreviewPage(null)}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] p-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle>Preview: {previewPage?.title}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[80vh]">
            {previewPage && <TenantPageRenderer content={previewPage.content as TenantPageContent} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editPage} onOpenChange={() => setEditPage(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Edit Page: {editPage?.title}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <Textarea value={editJson} onChange={(e) => setEditJson(e.target.value)}
              className="font-mono text-xs min-h-[400px]" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPage(null)}>Cancel</Button>
            <Button onClick={handleEditSave}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-sm">{label}</span>
    </label>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPANDED PAGE CONTENT GENERATOR
// Uses all 15 section types with style variants based on user selections
// ═════════════════════════════════════════════════════════════════════════════

function generatePageContent(
  pageSlug: string,
  tenantName: string,
  form: GenForm
): TenantPageContent {
  const desc = form.description || `${tenantName} is a leading manufacturing company in Europe.`;
  const points = form.selling_points ? form.selling_points.split(',').map((s) => s.trim()) : ['Fast turnaround', 'Precision quality', 'Competitive pricing'];
  const years = form.years_experience || '10';
  const teamSize = form.team_size || '25';

  // Style-dependent variants
  const heroVariant = form.style === 'bold' ? 'centered' : form.style === 'classic' ? 'left' : 'split';
  const statsVariant = form.style === 'classic' ? 'bordered' : form.style === 'bold' ? 'cards' : 'simple';
  const servicesVariant = form.style === 'bold' ? 'minimal' : form.style === 'classic' ? 'icons' : 'cards';
  const ctaVariant = form.style === 'classic' ? 'outlined' : form.style === 'bold' ? 'gradient' : 'solid';
  const featVariant = form.style === 'bold' ? 'numbered' : form.style === 'classic' ? 'icons_left' : 'icons_top';
  const testVariant = form.style === 'bold' ? 'single' : form.style === 'classic' ? 'quotes' : 'cards';
  const timelineVariant = form.style === 'bold' ? 'horizontal' : 'vertical';

  // Dark styles for bold theme
  const darkSection = form.style === 'bold'
    ? { bg_color: '#111827', text_color: 'light' as const }
    : undefined;

  switch (pageSlug) {
    case 'home':
      return buildHomePage(tenantName, desc, points, years, teamSize, form, {
        heroVariant, statsVariant, servicesVariant, ctaVariant, featVariant, testVariant, timelineVariant, darkSection,
      });
    case 'about':
      return buildAboutPage(tenantName, desc, points, years, teamSize, form, {
        heroVariant, statsVariant, featVariant, testVariant, timelineVariant, darkSection,
      });
    case 'services':
      return buildServicesPage(tenantName, desc, form, {
        heroVariant, servicesVariant, ctaVariant, featVariant, darkSection,
      });
    case 'contact':
      return buildContactPage(tenantName, form, { heroVariant, darkSection });
    default:
      return { sections: [] };
  }
}

// ─── HOME ───────────────────────────────────────────────────────────────────

function buildHomePage(
  name: string, desc: string, points: string[], years: string, teamSize: string,
  form: GenForm, v: any,
): TenantPageContent {
  const sections: any[] = [
    // 1. Hero
    {
      type: 'hero',
      variant: v.heroVariant,
      headline: `Precision Manufacturing by ${name}`,
      subheadline: desc,
      cta_text: 'Get Instant Quote',
      cta_link: '/quote',
      secondary_cta_text: 'Our Services',
      secondary_cta_link: '/services',
      badge_text: points[0] || null,
      background_image: null,
      styles: v.darkSection,
    },
    // 2. Features grid — selling points
    {
      type: 'features_grid',
      variant: v.featVariant,
      title: `Why Choose ${name}`,
      subtitle: 'We combine advanced technology with decades of manufacturing expertise.',
      columns: Math.min(points.length, 4),
      items: points.slice(0, 6).map((p) => ({
        title: p,
        description: `Our commitment to ${p.toLowerCase()} sets us apart from the competition.`,
      })),
    },
    // 3. Services
    {
      type: 'services',
      variant: v.servicesVariant,
      title: 'Our Capabilities',
      subtitle: 'End-to-end manufacturing solutions for every project.',
      columns: 3,
      items: [
        { capability: 'cnc_milling', description: 'High-precision 5-axis CNC milling for complex geometries' },
        { capability: 'cnc_turning', description: 'Precision turning for cylindrical and rotational parts' },
        { capability: 'sheet_metal', description: 'Custom sheet metal cutting, bending, and welding' },
        { capability: '3d_printing', description: 'FDM, SLA, and SLS additive manufacturing' },
        { capability: 'laser_cutting', description: 'High-speed laser cutting for metals and plastics' },
        { capability: 'surface_finishing', description: 'Anodizing, plating, powder coating, and polishing' },
      ],
    },
    // 4. Stats
    {
      type: 'stats',
      variant: v.statsVariant,
      title: `${name} in Numbers`,
      items: [
        { value: '500+', label: 'Parts Delivered' },
        { value: `${years}+`, label: 'Years Experience' },
        { value: '48h', label: 'Express Turnaround' },
        { value: '15+', label: 'Materials Available' },
      ],
      styles: v.darkSection,
    },
  ];

  // 5. Optional: Process timeline
  if (form.include_timeline) {
    sections.push({
      type: 'timeline',
      variant: v.timelineVariant,
      title: 'How It Works',
      subtitle: 'From upload to delivery in 4 simple steps.',
      items: [
        { step: '1', title: 'Upload CAD File', description: 'Upload your STEP, STL, or IGES file through our secure platform.' },
        { step: '2', title: 'Get Instant Quote', description: 'Receive a detailed quote with pricing, lead time, and material options.' },
        { step: '3', title: 'Production', description: 'Your part is manufactured using state-of-the-art CNC machines.' },
        { step: '4', title: 'Delivery', description: 'Quality-inspected parts delivered to your door, on time.' },
      ],
    });
  }

  // 6. Optional: Testimonials
  if (form.include_testimonials) {
    sections.push({
      type: 'testimonials',
      variant: v.testVariant,
      title: 'Trusted by Engineers Worldwide',
      items: [
        { name: 'Martin K.', company: 'AutoParts GmbH', role: 'Head of Engineering', quote: `${name} delivered our prototype in under 48 hours with perfect tolerances. Exceptional quality.` },
        { name: 'Sofia R.', company: 'AeroTech Ltd', role: 'Procurement Manager', quote: 'The online quoting system saves us hours. Competitive pricing and reliable delivery every time.' },
        { name: 'Andreas P.', company: 'MedDevice SA', role: 'CTO', quote: 'We switched all our CNC work to them. The quality consistency is outstanding, and support is top-notch.' },
      ],
    });
  }

  // 7. Optional: Video
  if (form.include_video && form.video_url) {
    sections.push({
      type: 'video',
      title: `See ${name} in Action`,
      subtitle: 'A look inside our manufacturing facility.',
      video_url: form.video_url,
      styles: { bg_color: '#111827', text_color: 'light' },
    });
  }

  // 8. CTA
  sections.push({
    type: 'cta_banner',
    variant: v.ctaVariant,
    headline: 'Ready to get started?',
    subheadline: 'Upload your CAD file and receive a quote within minutes.',
    cta_text: 'Get Your Free Quote',
    cta_link: '/quote',
  });

  // 9. FAQ
  sections.push({
    type: 'faq',
    title: 'Frequently Asked Questions',
    subtitle: 'Everything you need to know about working with us.',
    items: [
      { question: 'What file formats do you accept?', answer: 'We accept STEP, STP, STL, IGES, 3MF, and DXF files. STEP is preferred for CNC machining.' },
      { question: 'What is the typical lead time?', answer: 'Standard lead time is 5-10 business days. Express (48h) and rush (24h) options are available.' },
      { question: 'What materials do you work with?', answer: 'We machine aluminum, steel, stainless steel, titanium, brass, copper, and various engineering plastics.' },
      { question: 'Do you offer prototyping?', answer: 'Yes — from single prototypes to full production runs. No minimum order quantity.' },
      { question: 'How does quality control work?', answer: 'Every part is inspected against your specifications. CMM reports available on request.' },
    ],
  });

  return { sections };
}

// ─── ABOUT ──────────────────────────────────────────────────────────────────

function buildAboutPage(
  name: string, desc: string, points: string[], years: string, teamSize: string,
  form: GenForm, v: any,
): TenantPageContent {
  const sections: any[] = [
    {
      type: 'hero',
      variant: 'centered',
      headline: `About ${name}`,
      subheadline: desc,
      cta_text: 'Contact Us',
      cta_link: '/contact',
      background_image: null,
    },
    {
      type: 'rich_text',
      title: 'Our Story',
      content: `Founded over ${years} years ago, ${name} began with a single CNC machine and a vision: to make precision manufacturing accessible to companies of every size.\n\nToday, we operate a modern facility with ${teamSize}+ skilled professionals, serving clients across Europe in aerospace, automotive, medical devices, and industrial equipment.\n\nOur mission is simple — deliver precision parts on time, every time, with the quality our customers depend on.`,
      text_align: 'left',
    },
    {
      type: 'stats',
      variant: v.statsVariant,
      title: `${name} in Numbers`,
      items: [
        { value: `${years}+`, label: 'Years Experience' },
        { value: `${teamSize}+`, label: 'Team Members' },
        { value: '1000+', label: 'Projects Completed' },
        { value: '99.2%', label: 'On-Time Delivery', suffix: '%' },
      ],
      styles: v.darkSection,
    },
    {
      type: 'features_grid',
      variant: v.featVariant,
      title: 'Our Values',
      columns: 3,
      items: [
        { title: 'Precision', description: 'Tolerances down to ±0.01mm. Every part is measured and verified.' },
        { title: 'Speed', description: 'From quote to delivery in days, not weeks. Express options available.' },
        { title: 'Reliability', description: '99%+ on-time delivery rate backed by rigorous process control.' },
        { title: 'Transparency', description: 'Instant online quotes. No hidden fees. Real-time order tracking.' },
        { title: 'Quality', description: 'ISO 9001-level quality management. Full traceability on every part.' },
        { title: 'Support', description: 'Dedicated engineering support from quote to delivery.' },
      ],
    },
  ];

  if (form.include_timeline) {
    sections.push({
      type: 'timeline',
      variant: v.timelineVariant,
      title: 'Our Journey',
      items: [
        { step: '1', title: 'Founded', description: `${name} was established with a focus on precision CNC machining.` },
        { step: '2', title: 'Growth', description: 'Expanded capabilities to include sheet metal, 3D printing, and laser cutting.' },
        { step: '3', title: 'Digital Platform', description: 'Launched our online quoting and order management platform.' },
        { step: '4', title: 'Today', description: `Serving 100+ companies across Europe with a team of ${teamSize}+ professionals.` },
      ],
    });
  }

  if (form.include_team) {
    sections.push({
      type: 'team',
      title: 'Leadership Team',
      subtitle: 'The people behind the precision.',
      items: [
        { name: 'CEO', role: 'Chief Executive Officer', bio: `Leads ${name} with a focus on innovation and customer success.` },
        { name: 'CTO', role: 'Chief Technology Officer', bio: 'Oversees manufacturing technology and process optimization.' },
        { name: 'Head of Production', role: 'Production Director', bio: 'Ensures quality and on-time delivery across all orders.' },
      ],
    });
  }

  sections.push({
    type: 'cta_banner',
    variant: v.ctaVariant || 'solid',
    headline: 'Want to learn more?',
    subheadline: 'Get in touch with our team to discuss your project.',
    cta_text: 'Contact Us',
    cta_link: '/contact',
  });

  return { sections };
}

// ─── SERVICES ───────────────────────────────────────────────────────────────

function buildServicesPage(
  name: string, desc: string, form: GenForm, v: any,
): TenantPageContent {
  const sections: any[] = [
    {
      type: 'hero',
      variant: 'centered',
      headline: 'Manufacturing Services',
      subheadline: `Explore the full range of manufacturing capabilities offered by ${name}.`,
      cta_text: 'Request a Quote',
      cta_link: '/quote',
      background_image: null,
    },
    {
      type: 'services',
      variant: v.servicesVariant,
      title: 'What We Offer',
      subtitle: 'From prototype to production — we cover the full manufacturing spectrum.',
      columns: 3,
      items: [
        { capability: 'cnc_milling', description: '3 to 5-axis CNC milling for complex geometries in metals and plastics.' },
        { capability: 'cnc_turning', description: 'Precision CNC turning for cylindrical parts, shafts, and fittings.' },
        { capability: 'sheet_metal', description: 'Laser cut, bent, welded, and finished sheet metal assemblies.' },
        { capability: '3d_printing', description: 'FDM, SLA, SLS, and MJF technologies for rapid prototyping.' },
        { capability: 'injection_molding', description: 'Prototype and production injection molding in 50+ resins.' },
        { capability: 'laser_cutting', description: 'High-speed fiber and CO2 laser cutting for metals and plastics.' },
        { capability: 'surface_finishing', description: 'Anodizing, plating, powder coating, polishing, and more.' },
      ],
    },
    {
      type: 'features_grid',
      variant: v.featVariant,
      title: 'Why Our Services Stand Out',
      columns: 4,
      items: [
        { title: 'Online Quoting', description: 'Upload your file and get an instant price estimate.' },
        { title: 'Material Library', description: '15+ metals and plastics to choose from.' },
        { title: 'Quality Assurance', description: 'CMM inspection and full dimensional reports.' },
        { title: 'Express Delivery', description: 'Parts shipped in as fast as 24 hours.' },
      ],
    },
  ];

  if (form.include_pricing) {
    sections.push({
      type: 'pricing',
      title: 'Service Tiers',
      subtitle: 'Flexible options for every project size.',
      items: [
        {
          name: 'Prototype', price: 'From €50', description: 'Single parts and prototypes',
          features: ['1-10 parts', 'Standard tolerances', '7-10 day lead time', 'Basic finish'],
          cta_text: 'Get Quote', cta_link: '/quote',
        },
        {
          name: 'Production', price: 'Custom', description: 'Medium to large production runs', is_featured: true,
          features: ['10-1000+ parts', 'Tight tolerances', '5-7 day lead time', 'Surface treatment included', 'Dedicated project manager'],
          cta_text: 'Get Quote', cta_link: '/quote',
        },
        {
          name: 'Enterprise', price: 'Contact Us', description: 'Ongoing manufacturing partnership',
          features: ['Volume pricing', 'Priority scheduling', 'Kanban/JIT delivery', 'Custom reporting', 'Dedicated account team'],
          cta_text: 'Contact Sales', cta_link: '/contact',
        },
      ],
    });
  }

  sections.push({
    type: 'cta_banner',
    variant: 'gradient',
    headline: 'Have a project in mind?',
    subheadline: 'Upload your CAD file for an instant quote, or contact us to discuss your requirements.',
    cta_text: 'Start Your Project',
    cta_link: '/quote',
  });

  sections.push({
    type: 'faq',
    title: 'Service FAQ',
    items: [
      { question: 'What file formats do you accept?', answer: 'STEP, STP, STL, IGES, 3MF, and DXF. STEP format is preferred for CNC parts.' },
      { question: 'Is there a minimum order quantity?', answer: 'No minimum — we handle everything from single prototypes to production runs of 10,000+.' },
      { question: 'What tolerances can you achieve?', answer: 'Standard: ±0.1mm. Precision: ±0.05mm. Ultra-precision: ±0.01mm (material dependent).' },
      { question: 'Do you handle assembly?', answer: 'Yes, we offer mechanical assembly, press-fit, and hardware insertion services.' },
    ],
  });

  return { sections };
}

// ─── CONTACT ────────────────────────────────────────────────────────────────

function buildContactPage(
  name: string, form: GenForm, v: any,
): TenantPageContent {
  const sections: any[] = [
    {
      type: 'hero',
      variant: 'centered',
      headline: `Contact ${name}`,
      subheadline: 'Get in touch with our team for quotes, technical questions, or partnership inquiries.',
      cta_text: 'Send Message',
      cta_link: '/contact',
      background_image: null,
    },
    {
      type: 'contact_info',
      title: 'Reach Us',
      subtitle: 'We respond to all inquiries within 24 hours.',
      show_email: true,
      show_phone: true,
      show_address: true,
      custom_fields: [
        { label: 'Working Hours', value: 'Mon-Fri, 08:00 - 18:00 CET' },
        { label: 'Response Time', value: 'Within 24 hours' },
      ],
    },
    {
      type: 'faq',
      title: 'Before You Reach Out',
      subtitle: 'Quick answers to common questions.',
      items: [
        { question: 'How quickly will I get a response?', answer: 'We reply to all inquiries within 24 hours during business days.' },
        { question: 'Can I visit your facility?', answer: 'Yes — facility tours are available by appointment. Contact us to schedule.' },
        { question: 'Do you offer engineering support?', answer: 'Absolutely. Our engineers can help with DFM analysis, material selection, and tolerance optimization.' },
      ],
    },
    {
      type: 'cta_banner',
      variant: 'outlined',
      headline: 'Prefer to get started right away?',
      subheadline: 'Skip the email — upload your CAD file and get an instant quote.',
      cta_text: 'Get Instant Quote',
      cta_link: '/quote',
    },
  ];

  return { sections };
}
