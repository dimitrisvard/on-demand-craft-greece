import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Package, Layers, ScanLine, Settings, AlertTriangle, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/dashboard/inventory', label: 'Dashboard', icon: Package },
  { path: '/dashboard/inventory/sessions', label: 'Nesting Sessions', icon: Layers },
  { path: '/dashboard/inventory/receive', label: 'Receive Stock', icon: ClipboardList },
  { path: '/dashboard/inventory/scan', label: 'QR Scanner', icon: ScanLine },
  { path: '/dashboard/inventory/alerts', label: 'Alerts', icon: AlertTriangle },
  { path: '/dashboard/inventory/settings', label: 'Settings', icon: Settings },
];

export default function InventoryLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white px-6 py-3">
        <div className="flex items-center gap-6 overflow-x-auto">
          <Link to="/dashboard" className="text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap">
            ← Dashboard
          </Link>
          <div className="h-4 w-px bg-gray-300" />
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path ||
              (item.path !== '/dashboard/inventory' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-1.5 text-sm whitespace-nowrap px-3 py-1.5 rounded-md transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
