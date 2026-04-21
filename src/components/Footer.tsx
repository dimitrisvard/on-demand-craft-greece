import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, Facebook, Twitter, Linkedin, Instagram, FileText, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTenant } from '@/contexts/TenantContext';

const Footer = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const { tenant } = useTenant();
  
  return (
    <footer className="bg-white text-gray-800 border-t border-gray-200">
      <div className="container-custom pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="space-y-4">
            <Link to={getLocalizedPath('/')}>
              <img
                src={tenant?.logoUrl || "/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png"}
                alt={`${tenant?.name || 'Microns Hub'} Logo`}
                className="h-12"
              />
            </Link>
            <p className="text-sm mt-4 text-gray-600">
              {tenant?.welcomeMessage || t('footer_company_desc', "Microns Hub is Greece's premier on-demand manufacturing platform, specializing in precision CNC machining, sheet metal fabrication and more.")}
            </p>
            <div className="flex space-x-4 pt-2">
              <SocialIcon icon={<Facebook size={18} />} />
              <SocialIcon icon={<Twitter size={18} />} />
              <SocialIcon icon={<Linkedin size={18} />} />
              <SocialIcon icon={<Instagram size={18} />} />
            </div>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4 text-gray-800">{t('footer_services', 'Services')}</h4>
            <ul className="space-y-3">
              <FooterLink to={getLocalizedPath('/services/cnc-machining')} label={t('footer_cnc_machining', 'CNC Machining')} />
              <FooterLink to={getLocalizedPath('/services/sheet-metal')} label={t('footer_sheet_metal', 'Sheet Metal Fabrication')} />
              <FooterLink to={getLocalizedPath('/services/3d-printing')} label={t('footer_3d_printing', '3D Printing')} />
              <FooterLink to={getLocalizedPath('/services/injection-molding')} label={t('footer_injection_molding', 'Injection Molding')} />
              <FooterLink to={getLocalizedPath('/services/surface-finish')} label={t('footer_surface_finishing', 'Surface Finishing')} />
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4 text-gray-800">{t('footer_company', 'Company')}</h4>
            <ul className="space-y-3">
              <FooterLink to={getLocalizedPath('/about')} label={t('footer_about_us', 'About Us')} />
              <FooterLink to={getLocalizedPath('/education')} label={t('navbar_education', 'Education')} />
              <FooterLink to={getLocalizedPath('/careers')} label={t('footer_careers', 'Careers')} />
              <FooterLink to={getLocalizedPath('/blog')} label={t('footer_blog', 'Blog')} />
              <FooterLink to={getLocalizedPath('/terms')} label={t('footer_terms', 'Terms of Service')} />
              <FooterLink to={getLocalizedPath('/privacy')} label={t('footer_privacy', 'Privacy Policy')} />
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4 text-gray-800">{t('footer_contact_us', 'Contact Us')}</h4>
            <ul className="space-y-3">
              <li className="flex items-start">
                <MapPin size={18} className="mr-2 text-brand-accent shrink-0 mt-1" />
                <span className="text-gray-600">{tenant?.address || t('footer_address', 'Industrial Area, Street B, Number 4, 71601 Heraklion, Crete, Greece')}</span>
              </li>
              <li className="flex items-center">
                <Phone size={18} className="mr-2 text-brand-accent" />
                <span className="text-gray-600">{tenant?.contactPhone || '+302104447830'}</span>
              </li>
              <li className="flex items-center">
                <Mail size={18} className="mr-2 text-brand-accent" />
                <span className="text-gray-600">{tenant?.contactEmail || 'info@micronshub.eu'}</span>
              </li>
              <li className="flex items-center">
                <FileText size={18} className="mr-2 text-brand-accent" />
                <span className="text-gray-600">{t('footer_vat_label', 'VAT Number')}: EL803129638</span>
              </li>
              <li className="flex items-center">
                <Scale size={18} className="mr-2 text-brand-accent" />
                <Link to={getLocalizedPath('/legal-notice')} className="text-gray-600 hover:text-brand-accent transition-colors">
                  {t('footer_impressum', 'Legal Notice')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-200 mt-12 pt-6 text-center text-sm text-gray-500">
          <p>&copy; {new Date().getFullYear()} {tenant?.name || 'Microns Hub'}. {t('footer_rights_reserved', 'All rights reserved.')}</p>
        </div>
      </div>
    </footer>
  );
};

const SocialIcon = ({ icon }: { icon: React.ReactNode }) => (
  <a href="#" className="bg-gray-200 hover:bg-brand-accent hover:text-white p-2 rounded-full transition-colors text-gray-700">
    {icon}
  </a>
);

const FooterLink = ({ to, label }: { to: string, label: string }) => (
  <li>
    <Link to={to} className="text-gray-600 hover:text-brand-accent transition-colors">
      {label}
    </Link>
  </li>
);

export default Footer;
