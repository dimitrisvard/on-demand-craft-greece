import { Link, useParams } from 'react-router-dom';
import {
  Layers, Circle, Square, Hexagon, Minus, CornerDownRight,
  Pipette, Cylinder, GitBranch, Flame, Cable, Shapes, Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { MaterialCategory } from '@/types/catalog';

const ICON_MAP: Record<string, React.ElementType> = {
  Layers, Circle, Square, Hexagon, Minus, CornerDownRight,
  Pipette, Cylinder, GitBranch, Flame, Cable, Shapes, Package,
};

interface CatalogSidebarProps {
  categories: MaterialCategory[];
  loading?: boolean;
}

export default function CatalogSidebar({ categories, loading }: CatalogSidebarProps) {
  const { categorySlug } = useParams<{ categorySlug: string }>();

  return (
    <aside className="w-64 shrink-0 bg-slate-900 text-slate-200 min-h-[calc(100vh-64px)] border-r border-slate-800">
      {/* Header */}
      <div className="px-4 py-5 border-b border-slate-800">
        <Link
          to="/dashboard/materials"
          className="flex items-center gap-2 text-white font-semibold text-sm tracking-wide uppercase"
        >
          <Package className="h-5 w-5 text-orange-400" />
          Material Catalog
        </Link>
      </div>

      {/* Category Navigation */}
      <nav className="py-2">
        <div className="px-4 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Categories
          </span>
        </div>

        {loading ? (
          <div className="px-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="space-y-0.5 px-2">
            {/* All Materials link */}
            <li>
              <Link
                to="/dashboard/materials"
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                  !categorySlug
                    ? 'bg-slate-800 text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                )}
              >
                <Package className="h-4 w-4 shrink-0" />
                <span className="truncate">All Materials</span>
              </Link>
            </li>

            {categories.map(cat => {
              const Icon = ICON_MAP[cat.icon] || Layers;
              const isActive = categorySlug === cat.slug;

              return (
                <li key={cat.id}>
                  <Link
                    to={`/dashboard/materials/${cat.slug}`}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors group',
                      isActive
                        ? 'bg-orange-500/15 text-orange-400 font-medium border-l-2 border-orange-400 -ml-0.5 pl-[10px]'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-orange-400' : 'text-slate-500 group-hover:text-slate-300')} />
                    <span className="truncate flex-1">{cat.name}</span>
                    {cat.material_count !== undefined && cat.material_count > 0 && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px] px-1.5 py-0 h-5 min-w-[20px] justify-center',
                          isActive
                            ? 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                            : 'bg-slate-800 text-slate-500 border-slate-700'
                        )}
                      >
                        {cat.material_count}
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Footer info */}
      <div className="mt-auto px-4 py-4 border-t border-slate-800">
        <Link
          to="/dashboard/materials/admin"
          className="text-xs text-slate-500 hover:text-orange-400 transition-colors"
        >
          Manage Materials →
        </Link>
      </div>
    </aside>
  );
}
