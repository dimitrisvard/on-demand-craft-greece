import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Save, GripVertical } from 'lucide-react';
import type { CapabilityRegistry, TenantCapability } from '@/types/tenant';

interface Props {
  capRegistry: CapabilityRegistry[];
  tenantCaps: TenantCapability[];
  onSave: (caps: { capability: string; is_enabled: boolean; sort_order: number }[]) => Promise<void>;
}

interface LocalCap {
  capability: string;
  label: string;
  category: string | null;
  is_enabled: boolean;
  sort_order: number;
}

export default function TenantCapabilitiesTab({ capRegistry, tenantCaps, onSave }: Props) {
  const [localCaps, setLocalCaps] = useState<LocalCap[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const merged = capRegistry.map((reg) => {
      const tc = tenantCaps.find((c) => c.capability === reg.key);
      return {
        capability: reg.key,
        label: reg.label,
        category: reg.category,
        is_enabled: tc ? tc.is_enabled : true,
        sort_order: tc ? tc.sort_order : reg.sort_order,
      };
    });
    merged.sort((a, b) => a.sort_order - b.sort_order);
    setLocalCaps(merged);
  }, [capRegistry, tenantCaps]);

  const toggleCapability = (key: string) => {
    setLocalCaps((prev) =>
      prev.map((c) => (c.capability === key ? { ...c, is_enabled: !c.is_enabled } : c))
    );
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setLocalCaps((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((c, i) => ({ ...c, sort_order: i }));
    });
  };

  const moveDown = (index: number) => {
    if (index === localCaps.length - 1) return;
    setLocalCaps((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((c, i) => ({ ...c, sort_order: i }));
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(
        localCaps.map((c) => ({
          capability: c.capability,
          is_enabled: c.is_enabled,
          sort_order: c.sort_order,
        }))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Enabled Capabilities</CardTitle>
        <p className="text-sm text-muted-foreground">
          Toggle each service ON/OFF for this tenant's quote form. Use arrows to reorder.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {localCaps.map((cap, index) => (
            <div
              key={cap.capability}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveUp(index)}
                    className="text-muted-foreground hover:text-foreground text-xs leading-none"
                    disabled={index === 0}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveDown(index)}
                    className="text-muted-foreground hover:text-foreground text-xs leading-none"
                    disabled={index === localCaps.length - 1}
                  >
                    ▼
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">{cap.label}</p>
                  {cap.category && (
                    <p className="text-xs text-muted-foreground capitalize">{cap.category}</p>
                  )}
                </div>
              </div>
              <Switch
                checked={cap.is_enabled}
                onCheckedChange={() => toggleCapability(cap.capability)}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-6">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Capabilities'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
