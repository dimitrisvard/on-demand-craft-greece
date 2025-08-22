import { Resend } from 'resend';

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

// QUICK SETUP: To test immediately without domain verification, change the "from" address to:
// from: 'MicronsHub <hello@resend.dev>'
// This will send emails from Resend's shared domain

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, phone, subject, message, to } = req.body;

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, email, subject, and message are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Send email to company
    const emailResponse = await resend.emails.send({
      from: 'MicronsHub Contact <hello@resend.dev>', // Using Resend's shared domain for immediate testing
      to: [to || 'info@micronshub.eu'],
      replyTo: email,
      subject: `Contact Form: ${subject}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Contact Form Submission</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
            .header { background-color: #0891b2; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .field { margin-bottom: 15px; }
            .label { font-weight: bold; color: #374151; }
            .value { color: #6b7280; margin-top: 5px; }
            .message { background-color: white; padding: 20px; border-radius: 6px; border-left: 4px solid #0891b2; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>New Contact Form Submission</h1>
          </div>
          <div class="content">
            <div class="field">
              <div class="label">Name:</div>
              <div class="value">${name}</div>
            </div>
            <div class="field">
              <div class="label">Email:</div>
              <div class="value">${email}</div>
            </div>
            ${phone ? `
            <div class="field">
              <div class="label">Phone:</div>
              <div class="value">${phone}</div>
            </div>
            ` : ''}
            <div class="field">
              <div class="label">Subject:</div>
              <div class="value">${subject}</div>
            </div>
            <div class="field">
              <div class="label">Message:</div>
              <div class="message">${message.replace(/\n/g, '<br>')}</div>
            </div>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="font-size: 14px; color: #6b7280;">
              This message was sent through the contact form on micronshub.eu
            </p>
          </div>
        </body>
        </html>
      `,
    });

    // Send auto-reply to customer
    await resend.emails.send({
      from: 'MicronsHub <hello@resend.dev>', // Using Resend's shared domain for immediate testing
      to: [email],
      subject: 'Thank you for contacting MicronsHub',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Thank you for contacting us</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
            .header { background-color: #0891b2; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Thank You for Contacting Us</h1>
          </div>
          <div class="content">
            <p>Dear ${name},</p>
            <p>Thank you for reaching out to MicronsHub. We have received your message regarding "<strong>${subject}</strong>" and will get back to you within 24 hours.</p>
            <p>Your message is important to us, and our team will review it carefully to provide you with the best possible assistance.</p>
            <p>If you have any urgent questions, please don't hesitate to call us directly or send an email to info@micronshub.eu.</p>
            <div class="footer">
              <p><strong>Best regards,</strong><br>
              The MicronsHub Team</p>
              <p>MicronsHub - Precision Manufacturing Solutions<br>
              Email: info@micronshub.eu<br>
              Website: www.micronshub.eu</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log('Contact email sent:', emailResponse);

    return res.status(200).json({ 
      success: true, 
      message: 'Email sent successfully',
      id: emailResponse.data?.id 
    });

  } catch (error) {
    console.error('Error sending contact email:', error);
    
    return res.status(500).json({ 
      error: 'Failed to send email',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
