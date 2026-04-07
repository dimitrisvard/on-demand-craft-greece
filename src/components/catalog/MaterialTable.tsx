import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, MapPin, Scissors, ExternalLink } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDimensions } from '@/types/catalog';
import type { CatalogMaterial } from '@/types/catalog';
import MaterialDetailPanel from './MaterialDetailPanel';

interface MaterialTableProps {
  materials: CatalogMaterial[];
  loading?: boolean;
}

function stockLevel(qty: number, alert: number): 'green' | 'yellow' | 'red' {
  if (qty <= 0) return 'red';
  if (alert > 0 && qty <= alert) return 'yellow';
  return 'green';
}

const STOCK_COLORS = {
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  yellow: 'bg-amber-100 text-amber-700 border-amber-200',
  red: 'bg-red-100 text-red-700 border-red-200',
};

const STOCK_DOT = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
};

export default function MaterialTable({ materials, loading }: MaterialTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  if (materials.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
        <p className="text-slate-500 text-sm">No materials found matching your filters.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead className="w-10 pl-4" />
            <TableHead className="text-xs font-semibold text-slate-600 uppercase tracking-wider min-w-[180px]">Material</TableHead>
            <TableHead className="text-xs font-semibold text-slate-600 uppercase tracking-wider w-[120px]">Grade</TableHead>
            <TableHead className="text-xs font-semibold text-slate-600 uppercase tracking-wider w-[200px]">Dimensions</TableHead>
            <TableHead className="text-xs font-semibold text-slate-600 uppercase tracking-wider w-[100px]">Finish</TableHead>
            <TableHead className="text-xs font-semibold text-slate-600 uppercase tracking-wider w-[100px] text-right">Stock</TableHead>
            <TableHead className="text-xs font-semibold text-slate-600 uppercase tracking-wider w-[100px] text-right">Price</TableHead>
            <TableHead className="text-xs font-semibold text-slate-600 uppercase tracking-wider w-[100px] text-center">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {materials.map(mat => {
            const isExpanded = expandedId === mat.id;
            const level = stockLevel(mat.stock_quantity, mat.min_stock_alert);

            return (
              <>
              <TableRow
                key={mat.id}
                className="group cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : mat.id)}
              >
                <TableCell className="w-10 pl-4 pr-0">
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4 text-slate-400" />
                    : <ChevronRight className="h-4 w-4 text-slate-400" />
                  }
                </TableCell>

                {/* Name */}
                <TableCell className="min-w-[180px]">
                  <p className="text-sm font-medium text-slate-900 truncate">{mat.name}</p>
                  {mat.standard && (
                    <p className="text-[11px] text-slate-400 mt-0.5">{mat.standard}</p>
                  )}
                </TableCell>

                {/* Grade */}
                <TableCell className="w-[120px]">
                  <Badge variant="outline" className="font-mono text-xs border-slate-300">
                    {mat.material_grade}
                  </Badge>
                </TableCell>

                {/* Dimensions */}
                <TableCell className="w-[200px]">
                  <span className="text-xs text-slate-600 font-mono">
                    {formatDimensions(mat.dimensions, mat.form_factor)}
                  </span>
                </TableCell>

                {/* Finish */}
                <TableCell className="w-[100px]">
                  <span className="text-xs text-slate-500">{mat.surface_finish || '—'}</span>
                </TableCell>

                {/* Stock */}
                <TableCell className="w-[100px] text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', STOCK_DOT[level])} />
                    <span className="text-sm font-medium text-slate-700">
                      {mat.stock_quantity}
                    </span>
                    <span className="text-[10px] text-slate-400">{mat.stock_unit}</span>
                  </div>
                </TableCell>

                {/* Price */}
                <TableCell className="w-[100px] text-right">
                  {mat.price_per_unit ? (
                    <span className="text-sm text-slate-700">
                      {new Intl.NumberFormat('de-DE', { style: 'currency', currency: mat.currency || 'EUR' }).format(mat.price_per_unit)}
                      <span className="text-[10px] text-slate-400">/{mat.stock_unit}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </TableCell>

                {/* Availability */}
                <TableCell className="w-[100px] text-center">
                  <div className="inline-flex items-center gap-1">
                    {mat.is_available ? (
                      <Badge className={cn('text-[10px] border', STOCK_COLORS[level])}>
                        {level === 'red' ? 'Out of Stock' : level === 'yellow' ? 'Low Stock' : 'Available'}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">Unavailable</Badge>
                    )}
                    {mat.cut_to_size && (
                      <Scissors className="h-3 w-3 text-blue-500" title="Cut to size available" />
                    )}
                  </div>
                </TableCell>
              </TableRow>

              {/* Expanded detail panel */}
              {isExpanded && (
                <TableRow key={`${mat.id}-detail`}>
                  <TableCell colSpan={8} className="p-0">
                    <MaterialDetailPanel material={mat} />
                  </TableCell>
                </TableRow>
              )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
