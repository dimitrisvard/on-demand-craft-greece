import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const processes = [
  { key: 'service_injection-molding_processes_1', default: 'Conventional Injection Molding' },
  { key: 'service_injection-molding_processes_2', default: 'Overmolding' },
  { key: 'service_injection-molding_processes_3', default: 'Insert Molding' },
  { key: 'service_injection-molding_processes_4', default: 'Two-Shot Molding' },
  { key: 'service_injection-molding_processes_5', default: 'Micro Injection Molding' },
];

const ProcessesSection = () => {
  const { t } = useTranslation();
  const [openItem, setOpenItem] = useState<string>("conventional");

  return (
    <section className="py-16 bg-brand-light">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t('service_injection-molding_processes_heading', 'Injection Molding Processes')}</h2>
          <p className="text-gray-600 max-w-3xl mx-auto">
            {t('service_injection-molding_processes_desc', 'We offer a range of injection molding processes to suit different project requirements, volumes, and complexity levels.')}
          </p>
        </div>
        
        <div className="max-w-4xl mx-auto">
          <Accordion type="single" collapsible defaultValue="conventional">
            {processes.map((proc, i) => (
              <AccordionItem key={i} value={proc.key}>
                <AccordionTrigger className="text-xl font-medium py-4">
                  {t(proc.key, proc.default)}
                </AccordionTrigger>
                <AccordionContent className="pb-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-gray-700 mb-4">{t(`${proc.key}_desc`, 'Description coming soon.')}</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default ProcessesSection;
