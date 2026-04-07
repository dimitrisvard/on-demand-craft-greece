import { useEffect, useState, useCallback } from 'react';
import { Layers, Plus, Play, CheckCircle, Trash2, ArrowRight, Info, Weight, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import InventoryLayout from '@/components/inventory/InventoryLayout';
import SessionCompletionModal from '@/components/inventory/SessionCompletionModal';
import {
  getSessions, createSession, getMaterials,
  addJobsToSession, removeJobFromSession,
  startSession, selectStockForSession,
} from '@/utils/inventoryApi';
import { getCatalogMaterials } from '@/utils/catalogApi';
import type { CatalogMaterial } from '@/types/catalog';
import type { NestingSession, Material, SessionStatus } from '@/types/inventory';

const STATUS_COLORS: Record<SessionStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  ready: 'bg-blue-100 text-blue-800',
  cutting: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function formatArea(mm2: number): string {
  return (mm2 / 1_000_000).toFixed(3);
}

export default function NestingSessionManager() {
  const [sessions, setSessions] = useState<NestingSession[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddJob, setShowAddJob] = useState<string | null>(null);
  const [completingSession, setCompletingSession] = useState<NestingSession | null>(null);
  const [catalogMaterials, setCatalogMaterials] = useState<CatalogMaterial[]>([]);

  // Create session form
  const [createForm, setCreateForm] = useState({ material_id: '', batch_name: '' });

  // Add job form
  const [jobForm, setJobForm] = useState({
    orderId: '', partName: '', quantity: '1', partAreaMm2: '', dxfFileUrl: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessData, matData, catData] = await Promise.all([
        getSessions(),
        getMaterials(),
        getCatalogMaterials().catch(() => [] as CatalogMaterial[]),
      ]);
      setSessions(sessData || []);
      setMaterials(matData || []);
      setCatalogMaterials(catData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleCreateSession() {
    if (!createForm.material_id) return;
    try {
      await createSession({
        material_id: createForm.material_id,
        batch_name: createForm.batch_name || undefined,
      });
      setShowCreate(false);
      setCreateForm({ material_id: '', batch_name: '' });
      toast({ title: 'Session created' });
      loadData();
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  }

  async function handleAddJob(sessionId: string) {
    if (!jobForm.orderId || !jobForm.partName) return;
    try {
      await addJobsToSession(sessionId, [{
        orderId: jobForm.orderId,
        partName: jobForm.partName,
        quantity: parseInt(jobForm.quantity) || 1,
        partAreaMm2: jobForm.partAreaMm2 ? parseFloat(jobForm.partAreaMm2) : undefined,
        dxfFileUrl: jobForm.dxfFileUrl || undefined,
      }]);
      setShowAddJob(null);
      setJobForm({ orderId: '', partName: '', quantity: '1', partAreaMm2: '', dxfFileUrl: '' });
      toast({ title: 'Job added to session' });
      loadData();
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  }

  async function handleRemoveJob(sessionId: string, jobId: string) {
    try {
      await removeJobFromSession(sessionId, jobId);
      toast({ title: 'Job removed' });
      loadData();
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  }

  async function handleStartCutting(sessionId: string) {
    try {
      await startSession(sessionId);
      toast({ title: 'Cutting started' });
      loadData();
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  }

  function getMaterialName(materialId: string): string {
    const m = materials.find(mat => mat.id === materialId);
    if (!m) return 'Unknown';
    return `${m.name}${m.grade ? ' ' + m.grade : ''}${m.thickness_mm ? ' — ' + m.thickness_mm + 'mm' : ''}`;
  }

  /**
   * Calculate sheet weight and price for a nesting session.
   * Weight = totalAreaNeeded (m²) × thickness (m) × density (kg/m³)
   * Price  = weight (kg) × price_per_kg (EUR/kg)
   *
   * Uses inventory material for density/thickness, catalog material for price_per_kg.
   */
  function getSheetCostInfo(session: NestingSession): {
    weightKg: number | null;
    pricePerKg: number | null;
    totalPrice: number | null;
    sheetAreaM2: number | null;
  } {
    const mat = materials.find(m => m.id === session.material_id);
    if (!mat) return { weightKg: null, pricePerKg: null, totalPrice: null, sheetAreaM2: null };

    const totalAreaMm2 = session.total_part_area_mm2;
    if (!totalAreaMm2) return { weightKg: null, pricePerKg: null, totalPrice: null, sheetAreaM2: null };

    const sheetAreaM2 = totalAreaMm2 / 1_000_000;

    // Compute weight: area(m²) × thickness(m) × density(kg/m³)
    let weightKg: number | null = null;
    if (mat.thickness_mm && mat.density_kg_per_m3) {
      const thicknessM = mat.thickness_mm / 1000;
      weightKg = sheetAreaM2 * thicknessM * mat.density_kg_per_m3;
    }

    // Find price_per_kg from catalog materials (match by grade/name)
    let pricePerKg: number | null = null;
    const catalogMatch = catalogMaterials.find(cm =>
      cm.material_grade === mat.grade ||
      cm.name.toLowerCase().includes(mat.name.toLowerCase())
    );
    if (catalogMatch && (catalogMatch as any).price_per_kg) {
      pricePerKg = (catalogMatch as any).price_per_kg;
    }

    const totalPrice = weightKg !== null && pricePerKg !== null
      ? weightKg * pricePerKg
      : null;

    return { weightKg, pricePerKg, totalPrice, sheetAreaM2 };
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

  const activeSessions = sessions.filter(s => s.status !== 'completed' && s.status !== 'cancelled');
  const completedSessions = sessions.filter(s => s.status === 'completed');

  return (
    <InventoryLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Nesting Sessions</h1>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Session
          </Button>
        </div>

        {/* Active Sessions */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Active Sessions</h2>
          {activeSessions.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                <Layers className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No active sessions. Create one to start batching jobs.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {activeSessions.map(session => (
                <Card key={session.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {session.batch_name || getMaterialName(session.material_id)}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={STATUS_COLORS[session.status]}>
                          {session.status}
                        </Badge>
                        <span className="text-sm text-gray-500">{session.session_date}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500">{getMaterialName(session.material_id)}</p>
                  </CardHeader>
                  <CardContent>
                    {/* Jobs list */}
                    {session.jobs && session.jobs.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Part</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Part Area</TableHead>
                            <TableHead className="text-right">Total Area</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {session.jobs.map(job => (
                            <TableRow key={job.id}>
                              <TableCell className="font-medium">{job.part_name}</TableCell>
                              <TableCell className="text-right">{job.quantity}</TableCell>
                              <TableCell className="text-right">
                                {job.part_area_mm2 ? `${formatArea(job.part_area_mm2)} m²` : '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {job.total_area_mm2 ? `${formatArea(job.total_area_mm2)} m²` : '—'}
                              </TableCell>
                              <TableCell>
                                {session.status === 'draft' && (
                                  <Button
                                    variant="ghost" size="sm"
                                    onClick={() => handleRemoveJob(session.id, job.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-gray-400 py-2">No jobs added yet</p>
                    )}

                    {/* Session stats */}
                    {session.total_part_area_mm2 && (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                          <span>Total area: <strong>{formatArea(session.total_part_area_mm2)} m²</strong></span>
                          {session.total_sheets_needed && (
                            <span>Sheets needed: <strong>{session.total_sheets_needed}</strong></span>
                          )}
                          {session.avg_utilization && (
                            <span>Utilization: <strong>{session.avg_utilization}%</strong></span>
                          )}
                        </div>

                        {/* Material cost info */}
                        {(() => {
                          const costInfo = getSheetCostInfo(session);
                          if (!costInfo.weightKg && !costInfo.totalPrice) return null;
                          return (
                            <div className="flex flex-wrap gap-3 items-center p-2 rounded-md bg-blue-50 border border-blue-200 text-sm">
                              <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />
                              {costInfo.weightKg !== null && (
                                <span className="flex items-center gap-1 text-gray-700">
                                  <Weight className="h-3.5 w-3.5 text-gray-400" />
                                  Weight: <strong>{costInfo.weightKg.toFixed(2)} kg</strong>
                                </span>
                              )}
                              {costInfo.pricePerKg !== null && (
                                <span className="text-gray-500">
                                  @ {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(costInfo.pricePerKg)}/kg
                                </span>
                              )}
                              {costInfo.totalPrice !== null && (
                                <span className="flex items-center gap-1 text-gray-700 font-semibold">
                                  <DollarSign className="h-3.5 w-3.5 text-green-600" />
                                  Material cost: {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(costInfo.totalPrice)}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="mt-4 flex gap-2">
                      {session.status === 'draft' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setShowAddJob(session.id)}>
                            <Plus className="h-3 w-3 mr-1" />
                            Add Job
                          </Button>
                          <Button size="sm" onClick={() => handleStartCutting(session.id)}>
                            <Play className="h-3 w-3 mr-1" />
                            Start Cutting
                          </Button>
                        </>
                      )}
                      {session.status === 'ready' && (
                        <Button size="sm" onClick={() => handleStartCutting(session.id)}>
                          <Play className="h-3 w-3 mr-1" />
                          Start Cutting
                        </Button>
                      )}
                      {session.status === 'cutting' && (
                        <Button size="sm" onClick={() => setCompletingSession(session)}>
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Complete Session
                        </Button>
                      )}
                      {(session.status === 'draft' || session.status === 'ready') && (
                        <Button size="sm" variant="outline" onClick={() => setCompletingSession(session)}>
                          <ArrowRight className="h-3 w-3 mr-1" />
                          Quick Complete
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Completed Sessions */}
        {completedSessions.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Completed Sessions</h2>
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Sheets Used</TableHead>
                      <TableHead className="text-right">Utilization</TableHead>
                      <TableHead>Completed By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedSessions.slice(0, 20).map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {s.batch_name || s.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>{getMaterialName(s.material_id)}</TableCell>
                        <TableCell>{s.session_date}</TableCell>
                        <TableCell className="text-right">{s.actual_sheets_used || '—'}</TableCell>
                        <TableCell className="text-right">
                          {s.actual_utilization ? `${s.actual_utilization}%` : s.avg_utilization ? `${s.avg_utilization}%` : '—'}
                        </TableCell>
                        <TableCell>{s.completed_by || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create Session Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Nesting Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Material *</Label>
              <Select value={createForm.material_id} onValueChange={v => setCreateForm(p => ({ ...p, material_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select material..." /></SelectTrigger>
                <SelectContent>
                  {materials.filter(m => m.category === 'sheet_metal').map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}{m.grade ? ` ${m.grade}` : ''}{m.thickness_mm ? ` — ${m.thickness_mm}mm` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Session Name</Label>
              <Input
                value={createForm.batch_name}
                onChange={e => setCreateForm(p => ({ ...p, batch_name: e.target.value }))}
                placeholder="e.g. Inox 2mm — April 1 afternoon"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreateSession} disabled={!createForm.material_id}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Job Dialog */}
      <Dialog open={!!showAddJob} onOpenChange={() => setShowAddJob(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Job to Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Order ID *</Label>
              <Input value={jobForm.orderId} onChange={e => setJobForm(p => ({ ...p, orderId: e.target.value }))} placeholder="Order UUID or reference" />
            </div>
            <div className="space-y-2">
              <Label>Part Name *</Label>
              <Input value={jobForm.partName} onChange={e => setJobForm(p => ({ ...p, partName: e.target.value }))} placeholder="e.g. Bracket A" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input type="number" min="1" value={jobForm.quantity} onChange={e => setJobForm(p => ({ ...p, quantity: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Part Area (mm²)</Label>
                <Input type="number" value={jobForm.partAreaMm2} onChange={e => setJobForm(p => ({ ...p, partAreaMm2: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddJob(null)}>Cancel</Button>
            <Button onClick={() => showAddJob && handleAddJob(showAddJob)} disabled={!jobForm.orderId || !jobForm.partName}>
              Add Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session Completion Modal */}
      {completingSession && (
        <SessionCompletionModal
          session={completingSession}
          materials={materials}
          onClose={() => { setCompletingSession(null); loadData(); }}
        />
      )}
    </InventoryLayout>
  );
}
