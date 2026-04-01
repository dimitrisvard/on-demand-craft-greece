import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { completeSession, selectStockForSession, getLabelUrl } from '@/utils/inventoryApi';
import type { NestingSession, Material, SessionCompletionSheetInput, SelectedStock } from '@/types/inventory';

interface Props {
  session: NestingSession;
  materials: Material[];
  onClose: () => void;
}

interface SheetDecision {
  stockItemId: string;
  stockLabel: string;
  consumedAreaMm2: number;
  utilization: number;
  leftoverAction: 'remnant' | 'scrap' | 'fully_consumed';
  remnantWidthMm: string;
  remnantHeightMm: string;
  remnantLocation: string;
  scrapWeightKg: string;
}

export default function SessionCompletionModal({ session, materials, onClose }: Props) {
  const material = materials.find(m => m.id === session.material_id);
  const [step, setStep] = useState(0); // 0 = stock selection, 1+ = per-sheet decisions
  const [availableStock, setAvailableStock] = useState<SelectedStock[]>([]);
  const [sheetsNeeded, setSheetsNeeded] = useState(session.total_sheets_needed || 1);
  const [sheetDecisions, setSheetDecisions] = useState<SheetDecision[]>([]);
  const [operatorNotes, setOperatorNotes] = useState('');
  const [completedBy, setCompletedBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ newRemnants: Array<{ id: string; width: number; height: number; qrCode: string }> } | null>(null);

  useEffect(() => {
    loadAvailableStock();
  }, []);

  async function loadAvailableStock() {
    try {
      const res = await selectStockForSession({
        materialId: session.material_id,
        sheetsNeeded: sheetsNeeded,
      });
      setAvailableStock(res.data || []);

      // Initialize sheet decisions
      const decisions: SheetDecision[] = [];
      for (let i = 0; i < sheetsNeeded; i++) {
        const stock = res.data?.[i];
        decisions.push({
          stockItemId: stock?.stock_item_id || '',
          stockLabel: stock
            ? `${stock.width_mm}×${stock.height_mm}mm ${stock.is_remnant ? '(remnant)' : '(full sheet)'} — ${stock.location || 'no location'}`
            : 'No stock available',
          consumedAreaMm2: session.total_part_area_mm2 ? session.total_part_area_mm2 / sheetsNeeded : 0,
          utilization: session.avg_utilization || 70,
          leftoverAction: 'remnant',
          remnantWidthMm: '',
          remnantHeightMm: '',
          remnantLocation: stock?.location || '',
          scrapWeightKg: '',
        });
      }
      setSheetDecisions(decisions);
      setStep(1);
    } catch (err) {
      console.error(err);
      toast({ title: 'Error loading stock', variant: 'destructive' });
    }
  }

  function updateDecision(index: number, updates: Partial<SheetDecision>) {
    setSheetDecisions(prev => prev.map((d, i) => i === index ? { ...d, ...updates } : d));
  }

  async function handleSubmit() {
    if (!completedBy.trim()) {
      toast({ title: 'Enter operator name', variant: 'destructive' });
      return;
    }

    const sheets: SessionCompletionSheetInput[] = sheetDecisions.map((d, i) => ({
      sheetIndex: i,
      stockItemId: d.stockItemId,
      consumedAreaMm2: d.consumedAreaMm2,
      utilization: d.utilization,
      leftoverAction: d.leftoverAction,
      ...(d.leftoverAction === 'remnant' && {
        remnantWidthMm: parseFloat(d.remnantWidthMm) || undefined,
        remnantHeightMm: parseFloat(d.remnantHeightMm) || undefined,
        remnantLocation: d.remnantLocation || undefined,
      }),
      ...(d.leftoverAction === 'scrap' && {
        scrapWeightKg: parseFloat(d.scrapWeightKg) || undefined,
      }),
    }));

    // Validate remnant dimensions
    for (const s of sheets) {
      if (s.leftoverAction === 'remnant' && (!s.remnantWidthMm || !s.remnantHeightMm)) {
        toast({ title: 'Enter remnant dimensions for all remnant sheets', variant: 'destructive' });
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await completeSession({
        sessionId: session.id,
        sheets,
        operatorNotes: operatorNotes || undefined,
        completedBy,
      });
      setResult(res as unknown as typeof result);
      toast({ title: 'Session completed successfully' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  const currentSheet = sheetDecisions[step - 1];

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {result
              ? 'Session Completed'
              : step === 0
              ? 'Loading stock...'
              : `Sheet ${step} of ${sheetsNeeded} — ${material?.name || 'Unknown'}${material?.thickness_mm ? ` ${material.thickness_mm}mm` : ''}`
            }
          </DialogTitle>
        </DialogHeader>

        {/* Success state */}
        {result && (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 text-green-800">
              <p className="font-medium">Session completed successfully.</p>
              <p className="text-sm mt-1">{sheetDecisions.length} sheet(s) consumed.</p>
              {result.newRemnants.length > 0 && (
                <p className="text-sm mt-1">{result.newRemnants.length} remnant(s) created.</p>
              )}
            </div>
            {result.newRemnants.map(r => (
              <div key={r.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="font-medium text-sm">Remnant: {r.width}×{r.height}mm</p>
                  <p className="text-xs text-gray-500">QR: {r.qrCode}</p>
                </div>
                <a href={getLabelUrl(r.id)} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline">Print Label</Button>
                </a>
              </div>
            ))}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        )}

        {/* Loading state */}
        {!result && step === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {/* Sheet decision state */}
        {!result && step > 0 && currentSheet && (
          <div className="space-y-4">
            {/* Stock info */}
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-sm font-medium">Stock: {currentSheet.stockLabel}</p>
              <div className="flex gap-4 mt-1 text-sm text-gray-600">
                <span>Consumed: {(currentSheet.consumedAreaMm2 / 1_000_000).toFixed(3)} m²</span>
                <span>Utilization: {currentSheet.utilization}%</span>
              </div>
            </div>

            {/* Consumed area */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Consumed Area (mm²)</Label>
                <Input
                  type="number"
                  value={currentSheet.consumedAreaMm2}
                  onChange={e => updateDecision(step - 1, { consumedAreaMm2: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1">
                <Label>Utilization (%)</Label>
                <Input
                  type="number" step="0.1" min="0" max="100"
                  value={currentSheet.utilization}
                  onChange={e => updateDecision(step - 1, { utilization: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            {/* Leftover action */}
            <div className="space-y-2">
              <Label>What happened to the leftover?</Label>
              <div className="flex gap-2">
                {[
                  { value: 'remnant' as const, label: 'Usable Remnant', color: 'bg-green-100 text-green-800 border-green-300' },
                  { value: 'scrap' as const, label: 'Scrap', color: 'bg-red-100 text-red-800 border-red-300' },
                  { value: 'fully_consumed' as const, label: 'Fully Used', color: 'bg-gray-100 text-gray-800 border-gray-300' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateDecision(step - 1, { leftoverAction: opt.value })}
                    className={`flex-1 rounded-lg border-2 p-3 text-center text-sm font-medium transition-all ${
                      currentSheet.leftoverAction === opt.value
                        ? opt.color + ' border-current'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Remnant details */}
            {currentSheet.leftoverAction === 'remnant' && (
              <div className="space-y-3 border rounded-lg p-3 bg-green-50">
                <p className="text-sm font-medium text-green-800">Remnant Dimensions</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Width (mm)</Label>
                    <Input
                      type="number" placeholder="mm"
                      value={currentSheet.remnantWidthMm}
                      onChange={e => updateDecision(step - 1, { remnantWidthMm: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Height (mm)</Label>
                    <Input
                      type="number" placeholder="mm"
                      value={currentSheet.remnantHeightMm}
                      onChange={e => updateDecision(step - 1, { remnantHeightMm: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Location</Label>
                    <Input
                      placeholder="Rack A3"
                      value={currentSheet.remnantLocation}
                      onChange={e => updateDecision(step - 1, { remnantLocation: e.target.value })}
                    />
                  </div>
                </div>
                {currentSheet.remnantWidthMm && currentSheet.remnantHeightMm && (
                  <p className="text-xs text-green-700">
                    Remnant area: {((parseFloat(currentSheet.remnantWidthMm) * parseFloat(currentSheet.remnantHeightMm)) / 1_000_000).toFixed(3)} m²
                  </p>
                )}
              </div>
            )}

            {/* Scrap details */}
            {currentSheet.leftoverAction === 'scrap' && (
              <div className="space-y-2 border rounded-lg p-3 bg-red-50">
                <Label className="text-xs text-red-800">Scrap Weight (kg)</Label>
                <Input
                  type="number" step="0.1" placeholder="kg"
                  value={currentSheet.scrapWeightKg}
                  onChange={e => updateDecision(step - 1, { scrapWeightKg: e.target.value })}
                />
              </div>
            )}

            {/* Final step: operator info */}
            {step === sheetsNeeded && (
              <div className="border-t pt-4 space-y-3">
                <div className="space-y-1">
                  <Label>Operator Name *</Label>
                  <Input value={completedBy} onChange={e => setCompletedBy(e.target.value)} placeholder="Your name" />
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Textarea value={operatorNotes} onChange={e => setOperatorNotes(e.target.value)} rows={2} placeholder="Optional notes..." />
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>Previous</Button>
              )}
              {step < sheetsNeeded ? (
                <Button onClick={() => setStep(step + 1)} disabled={!currentSheet.stockItemId}>
                  Next Sheet
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={submitting || !currentSheet.stockItemId}>
                  {submitting ? 'Completing...' : 'Complete Session'}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
