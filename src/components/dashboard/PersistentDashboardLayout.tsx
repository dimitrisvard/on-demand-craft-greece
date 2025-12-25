import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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
  TrendingUp,
  BookOpen,
  ChevronDown,
  Mail,
  Inbox,
  Sparkles
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";

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
    if (path.startsWith('/dashboard/blog')) return 'blog';
    if (path.startsWith('/dashboard/auto-blog')) return 'auto-blog';
    if (path.startsWith('/dashboard/email-marketing')) return 'email-marketing';
    if (path.startsWith('/dashboard/email-inbox')) return 'email-inbox';
    if (path === '/customers') return 'customers';
    if (path === '/partners') return 'partners';
    if (path === '/products') return 'products';
    if (path === '/rfq-management') return 'quotes';
    if (path === '/orders') return 'orders';
    if (path === '/calendar') return 'calendar';
    if (path === '/dashboard/notifications') return 'notifications';
    if (path === '/dashboard/settings') return 'settings';
    return 'overview';
  };

  const activeModule = getActiveModule();

  const handleNavigation = (path: string) => {
    navigate(path);
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
      <div className="w-64 border-r bg-card/50 hidden md:flex flex-col h-[calc(100vh-4rem)] sticky top-16 shadow-sm">
        <div className="p-6 border-b shrink-0">
          <div className="flex items-center gap-2 text-primary">
            <LayoutDashboard className="h-6 w-6" />
            <h2 className="text-lg font-bold tracking-tight">CRM System</h2>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-3 py-4">
            {/* Overview Section - Always visible */}
            <div className="space-y-1 mb-4">
              <NavButton 
                active={activeModule === "overview"}
                onClick={() => handleNavigation("/dashboard")}
                icon={<BarChart3 className="h-4 w-4" />}
                label="Overview"
              />
              <NavButton 
                active={activeModule === "analytics"}
                onClick={() => handleNavigation("/dashboard/analytics")}
                icon={<TrendingUp className="h-4 w-4" />}
                label="Analytics"
              />
            </div>

            {/* Collapsible Sections */}
            <Accordion type="multiple" defaultValue={["management", "content", "operations", "system"]} className="space-y-2">
              
              {/* Management Section */}
              {!isProductionPartner && (
                <AccordionItem value="management" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-accent/50 rounded-md text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Management
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-1 space-y-1">
                    <NavButton 
                      active={activeModule === "customers"}
                      onClick={() => handleNavigation("/customers")}
                      icon={<Users className="h-4 w-4" />}
                      label="Customers"
                    />
                    <NavButton 
                      active={activeModule === "partners"}
                      onClick={() => handleNavigation("/partners")}
                      icon={<Factory className="h-4 w-4" />}
                      label="Production Partners"
                    />
                    <NavButton 
                      active={activeModule === "products"}
                      onClick={() => handleNavigation("/products")}
                      icon={<ShoppingBag className="h-4 w-4" />}
                      label="Products & Inventory"
                    />
                    <NavButton 
                      active={activeModule === "quotes"}
                      onClick={() => handleNavigation("/rfq-management")}
                      icon={<FileText className="h-4 w-4" />}
                      label="RFQ & Quotes"
                    />
                     {/* Orders Moved Here */}
                    <NavButton 
                      active={activeModule === "orders"}
                      onClick={() => handleNavigation("/orders")}
                      icon={<Package className="h-4 w-4" />}
                      label="Orders"
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Content Section */}
              {!isProductionPartner && (
                <AccordionItem value="content" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-accent/50 rounded-md text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Content
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-1 space-y-1">
                    <NavButton 
                      active={activeModule === "blog"}
                      onClick={() => handleNavigation("/dashboard/blog")}
                      icon={<BookOpen className="h-4 w-4" />}
                      label="Blog Articles"
                    />
                    <NavButton 
                      active={activeModule === "auto-blog"}
                      onClick={() => handleNavigation("/dashboard/auto-blog")}
                      icon={<Sparkles className="h-4 w-4" />}
                      label="Auto-Blog Dashboard"
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Operations Section */}
              <AccordionItem value="operations" className="border-none">
                <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-accent/50 rounded-md text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Operations
                </AccordionTrigger>
                <AccordionContent className="pb-0 pt-1 space-y-1">
                  {/* Production Partner sees Orders here if strictly needed, but let's keep consistent if possible. 
                      If isProductionPartner is true, they don't see "Management" block above, 
                      so we should add Orders here for them or create a separate block.
                      The logic above hides "Management" for partners.
                  */}
                  {isProductionPartner && (
                     <NavButton 
                      active={activeModule === "orders"}
                      onClick={() => handleNavigation("/orders")}
                      icon={<Package className="h-4 w-4" />}
                      label="Orders"
                    />
                  )}
                <NavButton 
                  active={activeModule === "calendar"}
                  onClick={() => handleNavigation("/calendar")}
                  icon={<Calendar className="h-4 w-4" />}
                  label="Calendar"
                />
                 {/* Email Marketing - Operations */}
                 {!isProductionPartner && (
                  <>
                    <NavButton 
                      active={activeModule === "email-marketing"}
                      onClick={() => handleNavigation("/dashboard/email-marketing")}
                      icon={<Mail className="h-4 w-4" />}
                      label="Email Marketing"
                    />
                    <NavButton 
                      active={activeModule === "email-inbox"}
                      onClick={() => handleNavigation("/dashboard/email-inbox")}
                      icon={<Inbox className="h-4 w-4" />}
                      label="Email Inbox"
                    />
                  </>
                 )}
              </AccordionContent>
            </AccordionItem>

              {/* System Section */}
              {!isProductionPartner && (
                <AccordionItem value="system" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-accent/50 rounded-md text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    System
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-1 space-y-1">
                    <NavButton 
                      active={activeModule === "notifications"}
                      onClick={() => handleNavigation("/dashboard/notifications")}
                      icon={<Bell className="h-4 w-4" />}
                      label="Notifications"
                    />
                    <NavButton 
                      active={activeModule === "settings"}
                      onClick={() => handleNavigation("/dashboard/settings")}
                      icon={<Settings className="h-4 w-4" />}
                      label="Settings"
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

            </Accordion>
          </div>
        </ScrollArea>

        {/* User info at bottom - Fixed */}
        {user && (
          <div className="p-4 border-t bg-card/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold border border-primary/20 ring-2 ring-background">
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
      <div className="flex-1 overflow-auto min-h-[calc(100vh-4rem)] bg-muted/20 relative z-0">
        <div className="p-8 max-w-7xl mx-auto animate-fade-in w-full min-h-full">
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
    className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 group relative ${
      active 
        ? "bg-primary/10 text-primary" 
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    }`}
    onClick={onClick}
  >
    {active && (
      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary" />
    )}
    <span className="relative z-10 flex items-center gap-3">
      {icon}
      <span>{label}</span>
    </span>
  </button>
);

export default PersistentDashboardLayout;
