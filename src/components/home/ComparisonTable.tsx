import React from 'react';
import { useTranslation } from 'react-i18next';

const ComparisonTable: React.FC = () => {
  const { t } = useTranslation();

  const comparisonData = [
    {
      feature: t('comparison_production_execution'),
      micronsHub: t('comparison_production_execution_microns'),
      marketplace: t('comparison_production_execution_marketplace')
    },
    {
      feature: t('comparison_pricing_advantage'),
      micronsHub: t('comparison_pricing_advantage_microns'),
      marketplace: t('comparison_pricing_advantage_marketplace')
    },
    {
      feature: t('comparison_repeat_orders'), // "Responsibility"
      micronsHub: t('comparison_repeat_orders_microns'),
      marketplace: t('comparison_repeat_orders_marketplace')
    },
    {
      feature: t('comparison_design_control'),
      micronsHub: t('comparison_design_control_microns'),
      marketplace: t('comparison_design_control_marketplace')
    },
    {
      feature: t('comparison_dedicated_engineer'),
      micronsHub: t('comparison_dedicated_engineer_microns'),
      marketplace: t('comparison_dedicated_engineer_marketplace')
    },
    {
      feature: t('comparison_quality_control'),
      micronsHub: t('comparison_quality_control_microns'),
      marketplace: t('comparison_quality_control_marketplace')
    },
    {
      feature: t('comparison_ip_confidentiality'),
      micronsHub: t('comparison_ip_confidentiality_microns'),
      marketplace: t('comparison_ip_confidentiality_marketplace')
    },
    {
      feature: t('comparison_flexibility_turnaround'),
      micronsHub: t('comparison_flexibility_turnaround_microns'),
      marketplace: t('comparison_flexibility_turnaround_marketplace')
    },
    {
      feature: t('comparison_platform_services'),
      micronsHub: t('comparison_platform_services_microns'),
      marketplace: t('comparison_platform_services_marketplace')
    },
    {
      feature: t('comparison_supply_chain'),
      micronsHub: t('comparison_supply_chain_microns'),
      marketplace: t('comparison_supply_chain_marketplace')
    }
  ];

  return (
    <section className="bg-white section">
      <div className="container-custom">
        <div className="text-center max-w-4xl mx-auto mb-8">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900">
            {t('comparison_title')}
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            {t('comparison_subtitle')}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-white rounded-lg shadow-xl overflow-hidden border border-gray-200">
             <thead className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
               <tr>
                 <th className="px-6 py-5 text-left font-bold text-lg border-r border-orange-400 w-1/4">{t('comparison_header_feature')}</th>
                 <th className="px-6 py-5 text-center font-bold text-lg border-r border-orange-400 w-1/3">{t('comparison_header_microns_hub')}</th>
                 <th className="px-6 py-5 text-center font-bold text-lg w-1/3">{t('comparison_header_marketplace')}</th>
               </tr>
             </thead>
            <tbody>
              {comparisonData.map((row, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-gray-50 hover:bg-gray-100' : 'bg-white hover:bg-gray-50'}>
                  <td className="px-6 py-5 font-semibold text-gray-900 border-r border-gray-200">
                    {row.feature}
                  </td>
                  <td className="px-6 py-5 text-gray-700 border-r border-gray-200 bg-green-50/30">
                    <div className="flex items-start justify-center text-left">
                      <div className="w-3 h-3 bg-green-500 rounded-full mt-2 mr-3 flex-shrink-0 shadow-sm"></div>
                      <span className="font-medium text-gray-800">{row.micronsHub}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-gray-700 bg-red-50/30">
                    <div className="flex items-start justify-center text-left">
                      <div className="w-3 h-3 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0 shadow-sm"></div>
                      <span>{row.marketplace}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

export default ComparisonTable;
