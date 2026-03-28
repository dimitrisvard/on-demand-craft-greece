import { Link, NavLink, useLocation, Navigate } from 'react-router-dom';
import { Home, FolderOpen, Database, Wallet, Plus, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

interface CustomerPortalLayoutProps {
  children: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  title?: string;
}

const portalNavItems = [
  { to: '/customer/dashboard', label: 'Dashboard', icon: Home },
  { to: '/customer/projects', label: 'My Projects', icon: FolderOpen },
  { to: '/customer/parts-library', label: 'Parts Library', icon: Database },
  { to: '/customer/finance', label: 'My Finance', icon: Wallet },
];

const CustomerPortalLayout = ({ children, breadcrumbs, title }: CustomerPortalLayoutProps) => {
  const location = useLocation();
  const { user, loading } = useAuth();

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Secondary navigation bar - sticky below the main Navbar */}
      <nav className="sticky top-[73px] z-40 bg-white border-b border-gray-200">
        <div className="container-custom">
          <div className="flex items-center justify-between h-14">
            {/* Navigation links */}
            <div className="flex items-center space-x-1">
              {portalNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-150 ${
                      isActive
                        ? 'text-brand-accent bg-brand-accent/5'
                        : 'text-gray-600 hover:text-brand-dark hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>

            {/* Get a Quote accent button */}
            <Link to="/quote">
              <Button
                size="sm"
                className="bg-brand-accent hover:bg-brand-accent/90 text-white font-semibold shadow-sm"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Get a Quote
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Content area */}
      <main className="container-custom py-6">
        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex items-center text-sm text-gray-500 space-x-1">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;

                return (
                  <li key={index} className="flex items-center">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5 mx-1 text-gray-400 flex-shrink-0" />}
                    {crumb.href && !isLast ? (
                      <Link
                        to={crumb.href}
                        className="hover:text-brand-primary transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className={isLast ? 'text-brand-dark font-medium' : ''}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        {/* Page title */}
        {title && (
          <h1 className="text-2xl font-bold text-brand-dark mb-6">{title}</h1>
        )}

        {/* Page content */}
        {children}
      </main>
    </div>
  );
};

export default CustomerPortalLayout;
