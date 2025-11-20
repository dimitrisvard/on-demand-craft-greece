import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Separator } from "@/components/ui/separator";
import { 
  Users, 
  Factory, 
  ShoppingBag, 
  FileText, 
  Package, 
  Calendar, 
  Bell, 
  Settings,
  LayoutDashboard,
  BarChart3,
  TrendingUp
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface PersistentDashboardLayoutProps {
  children: React.ReactNode;
}

const PersistentDashboardLayout = ({ children }: PersistentDashboardLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();

  // Check if user is a production partner
  const isProductionPartner = user?.role === 'partner_seller';

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [user, loading, navigate]);

  const getActiveModule = () => {
    const path = location.pathname;
    if (path === '/dashboard' || path === '/') return 'overview';
    if (path === '/dashboard/analytics') return 'analytics';
    if (path === '/customers') return 'customers';
    if (path === '/partners') return 'partners';
    if (path === '/products') return 'products';
    if (path === '/rfq-management') return 'quotes';
    if (path === '/orders') return 'orders';
    if (path === '/calendar') return 'calendar';
    return 'overview';
  };

  const activeModule = getActiveModule();

  const handleNavigation = (module: string, path: string) => {
    if (module === 'overview') {
      navigate('/dashboard');
    } else {
      navigate(path);
    }
  };

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center mt-16">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <div className="text-lg">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background pt-16">
      {/* Persistent Sidebar */}
      <div className="w-64 border-r bg-slate-50/50 dark:bg-slate-950/50 hidden md:block flex-col h-[calc(100vh-4rem)] sticky top-16">
        <div className="p-6 border-b">
          <div className="flex items-center gap-2 text-primary">
            <LayoutDashboard className="h-6 w-6" />
            <h2 className="text-lg font-bold tracking-tight">CRM System</h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {/* Overview - Show for all users */}
          <NavButton 
            active={activeModule === "overview"}
            onClick={() => handleNavigation("overview", "/dashboard")}
            icon={<BarChart3 className="h-4 w-4" />}
            label="Overview"
          />

          <NavButton 
            active={activeModule === "analytics"}
            onClick={() => handleNavigation("analytics", "/dashboard/analytics")}
            icon={<TrendingUp className="h-4 w-4" />}
            label="Analytics"
          />

          {/* Admin-only menu items */}
          {!isProductionPartner && (
            <>
              <div className="pt-4 pb-2 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Management
              </div>
              <NavButton 
                active={activeModule === "customers"}
                onClick={() => handleNavigation("customers", "/customers")}
                icon={<Users className="h-4 w-4" />}
                label="Customers"
              />
              
              <NavButton 
                active={activeModule === "partners"}
                onClick={() => handleNavigation("partners", "/partners")}
                icon={<Factory className="h-4 w-4" />}
                label="Production Partners"
              />
              
              <NavButton 
                active={activeModule === "products"}
                onClick={() => handleNavigation("products", "/products")}
                icon={<ShoppingBag className="h-4 w-4" />}
                label="Products & Inventory"
              />
              
              <NavButton 
                active={activeModule === "quotes"}
                onClick={() => handleNavigation("quotes", "/rfq-management")}
                icon={<FileText className="h-4 w-4" />}
                label="RFQ & Quotes"
              />
            </>
          )}
          
          <div className="pt-4 pb-2 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Operations
          </div>
          
          {/* Orders - Show for all users */}
          <NavButton 
            active={activeModule === "orders"}
            onClick={() => handleNavigation("orders", "/orders")}
            icon={<Package className="h-4 w-4" />}
            label="Orders"
          />
          
          {/* Calendar - Show for all users */}
          <NavButton 
            active={activeModule === "calendar"}
            onClick={() => handleNavigation("calendar", "/calendar")}
            icon={<Calendar className="h-4 w-4" />}
            label="Calendar"
          />

          {/* Admin-only additional menu items */}
          {!isProductionPartner && (
            <>
              <div className="pt-4 pb-2 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                System
              </div>
              
              <NavButton 
                active={activeModule === "notifications"}
                onClick={() => handleNavigation("notifications", "/notifications")}
                icon={<Bell className="h-4 w-4" />}
                label="Notifications"
              />
              
              <NavButton 
                active={activeModule === "settings"}
                onClick={() => handleNavigation("settings", "/settings")}
                icon={<Settings className="h-4 w-4" />}
                label="Settings"
              />
            </>
          )}
        </div>

        {/* User info at bottom */}
        {user && (
          <div className="p-4 border-t bg-background/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold border border-primary/20">
                {user.email?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate text-foreground">{user.email}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {user.role?.replace('_', ' ') || 'User'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto min-h-[calc(100vh-4rem)] bg-slate-50/30 dark:bg-slate-900/30">
        <div className="p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const NavButton = ({ active, onClick, icon, label }: NavButtonProps) => (
  <button 
    className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 ${
      active 
        ? "bg-primary text-primary-foreground shadow-sm" 
        : "text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-foreground"
    }`}
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export default PersistentDashboardLayout;
