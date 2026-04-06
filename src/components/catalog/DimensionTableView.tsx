import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DIMENSION_FIELDS } from '@/types/catalog';
import type { CatalogMaterial, CatalogFormFactor } from '@/types/catalog';

interface DimensionTableViewProps {
  materials: CatalogMaterial[];
  formFactor: CatalogFormFactor;
}

export default function DimensionTableView({ materials, formFactor }: DimensionTableViewProps) {
  const dimFields = DIMENSION_FIELDS[formFactor] || [];

  // Group materials by grade
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogMaterial[]>();
    materials.forEach(m => {
      const list = map.get(m.material_grade) || [];
      list.push(m);
      map.set(m.material_grade, list);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [materials]);

  if (materials.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
        <p className="text-sm text-slate-500">No dimensions to display.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([grade, items]) => (
        <div key={grade} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-800 px-4 py-2.5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white tracking-wide">{grade}</h3>
            <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px]">
              {items.length} size{items.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {dimFields.map(f => (
                    <th key={f.key} className="text-left px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {f.label} {f.unit && <span className="text-slate-400">({f.unit})</span>}
                    </th>
                  ))}
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Finish</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Stock</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Weight</th>
                  <th className="text-center px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m, idx) => {
                  const dims = m.dimensions as Record<string, number | string>;
                  const hasStock = m.stock_quantity > 0;
                  return (
                    <tr
                      key={m.id}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50 transition-colors',
                        idx % 2 === 1 && 'bg-slate-25'
                      )}
                    >
                      {dimFields.map(f => (
                        <td key={f.key} className="px-4 py-2 font-mono text-xs text-slate-700">
                          {dims[f.key] !== undefined ? String(dims[f.key]) : '—'}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-xs text-slate-600">
                        {m.surface_finish || '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={cn(
                          'font-mono text-xs font-medium',
                          hasStock ? 'text-emerald-600' : 'text-red-500'
                        )}>
                          {m.stock_quantity}
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1">{m.stock_unit}</span>
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-slate-500 font-mono">
                        {m.weight_per_unit ? `${m.weight_per_unit} kg` : '—'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {hasStock ? (
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="In stock" />
                        ) : (
                          <span className="inline-block h-2 w-2 rounded-full bg-red-400" title="Out of stock" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
