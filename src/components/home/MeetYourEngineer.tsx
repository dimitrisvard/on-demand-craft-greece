import React from 'react';
import { useTranslation } from 'react-i18next';

const MeetYourEngineer: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section className="py-24 bg-white section">
      <div className="container-custom">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          {/* Image Side */}
          <div className="relative">
            <div className="aspect-[4/5] bg-gray-200 rounded-lg overflow-hidden shadow-2xl relative">
              <img 
                src="/lovable-uploads/engineer-measuring-part.jpg" 
                alt="microns hub engineer" 
                className="w-full h-full object-cover brightness-110"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                <p className="text-white font-bold text-xl">Alex K.</p>
                <p className="text-gray-300 text-sm">Senior Manufacturing Engineer</p>
              </div>
            </div>
            
            {/* Decorative element */}
            <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-brand-primary rounded-lg -z-10"></div>
            <div className="absolute -top-6 -left-6 w-32 h-32 border-4 border-gray-100 rounded-lg -z-10"></div>
          </div>

          {/* Content Side */}
          <div>
            <h2 className="text-4xl font-bold mb-6 text-gray-900 leading-tight">
              We are not an algorithm.<br />
              <span className="text-brand-primary">We are engineers.</span>
            </h2>
            
            <div className="prose prose-lg text-gray-600 mb-8">
              <p className="mb-4">
                Unlike automated platforms that just pass your file to the lowest bidder, every quote at Microns Hub is reviewed by a qualified engineer.
              </p>
              <p>
                We check for manufacturability, suggest cost-saving improvements, and ensure your tolerances are realistic before production even begins. It's the difference between "getting a part" and "getting the right part."
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mt-8">
               <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
                  <div className="bg-white p-2 rounded-full shadow-sm text-2xl">🧐</div>
                  <div>
                    <h4 className="font-bold text-gray-900">DFM Review</h4>
                    <p className="text-sm text-gray-500">Free Design for Manufacturing feedback on every order.</p>
                  </div>
               </div>
               <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
                  <div className="bg-white p-2 rounded-full shadow-sm text-2xl">🛡️</div>
                  <div>
                    <h4 className="font-bold text-gray-900">Quality Guarantee</h4>
                    <p className="text-sm text-gray-500">We inspect every batch before it ships to you.</p>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MeetYourEngineer;

