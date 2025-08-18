import React from 'react';
import { useTranslation } from 'react-i18next';
const DimensionsSection = () => {
  const { t } = useTranslation();
  return <section className="py-16 bg-white">
      <div className="container-custom">
        <div className="max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl font-bold text-center mb-4">{t('service_injection-molding_dimensions_heading', 'Dimensions & Tolerances')}</h2>
          <p className="text-gray-600 text-center">
            {t('service_injection-molding_dimensions_desc', 'Precision is paramount in injection molding, especially for safety-critical components in industries like automotive, aerospace, and medical. Our advanced molding capabilities ensure tight tolerances and consistent dimensions across production runs.')}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="bg-brand-light rounded-lg p-6 text-center">
            <h3 className="font-bold text-xl mb-2">{t('service_injection-molding_dimensions_part_size_range', 'Part Size Range')}</h3>
            <p className="text-gray-700 mb-2">{t('service_injection-molding_dimensions_minimum', 'Minimum')}</p>
            <p className="text-brand-accent font-bold text-lg">3 × 3 × 3 mm</p>
            <p className="text-gray-700 mb-2 mt-4">{t('service_injection-molding_dimensions_maximum', 'Maximum')}</p>
            <p className="text-brand-accent font-bold text-lg">1000 × 1000 × 1000 mm</p>
          </div>
          
          <div className="bg-brand-light rounded-lg p-6 text-center">
            <h3 className="font-bold text-xl mb-2">{t('service_injection-molding_dimensions_wall_thickness', 'Wall Thickness')}</h3>
            <p className="text-gray-700 mb-2">{t('service_injection-molding_dimensions_minimum', 'Minimum')}</p>
            <p className="text-brand-accent font-bold text-lg">0.2 mm</p>
            <p className="text-gray-700 mb-2 mt-4">{t('service_injection-molding_dimensions_recommended', 'Recommended')}</p>
            <p className="text-brand-accent font-bold text-lg">1.0 - 3.0 mm</p>
          </div>
          
          <div className="bg-brand-light rounded-lg p-6 text-center">
            <h3 className="font-bold text-xl mb-2">{t('service_injection-molding_dimensions_tolerances', 'Tolerances')}</h3>
            <p className="text-gray-700 mb-2">{t('service_injection-molding_dimensions_standard', 'Standard')}</p>
            <p className="text-brand-accent font-bold text-lg">±0.1 mm</p>
            <p className="text-gray-700 mb-2 mt-4">{t('service_injection-molding_dimensions_precision', 'Precision')}</p>
            <p className="text-brand-accent font-bold text-lg">Down to ±0.01 mm</p>
          </div>
          
          <div className="bg-brand-light rounded-lg p-6 text-center">
            <h3 className="font-bold text-xl mb-2">{t('service_injection-molding_dimensions_production_quantity', 'Production Quantity')}</h3>
            <p className="text-gray-700 mb-2">{t('service_injection-molding_dimensions_minimum', 'Minimum')}</p>
            <p className="text-brand-accent font-bold text-lg">1 piece</p>
            <p className="text-gray-700 mb-2 mt-4">{t('service_injection-molding_dimensions_optimal', 'Optimal')}</p>
            <p className="text-brand-accent font-bold text-lg">1,000,000+ pieces</p>
          </div>
        </div>
        
        <div className="bg-brand-light p-6 rounded-lg">
          <h3 className="font-bold text-xl mb-4 text-center">{t('service_injection-molding_dimensions_applications_heading', 'Common Applications by Dimension')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <h4 className="font-bold mb-2">{t('service_injection-molding_dimensions_small_parts', 'Small Parts')}</h4>
              <p className="text-gray-700">{t('service_injection-molding_dimensions_small_parts_examples', 'Gears, connectors, caps, buttons')}</p>
            </div>
            <div className="text-center">
              <h4 className="font-bold mb-2">{t('service_injection-molding_dimensions_medium_parts', 'Medium Parts')}</h4>
              <p className="text-gray-700">{t('service_injection-molding_dimensions_medium_parts_examples', 'Housings, panels, containers, fixtures')}</p>
            </div>
            <div className="text-center">
              <h4 className="font-bold mb-2">{t('service_injection-molding_dimensions_large_parts', 'Large Parts')}</h4>
              <p className="text-gray-700">{t('service_injection-molding_dimensions_large_parts_examples', 'Automotive panels, furniture components, industrial containers')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>;
};
export default DimensionsSection;