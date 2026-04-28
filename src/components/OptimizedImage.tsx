import React from 'react';

const WEBP_VARIANTS: Record<string, number[]> = {
  '/lovable-uploads/f239043e-a42b-4b5f-8fa3-8c964cdf24ab.png': [252, 504],
  '/lovable-uploads/d6fe3791-124e-467d-b139-0de39711af5e.png': [252, 504],
  '/lovable-uploads/16c64550-bebe-424d-b0a9-1897d23c0968.png': [252, 504],
  '/lovable-uploads/e684a8c7-882d-4e2a-b7f1-c2390897e274.png': [252, 504],
  '/lovable-uploads/200d9297-1d4c-4f58-a7d0-492ec78f506b.png': [450, 900],
  '/lovable-uploads/59f13e48-0a66-4e3a-a3c3-e9db4fa53d08.png': [450, 900],
  '/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png': [450, 900],
  '/lovable-uploads/e4960d66-a6c4-46ae-ab67-f061530c38cb.png': [450, 900],
  '/lovable-uploads/solidworks-rapid-prototyping.png': [450, 900],
  '/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png': [400, 800],
  '/lovable-uploads/aerospace-and-defence.jpg': [400, 800],
  '/lovable-uploads/automotive.jpg': [400, 800],
  '/lovable-uploads/medical-industry.jpg': [400, 800],
  '/lovable-uploads/industrial-automation.jpg': [400, 800],
  '/lovable-uploads/b8cf7ba7-ff7c-4b2f-b0f3-6e2a22c67a56.png': [300, 600],
  '/lovable-uploads/60e70592-dead-43bf-8e13-84721335759b.png': [300, 600],
  '/lovable-uploads/af68ca9b-890c-4621-9c34-647ab740638a.png': [300, 600],
  '/lovable-uploads/3039d310-f098-41d9-bd6d-f0bbd96cd6d0.png': [300, 600],
  '/lovable-uploads/5e121727-74d3-4cd9-a408-cbc38c44eb3d.png': [300, 600],
  '/lovable-uploads/826bb430-78bf-44d2-bd1a-51ffc0114f0c.png': [300, 600],
  '/lovable-uploads/b85d87d8-d572-45bb-96f5-0fc03ef5527b.png': [300, 600],
  '/lovable-uploads/a47a5177-0329-402a-97c3-aa30856e045f.png': [300, 600],
  '/lovable-uploads/87b2d570-3452-484d-95f7-9f5f5e34302b.png': [300, 600],
  '/lovable-uploads/f9f6c191-3f92-4b8d-be22-0c26f59e729b.png': [300, 600],
  '/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png': [344],
  '/lovable-uploads/b17e4baa-4be2-4892-a725-5871867d3dc3.png': [800, 1600],
};

function buildWebpSources(src: string): { srcSet: string; smallest: string } | null {
  const widths = WEBP_VARIANTS[src];
  if (!widths || widths.length === 0) return null;
  const base = src.replace(/\.(png|jpe?g)$/i, '');
  const entries = widths.map((w) => `${base}-${w}.webp ${w}w`);
  const smallest = `${base}-${widths[0]}.webp`;
  return { srcSet: entries.join(', '), smallest };
}

interface OptimizedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  /** Used both for the img sizes attr and to mark the image as eager-load critical above-the-fold. */
  sizes?: string;
  /** Set to "eager" + fetchpriority="high" for LCP/above-the-fold images. */
  priority?: boolean;
  width?: number;
  height?: number;
}

const OptimizedImage = React.forwardRef<HTMLImageElement, OptimizedImageProps>(
  (
    { src, alt, sizes, priority = false, loading, width, height, className, ...rest },
    ref,
  ) => {
    const webp = buildWebpSources(src);
    const loadingAttr = loading ?? (priority ? 'eager' : 'lazy');
    const decoding = priority ? 'sync' : 'async';
    const fetchPriority = priority ? 'high' : undefined;

    const imgEl = (
      <img
        ref={ref}
        src={src}
        alt={alt ?? ''}
        loading={loadingAttr}
        decoding={decoding}
        // @ts-expect-error fetchpriority is valid HTML but not in older React types
        fetchpriority={fetchPriority}
        width={width}
        height={height}
        sizes={sizes}
        className={className}
        {...rest}
      />
    );

    if (!webp) return imgEl;

    return (
      <picture>
        <source type="image/webp" srcSet={webp.srcSet} sizes={sizes} />
        {imgEl}
      </picture>
    );
  },
);

OptimizedImage.displayName = 'OptimizedImage';

export default OptimizedImage;
export { buildWebpSources };
