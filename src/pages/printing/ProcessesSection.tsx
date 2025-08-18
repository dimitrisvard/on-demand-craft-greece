import React from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Printer, Layers, Settings, Box, File } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const processes = [
  {
    id: "fdm",
    nameKey: "service_3d-printing_processes_fdm",
    defaultName: "FDM (Fused Deposition Modeling)",
    icon: <Layers className="text-brand-primary" size={24} />,
    descriptionKey: "service_3d-printing_processes_fdm_desc",
    defaultDescription: "Material is extruded through a heated nozzle, depositing layer upon layer to create a 3D object.",
    pros: [
      { key: "service_3d-printing_processes_fdm_pro_1", default: "Cost-effective" },
      { key: "service_3d-printing_processes_fdm_pro_2", default: "Wide range of thermoplastics" },
      { key: "service_3d-printing_processes_fdm_pro_3", default: "Good for functional prototypes" },
      { key: "service_3d-printing_processes_fdm_pro_4", default: "Simple post-processing" }
    ],
    cons: [
      { key: "service_3d-printing_processes_fdm_con_1", default: "Limited resolution" },
      { key: "service_3d-printing_processes_fdm_con_2", default: "Visible layer lines" },
      { key: "service_3d-printing_processes_fdm_con_3", default: "Limited material strength" },
      { key: "service_3d-printing_processes_fdm_con_4", default: "Slower than some methods" }
    ]
  },
  {
    id: "sla",
    nameKey: "service_3d-printing_processes_sla",
    defaultName: "SLA (Stereolithography)",
    icon: <Layers className="text-brand-primary" size={24} />,
    descriptionKey: "service_3d-printing_processes_sla_desc",
    defaultDescription: "Liquid photopolymer resin is cured by a UV laser, creating precise and detailed parts with smooth surfaces.",
    pros: [
      { key: "service_3d-printing_processes_sla_pro_1", default: "High resolution and detail" },
      { key: "service_3d-printing_processes_sla_pro_2", default: "Smooth surface finish" },
      { key: "service_3d-printing_processes_sla_pro_3", default: "Accurate small features" },
      { key: "service_3d-printing_processes_sla_pro_4", default: "Various specialty resins available" }
    ],
    cons: [
      { key: "service_3d-printing_processes_sla_con_1", default: "Limited material properties" },
      { key: "service_3d-printing_processes_sla_con_2", default: "Requires post-curing" },
      { key: "service_3d-printing_processes_sla_con_3", default: "More expensive than FDM" },
      { key: "service_3d-printing_processes_sla_con_4", default: "Brittle parts" }
    ]
  },
  {
    id: "mjf",
    nameKey: "service_3d-printing_processes_mjf",
    defaultName: "MJF (Multi Jet Fusion)",
    icon: <Printer className="text-brand-primary" size={24} />,
    descriptionKey: "service_3d-printing_processes_mjf_desc",
    defaultDescription: "Powdered material is fused by a binding agent and energy source, creating high-detail, functional parts.",
    pros: [
      { key: "service_3d-printing_processes_mjf_pro_1", default: "High resolution" },
      { key: "service_3d-printing_processes_mjf_pro_2", default: "Excellent mechanical properties" },
      { key: "service_3d-printing_processes_mjf_pro_3", default: "Consistent in all directions" },
      { key: "service_3d-printing_processes_mjf_pro_4", default: "Cost-effective for small series" }
    ],
    cons: [
      { key: "service_3d-printing_processes_mjf_con_1", default: "Limited material options" },
      { key: "service_3d-printing_processes_mjf_con_2", default: "Limited colors" },
      { key: "service_3d-printing_processes_mjf_con_3", default: "Rough surface finish" },
      { key: "service_3d-printing_processes_mjf_con_4", default: "Higher minimum cost" }
    ]
  },
  {
    id: "polyjet",
    nameKey: "service_3d-printing_processes_polyjet",
    defaultName: "PolyJet",
    icon: <Printer className="text-brand-primary" size={24} />,
    descriptionKey: "service_3d-printing_processes_polyjet_desc",
    defaultDescription: "Photopolymer droplets are jetted and UV-cured in layers, allowing for multi-material printing.",
    pros: [
      { key: "service_3d-printing_processes_polyjet_pro_1", default: "High accuracy" },
      { key: "service_3d-printing_processes_polyjet_pro_2", default: "Multiple materials in one print" },
      { key: "service_3d-printing_processes_polyjet_pro_3", default: "Full color capability" },
      { key: "service_3d-printing_processes_polyjet_pro_4", default: "Smooth surface finish" }
    ],
    cons: [
      { key: "service_3d-printing_processes_polyjet_con_1", default: "Expensive" },
      { key: "service_3d-printing_processes_polyjet_con_2", default: "Fragile parts" },
      { key: "service_3d-printing_processes_polyjet_con_3", default: "Limited functional properties" },
      { key: "service_3d-printing_processes_polyjet_con_4", default: "Requires support removal" }
    ]
  },
  {
    id: "sls",
    nameKey: "service_3d-printing_processes_sls",
    defaultName: "SLS (Selective Laser Sintering)",
    icon: <Settings className="text-brand-primary" size={24} />,
    descriptionKey: "service_3d-printing_processes_sls_desc",
    defaultDescription: "Laser fuses powder particles together, creating strong, detailed parts without supports.",
    pros: [
      { key: "service_3d-printing_processes_sls_pro_1", default: "No support structures needed" },
      { key: "service_3d-printing_processes_sls_pro_2", default: "Strong functional parts" },
      { key: "service_3d-printing_processes_sls_pro_3", default: "Complex geometries possible" },
      { key: "service_3d-printing_processes_sls_pro_4", default: "Excellent for mechanical parts" }
    ],
    cons: [
      { key: "service_3d-printing_processes_sls_con_1", default: "Rough surface finish" },
      { key: "service_3d-printing_processes_sls_con_2", default: "Limited color options" },
      { key: "service_3d-printing_processes_sls_con_3", default: "Higher cost than FDM" },
      { key: "service_3d-printing_processes_sls_con_4", default: "Porous structure" }
    ]
  },
  {
    id: "slm",
    nameKey: "service_3d-printing_processes_slm",
    defaultName: "SLM (Selective Laser Melting)",
    icon: <Settings className="text-brand-primary" size={24} />,
    descriptionKey: "service_3d-printing_processes_slm_desc",
    defaultDescription: "Metal powder is fully melted by a high-power laser, creating dense metal parts.",
    pros: [
      { key: "service_3d-printing_processes_slm_pro_1", default: "Full-density metal parts" },
      { key: "service_3d-printing_processes_slm_pro_2", default: "Strong mechanical properties" },
      { key: "service_3d-printing_processes_slm_pro_3", default: "High detail level" },
      { key: "service_3d-printing_processes_slm_pro_4", default: "Range of metal alloys" }
    ],
    cons: [
      { key: "service_3d-printing_processes_slm_con_1", default: "Expensive process" },
      { key: "service_3d-printing_processes_slm_con_2", default: "Requires support structures" },
      { key: "service_3d-printing_processes_slm_con_3", default: "Complex post-processing" },
      { key: "service_3d-printing_processes_slm_con_4", default: "Slow build times" }
    ]
  },
  {
    id: "other",
    nameKey: "service_3d-printing_processes_other",
    defaultName: "Other Processes",
    icon: <Box className="text-brand-primary" size={24} />,
    descriptionKey: "service_3d-printing_processes_other_desc",
    defaultDescription: "Additional technologies including DLP, Binder Jetting, and EBM offer specialized capabilities.",
    pros: [
      { key: "service_3d-printing_processes_other_pro_1", default: "Specialized applications" },
      { key: "service_3d-printing_processes_other_pro_2", default: "Unique material properties" },
      { key: "service_3d-printing_processes_other_pro_3", default: "Industry-specific solutions" },
      { key: "service_3d-printing_processes_other_pro_4", default: "Advancing rapidly" }
    ],
    cons: [
      { key: "service_3d-printing_processes_other_con_1", default: "Limited availability" },
      { key: "service_3d-printing_processes_other_con_2", default: "Specialized knowledge required" },
      { key: "service_3d-printing_processes_other_con_3", default: "Often higher cost" },
      { key: "service_3d-printing_processes_other_con_4", default: "Technology-specific limitations" }
    ]
  }
];

const ProcessesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold text-center mb-12">{t('service_3d-printing_processes_heading', '3D Printing Processes')}</h2>
        
        <div className="max-w-4xl mx-auto">
          <Accordion type="single" collapsible className="w-full">
            {processes.map((process) => (
              <AccordionItem value={process.id} key={process.id}>
                <AccordionTrigger className="hover:bg-gray-100 px-4 rounded-t-lg">
                  <div className="flex items-center">
                    <span className="mr-3">{process.icon}</span>
                    <span className="font-bold">{t(process.nameKey, process.defaultName)}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="bg-white p-4 rounded-b-lg mb-4 shadow-sm">
                  <p className="mb-4 text-gray-700">{t(process.descriptionKey, process.defaultDescription)}</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-bold text-green-600 mb-2">{t('service_3d-printing_processes_advantages', 'Advantages')}</h4>
                      <ul className="list-disc pl-5 space-y-1">
                        {process.pros.map((pro, i) => (
                          <li key={i} className="text-gray-700">{t(pro.key, pro.default)}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-bold text-red-600 mb-2">{t('service_3d-printing_processes_limitations', 'Limitations')}</h4>
                      <ul className="list-disc pl-5 space-y-1">
                        {process.cons.map((con, i) => (
                          <li key={i} className="text-gray-700">{t(con.key, con.default)}</li>
                        ))}
                      </ul>
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
