import React from 'react';
import IconRenderer from '../IconRenderer';
import { WorkflowStepItem } from './data';
import { useTranslation } from 'react-i18next';

interface HowItWorksSectionProps {
  steps: WorkflowStepItem[];
}

const HowItWorksSection: React.FC<HowItWorksSectionProps> = ({ steps }) => {
  const { t, i18n } = useTranslation();
  console.log('HowItWorksSection rendered, lang:', i18n.language);
  return (
    <section id="workflow" className="section">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('how_it_works_title', 'How It Works')}</h2>
          <p className="text-lg text-gray-600">
            {t('how_it_works_subtitle', 'Our streamlined process makes it easy to get your parts manufactured quickly and efficiently')}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, index) => (
            <div 
              key={index} 
              className="bg-white rounded-lg shadow-md p-6 flex flex-col h-full"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-brand-teal h-8 w-8 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {step.step}
                </div>
                <h3 className="text-lg font-bold">{t(`workflow_step_${step.step}_title`, step.title)}</h3>
              </div>
              
              <div className="mb-4">
                <img 
                  src={step.image} 
                  alt={t(`workflow_step_${step.step}_title`, step.title)} 
                  className="rounded-lg w-full h-40 object-cover"
                />
              </div>
              
              <div className="flex items-start gap-3 mt-auto">
                <IconRenderer name={step.iconName} size={20} className="text-brand-teal mt-1 flex-shrink-0" />
                <p className="text-gray-600 text-sm">{t(`workflow_step_${step.step}_desc`, step.description)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
