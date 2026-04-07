import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Sparkles, Eye, Pencil, Globe, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { getTenantPages, upsertTenantPage, publishTenantPage } from '@/utils/tenantApi';
import type { TenantPage, TenantPageContent } from '@/types/tenant';

interface Props {
  tenantId: string;
  tenantName: string;
}

export default function TenantPagesTab({ tenantId, tenantName }: Props) {
  const [pages, setPages] = useState<TenantPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editPage, setEditPage] = useState<TenantPage | null>(null);
  const [editJson, setEditJson] = useState('');
  const { toast } = useToast();

  // AI generation form
  const [genForm, setGenForm] = useState({
    description: '',
    audience: '',
    selling_points: '',
    tone: 'professional',
    language: 'en',
  });

  useEffect(() => {
    loadPages();
  }, [tenantId]);

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
      // Generate structured content for each page type
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

      toast({ title: 'Pages generated', description: 'AI-generated pages are ready for review' });
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

  const handleEditOpen = (page: TenantPage) => {
    setEditPage(page);
    setEditJson(JSON.stringify(page.content, null, 2));
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

  return (
    <div className="space-y-6">
      {/* AI Generation Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI-Generated Landing Pages
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generate branded landing pages for this tenant. Pages are stored and served at the tenant subdomain.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Company Description</Label>
              <Textarea
                value={genForm.description}
                onChange={(e) => setGenForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="We are a precision CNC manufacturing company..."
                rows={3}
              />
            </div>
            <div>
              <Label>Target Audience</Label>
              <Textarea
                value={genForm.audience}
                onChange={(e) => setGenForm((prev) => ({ ...prev, audience: e.target.value }))}
                placeholder="Automotive engineers, aerospace companies..."
                rows={3}
              />
            </div>
            <div>
              <Label>Key Selling Points</Label>
              <Textarea
                value={genForm.selling_points}
                onChange={(e) => setGenForm((prev) => ({ ...prev, selling_points: e.target.value }))}
                placeholder="Fast turnaround, ISO certified, 5-axis capability..."
                rows={3}
              />
            </div>
            <div className="space-y-4">
              <div>
                <Label>Tone</Label>
                <Select
                  value={genForm.tone}
                  onValueChange={(v) => setGenForm((prev) => ({ ...prev, tone: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Language</Label>
                <Select
                  value={genForm.language}
                  onValueChange={(v) => setGenForm((prev) => ({ ...prev, language: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {generating ? 'Generating...' : 'Generate Landing Pages'}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Pages List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generated Pages</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : pages.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No pages generated yet. Use the form above to create AI-generated landing pages.
            </p>
          ) : (
            <div className="space-y-2">
              {pages.map((page) => (
                <div
                  key={page.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{page.title}</p>
                      <p className="text-xs text-muted-foreground">
                        /{page.slug} · v{page.version} · {page.language.toUpperCase()}
                      </p>
                    </div>
                    <Badge variant={page.is_published ? 'default' : 'outline'}>
                      {page.is_published ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEditOpen(page)} className="gap-1">
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

      {/* Edit Dialog */}
      <Dialog open={!!editPage} onOpenChange={() => setEditPage(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Edit Page: {editPage?.title}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <Textarea
              value={editJson}
              onChange={(e) => setEditJson(e.target.value)}
              className="font-mono text-xs min-h-[400px]"
            />
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

// ─── Local page content generation (template-based) ─────────────────────────
// This generates structured JSON content without requiring an AI API call.
// For actual AI generation, this would be replaced with a call to the Claude API.

function generatePageContent(
  pageSlug: string,
  tenantName: string,
  form: { description: string; audience: string; selling_points: string; tone: string }
): TenantPageContent {
  const desc = form.description || `${tenantName} is a leading manufacturing company in Europe.`;
  const points = form.selling_points || 'Fast turnaround, precision quality, competitive pricing';

  switch (pageSlug) {
    case 'home':
      return {
        sections: [
          {
            type: 'hero',
            headline: `Precision Manufacturing by ${tenantName}`,
            subheadline: desc,
            cta_text: 'Get Instant Quote',
            cta_link: '/quote',
            background_image: null,
          },
          {
            type: 'services',
            title: 'Our Capabilities',
            items: [
              { capability: 'cnc_milling', description: 'High-precision 5-axis CNC milling' },
              { capability: 'sheet_metal', description: 'Custom sheet metal fabrication' },
              { capability: '3d_printing', description: 'Rapid prototyping and production' },
            ],
          },
          {
            type: 'stats',
            items: [
              { value: '500+', label: 'Parts Delivered' },
              { value: '48h', label: 'Average Lead Time' },
              { value: '15+', label: 'Materials Available' },
            ],
          },
          {
            type: 'cta_banner',
            headline: 'Ready to get started?',
            cta_text: 'Upload Your CAD File',
            cta_link: '/quote',
          },
        ],
      };

    case 'about':
      return {
        sections: [
          {
            type: 'hero',
            headline: `About ${tenantName}`,
            subheadline: desc,
            cta_text: 'Contact Us',
            cta_link: '/contact',
            background_image: null,
          },
          {
            type: 'stats',
            items: [
              { value: '10+', label: 'Years Experience' },
              { value: '50+', label: 'Team Members' },
              { value: '1000+', label: 'Projects Completed' },
            ],
          },
        ],
      };

    case 'services':
      return {
        sections: [
          {
            type: 'hero',
            headline: `Manufacturing Services`,
            subheadline: `Explore the full range of manufacturing capabilities offered by ${tenantName}.`,
            cta_text: 'Request a Quote',
            cta_link: '/quote',
            background_image: null,
          },
          {
            type: 'services',
            title: 'What We Offer',
            items: [
              { capability: 'cnc_milling', description: '5-axis CNC milling for complex geometries' },
              { capability: 'cnc_turning', description: 'Precision CNC turning for cylindrical parts' },
              { capability: 'sheet_metal', description: 'Sheet metal cutting, bending, and welding' },
              { capability: '3d_printing', description: 'FDM, SLA, and SLS 3D printing technologies' },
              { capability: 'laser_cutting', description: 'High-speed laser cutting for metals and plastics' },
            ],
          },
          {
            type: 'faq',
            items: [
              { question: 'What file formats do you accept?', answer: 'We accept STEP, STP, STL, IGES, and 3MF files.' },
              { question: 'What is the typical lead time?', answer: 'Standard lead time is 5-10 business days. Express options available.' },
              { question: 'Do you offer prototyping?', answer: 'Yes, we offer rapid prototyping with as fast as 24-hour turnaround.' },
            ],
          },
        ],
      };

    case 'contact':
      return {
        sections: [
          {
            type: 'hero',
            headline: `Contact ${tenantName}`,
            subheadline: 'Get in touch with our team for quotes, questions, or partnership inquiries.',
            cta_text: 'Send Message',
            cta_link: '/contact',
            background_image: null,
          },
        ],
      };

    default:
      return { sections: [] };
  }
}
