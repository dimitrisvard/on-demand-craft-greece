import React from 'react';
import { useTranslation } from 'react-i18next';

const FAQSection = () => {
  const { t } = useTranslation();
  
  const faqs = [
    {
      question: t('service_injection-molding_faq_min_quantity_question', 'What is the minimum quantity for injection molding orders?'),
      answer: t('service_injection-molding_faq_min_quantity_answer', 'While injection molding is typically for mass production, we offer bridge tooling and low-volume runs starting from as few as 500 units. This allows you to bridge the gap between prototyping and full-scale mass production without a massive initial investment.')
    },
    {
      question: t('service_injection-molding_faq_tooling_question', 'Do you offer rapid tooling (aluminum molds) or just steel molds?'),
      answer: t('service_injection-molding_faq_tooling_answer', 'We offer both. Aluminum molds are faster and cheaper to manufacture, ideal for low-volume runs (up to 10,000 shots). Hardened steel molds are available for high-volume production (100,000+ shots) requiring maximum durability and cycle speed.')
    },
    {
      question: t('service_injection-molding_faq_plastics_question', 'What types of plastics can be injection molded?'),
      answer: t('service_injection-molding_faq_plastics_answer', 'We mold a comprehensive range of thermoplastics, including commodity plastics like PP, PE, and PS, and engineering-grade materials like ABS, PC, Nylon (PA6/PA66), PBT, POM, and TPE/TPU. We can also include additives like glass fiber or UV stabilizers.')
    },
    {
      question: t('service_injection-molding_faq_overmolding_question', 'Can you handle overmolding and insert molding?'),
      answer: t('service_injection-molding_faq_overmolding_answer', 'Yes, we specialize in overmolding (e.g., soft rubber grips over hard plastic) and insert molding (encapsulating metal inserts like threaded brass nuts). These processes improve part functionality and eliminate secondary assembly steps.')
    },
    {
      question: t('service_injection-molding_faq_mold_time_question', 'How long does it take to manufacture a mold?'),
      answer: t('service_injection-molding_faq_mold_time_answer', 'Lead times vary by complexity. Simple rapid tooling can be ready in 2–4 weeks, while complex multi-cavity production molds typically take 4–8 weeks. We provide a detailed timeline with your DFM (Design for Manufacturability) report.')
    },
    {
      question: t('service_injection-molding_faq_mold_ownership_question', 'Who owns the mold after production?'),
      answer: t('service_injection-molding_faq_mold_ownership_answer', 'You do. Once you pay for the tooling, the mold is your property. We store and maintain it at our facility for your future production runs, ensuring it remains in optimal condition for its guaranteed lifespan.')
    },
    {
      question: t('service_injection-molding_faq_dfm_question', 'Do you provide a DFM analysis before cutting the mold?'),
      answer: t('service_injection-molding_faq_dfm_answer', 'Yes, every injection molding order includes a comprehensive DFM analysis. Our engineers review your design for draft angles, wall thickness consistency, gate locations, and ejection issues to prevent defects and ensure a high-quality outcome.')
    },
    {
      question: t('service_injection-molding_faq_accuracy_question', 'How accurate are injection molded parts?'),
      answer: t('service_injection-molding_faq_accuracy_answer', 'Injection molding offers high precision and repeatability. Standard tolerances are typically ±0.1 mm to ±0.2 mm, but tighter tolerances can be achieved with precision tooling and specific material selection.')
    },
    {
      question: t('service_injection-molding_faq_colors_question', 'Can you match specific brand colors (Pantone/RAL)?'),
      answer: t('service_injection-molding_faq_colors_answer', 'Absolutely. We use masterbatches or pre-compounded resins to match your specific Pantone or RAL color codes. This ensures your parts align perfectly with your brand identity and product design requirements.')
    },
    {
      question: t('service_injection-molding_faq_textures_question', 'What surface textures are available for molded parts?'),
      answer: t('service_injection-molding_faq_textures_answer', 'We can apply industry-standard textures, such as VDI 3400 or Mold-Tech finishes, directly to the mold cavity. Options range from high-gloss polish to heavy matte or grain textures to hide sink marks and improve grip.')
    }
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container-custom max-w-6xl">
        <h2 className="text-3xl font-bold mb-12 text-center">
          {t('service_injection-molding_faq_heading', 'Frequently Asked Questions')}
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

