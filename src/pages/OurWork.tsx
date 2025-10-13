import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

// Professional gallery with lightbox navigation
export default function OurWork() {
  const { t } = useTranslation();

  const images = useMemo(
    () => [
      '/lovable-uploads/sheet-metal-fabrication-1.jpg',
      '/lovable-uploads/sheet-metal-fabrication-2.jpg',
      '/lovable-uploads/sheet-metal-fabrication-3.jpg',
      '/lovable-uploads/sheet-metal-fabrication-4.jpg',
      '/lovable-uploads/sheet-metal-fabrication-5.jpg',
      '/lovable-uploads/sheet-metal-fabrication-6.jpg',
      '/lovable-uploads/sheet-metal-fabrication-7.jpg',
      '/lovable-uploads/sheet-metal-fabrication-8.jpg',
      '/lovable-uploads/sheet-metal-fabrication-9.jpg',
      '/lovable-uploads/sheet-metal-fabrication-10.jpg',
      '/lovable-uploads/sheet-metal-fabrication-11.jpg',
      '/lovable-uploads/sheet-metal-fabrication-12.jpg',
      '/lovable-uploads/sheet-metal-fabrication-13.jpg',
      '/lovable-uploads/sheet-metal-fabrication-14.jpg',
      '/lovable-uploads/sheet-metal-fabrication-15.jpg',
      '/lovable-uploads/sheet-metal-fabrication-16.jpg',
      '/lovable-uploads/sheet-metal-fabrication-17.jpg',
      '/lovable-uploads/sheet-metal-fabrication-18.jpg',
      '/lovable-uploads/sheet-metal-fabrication-19.jpg',
      '/lovable-uploads/sheet-metal-fabrication-20.jpg',
      '/lovable-uploads/sheet-metal-fabrication-21.jpg',
      '/lovable-uploads/sheet-metal-fabrication-22.jpg',
      '/lovable-uploads/sheet-metal-fabrication-23.jpg',
      '/lovable-uploads/sheet-metal-fabrication-24.jpg',
      '/lovable-uploads/sheet-metal-fabrication-25.jpg',
      '/lovable-uploads/sheet-metal-fabrication-26.jpg',
      '/lovable-uploads/sheet-metal-fabrication-27.jpg',
      '/lovable-uploads/sheet-metal-fabrication-28.jpg',
      '/lovable-uploads/sheet-metal-fabrication-29.jpg',
      '/lovable-uploads/sheet-metal-fabrication-30.jpg',
      '/lovable-uploads/sheet-metal-fabrication-31.jpg',
      '/lovable-uploads/sheet-metal-fabrication-32.jpg',
      '/lovable-uploads/sheet-metal-fabrication-33.jpg',
      '/lovable-uploads/sheet-metal-fabrication-34.jpg',
      '/lovable-uploads/sheet-metal-fabrication-35.jpg',
      '/lovable-uploads/sheet-metal-fabrication-36.jpg',
      '/lovable-uploads/sheet-metal-fabrication-37.jpg',
      '/lovable-uploads/sheet-metal-fabrication-38.jpg',
      '/lovable-uploads/sheet-metal-fabrication-39.jpg',
      '/lovable-uploads/sheet-metal-fabrication-40.jpg',
      '/lovable-uploads/sheet-metal-fabrication-41.jpg',
      '/lovable-uploads/sheet-metal-fabrication-42.jpg',
      '/lovable-uploads/sheet-metal-fabrication-43.jpg',
      '/lovable-uploads/sheet-metal-fabrication-44.jpg',
      '/lovable-uploads/sheet-metal-fabrication-45.jpg',
      '/lovable-uploads/sheet-metal-fabrication-46.jpg',
      '/lovable-uploads/sheet-metal-fabrication-47.jpg',
      '/lovable-uploads/sheet-metal-fabrication-48.jpg',
      '/lovable-uploads/sheet-metal-fabrication-49.jpg',
      '/lovable-uploads/sheet-metal-fabrication-50.jpg',
      '/lovable-uploads/sheet-metal-fabrication-51.jpg',
      '/lovable-uploads/sheet-metal-fabrication-52.jpg',
      '/lovable-uploads/sheet-metal-fabrication-53.jpg',
      '/lovable-uploads/sheet-metal-fabrication-54.jpg',
      '/lovable-uploads/sheet-metal-fabrication-55.jpg',
      '/lovable-uploads/sheet-metal-fabrication-56.jpg',
      '/lovable-uploads/sheet-metal-fabrication-57.jpg',
      '/lovable-uploads/sheet-metal-fabrication-58.jpg',
      '/lovable-uploads/sheet-metal-fabrication-59.jpg',
      '/lovable-uploads/sheet-metal-fabrication-60.jpg',
      '/lovable-uploads/sheet-metal-fabrication-61.jpg',
      '/lovable-uploads/sheet-metal-fabrication-62.jpg',
      '/lovable-uploads/sheet-metal-fabrication-63.jpg',
      '/lovable-uploads/sheet-metal-fabrication-64.jpg',
      '/lovable-uploads/sheet-metal-fabrication-65.jpg',
      '/lovable-uploads/sheet-metal-fabrication-66.jpg',
      '/lovable-uploads/sheet-metal-fabrication-67.jpg',
      '/lovable-uploads/sheet-metal-fabrication-68.jpg',
      '/lovable-uploads/sheet-metal-fabrication-69.jpg',
      '/lovable-uploads/sheet-metal-fabrication-70.jpg',
      '/lovable-uploads/sheet-metal-fabrication-71.jpg',
      '/lovable-uploads/sheet-metal-fabrication-72.jpg',
      '/lovable-uploads/sheet-metal-fabrication-73.jpg',
      '/lovable-uploads/sheet-metal-fabrication-74.jpg',
      '/lovable-uploads/sheet-metal-fabrication-75.jpg',
      '/lovable-uploads/sheet-metal-fabrication-76.jpg',
      '/lovable-uploads/sheet-metal-fabrication-77.jpg',
      '/lovable-uploads/sheet-metal-fabrication-78.jpg',
      '/lovable-uploads/sheet-metal-fabrication-79.jpg',
      '/lovable-uploads/sheet-metal-fabrication-80.jpg',
      '/lovable-uploads/sheet-metal-fabrication-81.jpg',
      '/lovable-uploads/sheet-metal-fabrication-82.jpg',
      '/lovable-uploads/sheet-metal-fabrication-83.jpg',
    ],
    []
  );

  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const openAt = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsOpen(true);
  }, []);

  const showPrev = useCallback(() => {
    setCurrentIndex((idx) => (idx - 1 + images.length) % images.length);
  }, [images.length]);

  const showNext = useCallback(() => {
    setCurrentIndex((idx) => (idx + 1) % images.length);
  }, [images.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') showPrev();
      if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, showPrev, showNext]);

  return (
    <div className="pt-20">{/* account for fixed navbar */}
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

      <div className="container-custom py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {images.map((src, idx) => (
            <button
              key={idx}
              onClick={() => openAt(idx)}
              className="group relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-white shadow-sm hover:shadow-md transition-shadow"
              aria-label={t('our_work_open_image') as string}
            >
              <img
                src={src}
                alt={t('our_work_image_alt') as string}
                className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform"
                loading="lazy"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-5xl w-[96vw] p-0 bg-black/95 border-0">
          <VisuallyHidden>
            <DialogTitle>{t('our_work_image_alt')}</DialogTitle>
          </VisuallyHidden>
          <div className="relative w-full h-full">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              aria-label={t('close') as string}
            >
              <X />
            </button>

            <button
              onClick={showPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              aria-label={t('previous') as string}
            >
              <ChevronLeft />
            </button>

            <button
              onClick={showNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              aria-label={t('next') as string}
            >
              <ChevronRight />
            </button>

            <div className="flex items-center justify-center p-4 sm:p-6">
              <img
                src={images[currentIndex]}
                alt={t('our_work_image_alt') as string}
                className="max-h-[80vh] w-auto object-contain rounded-md"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


