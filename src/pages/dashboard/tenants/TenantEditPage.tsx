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
import { ArrowLeft, Save, Upload, Settings2, Globe, Palette, FileText, Sparkles, Link2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import {
  getTenant, createTenant, updateTenant, uploadTenantLogo, uploadTenantFavicon,
  getCapabilitiesRegistry, getTenantCapabilities, updateTenantCapabilities,
  getQuoteFieldsRegistry, getTenantQuoteFields, updateTenantQuoteFields,
  verifyTenantDomain,
} from '@/utils/tenantApi';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
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
  const [domainChecking, setDomainChecking] = useState(false);
  const [form, setForm] = useState<TenantInsert & { id?: string; domain_verified?: boolean }>({
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
    custom_domain: null,
    is_active: true,
    domain_verified: false,
  });

  // Tenant admin credentials (only for new tenants)
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

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
        custom_domain: tenant.custom_domain,
        domain_verified: tenant.domain_verified,
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
          custom_domain: form.custom_domain || null,
          is_active: form.is_active,
        });

        // Create admin user for this tenant if credentials provided
        if (adminEmail && adminPassword) {
          try {
            // Create the auth user via Supabase
            const { data: authData, error: authError } = await supabase.auth.signUp({
              email: adminEmail,
              password: adminPassword,
              options: {
                data: {
                  first_name: form.name,
                  last_name: 'Admin',
                  company_name: form.name,
                },
              },
            });

            if (authError) throw authError;

            if (authData.user) {
              // Assign tenant_admin role in user_tenant_roles
              const { error: roleError } = await supabase
                .from('user_tenant_roles')
                .insert({
                  user_id: authData.user.id,
                  tenant_id: tenant.id,
                  role: 'tenant_admin',
                });

              if (roleError) {
                console.error('Error assigning tenant admin role:', roleError);
                toast({ title: 'Warning', description: `Tenant created but admin role assignment failed: ${roleError.message}`, variant: 'destructive' });
              } else {
                toast({ title: 'Admin Created', description: `Admin account created for ${adminEmail}` });
              }
            }
          } catch (adminError: any) {
            console.error('Error creating tenant admin:', adminError);
            toast({ title: 'Warning', description: `Tenant created but admin account creation failed: ${adminError.message}`, variant: 'destructive' });
          }
        }

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
          custom_domain: form.custom_domain || null,
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

              {/* Admin Credentials - Only shown for new tenants */}
              {isNew && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Lock className="h-5 w-5" /> Tenant Admin Account
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Create a login account for the tenant administrator. They will have access to the dashboard
                      (Management, Operations, System) but not to Lead Monitor or Content sections.
                    </p>
                    <div>
                      <Label>Admin Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="email"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="admin@tenant-company.com"
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Admin Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          type={showAdminPassword ? 'text' : 'password'}
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="Min. 6 characters"
                          className="pl-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAdminPassword(!showAdminPassword)}
                          className="absolute right-3 top-2.5"
                        >
                          {showAdminPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Password must be at least 6 characters
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

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

            {/* Custom Domain — full width below the 2-col grid */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Link2 className="h-5 w-5" /> Custom Domain
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Custom Domain</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={form.custom_domain || ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, custom_domain: e.target.value.toLowerCase().trim() || null }))}
                      placeholder="www.laserkritis.gr"
                      className="max-w-sm"
                    />
                    {form.custom_domain && (
                      <Badge variant={form.domain_verified ? 'default' : 'outline'} className="gap-1">
                        {form.domain_verified
                          ? <><CheckCircle2 className="h-3 w-3" /> Verified</>
                          : <><AlertCircle className="h-3 w-3" /> Pending</>}
                      </Badge>
                    )}
                    {form.custom_domain && !isNew && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={domainChecking}
                        onClick={async () => {
                          if (!form.custom_domain) return;
                          setDomainChecking(true);
                          try {
                            const ok = await verifyTenantDomain(form.custom_domain);
                            if (ok && id) {
                              await updateTenant(id, { domain_verified: true });
                              setForm((prev) => ({ ...prev, domain_verified: true }));
                              toast({ title: 'Domain verified', description: `${form.custom_domain} is reachable.` });
                            } else {
                              toast({ title: 'Domain not reachable', description: 'Check DNS configuration and Vercel domain setup.', variant: 'destructive' });
                            }
                          } catch {
                            toast({ title: 'Check failed', variant: 'destructive' });
                          } finally {
                            setDomainChecking(false);
                          }
                        }}
                        className="gap-1"
                      >
                        {domainChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                        Check DNS
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Optional. Allows this tenant to be accessed via their own domain instead of {form.slug || 'slug'}.micronshub.eu
                  </p>
                </div>

                {form.custom_domain && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm space-y-3">
                    <p className="font-semibold text-amber-800">Setup Instructions</p>
                    <ol className="list-decimal list-inside space-y-2 text-amber-900">
                      <li>
                        <strong>Add domain in Vercel:</strong> Go to Vercel Dashboard &gt; Project &gt; Settings &gt; Domains &gt; Add <code className="bg-amber-100 px-1 rounded">{form.custom_domain}</code>
                      </li>
                      <li>
                        <strong>Configure DNS:</strong> The tenant owner must add this record to their domain registrar:
                        <div className="mt-1 bg-white border border-amber-200 rounded p-2 font-mono text-xs">
                          <div>Type: <strong>CNAME</strong></div>
                          <div>Name: <strong>{form.custom_domain.startsWith('www.') ? 'www' : '@'}</strong></div>
                          <div>Value: <strong>cname.vercel-dns.com</strong></div>
                        </div>
                      </li>
                      <li>
                        <strong>Wait for SSL:</strong> Vercel will automatically provision an SSL certificate (usually &lt; 5 minutes).
                      </li>
                      <li>
                        <strong>Verify:</strong> Click "Check DNS" above to confirm the domain is working.
                      </li>
                    </ol>
                  </div>
                )}
              </CardContent>
            </Card>

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
