import React from 'react';
import { useTranslation } from 'react-i18next';

const FAQSection = () => {
  const { t } = useTranslation();
  
  const faqs = [
    {
      question: t('service_3d-printing_faq_technologies_question', 'Which 3D printing technologies are available at Microns Hub?'),
      answer: t('service_3d-printing_faq_technologies_answer', 'We offer a suite of industrial additive manufacturing technologies, including FDM (Fused Deposition Modeling) for rapid prototypes, SLA (Stereolithography) for high-detail visual models, SLS (Selective Laser Sintering) for functional nylon parts, and MJF (Multi Jet Fusion) for production-grade components.')
    },
    {
      question: t('service_3d-printing_faq_materials_question', 'What materials can I choose for 3D printed parts?'),
      answer: t('service_3d-printing_faq_materials_answer', 'Our material range covers rigid and flexible options. Common materials include PLA and ABS for basic fit checks, Nylon (PA12) for functional durability, Resins for smooth details, and high-performance thermoplastics like PEEK or Carbon-Filled Nylon for engineering applications.')
    },
    {
      question: t('service_3d-printing_faq_vs_cnc_question', 'How does 3D printing compare to CNC machining for prototyping?'),
      answer: t('service_3d-printing_faq_vs_cnc_answer', '3D printing is generally faster and more cost-effective for complex geometries and low quantities, as it requires no tooling. CNC machining is better for testing the actual production material and achieving tighter tolerances. We can help you decide the best method for your specific project phase.')
    },
    {
      question: t('service_3d-printing_faq_large_parts_question', 'Can you print large parts in a single piece?'),
      answer: t('service_3d-printing_faq_large_parts_answer', 'Yes, we have large-format printers capable of producing bulky components. For parts exceeding our build volumes, we can print in sections and professionally bond them to create full-scale models with high structural integrity.')
    },
    {
      question: t('service_3d-printing_faq_end_use_question', 'Is 3D printing suitable for end-use production parts?'),
      answer: t('service_3d-printing_faq_end_use_answer', 'Absolutely. Technologies like SLS and MJF produce isotropic, durable parts suitable for end-use applications in automotive, medical, and industrial machinery. These parts can be post-processed to look and perform like injection-molded components.')
    },
    {
      question: t('service_3d-printing_faq_resolution_question', 'What is the typical layer height and resolution?'),
      answer: t('service_3d-printing_faq_resolution_answer', 'Resolution depends on the technology. SLA and PolyJet can achieve layer heights as fine as 0.02–0.05 mm for smooth surfaces. FDM typically ranges from 0.1–0.3 mm, while SLS/MJF usually prints at 0.08–0.1 mm, offering a balance of speed and detail.')
    },
    {
      question: t('service_3d-printing_faq_post_processing_question', 'Do you offer post-processing for 3D printed parts?'),
      answer: t('service_3d-printing_faq_post_processing_answer', 'Yes, we offer vapor smoothing (to seal surfaces), sandblasting, dyeing (coloring nylon parts), and painting. These finishes improve the mechanical properties and visual quality of the printed parts.')
    },
    {
      question: t('service_3d-printing_faq_file_formats_question', 'What file formats are required for 3D printing quotes?'),
      answer: t('service_3d-printing_faq_file_formats_answer', 'The standard format for 3D printing is STL, but we also accept STEP and IGES files. Please ensure your mesh is "watertight" (manifold) to prevent slicing errors and ensure an accurate quote.')
    },
    {
      question: t('service_3d-printing_faq_speed_question', 'How quickly can I receive my 3D printed parts?'),
      answer: t('service_3d-printing_faq_speed_answer', '3D printing is our fastest service. We can often produce and ship parts within 24–48 hours after order confirmation, making it the ideal solution for urgent prototyping needs.')
    },
    {
      question: t('service_3d-printing_faq_flexible_question', 'Can 3D printing produce flexible or rubber-like parts?'),
      answer: t('service_3d-printing_faq_flexible_answer', 'Yes, we print with flexible materials such as TPU (Thermoplastic Polyurethane) and various shore-hardness resins. These are perfect for prototyping gaskets, seals, grips, and vibration dampers.')
    }
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container-custom max-w-6xl">
        <h2 className="text-3xl font-bold mb-12 text-center">
          {t('service_3d-printing_faq_heading', 'Frequently Asked Questions')}
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

