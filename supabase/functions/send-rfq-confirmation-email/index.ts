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
    const { to, customerName, companyName, rfqNumber } = await req.json();

    if (!to || !customerName || !companyName || !rfqNumber) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, customerName, companyName, rfqNumber" }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
          status: 400,
        }
      );
    }

    const emailResponse = await resend.emails.send({
      from: "Microns Hubs <info@micronshub.eu>",
      to: [to],
      subject: "Thank You for Your Quotation – Microns Hubs",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; font-size: 28px; margin: 0;">Microns Hubs</h1>
            <p style="color: #64748b; font-size: 16px; margin: 5px 0 0 0;">Precision Manufacturing Solutions</p>
          </div>
          
          <div style="background: #f8fafc; padding: 30px; border-radius: 12px; margin: 20px 0;">
            <h2 style="color: #1e293b; font-size: 24px; margin: 0 0 20px 0;">Thank You for Your Quotation</h2>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              Dear ${customerName},
            </p>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              Thank you for submitting your quotation to Microns Hubs. We have successfully received your request, and our team is currently reviewing the details.
            </p>
            
            <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #065f46; font-size: 18px; margin: 0 0 10px 0;">Request Details</h3>
              <p style="color: #047857; font-size: 14px; margin: 0;"><strong>Company:</strong> ${companyName}</p>
              <p style="color: #047857; font-size: 14px; margin: 5px 0 0 0;"><strong>Reference Number:</strong> ${rfqNumber}</p>
            </div>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 20px 0;">
              You can expect a formal response from us within the next 24 hours. Should we require any additional information or clarification, one of our representatives will contact you directly.
            </p>
            
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 20px 0;">
              We truly value your time and interest in working with Microns Hubs, and we look forward to building a successful business relationship.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f1f5f9; border-radius: 8px;">
            <p style="color: #1e293b; font-size: 16px; margin: 0 0 10px 0;"><strong>Best regards,</strong></p>
            <p style="color: #1e293b; font-size: 16px; margin: 0;">Microns Hubs Team</p>
            <p style="color: #64748b; font-size: 14px; margin: 10px 0 0 0;">📧 info@micronshub.eu</p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">
            This email was sent from Microns Hubs quotation system at ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });

    console.log("RFQ confirmation email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error sending RFQ confirmation email:", error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 500,
      }
    );
  }
});
