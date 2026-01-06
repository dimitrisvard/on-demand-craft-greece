import React from 'react';
import { useTranslation } from 'react-i18next';

const FAQSection = () => {
  const { t } = useTranslation();
  
  const faqs = [
    {
      question: t('service_surface-finish_faq_importance_question', 'Why is surface finishing important for manufactured parts?'),
      answer: t('service_surface-finish_faq_importance_answer', 'Surface finishing is critical for both functionality and aesthetics. It improves corrosion resistance, hardness, electrical conductivity, and wear resistance, while also removing machining marks to provide a professional, consumer-ready look.')
    },
    {
      question: t('service_surface-finish_faq_anodizing_types_question', 'What is the difference between Anodizing Type II and Type III?'),
      answer: t('service_surface-finish_faq_anodizing_types_answer', 'Type II Anodizing is decorative, providing corrosion resistance and a wide range of color options. Type III (Hardcoat) Anodizing creates a much thicker, harder ceramic-like layer, offering superior wear resistance and electrical insulation for harsh industrial environments.')
    },
    {
      question: t('service_surface-finish_faq_powder_coating_question', 'Can you color-match parts using Powder Coating?'),
      answer: t('service_surface-finish_faq_powder_coating_answer', 'Yes, Powder Coating is available in a vast array of RAL and Pantone colors. It provides a durable, uniform finish that is more resistant to chipping and scratching than traditional wet paint, making it ideal for enclosures and architectural parts.')
    },
    {
      question: t('service_surface-finish_faq_passivation_question', 'What is passivation and which materials require it?'),
      answer: t('service_surface-finish_faq_passivation_answer', 'Passivation is a chemical process used primarily for Stainless Steel. It removes free iron from the surface and enhances the formation of a passive oxide layer, significantly improving the material\'s natural corrosion resistance without altering dimensions.')
    },
    {
      question: t('service_surface-finish_faq_bead_blasting_question', 'How does bead blasting affect part tolerances?'),
      answer: t('service_surface-finish_faq_bead_blasting_answer', 'Bead blasting removes material very slightly to create a matte, uniform texture. While generally negligible, it can affect extremely tight tolerances (e.g., < 0.01mm). We recommend masking critical features like bearing bores or threads during the blasting process.')
    },
    {
      question: t('service_surface-finish_faq_electroless_nickel_question', 'What is Electroless Nickel Plating used for?'),
      answer: t('service_surface-finish_faq_electroless_nickel_answer', 'Electroless Nickel Plating deposits a uniform layer of nickel-phosphorus alloy on complex geometries. It is excellent for corrosion protection, hardness, and lubricity, and unlike electrolytic plating, it ensures even thickness across all surfaces, including internal cavities.')
    },
    {
      question: t('service_surface-finish_faq_black_oxide_question', 'Do you offer Black Oxide finishing?'),
      answer: t('service_surface-finish_faq_black_oxide_answer', 'Yes, Black Oxide is a conversion coating for ferrous metals, stainless steel, and copper. It adds mild corrosion resistance and minimizes light reflection. It is commonly used on gears, fasteners, and tools where dimensional change must be minimized.')
    },
    {
      question: t('service_surface-finish_faq_mirror_finish_question', 'Can you polish parts to a mirror finish?'),
      answer: t('service_surface-finish_faq_mirror_finish_answer', 'We offer mechanical polishing and electropolishing to achieve low Ra (roughness average) values, up to a mirror-like finish. This is essential for medical devices, food processing equipment, and high-end aesthetic components.')
    },
    {
      question: t('service_surface-finish_faq_surface_roughness_question', 'What is the standard surface roughness (Ra) for CNC parts?'),
      answer: t('service_surface-finish_faq_surface_roughness_answer', 'The standard "as-machined" finish is typically Ra 3.2 μm, where visible tool marks remain. We can refine this to Ra 1.6, 0.8, or 0.4 μm through smoothing and polishing processes depending on your requirements.')
    },
    {
      question: t('service_surface-finish_faq_multiple_finishes_question', 'Can you apply multiple finishes to a single part?'),
      answer: t('service_surface-finish_faq_multiple_finishes_answer', 'Yes, we can perform selective finishing. For example, we can anodize an aluminum part and then CNC machine specific areas to expose the raw metal for electrical grounding (masking), or apply chromate conversion to internal surfaces while powder coating the exterior.')
    }
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container-custom max-w-6xl">
        <h2 className="text-3xl font-bold mb-12 text-center">
          {t('service_surface-finish_faq_heading', 'Frequently Asked Questions')}
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

