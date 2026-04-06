import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface CatalogFiltersProps {
  search: string;
  onSearchChange: (val: string) => void;
  grades: string[];
  selectedGrade: string;
  onGradeChange: (val: string) => void;
  finishes: string[];
  selectedFinish: string;
  onFinishChange: (val: string) => void;
  inStockOnly: boolean;
  onInStockChange: (val: boolean) => void;
  totalCount: number;
}

export default function CatalogFilters({
  search, onSearchChange,
  grades, selectedGrade, onGradeChange,
  finishes, selectedFinish, onFinishChange,
  inStockOnly, onInStockChange,
  totalCount,
}: CatalogFiltersProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search materials, grades, suppliers..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-9 h-9 text-sm bg-slate-50 border-slate-200"
        />
      </div>

      {/* Grade filter */}
      <Select value={selectedGrade} onValueChange={onGradeChange}>
        <SelectTrigger className="w-[160px] h-9 text-sm bg-slate-50">
          <SelectValue placeholder="Material Grade" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Grades</SelectItem>
          {grades.map(g => (
            <SelectItem key={g} value={g}>{g}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Surface finish filter */}
      <Select value={selectedFinish} onValueChange={onFinishChange}>
        <SelectTrigger className="w-[160px] h-9 text-sm bg-slate-50">
          <SelectValue placeholder="Surface Finish" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Finishes</SelectItem>
          {finishes.map(f => (
            <SelectItem key={f} value={f}>{f}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* In stock toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="in-stock"
          checked={inStockOnly}
          onCheckedChange={onInStockChange}
          className="data-[state=checked]:bg-green-600"
        />
        <Label htmlFor="in-stock" className="text-sm text-slate-600 cursor-pointer whitespace-nowrap">
          In Stock
        </Label>
      </div>

      {/* Count */}
      <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
        {totalCount} item{totalCount !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
