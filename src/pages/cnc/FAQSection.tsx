import React from 'react';
import { useTranslation } from 'react-i18next';

const FAQSection = () => {
  const { t } = useTranslation();
  
  const faqs = [
    {
      question: t('service_cnc-machining_faq_quote_speed_question', 'How quickly can I get a quote for precision CNC machining services?'),
      answer: t('service_cnc-machining_faq_quote_speed_answer', 'At Microns Hub, we prioritize speed without compromising accuracy. You can upload your CAD files directly through our platform and receive a detailed, competitive quote within 24 hours. Our system analyzes your design for manufacturability to ensure accurate pricing and rapid turnaround times.')
    },
    {
      question: t('service_cnc-machining_faq_tolerances_question', 'What are the standard and tightest tolerances you can achieve with CNC machining?'),
      answer: t('service_cnc-machining_faq_tolerances_answer', 'Our standard CNC machining tolerance is ISO 2768-m, suitable for most functional metal and plastic parts. For high-precision applications—such as aerospace or medical components—we can achieve tight tolerances of ±0.01 mm (10 microns). Please specify critical dimensions in your technical drawings (PDF).')
    },
    {
      question: t('service_cnc-machining_faq_materials_question', 'What materials are available for custom CNC machined parts?'),
      answer: t('service_cnc-machining_faq_materials_answer', 'We offer a vast selection of certified metals and engineering plastics. Our inventory includes Aluminum (AL6061, AL7075, AL5083), Stainless Steel (304, 316L, 17-4PH), Titanium (Grade 5), and Tool Steels. We also machine high-performance plastics like POM (Delrin), PEEK, and Polycarbonate.')
    },
    {
      question: t('service_cnc-machining_faq_5axis_question', 'When should I choose 5-axis CNC milling over 3-axis machining?'),
      answer: t('service_cnc-machining_faq_5axis_answer', '3-axis milling is cost-effective for parts with simple geometries machined from one side. 5-axis CNC milling is ideal for complex parts with intricate features, deep cavities, or undercuts, as it allows the tool to approach the workpiece from all angles, improving precision and reducing setup time.')
    },
    {
      question: t('service_cnc-machining_faq_prototyping_question', 'Do you handle both rapid prototyping and low-volume production runs?'),
      answer: t('service_cnc-machining_faq_prototyping_answer', 'Yes, Microns Hub is built to scale. We offer rapid prototyping (from 1 piece) to validate designs quickly, as well as low-to-mid volume production (100–10,000+ parts). Our network allows us to transition you seamlessly from prototype to series production without minimum order quantity (MOQ) bottlenecks.')
    },
    {
      question: t('service_cnc-machining_faq_surface_finishes_question', 'What surface finishes and post-processing options do you offer?'),
      answer: t('service_cnc-machining_faq_surface_finishes_answer', 'We provide comprehensive post-processing to ensure parts are end-use ready. Finishes include As-Machined, Bead Blasting (matte), Anodizing (Type II/III), Passivation, Electroplating, Powder Coating, and Heat Treatment. These treatments enhance wear resistance, corrosion protection, and aesthetics.')
    },
    {
      question: t('service_cnc-machining_faq_quality_question', 'How do you ensure the quality of CNC machined parts?'),
      answer: t('service_cnc-machining_faq_quality_answer', 'Quality is paramount. We work with manufacturing partners who follow strict ISO 9001 certified processes. Every order undergoes rigorous quality control, including Material Certification (available upon request) and 100% part inspection for critical dimensions before shipment.')
    },
    {
      question: t('service_cnc-machining_faq_cost_factors_question', 'What factors most significantly impact the cost of CNC machining?'),
      answer: t('service_cnc-machining_faq_cost_factors_answer', 'The main cost drivers are machining time, material cost, and complexity. To reduce costs, we recommend using standard hole sizes, avoiding deep cavities, minimizing tight tolerances to only necessary features, and reducing the number of required part orientations (setups).')
    },
    {
      question: t('service_cnc-machining_faq_max_dimensions_question', 'What are the maximum part dimensions you can machine?'),
      answer: t('service_cnc-machining_faq_max_dimensions_answer', 'We can handle large-format machining projects. Our network capabilities allow for maximum part dimensions of up to 7500 mm x 3000 mm x 2200 mm. Whether you need small connectors or large structural components, we have the capacity to accommodate your size requirements.')
    },
    {
      question: t('service_cnc-machining_faq_cad_formats_question', 'Which CAD file formats do you accept for quoting and manufacturing?'),
      answer: t('service_cnc-machining_faq_cad_formats_answer', 'For the fastest quoting, please upload 3D CAD files in STEP (.stp/.step) format. We also accept IGES, X_T, and SolidWorks files. For tolerances, threads, and specific surface finish requirements, please accompany your 3D model with a 2D technical drawing (PDF).')
    }
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container-custom max-w-6xl">
        <h2 className="text-3xl font-bold mb-12 text-center">
          {t('service_cnc-machining_faq_heading', 'Frequently Asked Questions')}
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

