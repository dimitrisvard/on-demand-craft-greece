
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, name, company, referenceNumber } = await req.json();

    const emailResponse = await resend.emails.send({
      from: "MicronsHub <info@micronshub.eu>",
      to: [to],
      subject: "Quote Request Confirmation - MicronsHub",
      html: `
        <h1>Quote Request Confirmation</h1>
        <p>Dear ${name},</p>
        <p>Thank you for submitting your quote request with MicronsHub.</p>
        <p>We have received your request and will prepare a detailed quote within 24 hours.</p>
        <p><strong>Reference Number:</strong> ${referenceNumber}<br>
        <strong>Company:</strong> ${company}</p>
        <p>If you have any questions, please contact us at info@micronshub.eu.</p>
        <p>Best regards,<br>The MicronsHub Team</p>
      `,
    });

    console.log("Confirmation email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 500,
      }
    );
  }
});
