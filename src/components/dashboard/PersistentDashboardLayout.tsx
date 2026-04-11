import { useEffect, useState } from "react";
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
  Sparkles,
  Menu,
  X,
  Radio,
  Scan,
  Building2,
  Rocket,
  Layers,
  Globe
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

interface PersistentDashboardLayoutProps {
  children: React.ReactNode;
}

const PersistentDashboardLayout = ({ children }: PersistentDashboardLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Check if user is a production partner
  const isProductionPartner = user?.role === 'partner_seller';
  // Check if user is a tenant admin (has limited dashboard access - no Lead Monitor, no Content)
  const isTenantAdminUser = user?.tenantRole === 'tenant_admin';
  
  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [user, loading, navigate]);

  const getActiveModule = () => {
    const path = location.pathname;
    if (path === '/dashboard' || path === '/') return 'overview';
    if (path === '/dashboard/analytics') return 'analytics';
    if (path.startsWith('/dashboard/materials')) return 'materials';
    if (path.startsWith('/dashboard/blog')) return 'blog';
    if (path.startsWith('/dashboard/auto-blog')) return 'auto-blog';
    if (path.startsWith('/dashboard/email-marketing')) return 'email-marketing';
    if (path.startsWith('/dashboard/email-inbox')) return 'email-inbox';
    if (path === '/customers') return 'customers';
    if (path === '/partners') return 'partners';
    if (path === '/products') return 'products';
    if (path === '/rfq-management') return 'rfq-orders';
    if (path === '/orders') return 'rfq-orders';
    if (path.startsWith('/orders/')) return 'rfq-orders';
    if (path === '/calendar') return 'calendar';
    if (path === '/dashboard/notifications') return 'notifications';
    if (path === '/dashboard/settings') return 'settings';
    if (path === '/dashboard/leads') return 'leads';
    if (path === '/dashboard/company-scanner') return 'company-scanner';
    if (path === '/dashboard/tenders') return 'tenders';
    if (path === '/dashboard/funded-startups') return 'funded-startups';
    if (path === '/dashboard/seo') return 'seo';
    if (path.startsWith('/dashboard/tenants')) return 'tenants';
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
    <div className="flex min-h-screen bg-slate-100 pt-16">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="md:hidden fixed top-20 left-4 z-[60] p-2 bg-primary text-primary-foreground rounded-md shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Toggle menu"
        aria-expanded={isMobileMenuOpen}
      >
        {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile Menu Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-[45] top-16"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Persistent Sidebar - Desktop */}
      <div className="w-64 border-r border-[hsl(217,40%,25%)] bg-[hsl(217,50%,18%)] hidden md:flex flex-col h-[calc(100vh-4rem)] sticky top-16 shadow-lg">
        <div className="p-6 border-b border-[hsl(217,40%,25%)] shrink-0">
          <div className="flex items-center gap-2 text-white">
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
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
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
                      active={activeModule === "materials"}
                      onClick={() => handleNavigation("/dashboard/materials")}
                      icon={<Layers className="h-4 w-4" />}
                      label="Material Catalog"
                    />
                    <NavButton
                      active={activeModule === "rfq-orders"}
                      onClick={() => handleNavigation("/rfq-management")}
                      icon={<FileText className="h-4 w-4" />}
                      label="RFQ & Orders"
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Content Section - hidden from production partners and tenant admins */}
              {!isProductionPartner && !isTenantAdminUser && (
                <AccordionItem value="content" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
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
                <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
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
                      active={activeModule === "rfq-orders"}
                      onClick={() => handleNavigation("/rfq-management")}
                      icon={<Package className="h-4 w-4" />}
                      label="RFQ & Orders"
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

              {/* Lead Monitor Section - hidden from production partners and tenant admins */}
              {!isProductionPartner && !isTenantAdminUser && (
                <AccordionItem value="leads" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
                    Lead Monitor
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-1 space-y-1">
                    <NavButton
                      active={activeModule === "leads"}
                      onClick={() => handleNavigation("/dashboard/leads")}
                      icon={<Radio className="h-4 w-4" />}
                      label="Lead Feed"
                    />
                    <NavButton
                      active={activeModule === "company-scanner"}
                      onClick={() => handleNavigation("/dashboard/company-scanner")}
                      icon={<Scan className="h-4 w-4" />}
                      label="Company Scanner"
                    />
                    <NavButton
                      active={activeModule === "tenders"}
                      onClick={() => handleNavigation("/dashboard/tenders")}
                      icon={<Building2 className="h-4 w-4" />}
                      label="Tender Monitor"
                    />
                    <NavButton
                      active={activeModule === "funded-startups"}
                      onClick={() => handleNavigation("/dashboard/funded-startups")}
                      icon={<Rocket className="h-4 w-4" />}
                      label="Funded Startups"
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* System Section */}
              {!isProductionPartner && (
                <AccordionItem value="system" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
                    System
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-1 space-y-1">
                    <NavButton
                      active={activeModule === "tenants"}
                      onClick={() => handleNavigation("/dashboard/tenants")}
                      icon={<Building2 className="h-4 w-4" />}
                      label="Tenants"
                    />
                    <NavButton
                      active={activeModule === "seo"}
                      onClick={() => handleNavigation("/dashboard/seo")}
                      icon={<Globe className="h-4 w-4" />}
                      label="SEO Console"
                    />
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
          <div className="p-4 border-t border-[hsl(217,40%,25%)] shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white font-semibold border border-white/20">
                {user.email?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate text-slate-200">{user.email}</p>
                <p className="text-xs text-slate-500 capitalize">
                  {user.role?.replace('_', ' ') || 'User'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Sidebar */}
      <div className={`md:hidden fixed left-0 top-16 w-72 h-[calc(100vh-4rem)] bg-[hsl(217,50%,18%)] border-r border-[hsl(217,40%,25%)] shadow-xl z-[55] transition-transform duration-300 ease-in-out overflow-y-auto ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-4 border-b border-[hsl(217,40%,25%)] shrink-0">
          <div className="flex items-center gap-2 text-white">
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
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
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
                      active={activeModule === "materials"}
                      onClick={() => handleNavigation("/dashboard/materials")}
                      icon={<Layers className="h-4 w-4" />}
                      label="Material Catalog"
                    />
                    <NavButton
                      active={activeModule === "rfq-orders"}
                      onClick={() => handleNavigation("/rfq-management")}
                      icon={<FileText className="h-4 w-4" />}
                      label="RFQ & Orders"
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Content Section - hidden from production partners and tenant admins */}
              {!isProductionPartner && !isTenantAdminUser && (
                <AccordionItem value="content" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
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
                <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
                  Operations
                </AccordionTrigger>
                <AccordionContent className="pb-0 pt-1 space-y-1">
                  {isProductionPartner && (
                     <NavButton
                      active={activeModule === "rfq-orders"}
                      onClick={() => handleNavigation("/rfq-management")}
                      icon={<Package className="h-4 w-4" />}
                      label="RFQ & Orders"
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

              {/* Lead Monitor Section - hidden from production partners and tenant admins */}
              {!isProductionPartner && !isTenantAdminUser && (
                <AccordionItem value="leads" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
                    Lead Monitor
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-1 space-y-1">
                    <NavButton
                      active={activeModule === "leads"}
                      onClick={() => handleNavigation("/dashboard/leads")}
                      icon={<Radio className="h-4 w-4" />}
                      label="Lead Feed"
                    />
                    <NavButton
                      active={activeModule === "company-scanner"}
                      onClick={() => handleNavigation("/dashboard/company-scanner")}
                      icon={<Scan className="h-4 w-4" />}
                      label="Company Scanner"
                    />
                    <NavButton
                      active={activeModule === "tenders"}
                      onClick={() => handleNavigation("/dashboard/tenders")}
                      icon={<Building2 className="h-4 w-4" />}
                      label="Tender Monitor"
                    />
                    <NavButton
                      active={activeModule === "funded-startups"}
                      onClick={() => handleNavigation("/dashboard/funded-startups")}
                      icon={<Rocket className="h-4 w-4" />}
                      label="Funded Startups"
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* System Section */}
              {!isProductionPartner && (
                <AccordionItem value="system" className="border-none">
                  <AccordionTrigger className="py-2 px-4 hover:no-underline hover:bg-white/5 rounded-md text-sm font-medium text-slate-500 uppercase tracking-wider">
                    System
                  </AccordionTrigger>
                  <AccordionContent className="pb-0 pt-1 space-y-1">
                    <NavButton
                      active={activeModule === "tenants"}
                      onClick={() => handleNavigation("/dashboard/tenants")}
                      icon={<Building2 className="h-4 w-4" />}
                      label="Tenants"
                    />
                    <NavButton
                      active={activeModule === "seo"}
                      onClick={() => handleNavigation("/dashboard/seo")}
                      icon={<Globe className="h-4 w-4" />}
                      label="SEO Console"
                    />
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
          <div className="p-4 border-t border-[hsl(217,40%,25%)] shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white font-semibold border border-white/20">
                {user.email?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate text-slate-200">{user.email}</p>
                <p className="text-xs text-slate-500 capitalize">
                  {user.role?.replace('_', ' ') || 'User'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto min-h-[calc(100vh-4rem)] bg-slate-100 relative z-0 md:ml-0">
        <div className="p-4 md:p-8 max-w-7xl mx-auto animate-fade-in w-full min-h-full">
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
        ? "bg-white/10 text-white"
        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
    }`}
    onClick={onClick}
  >
    {active && (
      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-white" />
    )}
    <span className="relative z-10 flex items-center gap-3">
      {icon}
      <span>{label}</span>
    </span>
  </button>
);

export default PersistentDashboardLayout;
