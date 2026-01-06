import React from 'react';
import { useTranslation } from 'react-i18next';

const FAQSection = () => {
  const { t } = useTranslation();
  
  const faqs = [
    {
      question: t('service_sheet-metal_faq_max_size_question', 'What is the maximum sheet size and thickness for laser cutting services?'),
      answer: t('service_sheet-metal_faq_max_size_answer', 'We can process sheet metal parts with maximum dimensions up to 2500 x 1250 mm. Our laser cutting capabilities handle material thicknesses ranging from 0.5 mm up to 25 mm, ensuring versatility for both delicate enclosures and heavy-duty structural brackets.')
    },
    {
      question: t('service_sheet-metal_faq_tolerances_question', 'What standard tolerances apply to your sheet metal fabrication?'),
      answer: t('service_sheet-metal_faq_tolerances_answer', 'For laser cutting and CNC bending, our standard general tolerance is ±0.1 mm. Tighter tolerances may be achievable depending on the feature and material thickness; please indicate critical dimensions on your 2D drawings for engineering review.')
    },
    {
      question: t('service_sheet-metal_faq_materials_question', 'Which materials are commonly stocked for sheet metal projects?'),
      answer: t('service_sheet-metal_faq_materials_answer', 'We stock a wide range of sheet metals, including Aluminum (5052, 6061, 7075), Stainless Steel (304, 316/316L), Mild Steel (CRS, HRPO), Galvanized Steel, Copper, and Brass. Specialized alloys can also be sourced upon request.')
    },
    {
      question: t('service_sheet-metal_faq_hardware_question', 'Can you provide sheet metal parts with pre-installed hardware?'),
      answer: t('service_sheet-metal_faq_hardware_answer', 'Yes, we offer full assembly services including the insertion of fasteners such as PEM nuts, studs, and standoffs. We also perform welding (MIG, TIG, Spot) and riveting to deliver complete, ready-to-assemble components.')
    },
    {
      question: t('service_sheet-metal_faq_surface_finishes_question', 'What surface finishes are recommended for sheet metal parts?'),
      answer: t('service_sheet-metal_faq_surface_finishes_answer', 'To prevent corrosion and improve aesthetics, we offer Powder Coating (in various RAL colors), Anodizing (for aluminum), Zinc Plating, Chromating, and Brushing. We can advise on the best finish based on your part\'s operating environment.')
    },
    {
      question: t('service_sheet-metal_faq_bending_question', 'Do you offer bending and forming for complex geometries?'),
      answer: t('service_sheet-metal_faq_bending_answer', 'Absolutely. We utilize CNC-controlled press brakes to create accurate bends and complex forms. Our equipment supports multiple bend angles and complicated geometries, ensuring repeatability across production batches.')
    },
    {
      question: t('service_sheet-metal_faq_moq_question', 'Is there a minimum order quantity (MOQ) for sheet metal fabrication?'),
      answer: t('service_sheet-metal_faq_moq_answer', 'No, we support projects starting from a single prototype (Batch size: 1) up to high-volume production runs. Our agile manufacturing setup allows us to be cost-effective for both one-off custom parts and large series.')
    },
    {
      question: t('service_sheet-metal_faq_design_files_question', 'How do I prepare my design files for sheet metal fabrication?'),
      answer: t('service_sheet-metal_faq_design_files_answer', 'For the best results, please submit a 3D STEP file representing the folded part and a 2D PDF drawing specifying threads, tolerances, and finishing requirements. Ensure your design accounts for bend radii and material deformation (K-factor).')
    },
    {
      question: t('service_sheet-metal_faq_lead_time_question', 'What is the typical lead time for sheet metal parts?'),
      answer: t('service_sheet-metal_faq_lead_time_answer', 'Our optimized workflow allows for fast turnarounds. Depending on complexity and quantity, we can ship sheet metal prototypes in as little as 3–5 business days, helping you accelerate your product development cycle.')
    },
    {
      question: t('service_sheet-metal_faq_redesign_question', 'Can you help redesign a machined part for sheet metal fabrication to save costs?'),
      answer: t('service_sheet-metal_faq_redesign_answer', 'Yes, converting machined parts to sheet metal is a common cost-reduction strategy. Our engineering team can review your design and suggest modifications—such as replacing solid blocks with bent sheet metal—to significantly lower material usage and production costs.')
    }
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container-custom max-w-6xl">
        <h2 className="text-3xl font-bold mb-12 text-center">
          {t('service_sheet-metal_faq_heading', 'Frequently Asked Questions')}
        </h2>
        
        <div className="space-y-6">
          {faqs.map((faq, index) => (
            <div key={index} className="bg-white rounded-lg p-6 shadow-md border border-gray-100">
              <h3 className="text-xl font-bold mb-3">{faq.question}</h3>
              <p className="text-gray-600">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQSection;

