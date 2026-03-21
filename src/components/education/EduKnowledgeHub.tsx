import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight, BookOpen, Send } from 'lucide-react';

const categories = [
  { icon: '🔧', name: 'CNC Machines & Equipment', href: '/en/blog' },
  { icon: '📐', name: 'Sheet Metal Fundamentals', href: '/en/blog' },
  { icon: '⚙️', name: 'Cutting Tools & Instruments', href: '/en/blog' },
  { icon: '✨', name: 'Surface Finishing', href: '/en/blog' },
  { icon: '🔩', name: 'Metal Materials', href: '/en/blog' },
  { icon: '🧱', name: 'Plastic Materials', href: '/en/blog' },
  { icon: '📊', name: 'Material Selection', href: '/en/blog' },
  { icon: '📏', name: 'Design Guidelines', href: '/en/blog' },
  { icon: '💻', name: 'CAD/CAM Workflows', href: '/en/blog' },
  { icon: '✅', name: 'DFM Best Practices', href: '/en/blog' },
  { icon: '📝', name: 'CNC Programming', href: '/en/blog' },
  { icon: '🏭', name: 'Manufacturing Processes', href: '/en/blog' },
  { icon: '💡', name: 'Project Inspiration', href: '/en/blog' },
  { icon: '🤖', name: 'AI in Manufacturing', href: '/en/blog' },
];

const learningPaths = [
  {
    persona: 'Designing your first CNC part?',
    categories: ['DFM Best Practices', 'Design Guidelines', 'Material Selection'],
    icon: '🔧',
  },
  {
    persona: 'On a Formula Student team?',
    categories: ['Metal Materials', 'CNC Machines & Equipment', 'Surface Finishing'],
    icon: '🏎️',
  },
  {
    persona: 'Need to choose a material?',
    categories: ['Material Selection', 'Metal Materials', 'Plastic Materials'],
    icon: '📊',
  },
  {
    persona: 'Writing a thesis on manufacturing?',
    categories: ['Manufacturing Processes', 'AI in Manufacturing', 'CNC Programming'],
    icon: '📖',
  },
];

const testimonials = [
  {
    quote:
      'I learned more about CNC tolerancing from your blog than from my entire manufacturing course.',
    author: 'Mechanical Engineering Student',
    uni: 'Technical University',
  },
  {
    quote:
      'We reference your material selection guides every time we design a new component for the car.',
    author: 'Formula Student Team Member',
    uni: 'Formula Student Europe',
  },
  {
    quote:
      'The DFM articles saved us from a costly redesign on our thesis prototype.',
    author: "Master's Student",
    uni: 'TU Delft',
  },
];

const EduKnowledgeHub: React.FC = () => {
  const { getLocalizedPath } = useLanguage();
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) setSubscribed(true);
  };

  return (
    <section id="knowledge-hub" className="section bg-[#F5F7FA]">
      <div className="container-custom">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            Free Engineering Resource
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1D1D1D] mb-5 tracking-tight">
            Your Daily Engineering Knowledge Base
          </h2>
          <p className="text-[#6C757D] text-lg leading-relaxed">
            We publish a new, in-depth manufacturing article{' '}
            <span className="font-semibold text-[#1D1D1D]">every single day</span>. From CNC
            fundamentals to advanced material science — the most comprehensive free resource for
            engineering students in Europe. Bookmark it. Your grades will thank you.
          </p>
        </div>

        {/* Live counter banner */}
        <div className="bg-[#1F4690] rounded-2xl p-6 md:p-8 mb-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-white/15 rounded-xl flex items-center justify-center text-2xl">
              📚
            </div>
            <div>
              <div className="text-white font-extrabold text-3xl">365+ Articles Published</div>
              <div className="text-white/70 text-sm">A new in-depth article added every day</div>
            </div>
          </div>
          <a
            href="/en/blog"
            className="inline-flex items-center gap-2 bg-[#FF5722] hover:bg-[#E64A19] text-white font-semibold px-6 py-3 rounded-xl transition-all duration-200 whitespace-nowrap shadow hover:shadow-lg hover:shadow-[#FF5722]/30"
          >
            <BookOpen size={18} />
            Browse All Articles
            <ArrowRight size={16} />
          </a>
        </div>

        {/* Categories grid */}
        <div className="mb-14">
          <h3 className="text-xl font-bold text-[#1D1D1D] mb-6 text-center">
            14 Topic Categories — Something for Every Engineer
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {categories.map((cat, i) => (
              <a
                key={i}
                href={cat.href}
                className="bg-white rounded-xl p-4 border border-gray-100 hover:border-[#1F4690]/30 hover:shadow-md transition-all duration-200 flex flex-col items-center text-center gap-2 group"
              >
                <span className="text-2xl">{cat.icon}</span>
                <span className="text-xs font-semibold text-[#4A4A4A] leading-tight group-hover:text-[#1F4690] transition-colors">
                  {cat.name}
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* Learning paths */}
        <div className="mb-14">
          <h3 className="text-xl font-bold text-[#1D1D1D] mb-2 text-center">
            Curated Learning Paths for Students
          </h3>
          <p className="text-[#6C757D] text-sm text-center mb-6">
            Not sure where to start? Jump directly into the content that matters most for your project.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {learningPaths.map((path, i) => (
              <a
                key={i}
                href="/en/blog"
                className="bg-white rounded-xl p-5 border border-gray-100 hover:border-[#1F4690]/30 hover:shadow-lg transition-all duration-300 group"
              >
                <div className="text-2xl mb-3">{path.icon}</div>
                <h4 className="font-bold text-[#1D1D1D] text-sm mb-3 group-hover:text-[#1F4690] transition-colors">
                  {path.persona}
                </h4>
                <div className="space-y-1.5">
                  {path.categories.map((cat, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#FF5722] flex-shrink-0" />
                      <span className="text-xs text-[#6C757D]">{cat}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-1 text-[#1F4690] text-xs font-semibold">
                  Start reading <ArrowRight size={12} />
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Testimonials */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-14">
          {testimonials.map((t, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-gray-100 p-6"
            >
              <div className="text-[#FF5722] text-3xl font-serif leading-none mb-3">"</div>
              <p className="text-[#4A4A4A] text-sm italic leading-relaxed mb-4">{t.quote}</p>
              <div>
                <p className="font-semibold text-sm text-[#1D1D1D]">{t.author}</p>
                <p className="text-xs text-[#6C757D]">{t.uni}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Newsletter CTA */}
        <div className="bg-[#1D1D1D] rounded-2xl p-8 md:p-10 text-center">
          <h3 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Get Smarter Every Morning
          </h3>
          <p className="text-white/70 max-w-xl mx-auto mb-8 text-sm leading-relaxed">
            Subscribe to our daily engineering article. One email, one article, zero spam. Join
            2,000+ engineering students and professionals who read us every morning.
          </p>

          {subscribed ? (
            <div className="inline-flex items-center gap-3 bg-green-500/20 border border-green-500/30 text-green-400 rounded-xl px-6 py-3 font-semibold">
              ✓ You're subscribed! Check your inbox.
            </div>
          ) : (
            <form
              onSubmit={handleSubscribe}
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@university.edu"
                required
                className="flex-1 bg-white/10 border border-white/20 text-white placeholder:text-white/40 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#FF5722] transition-colors"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 bg-[#FF5722] hover:bg-[#E64A19] text-white font-semibold px-6 py-3 rounded-xl transition-all duration-200 whitespace-nowrap"
              >
                <Send size={15} />
                Subscribe Free
              </button>
            </form>
          )}

          <p className="text-white/40 text-xs mt-4">
            Unsubscribe anytime. We respect your inbox.
          </p>
        </div>
      </div>
    </section>
  );
};

export default EduKnowledgeHub;
