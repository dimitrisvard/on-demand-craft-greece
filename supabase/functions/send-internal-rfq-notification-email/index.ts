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
    const { customerName, companyName, rfqNumber, customerEmail } = await req.json();

    if (!customerName || !companyName || !rfqNumber || !customerEmail) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: customerName, companyName, rfqNumber, customerEmail" }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
          status: 400,
        }
      );
    }

    // Send to both internal emails
    const emailResponse = await resend.emails.send({
      from: "Microns Hubs System <info@micronshub.eu>",
      to: ["dimitrisvard@hotmail.com", "info@micronshub.eu"],
      subject: `🚨 New Quote Request Received - ${rfqNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #dc2626; font-size: 28px; margin: 0;">🚨 New Quote Request Alert</h1>
            <p style="color: #64748b; font-size: 16px; margin: 5px 0 0 0;">Microns Hubs Quotation System</p>
          </div>
          
          <div style="background: #fef2f2; border: 2px solid #fecaca; padding: 25px; border-radius: 12px; margin: 20px 0;">
            <h2 style="color: #dc2626; font-size: 22px; margin: 0 0 20px 0;">Quote Request Details</h2>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 15px 0;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                <div style="flex: 1;">
                  <p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Quote ID:</p>
                  <p style="color: #1f2937; font-size: 18px; margin: 5px 0 0 0; font-family: monospace;">${rfqNumber}</p>
                </div>
                <div style="flex: 1;">
                  <p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Company:</p>
                  <p style="color: #1f2937; font-size: 16px; margin: 5px 0 0 0;">${companyName}</p>
                </div>
              </div>
              
              <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                <div style="flex: 1;">
                  <p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Contact Person:</p>
                  <p style="color: #1f2937; font-size: 16px; margin: 5px 0 0 0;">${customerName}</p>
                </div>
                <div style="flex: 1;">
                  <p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Email:</p>
                  <p style="color: #2563eb; font-size: 16px; margin: 5px 0 0 0;">
                    <a href="mailto:${customerEmail}" style="color: #2563eb; text-decoration: none;">${customerEmail}</a>
                  </p>
                </div>
              </div>
              
              <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
                <p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Submission Time:</p>
                <p style="color: #1f2937; font-size: 14px; margin: 5px 0 0 0;">${new Date().toLocaleString()}</p>
              </div>
            </div>
            
            <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0; font-weight: bold;">📋 Action Required:</p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Please review the quote request in the admin dashboard and prepare a response within 24 hours.
              </p>
            </div>
          </div>
          
          <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f8fafc; border-radius: 8px;">
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              This is an automated notification from the Microns Hubs quotation system.
            </p>
          </div>
        </div>
      `,
    });

    console.log("Internal RFQ notification email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error sending internal RFQ notification email:", error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 500,
      }
    );
  }
});
