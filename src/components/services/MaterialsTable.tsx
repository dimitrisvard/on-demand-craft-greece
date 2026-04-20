import React from 'react';
import type { Material } from '@/lib/service-pages';

interface MaterialsTableProps {
  materials: Material[];
  heading?: string;
}

const MaterialsTable: React.FC<MaterialsTableProps> = ({ materials, heading }) => {
  if (!materials?.length) return null;

  return (
    <section className="py-16">
      <div className="container-custom">
        {heading && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{heading}</h2>
        )}

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-brand-dark/10">
                <th className="py-3 px-4 font-semibold text-brand-dark">Material</th>
                <th className="py-3 px-4 font-semibold text-brand-dark">Grade</th>
                <th className="py-3 px-4 font-semibold text-brand-dark">Properties</th>
                <th className="py-3 px-4 font-semibold text-brand-dark">Common Uses</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={`${m.material}-${i}`} className="border-b border-brand-dark/10">
                  <td className="py-3 px-4 font-medium">{m.material}</td>
                  <td className="py-3 px-4 text-brand-dark/80">{m.grade}</td>
                  <td className="py-3 px-4 text-brand-dark/80">{m.properties}</td>
                  <td className="py-3 px-4 text-brand-dark/80">{m.uses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-4">
          {materials.map((m, i) => (
            <div
              key={`${m.material}-${i}`}
              className="border border-brand-dark/10 rounded-lg p-4 bg-white"
            >
              <div className="font-semibold text-brand-dark text-lg">{m.material}</div>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="font-medium text-brand-dark/70">Grade</dt>
                  <dd className="text-brand-dark">{m.grade}</dd>
                </div>
                <div>
                  <dt className="font-medium text-brand-dark/70">Properties</dt>
                  <dd className="text-brand-dark">{m.properties}</dd>
                </div>
                <div>
                  <dt className="font-medium text-brand-dark/70">Common Uses</dt>
                  <dd className="text-brand-dark">{m.uses}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default MaterialsTable;
