
import React from 'react';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { StepComponentProps, getErrorAsString } from './types';

const StepDeliveryOptions: React.FC<StepComponentProps> = ({ formikProps }) => {
  const { values, errors, touched, setFieldValue } = formikProps;

  const deliveryOptions = [
    {
      id: 'standard',
      name: 'Standard Production',
      description: '10-15 business days',
      image: null
    },
    {
      id: 'express',
      name: 'Express Production',
      description: '5-8 business days',
      image: null 
    },
    {
      id: 'urgent',
      name: 'Urgent Production',
      description: '3-4 business days',
      image: null
    }
  ];

  return (
    <div className="space-y-8">
      <h3 className="text-xl font-medium mb-4">Delivery Options</h3>

      <div className="space-y-6">
        <div>
          <h4 className="text-base font-medium mb-3">Select Production Speed</h4>
          <RadioGroup
            value={values.delivery.speed}
            onValueChange={(value) => setFieldValue('delivery.speed', value)}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {deliveryOptions.map((option) => (
              <div key={option.id} className="relative">
                <RadioGroupItem
                  value={option.id}
                  id={option.id}
                  className="peer sr-only"
                />
                <Label
                  htmlFor={option.id}
                  className={cn(
                    "flex flex-col h-full p-4 rounded-md border-2 border-muted bg-popover hover:bg-accent hover:text-accent-foreground cursor-pointer",
                    "peer-data-[state=checked]:border-teal-600",
                    values.delivery.speed === option.id ? "border-teal-600" : ""
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className="font-medium block">{option.name}</span>
                      <span className="text-sm text-muted-foreground flex items-center mt-1">
                        <Clock className="h-3.5 w-3.5 mr-1" />
                        {option.description}
                      </span>
                    </div>
                    {values.delivery.speed === option.id && (
                      <div className="h-5 w-5 rounded-full bg-teal-600 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                    )}
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>
          {touched.delivery?.speed && errors.delivery?.speed && (
            <p className="text-red-500 text-sm mt-2">{getErrorAsString(errors.delivery.speed)}</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label htmlFor="delivery.maxDeliveryDate">
              Latest Delivery Date (Optional)
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal mt-1.5",
                    !values.delivery.maxDeliveryDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {values.delivery.maxDeliveryDate ? (
                    format(new Date(values.delivery.maxDeliveryDate), "PPP")
                  ) : (
                    <span>Select date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={values.delivery.maxDeliveryDate ? new Date(values.delivery.maxDeliveryDate) : undefined}
                  onSelect={(date) => setFieldValue('delivery.maxDeliveryDate', date ? date.toISOString() : '')}
                  initialFocus
                  disabled={(date) => date < new Date(new Date().setDate(new Date().getDate() + 2))}
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-gray-500 mt-1.5">
              If you have a specific deadline, please select it here. We'll do our best to accommodate it.
            </p>
          </div>

          <div>
            <Label htmlFor="delivery.latestOfferDate">
              Offer Needed By (Optional)
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal mt-1.5",
                    !values.delivery.latestOfferDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {values.delivery.latestOfferDate ? (
                    format(new Date(values.delivery.latestOfferDate), "PPP")
                  ) : (
                    <span>Select date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={values.delivery.latestOfferDate ? new Date(values.delivery.latestOfferDate) : undefined}
                  onSelect={(date) => setFieldValue('delivery.latestOfferDate', date ? date.toISOString() : '')}
                  initialFocus
                  disabled={(date) => date < new Date() || date > new Date(new Date().setDate(new Date().getDate() + 30))}
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-gray-500 mt-1.5">
              If you need our quote by a specific date, please indicate it here.
            </p>
          </div>
        </div>
        
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-700">
                Faster production options may incur additional costs. We'll provide detailed pricing for each option in your quote.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepDeliveryOptions;
