import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';

// Professional gallery with lightbox navigation and categories
export default function OurWork() {
  const { t } = useTranslation();

  const allImages = useMemo(
    () => [
      // Injection Molding
      { src: '/lovable-uploads/injection-molding-1.jpeg', category: 'Injection Molding' },
      { src: '/lovable-uploads/injection-molding-2.jpg', category: 'Injection Molding' },
      { src: '/lovable-uploads/injection-molding-3.jpg', category: 'Injection Molding' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-1.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-2.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-3.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-1.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-2.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-3.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-4.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-5.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-6.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-4.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-5.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-6.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-7.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-8.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-9.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-7.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-8.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-9.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-10.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-11.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-12.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-10.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-11.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-12.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-13.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-14.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-15.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-13.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-14.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-15.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-16.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-17.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-18.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-16.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-17.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-18.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-19.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-20.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-21.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-19.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-20.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-21.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-22.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-23.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-24.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-22.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-23.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-24.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-25.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-26.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-27.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-25.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-26.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-27.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-28.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-29.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-30.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-28.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-29.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-30.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-31.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-32.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-33.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-31.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-32.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-33.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-34.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-35.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-36.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-34.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-35.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-36.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-37.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-38.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-39.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-37.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-38.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-39.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-40.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-41.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-42.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-40.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-41.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-42.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-43.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-44.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-45.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-43.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-44.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-45.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-46.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-47.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-48.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-46.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-47.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-48.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-49.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-50.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-51.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-49.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-50.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-51.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-52.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-53.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-54.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-52.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-53.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-54.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-55.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-56.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-57.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-55.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-56.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-57.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-58.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-59.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-60.jpg', category: 'Sheet Metal' },
      // Milling & Turning
      { src: '/lovable-uploads/milling-turning-58.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-59.jpg', category: 'CNC Machining' },
      { src: '/lovable-uploads/milling-turning-60.jpg', category: 'CNC Machining' },
      // Sheet Metal
      { src: '/lovable-uploads/sheet-metal-fabrication-61.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-62.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-63.jpg', category: 'Sheet Metal' },
      // Milling & Turning (1 image)
      { src: '/lovable-uploads/milling-turning-61.jpg', category: 'CNC Machining' },
      // Sheet Metal (remaining images)
      { src: '/lovable-uploads/sheet-metal-fabrication-64.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-65.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-66.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-67.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-68.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-69.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-70.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-71.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-72.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-73.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-74.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-75.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-76.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-77.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-78.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-79.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-80.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-81.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-82.jpg', category: 'Sheet Metal' },
      { src: '/lovable-uploads/sheet-metal-fabrication-83.jpg', category: 'Sheet Metal' },
    ],
    []
  );

  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [visibleCount, setVisibleCount] = useState(12);

  const categories = useMemo(() => {
    const cats = new Set(allImages.map(img => img.category));
    return ['All', ...Array.from(cats)];
  }, [allImages]);

  const filteredImages = useMemo(() => {
    return selectedCategory === 'All' 
      ? allImages 
      : allImages.filter(img => img.category === selectedCategory);
  }, [allImages, selectedCategory]);

  const visibleImages = useMemo(() => {
    return filteredImages.slice(0, visibleCount);
  }, [filteredImages, visibleCount]);

  const openAt = (index: number) => {
    // We need to find the global index of the clicked image to correctly navigate
    const clickedImage = visibleImages[index];
    const globalIndex = allImages.indexOf(clickedImage);
    setCurrentIndex(globalIndex);
    setIsOpen(true);
  };

  const showPrev = () => {
    // Find previous image in the filtered list if possible, otherwise simple logic
    // Simplified: Just cycle through all images in the lightbox
    setCurrentIndex((idx) => (idx - 1 + allImages.length) % allImages.length);
  };

  const showNext = () => {
    setCurrentIndex((idx) => (idx + 1) % allImages.length);
  };

  const handleLoadMore = () => {
    setVisibleCount(prev => prev + 12);
  };

  return (
    <div className="pt-20">
      <SEOMeta 
        title={`${t('seo_our_work_title', 'Our Work Portfolio')} | Microns Hub`}
        description={t('seo_our_work_description', 'View our portfolio of manufacturing projects. Examples of CNC machining, sheet metal fabrication, injection molding, and more.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      <div className="bg-gradient-to-b from-brand-primary/5 to-transparent py-12">
        <div className="container-custom text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-brand-dark">
            {t('our_work_title')}
          </h1>
          <p className="mt-4 text-brand-muted max-w-3xl mx-auto">
            {t('our_work_intro')}
          </p>
        </div>
      </div>

      <div className="container-custom py-8">
        {/* Categories Filter */}
        <div className="flex flex-wrap justify-center gap-3 mb-10">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat);
                setVisibleCount(12); // Reset count when changing category
              }}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === cat 
                  ? 'bg-brand-primary text-white shadow-md' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleImages.map((img, idx) => (
            <button
              key={`${img.src}-${idx}`}
              onClick={() => openAt(idx)}
              className="group relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-white shadow-sm hover:shadow-md transition-all duration-300"
              aria-label={t('our_work_open_image') as string}
            >
              <img
                src={img.src}
                alt={t('our_work_image_alt') as string}
                className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform"
                loading="lazy"
              />
              <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                {img.category}
              </div>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>

        {/* Load More Button */}
        {visibleImages.length < filteredImages.length && (
          <div className="flex justify-center mt-12">
            <Button 
              onClick={handleLoadMore}
              variant="outline"
              className="px-8 py-2 border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white transition-colors"
            >
              Load More
            </Button>
          </div>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-5xl w-[96vw] p-0 bg-black/95 border-0">
          <VisuallyHidden>
            <DialogTitle>{t('our_work_image_alt')}</DialogTitle>
          </VisuallyHidden>
          <div className="relative w-full h-full flex flex-col items-center justify-center h-[90vh]">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/20 transition-colors"
              aria-label={t('close') as string}
            >
              <X size={24} />
            </button>

            <button
              onClick={showPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/20 transition-colors"
              aria-label={t('previous') as string}
            >
              <ChevronLeft size={32} />
            </button>

            <button
              onClick={showNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/20 transition-colors"
              aria-label={t('next') as string}
            >
              <ChevronRight size={32} />
            </button>

            <div className="relative max-w-full max-h-full p-4 flex items-center justify-center">
              <img
                src={allImages[currentIndex].src}
                alt={t('our_work_image_alt') as string}
                className="max-h-[85vh] w-auto object-contain rounded-sm shadow-2xl"
              />
              <div className="absolute bottom-8 left-0 right-0 text-center">
                 <span className="bg-black/60 text-white px-4 py-2 rounded-full backdrop-blur-md text-sm font-medium">
                   {allImages[currentIndex].category}
                 </span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
