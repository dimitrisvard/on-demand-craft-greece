import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Box, Ruler, Weight, Layers, ChevronDown, ChevronUp,
  Maximize2, FileText, Eye, Copy, Trash2
} from 'lucide-react';
import { formatVolume, formatWeight, calculateWeight } from '@/utils/materialDensity';

export interface PartSpecs {
  product_name?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
  material?: string;
  process?: string;
  tolerance?: string;
  surfaceRoughness?: string;
  surfaceTreatment?: string;
  dimensions?: { x: number; y: number; z: number };
  volume?: number; // mm³
  surfaceArea?: number; // mm²
  weight?: number; // grams (calculated)
  fileCount?: number;
}

interface PartSpecsCardProps {
  part: PartSpecs;
  index: number;
  currency?: string;
  onView3D?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  showActions?: boolean;
  showPricing?: boolean;
  compact?: boolean;
}

const processBadgeColor: Record<string, string> = {
  'CNC Milling': 'bg-blue-100 text-blue-800',
  'CNC Machining': 'bg-blue-100 text-blue-800',
  'Turning': 'bg-indigo-100 text-indigo-800',
  'Laser Cutting': 'bg-red-100 text-red-800',
  'Sheet Metal': 'bg-slate-100 text-slate-800',
  '3D Printing': 'bg-purple-100 text-purple-800',
  'Injection Molding': 'bg-orange-100 text-orange-800',
};

export default function PartSpecsCard({
  part,
  index,
  currency = 'EUR',
  onView3D,
  onEdit,
  onDuplicate,
  onDelete,
  showActions = true,
  showPricing = true,
  compact = false,
}: PartSpecsCardProps) {
  const [expanded, setExpanded] = useState(!compact);

  const estimatedWeight = part.weight ?? (part.volume && part.material
    ? calculateWeight(part.volume, part.material)
    : null);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(value);

  const processColor = part.process
    ? processBadgeColor[part.process] || 'bg-gray-100 text-gray-800'
    : 'bg-gray-100 text-gray-800';

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-5">
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Part icon */}
          <div className="hidden sm:flex h-10 w-10 rounded-lg bg-slate-100 items-center justify-center flex-shrink-0 mt-0.5">
            <Box className="h-5 w-5 text-slate-500" />
          </div>

          {/* Part info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900 truncate">
                {part.product_name || `Part ${index + 1}`}
              </h3>
              {part.process && (
                <Badge className={`${processColor} border-0 text-xs`}>
                  {part.process}
                </Badge>
              )}
              {part.quantity && part.quantity > 1 && (
                <Badge variant="outline" className="text-xs">
                  Qty: {part.quantity}
                </Badge>
              )}
            </div>

            {/* Quick stats row - always visible */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {part.material && (
                <span className="flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" />
                  {part.material}
                </span>
              )}
              {part.dimensions && (
                <span className="flex items-center gap-1">
                  <Maximize2 className="h-3.5 w-3.5" />
                  {part.dimensions.x.toFixed(1)} x {part.dimensions.y.toFixed(1)} x {part.dimensions.z.toFixed(1)} mm
                </span>
              )}
              {part.volume != null && part.volume > 0 && (
                <span className="flex items-center gap-1">
                  <Ruler className="h-3.5 w-3.5" />
                  {formatVolume(part.volume)}
                </span>
              )}
              {estimatedWeight != null && estimatedWeight > 0 && (
                <span className="flex items-center gap-1">
                  <Weight className="h-3.5 w-3.5" />
                  {formatWeight(estimatedWeight)}
                </span>
              )}
              {part.fileCount != null && part.fileCount > 0 && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {part.fileCount} file{part.fileCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Price + expand */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {showPricing && part.total_price != null && (
              <div className="text-right">
                <p className="font-bold text-gray-900">
                  {formatCurrency(part.total_price)}
                </p>
                {part.unit_price != null && part.quantity != null && part.quantity > 1 && (
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(part.unit_price)} x {part.quantity}
                  </p>
                )}
              </div>
            )}
            {compact && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t">
            {/* Specs grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {part.process && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Process</span>
                  <span className="font-medium">{part.process}</span>
                </div>
              )}
              {part.material && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Material</span>
                  <span className="font-medium">{part.material}</span>
                </div>
              )}
              {part.tolerance && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Tolerance</span>
                  <span className="font-medium">{part.tolerance}</span>
                </div>
              )}
              {part.surfaceRoughness && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Surface Roughness</span>
                  <span className="font-medium">{part.surfaceRoughness}</span>
                </div>
              )}
              {part.surfaceTreatment && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Surface Treatment</span>
                  <span className="font-medium">{part.surfaceTreatment}</span>
                </div>
              )}
              {part.dimensions && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Bounding Box</span>
                  <span className="font-medium">
                    {part.dimensions.x.toFixed(1)} x {part.dimensions.y.toFixed(1)} x {part.dimensions.z.toFixed(1)} mm
                  </span>
                </div>
              )}
              {part.volume != null && part.volume > 0 && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Volume</span>
                  <span className="font-medium">{formatVolume(part.volume)}</span>
                </div>
              )}
              {estimatedWeight != null && estimatedWeight > 0 && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Est. Weight</span>
                  <span className="font-medium">{formatWeight(estimatedWeight)}</span>
                </div>
              )}
              {part.surfaceArea != null && part.surfaceArea > 0 && (
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wide">Surface Area</span>
                  <span className="font-medium">
                    {part.surfaceArea >= 100
                      ? `${(part.surfaceArea / 100).toFixed(2)} cm²`
                      : `${part.surfaceArea.toFixed(1)} mm²`}
                  </span>
                </div>
              )}
            </div>

            {/* Description */}
            {part.description && (
              <div className="mt-3">
                <span className="text-muted-foreground text-xs uppercase tracking-wide">Notes</span>
                <p className="text-sm text-gray-700 mt-1">{part.description}</p>
              </div>
            )}

            {/* Actions */}
            {showActions && (
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
                {onView3D && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={onView3D}>
                    <Eye className="h-3.5 w-3.5" /> View 3D Model
                  </Button>
                )}
                {onEdit && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
                    <FileText className="h-3.5 w-3.5" /> Edit Specs
                  </Button>
                )}
                {onDuplicate && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={onDuplicate}>
                    <Copy className="h-3.5 w-3.5" /> Duplicate
                  </Button>
                )}
                {onDelete && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={onDelete}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
