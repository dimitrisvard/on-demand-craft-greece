import React from 'react';

const universities: Array<{ flag: string; names: string[] }> = [
  { flag: '🇩🇪', names: ['TU Munich', 'RWTH Aachen', 'TU Berlin', 'KIT Karlsruhe', 'TU Darmstadt'] },
  { flag: '🇳🇱', names: ['TU Delft', 'TU Eindhoven', 'University of Twente'] },
  { flag: '🇮🇹', names: ['Politecnico di Milano', 'Politecnico di Torino', 'Univ. of Bologna'] },
  { flag: '🇫🇷', names: ['École Polytechnique', 'INSA Lyon', 'CentraleSupélec'] },
  { flag: '🇨🇭', names: ['ETH Zurich', 'EPFL Lausanne'] },
  { flag: '🇸🇪', names: ['KTH Stockholm', 'Chalmers University'] },
  { flag: '🇬🇷', names: ['NTUA Athens', 'Aristotle Univ.', 'University of Crete', 'Univ. of Patras'] },
  { flag: '🇧🇪', names: ['KU Leuven', 'Ghent University'] },
  { flag: '🇪🇸', names: ['UPM Madrid', 'UPC Barcelona'] },
  { flag: '🇦🇹', names: ['TU Wien', 'TU Graz'] },
  { flag: '🇵🇱', names: ['Warsaw Univ. of Technology', 'AGH Krakow'] },
  { flag: '🇨🇿', names: ['CTU Prague'] },
  { flag: '🇵🇹', names: ['IST Lisbon', 'Univ. of Porto'] },
  { flag: '🇫🇮', names: ['Aalto University'] },
];

const competitions = [
  'Formula Student',
  'Formula Electric',
  'Baja SAE',
  'Shell Eco-Marathon',
  'EUROBOT',
  'RoboCup',
  'European Rover Challenge',
  'Hyperloop Competitions',
  'CANSAT',
  'Unmanned Aerial Systems',
];

const EduUniversities: React.FC = () => {
  return (
    <section id="universities" className="section bg-white">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            Academic Coverage
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1D1D1D] mb-5 tracking-tight">
            Built for Europe's Top Engineering Programs
          </h2>
          <p className="text-[#6C757D] text-lg leading-relaxed">
            We serve engineering students and researchers at institutions across the continent.
            If your university issues email addresses — you qualify.
          </p>
        </div>

        {/* Universities grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-14">
          {universities.map((uni, i) => (
            <div
              key={i}
              className="bg-[#F5F7FA] rounded-xl p-3 border border-gray-100 hover:border-[#1F4690]/30 hover:shadow-md transition-all duration-200"
            >
              <div className="text-xl mb-2">{uni.flag}</div>
              {uni.names.map((name, j) => (
                <p key={j} className="text-xs text-[#4A4A4A] font-medium leading-tight">
                  {name}
                </p>
              ))}
            </div>
          ))}
        </div>

        {/* Competitions */}
        <div className="rounded-2xl bg-[#1F4690]/4 border border-[#1F4690]/15 p-8">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-[#1D1D1D] mb-2">
              Engineering Competitions We Support
            </h3>
            <p className="text-[#6C757D] text-sm">
              We know competition deadlines don't move. That's why we offer priority production for
              competition teams.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            {competitions.map((comp, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 bg-white border border-[#1F4690]/20 text-[#1F4690] font-semibold text-sm px-4 py-2 rounded-full shadow-sm"
              >
                <span className="w-2 h-2 rounded-full bg-[#FF5722]" />
                {comp}
              </span>
            ))}
          </div>
        </div>

        <p className="text-center text-[#6C757D] text-xs mt-6">
          * University and competition names listed are targets. Logos are not used without explicit partnership agreements.
        </p>
      </div>
    </section>
  );
};

export default EduUniversities;
