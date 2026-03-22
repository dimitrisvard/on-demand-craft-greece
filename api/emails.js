/**
 * Consolidated Email API
 * Routes via `action` body parameter:
 *   action=contact         → contact form handler (was contact.js)
 *   action=email           → advanced email handler with RFQ detection (was email.js)
 *   action=rfq             → RFQ confirmation emails (was send-rfq-emails.js)
 *   action=rfq-pdf         → RFQ email with PDF attachment (was send-rfq-pdf-email.js)
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

// ─── contact form ───
async function handleContact(req, res) {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields: name, email, and message are required' });
  }

  const companyEmail = await resend.emails.send({
    from: 'MicronsHub Contact Form <info@micronshub.eu>',
    to: ['info@micronshub.eu'],
    subject: `New Contact Form Submission: ${subject || 'General Inquiry'}`,
    html: `
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
          <p style="margin: 0; color: #065f46;"><strong>Reply directly to:</strong> ${email}</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 14px;">This email was sent from the MicronsHub contact form at ${new Date().toLocaleString()}</p>
      </div>
    `,
    replyTo: email
  });

  const customerEmail = await resend.emails.send({
    from: 'MicronsHub <info@micronshub.eu>',
    to: [email],
    subject: 'Thank you for contacting MicronsHub',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 30px;">
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
            <li>If urgent, call us directly</li>
          </ul>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 14px; text-align: center;">&copy; ${new Date().getFullYear()} MicronsHub. All rights reserved.</p>
      </div>
    `
  });

  console.log('Contact form submission received:', { name, email, subject, companyEmailId: companyEmail.data?.id, customerEmailId: customerEmail.data?.id });

  return res.status(200).json({
    success: true,
    message: 'Contact form received successfully',
    companyEmailId: companyEmail.data?.id,
    customerEmailId: customerEmail.data?.id
  });
}

// ─── advanced email handler (RFQ detection) ───
async function handleEmail(req, res) {
  const { name, email, phone, subject, message, rfqNumber, companyName } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields: name, email, and message are required' });
  }

  const isRfqSubmission = rfqNumber && companyName;

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
          <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">Please review the quote request in the admin dashboard and prepare a response within 24 hours.</p>
        </div>
        <div style="margin-top: 30px; padding: 20px; background: #ecfdf5; border-radius: 8px;">
          <p style="margin: 0; color: #065f46;"><strong>Reply directly to:</strong> ${email}</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 14px;">This email was sent from the MicronsHub RFQ system at ${new Date().toLocaleString()}</p>
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
          <p style="margin: 0; color: #065f46;"><strong>Reply directly to:</strong> ${email}</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 14px;">This email was sent from the MicronsHub contact form at ${new Date().toLocaleString()}</p>
      </div>
    `,
    replyTo: email
  });

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
            <li>If urgent, call us directly at +302104447830</li>
          </ul>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 14px; text-align: center;">&copy; ${new Date().getFullYear()} MicronsHub. All rights reserved.</p>
      </div>
    `
  });

  return res.status(200).json({
    success: true,
    message: 'Email sent successfully',
    companyEmailId: companyEmail.data?.id,
    customerEmailId: customerEmail.data?.id
  });
}

// ─── RFQ confirmation emails ───
async function handleRfq(req, res) {
  const { customerName, customerEmail, companyName, rfqNumber } = req.body;

  if (!customerName || !customerEmail || !companyName || !rfqNumber) {
    return res.status(400).json({ error: 'Missing required fields: customerName, customerEmail, companyName, rfqNumber' });
  }

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
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">Dear ${customerName},</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">Thank you for submitting your quotation to Microns Hubs. We have successfully received your request, and our team is currently reviewing the details.</p>
          <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #065f46; font-size: 18px; margin: 0 0 10px 0;">Request Details</h3>
            <p style="color: #047857; font-size: 14px; margin: 0;"><strong>Company:</strong> ${companyName}</p>
            <p style="color: #047857; font-size: 14px; margin: 5px 0 0 0;"><strong>Reference Number:</strong> ${rfqNumber}</p>
          </div>
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 20px 0;">You can expect a formal response from us within the next 24 hours. Should we require any additional information or clarification, one of our representatives will contact you directly.</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 20px 0;">We truly value your time and interest in working with Microns Hubs, and we look forward to building a successful business relationship.</p>
        </div>
        <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f1f5f9; border-radius: 8px;">
          <p style="color: #1e293b; font-size: 16px; margin: 0 0 10px 0;"><strong>Best regards,</strong></p>
          <p style="color: #1e293b; font-size: 16px; margin: 0;">Microns Hubs Team</p>
          <p style="color: #64748b; font-size: 14px; margin: 10px 0 0 0;">📧 info@micronshub.eu</p>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">This email was sent from Microns Hubs quotation system at ${new Date().toLocaleString()}</p>
      </div>
    `,
  });

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
              <div style="flex: 1;"><p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Quote ID:</p><p style="color: #1f2937; font-size: 18px; margin: 5px 0 0 0; font-family: monospace;">${rfqNumber}</p></div>
              <div style="flex: 1;"><p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Company:</p><p style="color: #1f2937; font-size: 16px; margin: 5px 0 0 0;">${companyName}</p></div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
              <div style="flex: 1;"><p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Contact Person:</p><p style="color: #1f2937; font-size: 16px; margin: 5px 0 0 0;">${customerName}</p></div>
              <div style="flex: 1;"><p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Email:</p><p style="color: #2563eb; font-size: 16px; margin: 5px 0 0 0;"><a href="mailto:${customerEmail}" style="color: #2563eb; text-decoration: none;">${customerEmail}</a></p></div>
            </div>
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
              <p style="color: #374151; font-size: 14px; margin: 0; font-weight: bold;">Submission Time:</p>
              <p style="color: #1f2937; font-size: 14px; margin: 5px 0 0 0;">${new Date().toLocaleString()}</p>
            </div>
          </div>
          <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <p style="color: #1e40af; font-size: 14px; margin: 0; font-weight: bold;">📋 Action Required:</p>
            <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">Please review the quote request in the admin dashboard and prepare a response within 24 hours.</p>
          </div>
        </div>
        <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f8fafc; border-radius: 8px;">
          <p style="color: #64748b; font-size: 12px; margin: 0;">This is an automated notification from the Microns Hubs quotation system.</p>
        </div>
      </div>
    `,
  });

  return res.status(200).json({ success: true, confirmationEmail, notificationEmail, message: 'Both emails sent successfully' });
}

// ─── RFQ with PDF attachment ───
async function handleRfqPdf(req, res) {
  const { customerName, customerEmail, companyName, rfqNumber, pdfBase64, pdfFileName } = req.body;

  if (!customerName || !customerEmail || !companyName || !rfqNumber || !pdfBase64) {
    return res.status(400).json({ error: 'Missing required fields: customerName, customerEmail, companyName, rfqNumber, pdfBase64' });
  }

  const pdfBuffer = Buffer.from(pdfBase64, 'base64');

  const emailResult = await resend.emails.send({
    from: 'MicronsHub Quotations <info@micronshub.eu>',
    to: [customerEmail],
    subject: `Your Quote Request - ${rfqNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <img src="https://micronshub.eu/logo.png" alt="Microns Hub" style="height: 60px; margin-bottom: 15px;" />
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">Quote Request Confirmation</h1>
          <p style="color: #e0e7ff; margin: 10px 0 0 0; font-size: 16px;">Thank you for your interest in our manufacturing services</p>
        </div>
        <div style="padding: 30px; background: #ffffff;">
          <div style="margin-bottom: 25px;">
            <h2 style="color: #1f2937; font-size: 20px; margin: 0 0 15px 0;">Dear ${customerName},</h2>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">Thank you for submitting your quote request to <strong>Microns Hub</strong>. We have received your RFQ <strong>#${rfqNumber}</strong> and our team is already working on preparing a detailed quotation for your project.</p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">Please find attached a copy of your quote request for your records.</p>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #1e40af; font-size: 18px; margin: 0 0 15px 0; font-weight: bold;">📋 Quote Request Details</h3>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between;"><span style="color: #64748b; font-weight: 500;">RFQ Number:</span><span style="color: #1f2937; font-weight: bold;">#${rfqNumber}</span></div>
              <div style="display: flex; justify-content: space-between;"><span style="color: #64748b; font-weight: 500;">Company:</span><span style="color: #1f2937; font-weight: bold;">${companyName}</span></div>
              <div style="display: flex; justify-content: space-between;"><span style="color: #64748b; font-weight: 500;">Contact:</span><span style="color: #1f2937; font-weight: bold;">${customerName}</span></div>
              <div style="display: flex; justify-content: space-between;"><span style="color: #64748b; font-weight: 500;">Submission Date:</span><span style="color: #1f2937; font-weight: bold;">${new Date().toLocaleDateString()}</span></div>
            </div>
          </div>
          <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0;">
            <h3 style="color: #1e40af; font-size: 18px; margin: 0 0 15px 0; font-weight: bold;">🚀 What Happens Next?</h3>
            <ul style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 8px;">Our engineering team will review your requirements</li>
              <li style="margin-bottom: 8px;">We'll analyze your technical specifications and materials</li>
              <li style="margin-bottom: 8px;">Our experts will prepare a detailed quotation</li>
              <li style="margin-bottom: 8px;">You'll receive our competitive offer within 24-48 hours</li>
            </ul>
          </div>
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
            <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 15px 0; font-weight: bold;">📞 Need Immediate Assistance?</h3>
            <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0;">Our team is here to help! Feel free to contact us if you have any questions.</p>
            <div style="display: flex; justify-content: center; gap: 30px; flex-wrap: wrap;">
              <div style="text-align: center;"><p style="color: #1e40af; font-weight: bold; margin: 0; font-size: 16px;">📧 Email</p><a href="mailto:info@micronshub.eu" style="color: #3b82f6; text-decoration: none; font-size: 14px;">info@micronshub.eu</a></div>
              <div style="text-align: center;"><p style="color: #1e40af; font-weight: bold; margin: 0; font-size: 16px;">📱 Phone</p><a href="tel:+302104447830" style="color: #3b82f6; text-decoration: none; font-size: 14px;">+302104447830</a></div>
            </div>
          </div>
        </div>
        <div style="background: #1f2937; color: #9ca3af; padding: 20px; text-align: center; border-radius: 0 0 8px 8px;">
          <p style="margin: 0 0 10px 0; font-size: 14px;"><strong>Microns Hub</strong> - Precision Manufacturing Solutions</p>
          <p style="margin: 0; font-size: 12px;">Industrial Area Street B Number 4, Heraklion, Greece 71601 | VAT ID: EL803129638</p>
          <p style="margin: 10px 0 0 0; font-size: 12px;"><a href="https://micronshub.eu" style="color: #3b82f6; text-decoration: none;">www.micronshub.eu</a></p>
        </div>
      </div>
    `,
    attachments: [
      {
        filename: pdfFileName || `quote_${rfqNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });

  return res.status(200).json({ success: true, message: 'RFQ PDF email sent successfully', emailId: emailResult.data?.id });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const action = req.body?.action || new URL(req.url, 'http://localhost').searchParams.get('action') || 'email';

    switch (action) {
      case 'contact':
        return handleContact(req, res);
      case 'rfq':
        return handleRfq(req, res);
      case 'rfq-pdf':
        return handleRfqPdf(req, res);
      case 'email':
      default:
        return handleEmail(req, res);
    }
  } catch (error) {
    console.error('Email handler error:', error);
    return res.status(500).json({ error: 'Failed to process email request', details: error.message, success: false });
  }
}
