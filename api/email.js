import { Resend } from 'resend';

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[API] Request received:', {
    method: req.method,
    headers: req.headers,
    body: req.body
  });

  try {
    console.log('[API] RESEND_API_KEY present:', !!process.env.RESEND_API_KEY);
    console.log('[API] RESEND_API_KEY length:', process.env.RESEND_API_KEY?.length || 0);
    
    const { name, email, phone, subject, message, rfqNumber, companyName } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, email, and message are required' 
      });
    }

    // Check if this is an RFQ submission
    const isRfqSubmission = rfqNumber && companyName;

    // Email to company (info@micronshub.eu)
    console.log('Sending company email to:', ['info@micronshub.eu', 'dimitrisvard@hotmail.com']);
    const companyEmail = await resend.emails.send({
      from: 'MicronsHub Contact Form <info@micronshub.eu>',
      to: ['info@micronshub.eu', 'dimitrisvard@hotmail.com'],
      subject: isRfqSubmission ? `🚨 New RFQ Request - ${rfqNumber}` : `New Contact Form Submission: ${subject || 'General Inquiry'}`,
      html: isRfqSubmission ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">🚨 New RFQ Request Received</h2>
          
          <div style="background: #fef2f2; border: 2px solid #fecaca; padding: 25px; border-radius: 12px; margin: 20px 0;">
            <h3 style="color: #dc2626; margin-top: 0;">RFQ Details</h3>
            <p><strong>RFQ Number:</strong> ${rfqNumber}</p>
            <p><strong>Company:</strong> ${companyName}</p>
            <p><strong>Contact Person:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
          </div>
          
          <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <p style="color: #1e40af; font-size: 14px; margin: 0; font-weight: bold;">📋 Action Required:</p>
            <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
              Please review the quote request in the admin dashboard and prepare a response within 24 hours.
            </p>
          </div>
          
          <div style="margin-top: 30px; padding: 20px; background: #ecfdf5; border-radius: 8px;">
            <p style="margin: 0; color: #065f46;">
              <strong>Reply directly to:</strong> ${email}
            </p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="color: #64748b; font-size: 14px;">
            This email was sent from the MicronsHub RFQ system at ${new Date().toLocaleString()}
          </p>
        </div>
      ` : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">New Contact Form Submission</h2>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1e293b; margin-top: 0;">Contact Details</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
            <p><strong>Subject:</strong> ${subject || 'General Inquiry'}</p>
          </div>
          
          <div style="background: #f1f5f9; padding: 20px; border-radius: 8px;">
            <h3 style="color: #1e293b; margin-top: 0;">Message</h3>
            <p style="white-space: pre-wrap;">${message}</p>
          </div>
          
          <div style="margin-top: 30px; padding: 20px; background: #ecfdf5; border-radius: 8px;">
            <p style="margin: 0; color: #065f46;">
              <strong>Reply directly to:</strong> ${email}
            </p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="color: #64748b; font-size: 14px;">
            This email was sent from the MicronsHub contact form at ${new Date().toLocaleString()}
          </p>
        </div>
      `,
      replyTo: email
    });

    // Auto-reply to customer
    console.log('Sending customer email to:', email);
    const customerEmail = await resend.emails.send({
      from: 'MicronsHub <info@micronshub.eu>',
      to: [email],
      subject: isRfqSubmission ? 'Thank You for Your Quotation – Microns Hubs' : 'Thank you for contacting MicronsHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://micronshub.eu/logo.png" alt="MicronsHub Logo" style="height: 60px; margin-bottom: 20px;">
            <h1 style="color: #2563eb; margin-bottom: 10px;">Thank You!</h1>
            <p style="color: #64748b; font-size: 18px;">We've received your message</p>
          </div>
          
          <div style="background: #f8fafc; padding: 25px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1e293b; margin-top: 0;">Dear ${name},</h3>
            <p>Thank you for reaching out to MicronsHub. We have received your inquiry and will get back to you within 24 hours.</p>
            
            <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p style="margin: 0;"><strong>Your message:</strong></p>
              <p style="margin: 10px 0 0 0; color: #475569;">${message}</p>
            </div>
          </div>
          
          <div style="background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h4 style="color: #1e40af; margin-top: 0;">What happens next?</h4>
            <ul style="color: #374151; padding-left: 20px;">
              <li>Our team will review your inquiry</li>
              <li>We'll respond within 24 hours</li>
              <li>If urgent, call us directly at +30 210 123 4567</li>
            </ul>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="color: #64748b; font-size: 14px; text-align: center;">
            © ${new Date().getFullYear()} MicronsHub. All rights reserved.
          </p>
        </div>
      `
    });

    console.log('Company email result:', companyEmail);
    console.log('Customer email result:', customerEmail);

    return res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      companyEmailId: companyEmail.data?.id,
      customerEmailId: customerEmail.data?.id
    });

  } catch (error) {
    console.error('Email sending error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Ensure we always return a proper JSON response
    try {
      return res.status(500).json({
        error: 'Failed to send email',
        details: error.message,
        success: false
      });
    } catch (jsonError) {
      console.error('Failed to send JSON error response:', jsonError);
      return res.status(500).end('Internal Server Error');
    }
  }
}
