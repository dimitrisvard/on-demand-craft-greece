// Custom-domain notes of the tenant editor (PLAN.md P3-6). The text names no hosting provider and no DNS target,
// so it stays true whichever platform serves production, before and after the Phase 3 cutover and after a rollback.
// Tenant subdomains <slug>.micronshub.eu need no DNS step (the zone has a wildcard record). A custom domain is
// connected by the platform team first; the domain owner then creates the DNS record the team sends.

interface Props {
  slug: string;
  customDomain: string;
}

export const TENANT_ROOT_DOMAIN = 'micronshub.eu';

export const DOMAIN_NOT_REACHABLE =
  'The domain did not answer over HTTPS. Check that the Microns Hub team has connected it and that the DNS record they sent exists.';

export function CustomDomainInstructions({ slug, customDomain }: Props) {
  const subdomain = `${slug || 'slug'}.${TENANT_ROOT_DOMAIN}`;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm space-y-3" data-testid="custom-domain-instructions">
      <p className="font-semibold text-amber-800">Custom domain setup</p>
      <ol className="list-decimal list-inside space-y-2 text-amber-900">
        <li>
          <strong>Works now without DNS changes:</strong>{' '}
          <code className="bg-amber-100 px-1 rounded">https://{subdomain}</code>
        </li>
        <li>
          <strong>Request the custom domain:</strong> a custom domain is not self-service. Ask the Microns Hub team to
          connect <code className="bg-amber-100 px-1 rounded">{customDomain}</code> on the hosting platform. Saving it
          here only records the request.
        </li>
        <li>
          <strong>DNS record:</strong> once the team confirms the connection, the domain owner creates the DNS record
          the team sends (usually a CNAME on{' '}
          <strong>{customDomain.startsWith('www.') ? 'www' : 'the domain itself'}</strong>). The SSL certificate is
          issued automatically after that.
        </li>
        <li>
          <strong>Verify:</strong> click &quot;Check DNS&quot; above to confirm the domain answers.
        </li>
      </ol>
    </div>
  );
}
