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
  BarChart3
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
      <div className="w-64 border-r bg-card hidden md:block p-4 space-y-6">
        <div className="flex items-center mb-8">
          <LayoutDashboard className="h-6 w-6 mr-2 text-primary" />
          <h2 className="text-xl font-bold">CRM System</h2>
        </div>

        <nav className="space-y-1">
          {/* Overview - Show for all users */}
          <button 
            className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
              activeModule === "overview" 
                ? "bg-primary text-primary-foreground" 
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => handleNavigation("overview", "/dashboard")}
          >
            <BarChart3 className="h-5 w-5" />
            <span>Overview</span>
          </button>

          {/* Admin-only menu items */}
          {!isProductionPartner && (
            <>
              <button 
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
                  activeModule === "customers" 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => handleNavigation("customers", "/customers")}
              >
                <Users className="h-5 w-5" />
                <span>Customers</span>
              </button>
              
              <button 
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
                  activeModule === "partners" 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => handleNavigation("partners", "/partners")}
              >
                <Factory className="h-5 w-5" />
                <span>Production Partners</span>
              </button>
              
              <button 
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
                  activeModule === "products" 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => handleNavigation("products", "/products")}
              >
                <ShoppingBag className="h-5 w-5" />
                <span>Products & Inventory</span>
              </button>
              
              <button 
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
                  activeModule === "quotes" 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => handleNavigation("quotes", "/rfq-management")}
              >
                <FileText className="h-5 w-5" />
                <span>RFQ & Quotes</span>
              </button>
            </>
          )}
          
          {/* Orders - Show for all users */}
          <button 
            className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
              activeModule === "orders" 
                ? "bg-primary text-primary-foreground" 
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => handleNavigation("orders", "/orders")}
          >
            <Package className="h-5 w-5" />
            <span>Orders</span>
          </button>
          
          {/* Calendar - Show for all users */}
          <button 
            className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
              activeModule === "calendar" 
                ? "bg-primary text-primary-foreground" 
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => handleNavigation("calendar", "/calendar")}
          >
            <Calendar className="h-5 w-5" />
            <span>Calendar</span>
          </button>

          {/* Admin-only additional menu items */}
          {!isProductionPartner && (
            <>
              <Separator className="my-4" />
              
              <button 
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
                  activeModule === "notifications" 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => handleNavigation("notifications", "/notifications")}
              >
                <Bell className="h-5 w-5" />
                <span>Notifications</span>
              </button>
              
              <button 
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
                  activeModule === "settings" 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => handleNavigation("settings", "/settings")}
              >
                <Settings className="h-5 w-5" />
                <span>Settings</span>
              </button>
            </>
          )}
        </nav>

        {/* User info at bottom */}
        {user && (
          <div className="absolute bottom-4 left-0 w-64 p-4">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                {user.email?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate">{user.email}</p>
                <p className="text-xs text-muted-foreground">
                  {user.role === 'partner_seller' ? 'Partner' : 
                   user.role === 'admin' ? 'Admin' : 
                   user.role === 'sales_rep' ? 'Sales Rep' :
                   user.role === 'production_manager' ? 'Production Manager' :
                   user.role === 'customer' ? 'Customer' :
                   user.role === 'supplier' ? 'Supplier' :
                   user.role === 'accountant' ? 'Accountant' :
                   user.role || 'User'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
};

export default PersistentDashboardLayout;
