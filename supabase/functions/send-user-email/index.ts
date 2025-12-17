import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendUserEmailRequest {
  to: string;
  subject: string;
  content: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
        throw new Error("Unauthorized");
    }

    const { to, subject, content } = await req.json() as SendUserEmailRequest;

    if (!to || !subject || !content) {
      throw new Error("Missing required fields: to, subject, content");
    }

    console.log(`Sending email from user ${user.id} to ${to}`);

    // Send via Resend
    // Using the same From address as campaigns for now, or could use a generic one
    const { data, error } = await resend.emails.send({
        from: "Microns Hub <info@micronshub.eu>",
        to: [to],
        subject: subject,
        html: content, // Content is HTML
        reply_to: user.email // Set reply-to as the sending user's email
    });

    if (error) {
        console.error("Resend error:", error);
        throw new Error(`Resend error: ${error.message}`);
    }

    console.log("Email sent successfully:", data);

    // Store in user_emails table as 'sent'
    const { error: dbError } = await supabase
        .from("user_emails")
        .insert({
            user_id: user.id,
            sender: user.email || "Me",
            recipient: to,
            subject: subject,
            content: content,
            folder: "sent",
            read: true,
            sent_at: new Date().toISOString()
        });

    if (dbError) {
        console.error("Database insert error:", dbError);
        // We don't fail the request if DB insert fails, but log it. 
        // Or maybe we should return a warning.
    }

    return new Response(
      JSON.stringify({ 
        message: "Email sent successfully", 
        id: data?.id 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    console.error("Error in send-user-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});

