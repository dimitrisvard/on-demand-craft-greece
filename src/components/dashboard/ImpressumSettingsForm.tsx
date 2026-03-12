import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Save, Globe, Building2, Phone, Mail, MapPin, FileText, RefreshCw } from 'lucide-react';

// All supported languages
const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'pl', label: 'Polski' },
  { code: 'pt', label: 'Português' },
  { code: 'es', label: 'Español' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'cs', label: 'Čeština' },
  { code: 'hu', label: 'Magyar' },
  { code: 'sv', label: 'Svenska' },
  { code: 'nb', label: 'Norsk' },
  { code: 'fi', label: 'Suomi' },
  { code: 'da', label: 'Dansk' },
];

// Schema for universal (non-translated) fields
const universalSchema = z.object({
  operator_name: z.string().min(1, 'Operator name is required'),
  company_name: z.string().min(1, 'Company name is required'),
  address_street: z.string().min(1, 'Street address is required'),
  address_zip_city: z.string().min(1, 'ZIP/City is required'),
  address_country: z.string().min(1, 'Country is required'),
  phone: z.string().min(1, 'Phone number is required'),
  email: z.string().email('Must be a valid email address'),
});

// Schema for per-language translated fields
const translationSchema = z.object({
  legal_form_detail: z.string().min(1, 'Legal form detail is required'),
  register_detail: z.string().min(1, 'Register detail is required'),
  vat_detail: z.string().min(1, 'VAT detail is required'),
  eu_dispute_text: z.string().min(1, 'EU dispute text is required'),
  consumer_dispute_text: z.string().min(1, 'Consumer dispute text is required'),
});

type UniversalFormValues = z.infer<typeof universalSchema>;
type TranslationFormValues = z.infer<typeof translationSchema>;

interface ImpressumRow {
  id: string;
  operator_name: string;
  company_name: string;
  address_street: string;
  address_zip_city: string;
  address_country: string;
  phone: string;
  email: string;
  translations: Record<string, TranslationFormValues>;
}

const DEFAULT_UNIVERSAL: UniversalFormValues = {
  operator_name: 'Dimitrios Vardalachakis',
  company_name: 'MICRONS HUB DV Ε.Ε.',
  address_street: 'Industrial Area Street B Number 4',
  address_zip_city: '71601 Heraklion',
  address_country: 'Griechenland',
  phone: '+302104447830',
  email: 'info@micronshub.eu',
};

const fetchImpressumSettings = async (): Promise<ImpressumRow | null> => {
  const { data, error } = await supabase
    .from('impressum_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as ImpressumRow | null;
};

const ImpressumSettingsForm = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedLang, setSelectedLang] = useState('en');

  const getTranslationDefaults = (): TranslationFormValues => ({
    legal_form_detail: t('impressum_legal_form_detail'),
    register_detail: t('impressum_register_detail'),
    vat_detail: t('impressum_vat_detail'),
    eu_dispute_text: t('impressum_eu_dispute_text'),
    consumer_dispute_text: t('impressum_consumer_dispute_text'),
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['impressum_settings'],
    queryFn: fetchImpressumSettings,
  });

  // Form for universal fields
  const universalForm = useForm<UniversalFormValues>({
    resolver: zodResolver(universalSchema),
    values: settings
      ? {
          operator_name: settings.operator_name,
          company_name: settings.company_name,
          address_street: settings.address_street,
          address_zip_city: settings.address_zip_city,
          address_country: settings.address_country,
          phone: settings.phone,
          email: settings.email,
        }
      : DEFAULT_UNIVERSAL,
  });

  // Form for translated fields (re-populates when language changes)
  const translationForm = useForm<TranslationFormValues>({
    resolver: zodResolver(translationSchema),
    values: settings?.translations?.[selectedLang] ?? getTranslationDefaults(),
  });

  // Mutation to save universal fields
  const universalMutation = useMutation({
    mutationFn: async (values: UniversalFormValues) => {
      const now = new Date().toISOString();
      if (settings?.id) {
        const { error } = await supabase
          .from('impressum_settings')
          .update({ ...values, updated_at: now })
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('impressum_settings')
          .insert({ ...values, translations: {}, updated_at: now });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['impressum_settings'] });
      toast({ title: '✅ Contact & address saved', description: 'Universal fields updated successfully.' });
    },
    onError: (err: Error) => {
      toast({ title: '❌ Save failed', description: err.message, variant: 'destructive' });
    },
  });

  // Mutation to save translated fields for selected language
  const translationMutation = useMutation({
    mutationFn: async (values: TranslationFormValues) => {
      const now = new Date().toISOString();
      const updatedTranslations = {
        ...(settings?.translations ?? {}),
        [selectedLang]: values,
      };
      if (settings?.id) {
        const { error } = await supabase
          .from('impressum_settings')
          .update({ translations: updatedTranslations, updated_at: now })
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('impressum_settings')
          .insert({ ...DEFAULT_UNIVERSAL, translations: updatedTranslations, updated_at: now });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['impressum_settings'] });
      const langLabel = SUPPORTED_LANGUAGES.find((l) => l.code === selectedLang)?.label ?? selectedLang;
      toast({ title: '✅ Translation saved', description: `Legal details for ${langLabel} updated successfully.` });
    },
    onError: (err: Error) => {
      toast({ title: '❌ Save failed', description: err.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading legal notice settings…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Universal fields ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t('impressum_operator', 'Company & Contact')}
          </CardTitle>
          <CardDescription>
            {t('impressum_section5', 'Information displayed in the legal notice — applies to all languages.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...universalForm}>
            <form
              onSubmit={universalForm.handleSubmit((values) => universalMutation.mutate(values))}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Operator name */}
                <FormField
                  control={universalForm.control}
                  name="operator_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('impressum_operator', 'Website Operator')}</FormLabel>
                      <FormControl>
                        <Input placeholder="Full name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Company name */}
                <FormField
                  control={universalForm.control}
                  name="company_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('impressum_acting_under', 'Acting Under')}</FormLabel>
                      <FormControl>
                        <Input placeholder="Company name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Address */}
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {t('impressum_address', 'Address')}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={universalForm.control}
                    name="address_street"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel className="text-xs text-muted-foreground">Street</FormLabel>
                        <FormControl>
                          <Input placeholder="Street address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={universalForm.control}
                    name="address_zip_city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">ZIP / City</FormLabel>
                        <FormControl>
                          <Input placeholder="ZIP / City" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={universalForm.control}
                  name="address_country"
                  render={({ field }) => (
                    <FormItem className="max-w-xs">
                      <FormLabel className="text-xs text-muted-foreground">Country</FormLabel>
                      <FormControl>
                        <Input placeholder="Country" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={universalForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        {t('impressum_phone', 'Phone')}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="+30..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={universalForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />
                        {t('impressum_email', 'E-Mail')}
                      </FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="info@..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" disabled={universalMutation.isPending}>
                {universalMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Contact & Address
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* ── Per-language translated details ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t('impressum_legal_form', 'Legal Details')} — Translations
          </CardTitle>
          <CardDescription>
            Edit the translated legal details shown on the legal notice page per language.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Language selector */}
          <div className="mb-6">
            <label className="text-sm font-medium mb-1 block">Select Language</label>
            <Select
              value={selectedLang}
              onValueChange={(val) => {
                setSelectedLang(val);
                // Reset form with the new language's values (handled via `values` prop)
                translationForm.reset(
                  settings?.translations?.[val] ?? getTranslationDefaults()
                );
              }}
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Form {...translationForm}>
            <form
              onSubmit={translationForm.handleSubmit((values) => translationMutation.mutate(values))}
              className="space-y-4"
            >
              {/* Legal Form Detail */}
              <FormField
                control={translationForm.control}
                name="legal_form_detail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {t('impressum_legal_form', 'Legal Form')}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Legal form description…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Register Detail */}
              <FormField
                control={translationForm.control}
                name="register_detail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('impressum_register_entry', 'Register Entry')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Register entry description…"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* VAT Detail */}
              <FormField
                control={translationForm.control}
                name="vat_detail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('impressum_vat_id', 'VAT ID')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="VAT identification description…"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* EU Dispute Text */}
              <FormField
                control={translationForm.control}
                name="eu_dispute_text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('impressum_eu_dispute', 'EU Dispute Resolution')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="EU dispute resolution text… (include the ODR URL)"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Consumer Dispute Text */}
              <FormField
                control={translationForm.control}
                name="consumer_dispute_text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('impressum_consumer_dispute', 'Consumer Dispute Resolution')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Consumer dispute resolution text…"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={translationMutation.isPending}>
                {translationMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save{' '}
                    {SUPPORTED_LANGUAGES.find((l) => l.code === selectedLang)?.label ?? selectedLang} Translation
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ImpressumSettingsForm;
