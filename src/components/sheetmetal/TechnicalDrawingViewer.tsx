import { useMemo } from 'react';
import type { FlatPatternResponse, FlatPatternBend } from '@/utils/serverManufacturingPdf';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface TechnicalDrawingViewerProps {
  flatPattern: FlatPatternResponse | null;
  partName?: string;
  material?: string;
  quantity?: number;
  onDownloadDxf?: () => void;
  onDownloadPdf?: () => void;
}

const STROKE_DARK = '#1A1A2E';
const STROKE_BEND_UP = '#C0392B';
const STROKE_BEND_DOWN = '#2E6EA6';
const FILL_PART = '#F8F9FA';

function buildInlineSvg(
  fp: NonNullable<FlatPatternResponse['flat_pattern']>,
  partName: string,
): string {
  const w = fp.dimensions.width || 0;
  const h = fp.dimensions.height || 0;
  if (w <= 0 || h <= 0) return '';

  const padding = 20;
  const maxWidth = 800;
  const scale = Math.min(maxWidth / w, (maxWidth * 0.6) / h, 6);
  const svgW = w * scale + 2 * padding;
  const svgH = h * scale + 2 * padding + 40;
  const ox = padding;
  const oy = padding + 20;

  const toSvg = (x: number, y: number): [number, number] => [
    ox + x * scale,
    oy + (h - y) * scale,
  ];

  const edgeLines = (fp.outline_edges || [])
    .map((e) => {
      const [x1, y1] = toSvg(e.start[0], e.start[1]);
      const [x2, y2] = toSvg(e.end[0], e.end[1]);
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${STROKE_DARK}" stroke-width="2" />`;
    })
    .join('\n');

  const fillPoly =
    fp.outline_edges && fp.outline_edges.length
      ? (() => {
          const pts = fp.outline_edges!.map((e) => toSvg(e.start[0], e.start[1]));
          return `<polygon points="${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')}" fill="${FILL_PART}" opacity="0.5" />`;
        })()
      : '';

  const bendLines = (fp.bends || [])
    .map((b, i) => {
      const line = b.bend_line_on_flat;
      const direction = (b.direction || 'UP').toUpperCase();
      const color = direction === 'DOWN' ? STROKE_BEND_DOWN : STROKE_BEND_UP;
      const dash = direction === 'DOWN' ? '8,4,2,4' : '8,4';
      const xPos =
        typeof b.distance_from_left_edge_mm === 'number'
          ? b.distance_from_left_edge_mm
          : undefined;

      let x1: number, y1: number, x2: number, y2: number;
      if (line) {
        [x1, y1] = toSvg(line.start[0], line.start[1]);
        [x2, y2] = toSvg(line.end[0], line.end[1]);
      } else if (xPos != null) {
        [x1, y1] = toSvg(xPos, 0);
        [x2, y2] = toSvg(xPos, h);
      } else {
        return '';
      }
      const angle = b.angle ?? b.angle_deg ?? 0;
      const arrow = direction === 'DOWN' ? '\u2193' : '\u2191';
      const labelX = (x1 + x2) / 2;
      const labelY = Math.min(y1, y2) - 4;
      return `
        <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="1.8" stroke-dasharray="${dash}" />
        <text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" font-size="11" font-family="sans-serif" font-weight="bold" fill="${color}" text-anchor="middle">B${b.id ?? b.index ?? i + 1} ${arrow}${angle.toFixed(0)}&#176;</text>
      `;
    })
    .join('\n');

  const titleX = svgW / 2;
  const widthLabelX = ox + (w * scale) / 2;
  const widthLabelY = oy + h * scale + 35;
  const heightLabelX = ox + w * scale + 15;
  const heightLabelY = oy + (h * scale) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect width="${svgW}" height="${svgH}" fill="white" />
    <text x="${titleX}" y="15" font-size="14" font-family="sans-serif" font-weight="bold" fill="${STROKE_DARK}" text-anchor="middle">${escapeXml(partName)} — Flat Pattern</text>
    ${fillPoly}
    ${edgeLines}
    ${bendLines}
    <text x="${widthLabelX}" y="${widthLabelY}" font-size="12" font-family="sans-serif" font-weight="bold" fill="#2E6EA6" text-anchor="middle">${w.toFixed(1)} mm</text>
    <text x="${heightLabelX}" y="${heightLabelY}" font-size="12" font-family="sans-serif" font-weight="bold" fill="#2E6EA6" transform="rotate(90,${heightLabelX},${heightLabelY})">${h.toFixed(1)} mm</text>
  </svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number | undefined | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

function bendAngle(b: FlatPatternBend): number | undefined {
  return b.angle ?? b.angle_deg;
}
function bendRadius(b: FlatPatternBend): number | undefined {
  return b.radius ?? b.inner_radius_mm;
}
function bendLength(b: FlatPatternBend): number | undefined {
  return b.length ?? b.length_mm;
}

export function TechnicalDrawingViewer({
  flatPattern,
  partName = 'Part',
  material,
  quantity,
  onDownloadDxf,
  onDownloadPdf,
}: TechnicalDrawingViewerProps) {
  const svgMarkup = useMemo(() => {
    if (!flatPattern?.flat_pattern) return '';
    if (flatPattern.svg_base64) {
      try {
        return atob(flatPattern.svg_base64);
      } catch {
        // fall through to inline renderer
      }
    }
    return buildInlineSvg(flatPattern.flat_pattern, partName);
  }, [flatPattern, partName]);

  if (!flatPattern) {
    return (
      <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
        No flat pattern available yet. Upload a STEP file and run the unfold pipeline.
      </div>
    );
  }

  if (flatPattern.error) {
    return (
      <div className="rounded border border-destructive/30 bg-destructive/5 p-4">
        <div className="font-semibold text-destructive">Unfold unavailable</div>
        <div className="mt-1 text-sm">{flatPattern.error}</div>
        {flatPattern.detail ? (
          <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs">
            {flatPattern.detail}
          </pre>
        ) : null}
      </div>
    );
  }

  const fp = flatPattern.flat_pattern;
  const bends: FlatPatternBend[] = fp?.bends ?? [];
  const hasDxf = Boolean(flatPattern.dxf_base64);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{partName}</span>
          {material ? <Badge variant="outline">{material}</Badge> : null}
          {quantity ? <Badge variant="secondary">× {quantity}</Badge> : null}
          {flatPattern.source ? (
            <Badge variant="outline" className="uppercase">
              {flatPattern.source}
            </Badge>
          ) : null}
        </div>
        <div className="flex gap-2">
          {onDownloadPdf ? (
            <Button size="sm" variant="outline" onClick={onDownloadPdf}>
              Download PDF
            </Button>
          ) : null}
          {onDownloadDxf && hasDxf ? (
            <Button size="sm" variant="outline" onClick={onDownloadDxf}>
              Download DXF
            </Button>
          ) : null}
        </div>
      </div>

      {svgMarkup ? (
        <div
          className="overflow-auto rounded border bg-white"
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      ) : (
        <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
          Flat pattern geometry is not available for this part.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="mb-2 text-sm font-semibold">Parameters</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Flat width</dt>
            <dd>{fmt(fp?.dimensions.width)} mm</dd>
            <dt className="text-muted-foreground">Flat height</dt>
            <dd>{fmt(fp?.dimensions.height)} mm</dd>
            <dt className="text-muted-foreground">Thickness</dt>
            <dd>{fmt(fp?.dimensions.thickness ?? flatPattern.thickness_mm, 2)} mm</dd>
            <dt className="text-muted-foreground">Bends</dt>
            <dd>{fp?.bend_count ?? bends.length}</dd>
            {material ? (
              <>
                <dt className="text-muted-foreground">Material</dt>
                <dd>{material}</dd>
              </>
            ) : null}
            {quantity ? (
              <>
                <dt className="text-muted-foreground">Quantity</dt>
                <dd>{quantity}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="rounded border p-3">
          <div className="mb-2 text-sm font-semibold">Legend</div>
          <ul className="space-y-1 text-xs">
            <li className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-8 bg-[#1A1A2E]" />
              <span>Outer cut outline</span>
            </li>
            <li className="flex items-center gap-2">
              <span
                className="inline-block h-0.5 w-8 border-t-2 border-dashed"
                style={{ borderColor: STROKE_BEND_UP }}
              />
              <span>Bend up (valley fold)</span>
            </li>
            <li className="flex items-center gap-2">
              <span
                className="inline-block h-0.5 w-8 border-t-2 border-dotted"
                style={{ borderColor: STROKE_BEND_DOWN }}
              />
              <span>Bend down (mountain fold)</span>
            </li>
          </ul>
        </div>
      </div>

      {bends.length > 0 ? (
        <div className="rounded border">
          <div className="border-b px-3 py-2 text-sm font-semibold">Bend schedule</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Angle</TableHead>
                <TableHead>Inner R</TableHead>
                <TableHead>Length</TableHead>
                <TableHead>K-factor</TableHead>
                <TableHead>Bend allowance</TableHead>
                <TableHead>Distance from edge</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bends.map((b, i) => (
                <TableRow key={`${b.id ?? i}`}>
                  <TableCell className="font-mono">{b.id ?? `B${b.index ?? i + 1}`}</TableCell>
                  <TableCell>
                    <span
                      style={{
                        color:
                          (b.direction || 'UP').toUpperCase() === 'DOWN'
                            ? STROKE_BEND_DOWN
                            : STROKE_BEND_UP,
                      }}
                    >
                      {b.direction || 'UP'}
                    </span>
                  </TableCell>
                  <TableCell>{fmt(bendAngle(b))}°</TableCell>
                  <TableCell>{fmt(bendRadius(b), 2)} mm</TableCell>
                  <TableCell>{fmt(bendLength(b))} mm</TableCell>
                  <TableCell>{fmt(b.k_factor, 2)}</TableCell>
                  <TableCell>{fmt(b.bend_allowance_mm, 2)} mm</TableCell>
                  <TableCell>{fmt(b.distance_from_left_edge_mm, 1)} mm</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {flatPattern.warnings && flatPattern.warnings.length > 0 ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="mb-1 font-semibold">Warnings</div>
          <ul className="list-inside list-disc space-y-0.5">
            {flatPattern.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default TechnicalDrawingViewer;
