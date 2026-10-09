import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Create a JWT for service account auth
async function createServiceAccountJWT(sa: any): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: any) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = enc(header);
  const payloadB64 = enc(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the private key
  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${sigB64}`;
}

async function getServiceAccountAccessToken(sa: any): Promise<string> {
  const jwt = await createServiceAccountJWT(sa);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`SA token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const { urls, action = "URL_UPDATED" } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return new Response(
        JSON.stringify({ error: "Provide an array of urls" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Limit to 200 per day (Google quota)
    const batch = urls.slice(0, 200);

    // Get service account from Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: config } = await supabase
      .from("gsc_config")
      .select("service_account")
      .eq("id", 1)
      .single();

    if (!config?.service_account) {
      return new Response(
        JSON.stringify({ error: "Service account not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getServiceAccountAccessToken(config.service_account);

    // Submit each URL to Indexing API
    const results: any[] = [];
    for (const url of batch) {
      try {
        const res = await fetch(
          "https://indexing.googleapis.com/v3/urlNotifications:publish",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url, type: action }),
          }
        );
        const data = await res.json();
        results.push({ url, status: res.status, response: data });
      } catch (err) {
        results.push({ url, status: 500, error: String(err) });
      }
    }

    const succeeded = results.filter((r) => r.status === 200).length;
    const failed = results.filter((r) => r.status !== 200).length;

    // Log to gsc_index_log if table exists
    try {
      const logEntries = results.map((r) => ({
        url: r.url,
        action,
        status_code: r.status,
        response: r.response || r.error,
        submitted_at: new Date().toISOString(),
      }));
      await supabase.from("gsc_index_log").insert(logEntries);
    } catch (_) {
      // Table might not exist yet
    }

    return new Response(
      JSON.stringify({
        message: `Indexing requests submitted`,
        total: batch.length,
        succeeded,
        failed,
        results: results.slice(0, 20),
      }),
      { headers: { "Content-Type": "application/json", Connection: "keep-alive" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
