
import React from 'react';
import { Clock, Scale, Truck } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface DeliveryOptionsStepProps {
  deliveryOption: string;
  deliveryDate: string;
  updateFormState: (field: string, value: any) => void;
}

const DeliveryOptionsStep: React.FC<DeliveryOptionsStepProps> = ({
  deliveryOption,
  deliveryDate,
  updateFormState
}) => {
  return (
    <div>
      <h3 className="text-xl font-bold mb-6">Delivery Time</h3>
      <p className="text-gray-600 mb-8">Please choose your product class</p>

      <div className="mb-8">
        <img 
          src="/lovable-uploads/419601d6-ef53-4340-aecd-eb272cc33a96.png" 
          alt="Delivery time vs price graph" 
          className="mx-auto w-full max-w-md"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div 
          className={`border rounded-lg p-6 text-center cursor-pointer transition-all ${
            deliveryOption === 'express' 
              ? 'border-teal-600 bg-teal-50' 
              : 'border-gray-200 hover:border-teal-400'
          }`}
          onClick={() => updateFormState('deliveryOption', 'express')}
        >
          <Clock className="mx-auto text-teal-600 mb-4" size={40} />
          <h4 className="text-lg font-bold mb-2">Express</h4>
          <p className="text-sm text-gray-600">Every day counts!</p>
        </div>

        <div 
          className={`border rounded-lg p-6 text-center cursor-pointer transition-all ${
            deliveryOption === 'optimum' 
              ? 'border-teal-600 bg-teal-50' 
              : 'border-gray-200 hover:border-teal-400'
          }`}
          onClick={() => updateFormState('deliveryOption', 'optimum')}
        >
          <Scale className="mx-auto text-teal-600 mb-4" size={40} />
          <h4 className="text-lg font-bold mb-2">Optimum</h4>
          <p className="text-sm text-gray-600">Best ratio<br />price / delivery time</p>
        </div>

        <div 
          className={`border rounded-lg p-6 text-center cursor-pointer transition-all ${
            deliveryOption === 'economy' 
              ? 'border-teal-600 bg-teal-50' 
              : 'border-gray-200 hover:border-teal-400'
          }`}
          onClick={() => updateFormState('deliveryOption', 'economy')}
        >
          <Truck className="mx-auto text-teal-600 mb-4" size={40} />
          <h4 className="text-lg font-bold mb-2">Economy</h4>
          <p className="text-sm text-gray-600">Lowest price<br />20+ working days</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Provide maximum delivery date (optional)
          </label>
          <Input
            type="date"
            value={deliveryDate}
            onChange={(e) => updateFormState('deliveryDate', e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="max-w-md"
          />
          <p className="text-xs text-gray-500 mt-1">Please choose maximum delivery date.</p>
        </div>

        <div className="pt-4">
          <div className="flex items-center cursor-pointer text-teal-600 hover:text-teal-700">
            <span className="text-xl mr-2">+</span>
            <span>Competitor quotation (optional)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeliveryOptionsStep;
