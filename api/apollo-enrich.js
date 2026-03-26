/**
 * Apollo.io Enrichment API Proxy
 * POST /api/apollo-enrich
 * Body: { companies: string[], titles: string[], per_page?: number }
 *
 * Searches Apollo.io for contacts at the given companies with the specified job titles.
 * Returns enriched contact data.
 */

import { createClient } from '@supabase/supabase-js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function getApolloApiKey() {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'apollo_api_key')
    .single();
  return data?.value || process.env.APOLLO_API_KEY || '';
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { companies = [], titles = [], per_page = 10 } = req.body || {};

  if (!companies.length) {
    return res.status(400).json({ error: 'companies array is required' });
  }
  if (!titles.length) {
    return res.status(400).json({ error: 'titles array is required (job titles to search for)' });
  }

  const apiKey = await getApolloApiKey();
  if (!apiKey) {
    return res.status(400).json({ error: 'Apollo API key not configured. Go to Settings > Integrations to add it.' });
  }

  const allContacts = [];
  const errors = [];

  // Process companies in batches of 3 to respect rate limits
  for (let i = 0; i < companies.length; i += 3) {
    const batch = companies.slice(i, i + 3);

    for (const company of batch) {
      try {
        // Determine if it's a domain or company name
        const isDomain = /^[a-z0-9-]+\.[a-z]{2,}/i.test(company.trim());

        const searchBody = {
          api_key: apiKey,
          person_titles: titles,
          per_page: Math.min(per_page, 25),
          page: 1,
        };

        if (isDomain) {
          searchBody.q_organization_domains = company.trim();
        } else {
          searchBody.q_organization_name = company.trim();
        }

        const resp = await fetch('https://api.apollo.io/v1/mixed_people/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        });

        if (resp.status === 429) {
          errors.push(`Rate limited on "${company}". Waiting...`);
          await delay(5000);
          continue;
        }

        if (!resp.ok) {
          const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
          errors.push(`Apollo error for "${company}": ${errText}`);
          continue;
        }

        const data = await resp.json();
        const people = data.people || [];

        for (const person of people) {
          allContacts.push({
            id: person.id,
            first_name: person.first_name || '',
            last_name: person.last_name || '',
            name: [person.first_name, person.last_name].filter(Boolean).join(' '),
            title: person.title || '',
            email: person.email || '',
            email_status: person.email_status || 'unknown',
            phone: person.phone_numbers?.[0]?.sanitized_number || '',
            linkedin_url: person.linkedin_url || '',
            company_name: person.organization?.name || company,
            company_domain: person.organization?.primary_domain || '',
            company_industry: person.organization?.industry || '',
            company_size: person.organization?.estimated_num_employees || '',
            city: person.city || '',
            country: person.country || '',
          });
        }
      } catch (err) {
        errors.push(`Failed for "${company}": ${err.message}`);
      }
    }

    // Rate limit between batches
    if (i + 3 < companies.length) {
      await delay(1500);
    }
  }

  return res.status(200).json({
    contacts: allContacts,
    total: allContacts.length,
    companies_searched: companies.length,
    errors,
  });
}
