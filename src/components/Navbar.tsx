import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, ChevronDown, Cog, Square, Box, Layers, User, FolderOpen, Database, Wallet, Briefcase } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { user, signOut, isAdmin, isPartner, isCustomer } = useAuth();
  const { tenant, isTenantSubdomain } = useTenant();
  const { t } = useTranslation();
  const { getLocalizedPath, getPathWithoutLanguage } = useLanguage();

  useEffect(() => {
    setIsOpen(false);
  }, [location]);

  // Helper function to check if a route is active
  const isRouteActive = (routePath: string) => {
    const currentPath = location.pathname;
    
    // Remove language prefix for comparison using the context function
    const pathWithoutLang = getPathWithoutLanguage(currentPath);
    
    // Handle root path specially
    if (routePath === '/') {
      return pathWithoutLang === '/' || pathWithoutLang === '';
    }
    
    // Check if the route matches
    return pathWithoutLang === routePath || pathWithoutLang.startsWith(routePath);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white shadow-md py-3">
      <div className="container-custom flex justify-between items-center">
        <Link to={getLocalizedPath('/')} className="flex items-center">
          {tenant?.logoUrl ? (
            <img
              src={tenant.logoUrl}
              alt={`${tenant?.name || 'Microns Hub'} Logo`}
              className="h-10"
              width={172}
              height={40}
            />
          ) : (
            <picture>
              <source
                type="image/webp"
                srcSet="/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e-344.webp"
              />
              <img
                src="/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png"
                alt={`${tenant?.name || 'Microns Hub'} Logo`}
                className="h-10"
                width={172}
                height={40}
                // @ts-expect-error fetchpriority is valid HTML
                fetchpriority="high"
              />
            </picture>
          )}
        </Link>

        <div className="hidden xl:flex items-center space-x-1 text-sm font-medium">
          <NavLink to={getLocalizedPath('/')} label={t('home_title', 'Home')} isActive={isRouteActive('/')} />
          {user && isAdmin() && (
            <NavLink to="/dashboard" label="Dashboard" isActive={isRouteActive('/dashboard')} />
          )}
          {user && isCustomer() && !isAdmin() && (
            <NavLink to="/customer/dashboard" label="My Dashboard" isActive={isRouteActive('/customer')} />
          )}
          {user && isPartner() && (
            <NavLink to="/partner/jobs" label="Partner Portal" isActive={isRouteActive('/partner')} />
          )}
          
          {/* Mega Menu for Services */}
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger className="bg-transparent hover:bg-transparent text-sm font-medium text-brand-dark hover:text-brand-primary data-[state=open]:bg-transparent px-3 py-2 h-auto">
                  {t('navbar_services', 'Services')}
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px] bg-white">
                    <ListItem to={getLocalizedPath('/services/cnc-machining')} title="5-Axis Milling" icon={<Cog className="h-5 w-5 mb-1" />}>
                      High precision complex parts
                    </ListItem>
                    <ListItem to={getLocalizedPath('/services/cnc-machining')} title="Turning" icon={<Cog className="h-5 w-5 mb-1 rotate-90" />}>
                      Cylindrical parts & threads
                    </ListItem>
                    <ListItem to={getLocalizedPath('/services/sheet-metal')} title="Sheet Metal Bending" icon={<Square className="h-5 w-5 mb-1" />}>
                      Enclosures & brackets
                    </ListItem>
                    <ListItem to={getLocalizedPath('/services/3d-printing')} title="3D Printing" icon={<Layers className="h-5 w-5 mb-1" />}>
                      Rapid prototyping & complex geometries
                    </ListItem>
                    <div className="col-span-2 mt-2 pt-2 border-t text-center">
                      <Link to={getLocalizedPath('/services')} className="text-brand-primary hover:underline text-sm font-semibold">
                        View All Services →
                      </Link>
                    </div>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          <NavLink to={getLocalizedPath('/industries')} label={t('navbar_industries')} isActive={isRouteActive('/industries')} />
          <NavLink to={getLocalizedPath('/our-work')} label={t('navbar_our_work')} isActive={isRouteActive('/our-work')} />
          <NavLink to={getLocalizedPath('/blog')} label={t('navbar_blog', 'Blog')} isActive={isRouteActive('/blog')} />
          <NavLink to={getLocalizedPath('/education')} label={t('navbar_education', 'Education')} isActive={isRouteActive('/education')} />
          <NavLink to={getLocalizedPath('/about')} label={t('navbar_about')} isActive={isRouteActive('/about')} />
          <NavLink to={getLocalizedPath('/contact')} label={t('navbar_contact')} isActive={isRouteActive('/contact')} />
        </div>

        <div className="hidden xl:flex items-center space-x-4">
          {(!user || !isCustomer()) && (
            <Link to={getLocalizedPath('/quote')}>
              <Button size="sm" variant="default" className="text-white bg-brand-accent hover:bg-brand-accent/90 px-4 font-bold shadow-sm">
                {t('navbar_get_quote')}
              </Button>
            </Link>
          )}
          {user && (
            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="bg-transparent hover:bg-transparent text-sm font-medium text-brand-dark hover:text-brand-primary data-[state=open]:bg-transparent px-3 py-2 h-auto">
                    <User className="h-4 w-4 mr-1" />
                    {t('navbar_my_account', 'My Account')}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="w-[220px] p-2 bg-white">
                      {/* Customer links - shown to customers only (not admins) */}
                      {isCustomer() && !isAdmin() && (
                        <>
                          <li>
                            <Link to="/customer/dashboard" className="block px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-brand-dark">
                              <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> My Dashboard</span>
                            </Link>
                          </li>
                          <li>
                            <Link to="/customer/projects" className="block px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-brand-dark">
                              <span className="flex items-center gap-2"><Database className="h-4 w-4" /> My Projects</span>
                            </Link>
                          </li>
                          <li>
                            <Link to="/customer/finance" className="block px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-brand-dark">
                              <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> My Finance</span>
                            </Link>
                          </li>
                        </>
                      )}
                      {/* Partner links - shown to partners */}
                      {isPartner() && (
                        <>
                          <li>
                            <Link to="/partner/jobs" className="block px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-brand-dark">
                              <span className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Job Board</span>
                            </Link>
                          </li>
                          <li>
                            <Link to="/partner/orders" className="block px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-brand-dark">
                              <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> My Orders</span>
                            </Link>
                          </li>
                          <li>
                            <Link to="/partner/finance" className="block px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-brand-dark">
                              <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Finance</span>
                            </Link>
                          </li>
                        </>
                      )}
                      {/* Admin dashboard - shown to admins only */}
                      {isAdmin() && (
                        <li className="border-t mt-1 pt-1">
                          <Link to="/dashboard" className="block px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-brand-dark">
                            <span className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Admin Dashboard</span>
                          </Link>
                        </li>
                      )}
                      <li className="border-t mt-1 pt-1">
                        <button onClick={signOut} className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-slate-100 text-red-600 flex items-center gap-2">
                          <LogOut className="h-4 w-4" /> Logout
                        </button>
                      </li>
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          )}
          {!user && (
            <Link to="/login">
              <Button size="sm" variant="outline" className="text-sm">
                Login
              </Button>
            </Link>
          )}
          <LanguageSwitcher />
        </div>

        <button className="xl:hidden text-brand-dark" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      <div className={`xl:hidden fixed top-[73px] left-0 right-0 bg-white shadow-lg transition-all duration-300 z-[60] ${isOpen ? 'max-h-[calc(100vh-73px)] opacity-100 overflow-y-auto' : 'max-h-0 opacity-0 overflow-hidden'}`}>
        <div className="container-custom py-4 flex flex-col space-y-4">
          <MobileNavLink to={getLocalizedPath('/')} label={t('home_title', 'Home')} />
          {user && isAdmin() && (
            <MobileNavLink to="/dashboard" label="Dashboard" />
          )}
          {user && isCustomer() && !isAdmin() && (
            <MobileNavLink to="/customer/dashboard" label="My Dashboard" />
          )}
          {user && isPartner() && (
            <MobileNavLink to="/partner/jobs" label="Partner Portal" />
          )}
          <div className="pl-4 border-l-2 border-gray-100 ml-2 space-y-2">
             <div className="font-medium text-brand-dark py-2">{t('navbar_services', 'Services')}</div>
             <MobileNavLink to={getLocalizedPath('/services/cnc-machining')} label="5-Axis Milling" />
             <MobileNavLink to={getLocalizedPath('/services/cnc-machining')} label="Turning" />
             <MobileNavLink to={getLocalizedPath('/services/sheet-metal')} label="Sheet Metal Bending" />
             <MobileNavLink to={getLocalizedPath('/services/3d-printing')} label="3D Printing" />
          </div>
          <MobileNavLink to={getLocalizedPath('/industries')} label={t('navbar_industries')} />
          <MobileNavLink to={getLocalizedPath('/our-work')} label={t('navbar_our_work')} />
          <MobileNavLink to={getLocalizedPath('/blog')} label={t('navbar_blog', 'Blog')} />
          <MobileNavLink to={getLocalizedPath('/education')} label={t('navbar_education', 'Education')} />
          <MobileNavLink to={getLocalizedPath('/about')} label={t('navbar_about')} />
          <MobileNavLink to={getLocalizedPath('/contact')} label={t('navbar_contact')} />
          <Link to={getLocalizedPath('/quote')} className="btn-primary text-center">{t('navbar_get_quote')}</Link>
          {user && (
            <>
              <div className="border-t pt-2 mt-2">
                <div className="font-medium text-brand-dark py-2">My Account</div>
                {isCustomer() && !isAdmin() && (
                  <>
                    <MobileNavLink to="/customer/dashboard" label="My Dashboard" />
                    <MobileNavLink to="/customer/projects" label="My Projects" />
                    <MobileNavLink to="/customer/finance" label="My Finance" />
                  </>
                )}
                {isPartner() && (
                  <>
                    <MobileNavLink to="/partner/jobs" label="Job Board" />
                    <MobileNavLink to="/partner/orders" label="My Orders" />
                    <MobileNavLink to="/partner/finance" label="Finance" />
                  </>
                )}
                {isAdmin() && (
                  <MobileNavLink to="/dashboard" label="Admin Dashboard" />
                )}
              </div>
              <Button
                variant="ghost"
                onClick={signOut}
                className="flex items-center justify-center gap-2 text-red-600"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </>
          )}
          {!user && (
            <Link to="/login" className="btn-primary text-center">Login</Link>
          )}
          <div className="w-full px-2">
            <LanguageSwitcher />
          </div>
        </div>
      </div>
      
      {/* Mobile Menu Backdrop */}
      {isOpen && (
        <div 
          className="xl:hidden fixed inset-0 bg-black/20 z-[55] top-[73px]"
          onClick={() => setIsOpen(false)}
        />
      )}
    </nav>
  );
};

const NavLink = ({ to, label, isActive }: { to: string, label: string, isActive: boolean }) => (
  <Link 
    to={to} 
    className={`font-medium transition-colors duration-200 px-3 py-2 ${isActive ? 'text-brand-accent' : 'text-brand-dark hover:text-brand-primary'}`}
  >
    {label}
  </Link>
);

const MobileNavLink = ({ to, label }: { to: string, label: string }) => (
  <Link to={to} className="font-medium text-brand-dark hover:text-brand-primary py-2 block">
    {label}
  </Link>
);

const ListItem = ({ className, title, children, to, icon, ...props }: any) => {
  return (
    <li>
      <Link
        to={to}
        className={`block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100 ${className}`}
        {...props}
      >
        <div className="flex items-center gap-3">
           <div className="text-brand-accent bg-brand-light/20 p-2 rounded-full">{icon}</div>
           <div>
            <div className="text-sm font-medium leading-none text-brand-dark">{title}</div>
            <p className="line-clamp-2 text-xs leading-snug text-gray-500 mt-1">
              {children}
            </p>
           </div>
        </div>
      </Link>
    </li>
  )
}

export default Navbar;
