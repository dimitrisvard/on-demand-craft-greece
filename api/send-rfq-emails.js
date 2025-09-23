import { Resend } from 'resend';

// Initialize Resend with env or fallback
const API_KEY = process.env.RESEND_API_KEY || 're_Kt4eqTRh_KPSsn348fDERPLRZwsDZQhxy';
const resend = new Resend(API_KEY);

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

  try {
    console.log('[API] Handler start');
    console.log('[API] Using RESEND key present:', !!API_KEY);
    console.log('[API] Content-Type:', req.headers['content-type']);
    const { customerName, customerEmail, companyName, rfqNumber } = req.body;
    console.log('[API] Parsed body:', { customerName, customerEmail, companyName, rfqNumber });

    // Validate required fields
    if (!customerName || !customerEmail || !companyName || !rfqNumber) {
      return res.status(400).json({ 
        error: 'Missing required fields: customerName, customerEmail, companyName, rfqNumber' 
      });
    }

    console.log('Sending RFQ emails for:', { customerName, customerEmail, companyName, rfqNumber });

    // Send confirmation email to customer
    const confirmationEmail = await resend.emails.send({
      from: 'MicronsHub <info@micronshub.eu>',
      to: [customerEmail],
      subject: 'Thank You for Your Quotation – Microns Hubs',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://micronshub.eu/logo.png" alt="MicronsHub Logo" style="height: 60px; margin-bottom: 20px;">
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

    console.log('Confirmation email sent:', confirmationEmail);

    // Send internal notification email
    const notificationEmail = await resend.emails.send({
      from: 'MicronsHub System <info@micronshub.eu>',
      to: ['dimitrisvard@hotmail.com', 'info@micronshub.eu'],
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

    console.log('Notification email sent:', notificationEmail);

    return res.status(200).json({ 
      success: true, 
      confirmationEmail, 
      notificationEmail,
      message: 'Both emails sent successfully' 
    });

  } catch (error) {
    console.error('Error sending RFQ emails:', error);
    return res.status(500).json({ 
      error: 'Failed to send emails', 
      details: error.message 
    });
  }
}
