import { lazy, type ComponentType } from 'react';

/**
 * Registry of tenant slugs that have custom-designed landing pages.
 * When a tenant slug is in this map, the custom component replaces
 * the default TenantPageRenderer AND the platform Navbar / Footer.
 */
const CUSTOM_PAGE_MAP: Record<string, () => Promise<{ default: ComponentType }>> = {
  laserkritis: () => import('./laserkritis'),
};

/** Set of slugs for quick O(1) lookups */
export const CUSTOM_PAGE_SLUGS = new Set(Object.keys(CUSTOM_PAGE_MAP));

/** Check if a tenant slug has a custom landing page */
export function hasCustomPage(slug: string | null | undefined): boolean {
  return !!slug && CUSTOM_PAGE_SLUGS.has(slug);
}

/** Lazy-load the custom component for a given tenant slug */
export function getCustomPageComponent(slug: string) {
  const loader = CUSTOM_PAGE_MAP[slug];
  if (!loader) return null;
  return lazy(loader);
}
