import { useEffect, useState } from 'react';
import { FileText, MapPin, Download, Clock, Shield, Truck, Package } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatDimensions, DIMENSION_FIELDS } from '@/types/catalog';
import type { CatalogMaterial, MaterialDocument, CatalogStockLog } from '@/types/catalog';
import { getDocuments, getStockLog } from '@/utils/catalogApi';

interface MaterialDetailPanelProps {
  material: CatalogMaterial;
}

export default function MaterialDetailPanel({ material: mat }: MaterialDetailPanelProps) {
  const [documents, setDocuments] = useState<MaterialDocument[]>([]);
  const [stockLog, setStockLog] = useState<CatalogStockLog[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  useEffect(() => {
    Promise.all([
      getDocuments({ materialId: mat.id }).catch(() => []),
      getStockLog(mat.id).catch(() => []),
    ]).then(([docs, log]) => {
      setDocuments(docs);
      setStockLog(log);
      setLoadingDocs(false);
    });
  }, [mat.id]);

  const dims = mat.dimensions as Record<string, number | string>;
  const dimFields = DIMENSION_FIELDS[mat.form_factor] || [];

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
      <Tabs defaultValue="specs" className="w-full">
        <TabsList className="bg-white border border-slate-200 h-9">
          <TabsTrigger value="specs" className="text-xs">Specifications</TabsTrigger>
          <TabsTrigger value="dimensions" className="text-xs">Dimension Table</TabsTrigger>
          <TabsTrigger value="documents" className="text-xs">
            Documents {documents.length > 0 && `(${documents.length})`}
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">Stock History</TabsTrigger>
        </TabsList>

        {/* Specs Tab */}
        <TabsContent value="specs" className="mt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SpecItem icon={Package} label="Material Grade" value={mat.material_grade} />
            <SpecItem icon={Shield} label="Standard" value={mat.standard || '—'} />
            <SpecItem icon={Shield} label="Certification" value={mat.certification || '—'} />
            <SpecItem label="Surface Finish" value={mat.surface_finish || '—'} />
            <SpecItem icon={MapPin} label="Location" value={mat.location || '—'} />
            <SpecItem icon={Truck} label="Supplier" value={mat.supplier || '—'} />
            <SpecItem label="Supplier SKU" value={mat.supplier_sku || '—'} />
            <SpecItem label="Weight/Unit" value={mat.weight_per_unit ? `${mat.weight_per_unit} kg` : '—'} />
            <SpecItem label="Cut to Size" value={mat.cut_to_size ? 'Yes' : 'No'} />
            <SpecItem label="Min Stock Alert" value={`${mat.min_stock_alert} ${mat.stock_unit}`} />
          </div>
          {mat.notes && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              <strong className="text-xs uppercase tracking-wide">Notes:</strong>
              <p className="mt-1">{mat.notes}</p>
            </div>
          )}
        </TabsContent>

        {/* Dimension Table Tab */}
        <TabsContent value="dimensions" className="mt-3">
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100">
                  {dimFields.map(f => (
                    <th key={f.key} className="text-left px-4 py-2 text-xs font-semibold text-slate-600 uppercase">
                      {f.label} {f.unit && <span className="text-slate-400">({f.unit})</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  {dimFields.map(f => (
                    <td key={f.key} className="px-4 py-2.5 font-mono text-slate-700">
                      {dims[f.key] !== undefined ? String(dims[f.key]) : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Full dimension: {formatDimensions(mat.dimensions, mat.form_factor)}
          </p>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-3">
          {loadingDocs ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-slate-400">No documents attached to this material.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map(doc => (
                <li key={doc.id} className="flex items-center gap-3 p-2 bg-white rounded border border-slate-200">
                  <FileText className="h-4 w-4 text-red-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{doc.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {doc.doc_type.replace(/_/g, ' ')}
                      {doc.file_size_bytes && ` · ${(doc.file_size_bytes / 1024).toFixed(0)} KB`}
                    </p>
                  </div>
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Stock History Tab */}
        <TabsContent value="history" className="mt-3">
          {stockLog.length === 0 ? (
            <p className="text-sm text-slate-400">No stock changes recorded.</p>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden max-h-[300px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Date</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Type</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">Change</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">After</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {stockLog.map(entry => (
                    <tr key={entry.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {entry.change_type.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono text-xs ${entry.quantity_change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {entry.quantity_change >= 0 ? '+' : ''}{entry.quantity_change}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-600">
                        {entry.quantity_after}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500 truncate max-w-[200px]">
                        {entry.reason || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SpecItem({ icon: Icon, label, value }: { icon?: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      {Icon && <Icon className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-slate-700 mt-0.5">{value}</p>
      </div>
    </div>
  );
}
