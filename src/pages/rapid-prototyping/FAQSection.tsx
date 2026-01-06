import React from 'react';
import { useTranslation } from 'react-i18next';

const FAQSection = () => {
  const { t } = useTranslation();
  
  const faqs = [
    {
      question: t('service_rapid-prototyping_faq_speed_question', 'How fast can Microns Hub deliver rapid prototypes?'),
      answer: t('service_rapid-prototyping_faq_speed_answer', 'Speed is our core strength. Depending on the complexity and technology chosen, we can manufacture and ship prototypes in as little as 3 business days. Our digital quoting system helps accelerate the process by providing instant pricing and DFM feedback.')
    },
    {
      question: t('service_rapid-prototyping_faq_functional_question', 'Which technology is best for a functional prototype?'),
      answer: t('service_rapid-prototyping_faq_functional_answer', 'For functional testing where material strength matters, CNC Machining or SLS 3D Printing (Nylon) are best. If you need to test fit and form only, FDM or SLA 3D printing offers a faster and more cost-effective solution.')
    },
    {
      question: t('service_rapid-prototyping_faq_production_material_question', 'Can I prototype in the actual production material?'),
      answer: t('service_rapid-prototyping_faq_production_material_answer', 'Yes. With CNC Machining and Sheet Metal Fabrication, we use the exact stock materials (e.g., Aluminum 6061, SS304) intended for your final product, ensuring your prototype\'s mechanical and thermal properties match the production units 100%.')
    },
    {
      question: t('service_rapid-prototyping_faq_prototype_to_production_question', 'Is it possible to move from prototyping to production with the same supplier?'),
      answer: t('service_rapid-prototyping_faq_prototype_to_production_answer', 'Absolutely. Microns Hub is a one-stop shop. We help you iterate through rapid prototyping and, once the design is frozen, seamlessly scale up to low-volume or mass production using our injection molding or extensive CNC network, keeping all your data in one place.')
    },
    {
      question: t('service_rapid-prototyping_faq_vacuum_casting_question', 'Do you offer Vacuum Casting for prototypes?'),
      answer: t('service_rapid-prototyping_faq_vacuum_casting_answer', 'Yes, Vacuum Casting (Urethane Casting) is excellent for producing 10–50 high-quality copies of a master pattern. It simulates injection molded parts in terms of surface finish and material properties (rigid or flexible) without the high cost of metal tooling.')
    },
    {
      question: t('service_rapid-prototyping_faq_ip_question', 'How do you handle intellectual property (IP) for prototypes?'),
      answer: t('service_rapid-prototyping_faq_ip_answer', 'We take IP protection seriously. We operate under strict EU laws and are happy to sign a Non-Disclosure Agreement (NDA) before you upload any files. Your designs are shared only with the vetted partners strictly necessary to manufacture your parts.')
    },
    {
      question: t('service_rapid-prototyping_faq_assemblies_question', 'Can you prototype complex assemblies?'),
      answer: t('service_rapid-prototyping_faq_assemblies_answer', 'Yes, we can manufacture multi-component assemblies. We can produce the metal housing via sheet metal, the internal brackets via CNC, and the plastic covers via 3D printing, delivering a complete works-like prototype for your review.')
    },
    {
      question: t('service_rapid-prototyping_faq_cost_difference_question', 'What is the cost difference between 3D printing and CNC for a single prototype?'),
      answer: t('service_rapid-prototyping_faq_cost_difference_answer', 'Generally, 3D printing is cheaper for a single unit with complex geometry. CNC machining has higher setup costs but becomes competitive as quantities increase or if the part requires the strength of solid metal. Our instant quote tool allows you to compare prices for both instantly.')
    },
    {
      question: t('service_rapid-prototyping_faq_file_types_question', 'What file types do I need to send for a prototyping quote?'),
      answer: t('service_rapid-prototyping_faq_file_types_answer', 'A 3D CAD file (STEP, STL, IGES) is sufficient for most prototyping quotes. If your prototype requires specific tolerances, threads, or surface finishes, please include a 2D drawing to ensure we meet your functional requirements.')
    },
    {
      question: t('service_rapid-prototyping_faq_design_feedback_question', 'Can you provide design feedback during the prototyping phase?'),
      answer: t('service_rapid-prototyping_faq_design_feedback_answer', 'Yes, our "Engineer-Reviewed" process means we check your files for manufacturability issues (like thin walls or impossible undercuts) before production. This feedback loop helps you refine your design early, saving time and money before you commit to expensive production tools.')
    }
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container-custom max-w-6xl">
        <h2 className="text-3xl font-bold mb-12 text-center">
          {t('service_rapid-prototyping_faq_heading', 'Frequently Asked Questions')}
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

