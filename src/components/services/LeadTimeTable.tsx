import React from 'react';
import type { LeadTime } from '@/lib/service-pages';

interface LeadTimeTableProps {
  leadTimes: LeadTime[];
  heading?: string;
}

const LeadTimeTable: React.FC<LeadTimeTableProps> = ({ leadTimes, heading }) => {
  if (!leadTimes?.length) return null;

  return (
    <section className="py-16">
      <div className="container-custom max-w-4xl">
        {heading && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{heading}</h2>
        )}

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-brand-dark/10">
                <th className="py-3 px-4 font-semibold text-brand-dark">Tier</th>
                <th className="py-3 px-4 font-semibold text-brand-dark">Quantity</th>
                <th className="py-3 px-4 font-semibold text-brand-dark">Working Days</th>
              </tr>
            </thead>
            <tbody>
              {leadTimes.map((lt, i) => (
                <tr key={`${lt.tier}-${i}`} className="border-b border-brand-dark/10">
                  <td className="py-3 px-4 font-medium">{lt.tier}</td>
                  <td className="py-3 px-4 text-brand-dark/80">{lt.quantity_range}</td>
                  <td className="py-3 px-4 text-brand-dark/80">{lt.working_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-4">
          {leadTimes.map((lt, i) => (
            <div
              key={`${lt.tier}-${i}`}
              className="border border-brand-dark/10 rounded-lg p-4 bg-white"
            >
              <div className="font-semibold text-brand-dark text-lg">{lt.tier}</div>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-brand-dark/70">Quantity</dt>
                  <dd className="text-brand-dark">{lt.quantity_range}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-brand-dark/70">Working Days</dt>
                  <dd className="text-brand-dark">{lt.working_days}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LeadTimeTable;
