
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CustomerDetails {
  name: string;
  email: string;
  phone: string;
  company: string;
  vatId: string;
}

interface RequestDetails {
  parts: number;
  deliverySpeed: string;
  notes: string;
  referenceNumber: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { customerDetails, requestDetails } = await req.json();
    
    // Format the details for the email
    const formattedCustomerDetails = formatCustomerDetails(customerDetails);
    const formattedRequestDetails = formatRequestDetails(requestDetails);
    
    const emailResponse = await resend.emails.send({
      from: "MicronsHub RFQ <info@micronshub.eu>",
      to: ["info@micronshub.eu"],
      subject: `New Quote Request: ${requestDetails.referenceNumber}`,
      html: `
        <h1>New Quote Request Submitted</h1>
        <p>A new quote request has been submitted with the following details:</p>
        
        <h2>Customer Information</h2>
        ${formattedCustomerDetails}
        
        <h2>Request Details</h2>
        ${formattedRequestDetails}
        
        <p>Please review and prepare a quote for this request.</p>
      `,
    });

    console.log("Notification email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error sending notification email:", error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
        status: 500,
      }
    );
  }
});

function formatCustomerDetails(details: CustomerDetails): string {
  return `
    <ul style="list-style-type: none; padding-left: 0;">
      <li><strong>Name:</strong> ${details.name}</li>
      <li><strong>Email:</strong> ${details.email}</li>
      <li><strong>Phone:</strong> ${details.phone}</li>
      <li><strong>Company:</strong> ${details.company}</li>
      <li><strong>VAT/Tax ID:</strong> ${details.vatId}</li>
    </ul>
  `;
}

function formatRequestDetails(details: RequestDetails): string {
  return `
    <ul style="list-style-type: none; padding-left: 0;">
      <li><strong>Reference Number:</strong> ${details.referenceNumber}</li>
      <li><strong>Number of Parts:</strong> ${details.parts}</li>
      <li><strong>Delivery Speed:</strong> ${details.deliverySpeed}</li>
      ${details.notes ? `<li><strong>Additional Notes:</strong> ${details.notes}</li>` : ''}
    </ul>
  `;
}
