import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Scissors, AlertTriangle, Euro, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import InventoryLayout from '@/components/inventory/InventoryLayout';
import { getStockSummary, getAlerts, getStockItems } from '@/utils/inventoryApi';
import type { StockSummaryRow, LowStockAlert, StockItem } from '@/types/inventory';

function formatArea(mm2: number): string {
  return (mm2 / 1_000_000).toFixed(2);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

export default function InventoryDashboard() {
  const [summary, setSummary] = useState<StockSummaryRow[]>([]);
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [expandedMaterial, setExpandedMaterial] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [summaryData, alertsData] = await Promise.all([
        getStockSummary(),
        getAlerts(),
      ]);
      setSummary(summaryData || []);
      setAlerts(alertsData || []);
    } catch (err) {
      console.error('Failed to load inventory data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(materialId: string) {
    if (expandedMaterial === materialId) {
      setExpandedMaterial(null);
      setExpandedItems([]);
      return;
    }
    setExpandedMaterial(materialId);
    try {
      const items = await getStockItems({ material_id: materialId, status: 'available' });
      setExpandedItems(items || []);
    } catch {
      setExpandedItems([]);
    }
  }

  const totalValue = summary.reduce((sum, s) => sum + s.total_value, 0);
  const totalAreaM2 = summary.filter(s => s.base_unit === 'm2').reduce((sum, s) => sum + s.total_area_mm2, 0) / 1_000_000;
  const totalRemnants = summary.reduce((sum, s) => sum + s.remnant_count, 0);
  const lowStockCount = alerts.length;

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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Inventory Dashboard</h1>
          <div className="flex gap-2">
            <Link to="/dashboard/inventory/receive">
              <Button>Receive Stock</Button>
            </Link>
            <Link to="/dashboard/inventory/sessions">
              <Button variant="outline">Nesting Sessions</Button>
            </Link>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Value</CardTitle>
              <Euro className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sheet Metal Stock</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalAreaM2.toFixed(1)} m²</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Remnants</CardTitle>
              <Scissors className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalRemnants}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{lowStockCount}</div>
            </CardContent>
          </Card>
        </div>

        {/* Low Stock Alerts Banner */}
        {alerts.length > 0 && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800">
                    {alerts.length} material{alerts.length > 1 ? 's' : ''} below stock threshold
                  </p>
                  <div className="mt-1 space-y-1">
                    {alerts.map(a => (
                      <p key={a.id} className="text-sm text-red-700">
                        {a.material?.name}{a.material?.thickness_mm ? ` ${a.material.thickness_mm}mm` : ''}: {a.current_stock.toFixed(2)} {a.base_unit} (min: {a.threshold} {a.base_unit})
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Materials Table */}
        <Card>
          <CardHeader>
            <CardTitle>Material Stock Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg font-medium">No materials defined yet</p>
                <p className="text-sm mt-1">Start by adding materials and receiving stock.</p>
                <Link to="/dashboard/inventory/receive">
                  <Button className="mt-4">Add First Material</Button>
                </Link>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Material</TableHead>
                    <TableHead>Thickness</TableHead>
                    <TableHead className="text-right">Full Sheets</TableHead>
                    <TableHead className="text-right">Remnants</TableHead>
                    <TableHead className="text-right">Total Area (m²)</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map(row => (
                    <>
                      <TableRow
                        key={row.material_id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleExpand(row.material_id)}
                      >
                        <TableCell>
                          {expandedMaterial === row.material_id
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />
                          }
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.material_name}{row.grade ? ` ${row.grade}` : ''}
                        </TableCell>
                        <TableCell>
                          {row.thickness_mm ? `${row.thickness_mm}mm` : '—'}
                        </TableCell>
                        <TableCell className="text-right">{row.full_sheets}</TableCell>
                        <TableCell className="text-right">{row.remnant_count}</TableCell>
                        <TableCell className="text-right">
                          {row.base_unit === 'm2' ? formatArea(row.total_area_mm2) : row.total_quantity.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(row.total_value)}</TableCell>
                        <TableCell>
                          {row.is_low_stock ? (
                            <Badge variant="destructive">Low</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-green-100 text-green-800">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {expandedMaterial === row.material_id && expandedItems.length > 0 && (
                        <TableRow key={`${row.material_id}-items`}>
                          <TableCell colSpan={8} className="bg-gray-50 p-0">
                            <div className="p-4">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>ID</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Dimensions</TableHead>
                                    <TableHead>Remaining Area</TableHead>
                                    <TableHead>Location</TableHead>
                                    <TableHead>QR Code</TableHead>
                                    <TableHead>Received</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {expandedItems.map(item => (
                                    <TableRow key={item.id}>
                                      <TableCell className="font-mono text-xs">
                                        {item.id.slice(0, 8)}...
                                      </TableCell>
                                      <TableCell>
                                        <Badge variant={item.origin === 'remnant' ? 'outline' : 'secondary'}>
                                          {item.origin}
                                        </Badge>
                                      </TableCell>
                                      <TableCell>
                                        {item.width_mm && item.height_mm
                                          ? `${item.width_mm} × ${item.height_mm} mm`
                                          : '—'
                                        }
                                      </TableCell>
                                      <TableCell>
                                        {item.remaining_area_mm2
                                          ? `${formatArea(item.remaining_area_mm2)} m²`
                                          : item.remaining_quantity != null
                                          ? item.remaining_quantity.toFixed(1)
                                          : '—'
                                        }
                                      </TableCell>
                                      <TableCell>{item.location || '—'}</TableCell>
                                      <TableCell className="font-mono text-xs">
                                        {item.qr_code || '—'}
                                      </TableCell>
                                      <TableCell>{item.received_date || '—'}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </InventoryLayout>
  );
}
