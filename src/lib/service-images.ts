export const SERVICE_IMAGES: Record<string, string> = {
  'cnc-machining':     '/lovable-uploads/200d9297-1d4c-4f58-a7d0-492ec78f506b.png',
  'sheet-metal':       '/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png',
  '3d-printing':       '/lovable-uploads/59f13e48-0a66-4e3a-a3c3-e9db4fa53d08.png',
  'injection-molding': '/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png',
  'surface-finishes':  '/lovable-uploads/e4960d66-a6c4-46ae-ab67-f061530c38cb.png',
  'surface-finishing': '/lovable-uploads/e4960d66-a6c4-46ae-ab67-f061530c38cb.png',
  'rapid-prototyping': '/lovable-uploads/solidworks-rapid-prototyping.png',
};

export function getServiceImage(slug: string | undefined | null): string | undefined {
  if (!slug) return undefined;
  return SERVICE_IMAGES[slug];
}
