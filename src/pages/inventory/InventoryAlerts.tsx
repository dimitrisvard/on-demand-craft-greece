import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import InventoryLayout from '@/components/inventory/InventoryLayout';
import { getAlerts, resolveAlert } from '@/utils/inventoryApi';
import type { LowStockAlert } from '@/types/inventory';

export default function InventoryAlerts() {
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAlerts();
  }, []);

  async function loadAlerts() {
    setLoading(true);
    try {
      const data = await getAlerts();
      setAlerts(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(alertId: string) {
    try {
      await resolveAlert(alertId);
      toast({ title: 'Alert resolved' });
      loadAlerts();
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  }

  if (loading) {
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
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Low Stock Alerts</h1>

        {alerts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-400" />
              <p className="text-lg font-medium">All stock levels are healthy</p>
              <p className="text-sm mt-1">No materials are below their minimum threshold.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {alerts.map(alert => (
              <Card key={alert.id} className="border-red-200">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                      <div>
                        <p className="font-medium">
                          {alert.material?.name || 'Unknown'}
                          {alert.material?.thickness_mm ? ` — ${alert.material.thickness_mm}mm` : ''}
                        </p>
                        <p className="text-sm text-gray-600 mt-0.5">
                          Current: <strong>{alert.current_stock.toFixed(2)} {alert.base_unit === 'm2' ? 'm²' : alert.base_unit}</strong>
                          {' '}/ Threshold: {alert.threshold} {alert.base_unit === 'm2' ? 'm²' : alert.base_unit}
                        </p>
                        <div className="flex gap-2 mt-1">
                          {alert.alert_sent && (
                            <Badge variant="outline" className="text-xs">
                              Alert sent via {alert.alert_channel || 'telegram'}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {new Date(alert.created_at).toLocaleDateString()}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleResolve(alert.id)}>
                      Resolve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </InventoryLayout>
  );
}
