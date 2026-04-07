import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { BackToDashboardButton } from '@/components/dashboard/BackToDashboardButton';
import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { ArrowLeft, Save, Upload, Settings2, Globe, Palette, FileText, Sparkles } from 'lucide-react';
import {
  getTenant, createTenant, updateTenant, uploadTenantLogo, uploadTenantFavicon,
  getCapabilitiesRegistry, getTenantCapabilities, updateTenantCapabilities,
  getQuoteFieldsRegistry, getTenantQuoteFields, updateTenantQuoteFields,
} from '@/utils/tenantApi';
import type {
  Tenant, TenantInsert, TenantUpdate, CapabilityRegistry,
  TenantCapability, QuoteFieldRegistry, TenantQuoteField,
} from '@/types/tenant';
import TenantCapabilitiesTab from '@/components/tenants/TenantCapabilitiesTab';
import TenantQuoteFieldsTab from '@/components/tenants/TenantQuoteFieldsTab';
import TenantPagesTab from '@/components/tenants/TenantPagesTab';

export default function TenantEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TenantInsert & { id?: string }>({
    slug: '',
    name: '',
    logo_url: null,
    favicon_url: null,
    primary_color: '#2563EB',
    secondary_color: '#1E40AF',
    welcome_message: null,
    contact_email: null,
    contact_phone: null,
    address: null,
    website: null,
    is_active: true,
  });

  // Capabilities state
  const [capRegistry, setCapRegistry] = useState<CapabilityRegistry[]>([]);
  const [tenantCaps, setTenantCaps] = useState<TenantCapability[]>([]);
  const [fieldRegistry, setFieldRegistry] = useState<QuoteFieldRegistry[]>([]);
  const [tenantFields, setTenantFields] = useState<TenantQuoteField[]>([]);

  useEffect(() => {
    if (!isNew && id) {
      loadTenant(id);
    }
    loadRegistries();
  }, [id]);

  const loadTenant = async (tenantId: string) => {
    try {
      setLoading(true);
      const tenant = await getTenant(tenantId);
      setForm({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        logo_url: tenant.logo_url,
        favicon_url: tenant.favicon_url,
        primary_color: tenant.primary_color,
        secondary_color: tenant.secondary_color,
        welcome_message: tenant.welcome_message,
        contact_email: tenant.contact_email,
        contact_phone: tenant.contact_phone,
        address: tenant.address,
        website: tenant.website,
        is_active: tenant.is_active,
      });
      const [caps, fields] = await Promise.all([
        getTenantCapabilities(tenantId),
        getTenantQuoteFields(tenantId),
      ]);
      setTenantCaps(caps);
      setTenantFields(fields);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const loadRegistries = async () => {
    try {
      const [caps, fields] = await Promise.all([
        getCapabilitiesRegistry(),
        getQuoteFieldsRegistry(),
      ]);
      setCapRegistry(caps);
      setFieldRegistry(fields);
    } catch (error: any) {
      console.error('Failed to load registries:', error);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.slug) {
      toast({ title: 'Validation', description: 'Name and slug are required', variant: 'destructive' });
      return;
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(form.slug)) {
      toast({ title: 'Validation', description: 'Slug must contain only lowercase letters, numbers, and hyphens', variant: 'destructive' });
      return;
    }

    try {
      setSaving(true);

      if (isNew) {
        const tenant = await createTenant({
          slug: form.slug,
          name: form.name,
          logo_url: form.logo_url,
          favicon_url: form.favicon_url,
          primary_color: form.primary_color,
          secondary_color: form.secondary_color,
          welcome_message: form.welcome_message,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          address: form.address,
          website: form.website,
          is_active: form.is_active,
        });
        toast({ title: 'Created', description: `${tenant.name} created successfully` });
        navigate(`/dashboard/tenants/${tenant.id}`);
      } else if (id) {
        const updates: TenantUpdate = {
          name: form.name,
          logo_url: form.logo_url,
          favicon_url: form.favicon_url,
          primary_color: form.primary_color,
          secondary_color: form.secondary_color,
          welcome_message: form.welcome_message,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          address: form.address,
          website: form.website,
          is_active: form.is_active,
        };
        await updateTenant(id, updates);
        toast({ title: 'Updated', description: `${form.name} updated successfully` });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !form.slug) return;

    try {
      const url = await uploadTenantLogo(form.slug, file);
      setForm((prev) => ({ ...prev, logo_url: url }));
      toast({ title: 'Logo uploaded' });
    } catch (error: any) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    }
  };

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !form.slug) return;

    try {
      const url = await uploadTenantFavicon(form.slug, file);
      setForm((prev) => ({ ...prev, favicon_url: url }));
      toast({ title: 'Favicon uploaded' });
    } catch (error: any) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    }
  };

  const handleCapabilitiesUpdate = async (
    caps: { capability: string; is_enabled: boolean; sort_order: number }[]
  ) => {
    if (!id || isNew) return;
    try {
      await updateTenantCapabilities(id, caps);
      const updated = await getTenantCapabilities(id);
      setTenantCaps(updated);
      toast({ title: 'Capabilities updated' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleQuoteFieldsUpdate = async (
    fields: { capability: string; field_key: string; is_visible: boolean; is_required: boolean; sort_order: number }[]
  ) => {
    if (!id || isNew) return;
    try {
      await updateTenantQuoteFields(id, fields);
      const updated = await getTenantQuoteFields(id);
      setTenantFields(updated);
      toast({ title: 'Quote fields updated' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <PersistentDashboardLayout>
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </PersistentDashboardLayout>
    );
  }

  return (
    <PersistentDashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard/tenants')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {isNew ? 'Create New Tenant' : `Edit: ${form.name}`}
            </h1>
            {!isNew && (
              <p className="text-muted-foreground text-sm">
                {form.slug}.micronshub.eu
              </p>
            )}
          </div>
        </div>

        <Tabs defaultValue="general">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general" className="gap-1">
              <Globe className="h-4 w-4" /> General
            </TabsTrigger>
            <TabsTrigger value="capabilities" className="gap-1" disabled={isNew}>
              <Settings2 className="h-4 w-4" /> Capabilities
            </TabsTrigger>
            <TabsTrigger value="fields" className="gap-1" disabled={isNew}>
              <FileText className="h-4 w-4" /> Quote Fields
            </TabsTrigger>
            <TabsTrigger value="pages" className="gap-1" disabled={isNew}>
              <Sparkles className="h-4 w-4" /> AI Pages
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: General Info */}
          <TabsContent value="general">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Tenant Name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="ACME Manufacturing"
                    />
                  </div>
                  <div>
                    <Label>Subdomain Slug *</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        value={form.slug}
                        onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                        placeholder="acme"
                        disabled={!isNew}
                        className="max-w-48"
                      />
                      <span className="text-muted-foreground text-sm">.micronshub.eu</span>
                    </div>
                    {!isNew && (
                      <p className="text-xs text-muted-foreground mt-1">Slug cannot be changed after creation</p>
                    )}
                  </div>
                  <div>
                    <Label>Welcome Message</Label>
                    <Textarea
                      value={form.welcome_message || ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, welcome_message: e.target.value || null }))}
                      placeholder="Welcome to ACME Manufacturing"
                      rows={2}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={form.is_active}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, is_active: checked }))}
                    />
                    <Label>Active</Label>
                    <Badge variant={form.is_active ? 'default' : 'secondary'}>
                      {form.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Contact Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Contact Email</Label>
                    <Input
                      type="email"
                      value={form.contact_email || ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, contact_email: e.target.value || null }))}
                      placeholder="admin@acme.com"
                    />
                  </div>
                  <div>
                    <Label>Contact Phone</Label>
                    <Input
                      value={form.contact_phone || ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, contact_phone: e.target.value || null }))}
                      placeholder="+30 210 xxxxxxx"
                    />
                  </div>
                  <div>
                    <Label>Address</Label>
                    <Textarea
                      value={form.address || ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value || null }))}
                      placeholder="123 Industrial Ave, Athens"
                      rows={2}
                    />
                  </div>
                  <div>
                    <Label>Website</Label>
                    <Input
                      value={form.website || ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value || null }))}
                      placeholder="https://acme.com"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Palette className="h-5 w-5" /> Branding
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Primary Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.primary_color || '#2563EB'}
                          onChange={(e) => setForm((prev) => ({ ...prev, primary_color: e.target.value }))}
                          className="w-10 h-10 rounded border cursor-pointer"
                        />
                        <Input
                          value={form.primary_color || '#2563EB'}
                          onChange={(e) => setForm((prev) => ({ ...prev, primary_color: e.target.value }))}
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Secondary Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.secondary_color || '#1E40AF'}
                          onChange={(e) => setForm((prev) => ({ ...prev, secondary_color: e.target.value }))}
                          className="w-10 h-10 rounded border cursor-pointer"
                        />
                        <Input
                          value={form.secondary_color || '#1E40AF'}
                          onChange={(e) => setForm((prev) => ({ ...prev, secondary_color: e.target.value }))}
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label>Logo</Label>
                    <div className="flex items-center gap-4">
                      {form.logo_url && (
                        <img src={form.logo_url} alt="Logo" className="h-12 object-contain rounded border p-1" />
                      )}
                      <label className="cursor-pointer">
                        <div className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm">
                          <Upload className="h-4 w-4" /> Upload Logo
                        </div>
                        <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={handleLogoUpload} className="hidden" />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">PNG, SVG, or WebP. Max 2MB.</p>
                  </div>
                  <div>
                    <Label>Favicon</Label>
                    <div className="flex items-center gap-4">
                      {form.favicon_url && (
                        <img src={form.favicon_url} alt="Favicon" className="h-8 w-8 object-contain rounded border p-1" />
                      )}
                      <label className="cursor-pointer">
                        <div className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm">
                          <Upload className="h-4 w-4" /> Upload Favicon
                        </div>
                        <input type="file" accept="image/png,image/x-icon,image/svg+xml" onChange={handleFaviconUpload} className="hidden" />
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="rounded-lg border p-6 space-y-3"
                    style={{ borderColor: form.primary_color || '#2563EB' }}
                  >
                    <div className="flex items-center gap-3">
                      {form.logo_url ? (
                        <img src={form.logo_url} alt="" className="h-8 object-contain" />
                      ) : (
                        <div
                          className="h-8 w-8 rounded flex items-center justify-center text-white font-bold text-sm"
                          style={{ backgroundColor: form.primary_color || '#2563EB' }}
                        >
                          {(form.name || 'T')[0].toUpperCase()}
                        </div>
                      )}
                      <span className="font-semibold">{form.name || 'Tenant Name'}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {form.welcome_message || 'Welcome message preview'}
                    </p>
                    <div className="flex gap-2">
                      <div
                        className="px-4 py-2 rounded text-white text-sm font-medium"
                        style={{ backgroundColor: form.primary_color || '#2563EB' }}
                      >
                        Get Quote
                      </div>
                      <div
                        className="px-4 py-2 rounded text-white text-sm font-medium"
                        style={{ backgroundColor: form.secondary_color || '#1E40AF' }}
                      >
                        Learn More
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end mt-6">
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : isNew ? 'Create Tenant' : 'Save Changes'}
              </Button>
            </div>
          </TabsContent>

          {/* Tab 2: Capabilities */}
          <TabsContent value="capabilities">
            <TenantCapabilitiesTab
              capRegistry={capRegistry}
              tenantCaps={tenantCaps}
              onSave={handleCapabilitiesUpdate}
            />
          </TabsContent>

          {/* Tab 3: Quote Fields */}
          <TabsContent value="fields">
            <TenantQuoteFieldsTab
              capRegistry={capRegistry}
              tenantCaps={tenantCaps}
              fieldRegistry={fieldRegistry}
              tenantFields={tenantFields}
              onSave={handleQuoteFieldsUpdate}
            />
          </TabsContent>

          {/* Tab 4: AI Pages */}
          <TabsContent value="pages">
            {id && !isNew && <TenantPagesTab tenantId={id} tenantName={form.name} />}
          </TabsContent>
        </Tabs>
      </div>
    </PersistentDashboardLayout>
  );
}
