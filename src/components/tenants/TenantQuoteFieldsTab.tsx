import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, Star } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { CapabilityRegistry, TenantCapability, QuoteFieldRegistry, TenantQuoteField } from '@/types/tenant';

interface Props {
  capRegistry: CapabilityRegistry[];
  tenantCaps: TenantCapability[];
  fieldRegistry: QuoteFieldRegistry[];
  tenantFields: TenantQuoteField[];
  onSave: (fields: { capability: string; field_key: string; is_visible: boolean; is_required: boolean; sort_order: number }[]) => Promise<void>;
}

interface LocalField {
  capability: string;
  field_key: string;
  label: string;
  field_type: string;
  is_visible: boolean;
  is_required: boolean;
  sort_order: number;
}

export default function TenantQuoteFieldsTab({ capRegistry, tenantCaps, fieldRegistry, tenantFields, onSave }: Props) {
  const [selectedCap, setSelectedCap] = useState<string>('');
  const [localFields, setLocalFields] = useState<LocalField[]>([]);
  const [saving, setSaving] = useState(false);

  // Get enabled capabilities
  const enabledCaps = capRegistry.filter((cr) => {
    const tc = tenantCaps.find((c) => c.capability === cr.key);
    return tc ? tc.is_enabled : false;
  });

  useEffect(() => {
    if (enabledCaps.length > 0 && !selectedCap) {
      setSelectedCap(enabledCaps[0].key);
    }
  }, [enabledCaps]);

  useEffect(() => {
    if (!selectedCap) return;

    const regFields = fieldRegistry.filter((f) => f.capability === selectedCap);
    const merged: LocalField[] = regFields.map((rf) => {
      const override = tenantFields.find(
        (tf) => tf.capability === selectedCap && tf.field_key === rf.field_key
      );
      return {
        capability: selectedCap,
        field_key: rf.field_key,
        label: rf.label,
        field_type: rf.field_type,
        is_visible: override ? override.is_visible : true,
        is_required: override ? override.is_required : false,
        sort_order: override ? override.sort_order : rf.sort_order,
      };
    });
    merged.sort((a, b) => a.sort_order - b.sort_order);
    setLocalFields(merged);
  }, [selectedCap, fieldRegistry, tenantFields]);

  const toggleVisible = (fieldKey: string) => {
    setLocalFields((prev) =>
      prev.map((f) =>
        f.field_key === fieldKey
          ? { ...f, is_visible: !f.is_visible, is_required: !f.is_visible ? f.is_required : false }
          : f
      )
    );
  };

  const toggleRequired = (fieldKey: string) => {
    setLocalFields((prev) =>
      prev.map((f) => (f.field_key === fieldKey ? { ...f, is_required: !f.is_required } : f))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(
        localFields.map((f) => ({
          capability: f.capability,
          field_key: f.field_key,
          is_visible: f.is_visible,
          is_required: f.is_required,
          sort_order: f.sort_order,
        }))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Quote Form Field Configuration</CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure which fields appear in the quote form for each capability.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-6">
          <Select value={selectedCap} onValueChange={setSelectedCap}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select capability" />
            </SelectTrigger>
            <SelectContent>
              {enabledCaps.map((cap) => (
                <SelectItem key={cap.key} value={cap.key}>
                  {cap.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {localFields.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">
            {selectedCap ? 'No fields defined for this capability' : 'Select a capability to configure fields'}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_80px_60px] gap-4 px-3 py-2 text-sm font-medium text-muted-foreground">
              <span>Field</span>
              <span className="text-center">Visible</span>
              <span className="text-center">Required</span>
              <span className="text-center">Type</span>
            </div>
            {localFields.map((field) => (
              <div
                key={field.field_key}
                className="grid grid-cols-[1fr_80px_80px_60px] gap-4 items-center p-3 rounded-lg border bg-card"
              >
                <div>
                  <p className="font-medium">{field.label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{field.field_key}</p>
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={field.is_visible}
                    onCheckedChange={() => toggleVisible(field.field_key)}
                  />
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={() => toggleRequired(field.field_key)}
                    disabled={!field.is_visible}
                    className={`p-1 rounded ${
                      field.is_required
                        ? 'text-amber-500'
                        : 'text-muted-foreground/30 hover:text-muted-foreground/50'
                    } ${!field.is_visible ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <Star className="h-5 w-5" fill={field.is_required ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <div className="flex justify-center">
                  <Badge variant="outline" className="text-xs">
                    {field.field_type}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end mt-6">
          <Button onClick={handleSave} disabled={saving || localFields.length === 0} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Field Configuration'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
