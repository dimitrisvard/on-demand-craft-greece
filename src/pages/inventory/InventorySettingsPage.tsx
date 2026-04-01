import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import InventoryLayout from '@/components/inventory/InventoryLayout';
import { getInventorySettings, updateInventorySettings } from '@/utils/inventoryApi';
import type { InventorySettings, AutomationLevel } from '@/types/inventory';

export default function InventorySettingsPage() {
  const [settings, setSettings] = useState<InventorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getInventorySettings()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await updateInventorySettings({
        automation_level: settings.automation_level,
        auto_batch_time: settings.auto_batch_time,
        timezone: settings.timezone,
        default_sheet_width_mm: settings.default_sheet_width_mm,
        default_sheet_height_mm: settings.default_sheet_height_mm,
        auto_scrap_threshold_utilization: settings.auto_scrap_threshold_utilization,
        max_remnant_depth: settings.max_remnant_depth,
        telegram_chat_id: settings.telegram_chat_id,
        telegram_bot_token: settings.telegram_bot_token,
        send_telegram_alerts: settings.send_telegram_alerts,
        send_email_alerts: settings.send_email_alerts,
        alert_email: settings.alert_email,
      });
      setSettings(updated);
      toast({ title: 'Settings saved' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return (
      <InventoryLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </InventoryLayout>
    );
  }

  return (
    <InventoryLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Inventory Settings</h1>

        {/* Automation Level */}
        <Card>
          <CardHeader>
            <CardTitle>Automation Level</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={settings.automation_level}
              onValueChange={v => setSettings(s => s ? { ...s, automation_level: v as AutomationLevel } : s)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual — Operator controls every step</SelectItem>
                <SelectItem value="semi_automatic">Semi-Automatic — Auto-batch at end of day</SelectItem>
                <SelectItem value="full_automatic">Full Automatic — Auto-batch + auto-remnants</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-gray-500">
              {settings.automation_level === 'manual' && 'Operator manually creates sessions, drags jobs, and makes all decisions.'}
              {settings.automation_level === 'semi_automatic' && 'System auto-creates sessions at end of day. Operator reviews and completes.'}
              {settings.automation_level === 'full_automatic' && 'Fully automated batching. Auto-creates remnants for high utilization sessions.'}
            </p>

            {settings.automation_level !== 'manual' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Auto-batch Time</Label>
                  <Input
                    type="time" value={settings.auto_batch_time}
                    onChange={e => setSettings(s => s ? { ...s, auto_batch_time: e.target.value } : s)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Timezone</Label>
                  <Input
                    value={settings.timezone}
                    onChange={e => setSettings(s => s ? { ...s, timezone: e.target.value } : s)}
                    placeholder="Europe/Athens"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Default Sheet Size */}
        <Card>
          <CardHeader>
            <CardTitle>Default Sheet Size</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Width (mm)</Label>
                <Input
                  type="number"
                  value={settings.default_sheet_width_mm}
                  onChange={e => setSettings(s => s ? { ...s, default_sheet_width_mm: parseFloat(e.target.value) } : s)}
                />
              </div>
              <div className="space-y-1">
                <Label>Height (mm)</Label>
                <Input
                  type="number"
                  value={settings.default_sheet_height_mm}
                  onChange={e => setSettings(s => s ? { ...s, default_sheet_height_mm: parseFloat(e.target.value) } : s)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Nesting Thresholds */}
        <Card>
          <CardHeader>
            <CardTitle>Nesting Thresholds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Auto-scrap Utilization (%)</Label>
                <Input
                  type="number" step="0.5" min="80" max="100"
                  value={settings.auto_scrap_threshold_utilization}
                  onChange={e => setSettings(s => s ? { ...s, auto_scrap_threshold_utilization: parseFloat(e.target.value) } : s)}
                />
                <p className="text-xs text-gray-500">Above this %, leftover is auto-scrapped</p>
              </div>
              <div className="space-y-1">
                <Label>Max Remnant Depth</Label>
                <Input
                  type="number" min="1" max="5"
                  value={settings.max_remnant_depth}
                  onChange={e => setSettings(s => s ? { ...s, max_remnant_depth: parseInt(e.target.value) } : s)}
                />
                <p className="text-xs text-gray-500">Max levels of remnant-of-remnant</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Telegram Alerts</Label>
                <p className="text-xs text-gray-500">Low stock and session completion notifications</p>
              </div>
              <Switch
                checked={settings.send_telegram_alerts}
                onCheckedChange={v => setSettings(s => s ? { ...s, send_telegram_alerts: v } : s)}
              />
            </div>
            {settings.send_telegram_alerts && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Bot Token</Label>
                  <Input
                    type="password"
                    value={settings.telegram_bot_token || ''}
                    onChange={e => setSettings(s => s ? { ...s, telegram_bot_token: e.target.value } : s)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Chat ID</Label>
                  <Input
                    value={settings.telegram_chat_id || ''}
                    onChange={e => setSettings(s => s ? { ...s, telegram_chat_id: e.target.value } : s)}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <div>
                <Label>Email Alerts</Label>
                <p className="text-xs text-gray-500">Send alerts via email</p>
              </div>
              <Switch
                checked={settings.send_email_alerts}
                onCheckedChange={v => setSettings(s => s ? { ...s, send_email_alerts: v } : s)}
              />
            </div>
            {settings.send_email_alerts && (
              <div className="space-y-1">
                <Label>Alert Email</Label>
                <Input
                  type="email"
                  value={settings.alert_email || ''}
                  onChange={e => setSettings(s => s ? { ...s, alert_email: e.target.value } : s)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </InventoryLayout>
  );
}
