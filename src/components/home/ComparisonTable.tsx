import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

const ComparisonTable: React.FC = () => {
  const { t } = useTranslation();

  const comparisonData = [
    {
      feature: "Direct Factory Access",
      micronsHub: true,
      broker: false
    },
    {
      feature: "Engineer-Reviewed Quotes",
      micronsHub: true,
      broker: false
    },
    {
      feature: "No Hidden Commission Fees",
      micronsHub: true,
      broker: false
    },
    {
      feature: "Direct Communication with Makers",
      micronsHub: true,
      broker: false
    },
    {
      feature: "ISO 9001:2015 Certified Factories",
      micronsHub: true,
      broker: true // Usually brokers also have certified partners, but let's stick to the prompt's vibe
    },
    {
      feature: "Full IP Protection (EU Law)",
      micronsHub: true,
      broker: "Varies" // Or false if we want to be aggressive
    }
  ];

  return (
    <section className="bg-gray-50 section py-20">
      <div className="container-custom">
        <div className="text-center max-w-4xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-extrabold mb-6 text-gray-900 tracking-tight">
            Stop Paying the Broker Tax.
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Why pay 30% more for a middleman? Connect directly with premium European factories and save on every part.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Comparison Table */}
          <div className="bg-white rounded-xl shadow-xl overflow-hidden border border-gray-200">
            <div className="grid grid-cols-3 bg-gray-900 text-white p-4">
              <div className="font-bold">Feature</div>
              <div className="text-center font-bold text-brand-primary">Microns Hub</div>
              <div className="text-center font-bold text-gray-400">Brokers</div>
            </div>
            {comparisonData.map((row, index) => (
              <div key={index} className={`grid grid-cols-3 p-4 border-b border-gray-100 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <div className="font-medium text-gray-800 flex items-center">{row.feature}</div>
                <div className="flex justify-center items-center">
                  <div className="bg-green-100 p-1 rounded-full">
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                </div>
                <div className="flex justify-center items-center">
                  {row.broker === true ? (
                     <div className="bg-gray-100 p-1 rounded-full">
                        <Check className="w-5 h-5 text-gray-500" />
                     </div>
                  ) : row.broker === "Varies" ? (
                    <span className="text-sm text-gray-500 font-medium">Varies</span>
                  ) : (
                    <div className="bg-red-100 p-1 rounded-full">
                      <X className="w-5 h-5 text-red-500" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Visual Pricing Bar */}
          <div className="bg-white p-8 rounded-xl shadow-xl border border-gray-200 h-full flex flex-col justify-center">
             <h3 className="text-2xl font-bold mb-8 text-center text-gray-900">Cost Comparison</h3>
             <div className="flex items-end justify-center space-x-12 h-64 w-full px-8">
               {/* Broker Bar */}
               <div className="flex flex-col items-center w-1/3 h-full justify-end group">
                 <div className="text-lg font-bold text-gray-500 mb-2 group-hover:text-red-500 transition-colors">100%</div>
                 <div className="w-full bg-gray-300 rounded-t-lg relative h-full group-hover:bg-red-200 transition-all duration-500">
                    <div className="absolute bottom-4 left-0 right-0 text-center text-gray-600 font-medium transform -rotate-90 sm:rotate-0">Broker Price</div>
                 </div>
               </div>

               {/* Microns Hub Bar */}
               <div className="flex flex-col items-center w-1/3 h-full justify-end group">
                 <div className="text-lg font-bold text-brand-primary mb-2 group-hover:scale-110 transition-transform">~70%</div>
                 <div className="w-full bg-brand-primary rounded-t-lg relative h-[70%] shadow-lg group-hover:shadow-brand-primary/50 transition-all duration-500">
                    <div className="absolute top-4 left-0 right-0 text-center text-white font-bold">Factory Direct</div>
                 </div>
               </div>
             </div>
             <p className="text-center text-sm text-gray-500 mt-6">
               *Average cost savings based on removal of broker commissions and markups.
             </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ComparisonTable;
