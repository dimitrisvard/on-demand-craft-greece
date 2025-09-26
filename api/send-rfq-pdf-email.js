import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      customerName, 
      customerEmail, 
      companyName, 
      rfqNumber, 
      pdfBase64,
      pdfFileName 
    } = req.body;

    if (!customerName || !customerEmail || !companyName || !rfqNumber || !pdfBase64) {
      return res.status(400).json({ 
        error: 'Missing required fields: customerName, customerEmail, companyName, rfqNumber, pdfBase64' 
      });
    }

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    // Send professional email with PDF attachment
    const emailResult = await resend.emails.send({
      from: 'MicronsHub Quotations <info@micronshub.eu>',
      to: [customerEmail],
      subject: `Your Quote Request - ${rfqNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <!-- Header with Logo -->
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <img src="https://micronshub.eu/logo.png" alt="Microns Hub" style="height: 60px; margin-bottom: 15px;" />
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">Quote Request Confirmation</h1>
            <p style="color: #e0e7ff; margin: 10px 0 0 0; font-size: 16px;">Thank you for your interest in our manufacturing services</p>
          </div>
          
          <!-- Main Content -->
          <div style="padding: 30px; background: #ffffff;">
            <div style="margin-bottom: 25px;">
              <h2 style="color: #1f2937; font-size: 20px; margin: 0 0 15px 0;">Dear ${customerName},</h2>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
                Thank you for submitting your quote request to <strong>Microns Hub</strong>. We have received your RFQ 
                <strong>#${rfqNumber}</strong> and our team is already working on preparing a detailed quotation for your project.
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Please find attached a copy of your quote request for your records.
              </p>
            </div>
            
            <!-- RFQ Details Box -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #1e40af; font-size: 18px; margin: 0 0 15px 0; font-weight: bold;">📋 Quote Request Details</h3>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b; font-weight: 500;">RFQ Number:</span>
                  <span style="color: #1f2937; font-weight: bold;">#${rfqNumber}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b; font-weight: 500;">Company:</span>
                  <span style="color: #1f2937; font-weight: bold;">${companyName}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b; font-weight: 500;">Contact:</span>
                  <span style="color: #1f2937; font-weight: bold;">${customerName}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #64748b; font-weight: 500;">Submission Date:</span>
                  <span style="color: #1f2937; font-weight: bold;">${new Date().toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            
            <!-- Next Steps -->
            <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0;">
              <h3 style="color: #1e40af; font-size: 18px; margin: 0 0 15px 0; font-weight: bold;">🚀 What Happens Next?</h3>
              <ul style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0; padding-left: 20px;">
                <li style="margin-bottom: 8px;">Our engineering team will review your requirements</li>
                <li style="margin-bottom: 8px;">We'll analyze your technical specifications and materials</li>
                <li style="margin-bottom: 8px;">Our experts will prepare a detailed quotation</li>
                <li style="margin-bottom: 8px;">You'll receive our competitive offer within 24-48 hours</li>
              </ul>
            </div>
            
            <!-- Contact Information -->
            <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
              <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 15px 0; font-weight: bold;">📞 Need Immediate Assistance?</h3>
              <p style="color: #374151; font-size: 16px; margin: 0 0 15px 0;">
                Our team is here to help! Feel free to contact us if you have any questions.
              </p>
              <div style="display: flex; justify-content: center; gap: 30px; flex-wrap: wrap;">
                <div style="text-align: center;">
                  <p style="color: #1e40af; font-weight: bold; margin: 0; font-size: 16px;">📧 Email</p>
                  <a href="mailto:info@micronshub.eu" style="color: #3b82f6; text-decoration: none; font-size: 14px;">info@micronshub.eu</a>
                </div>
                <div style="text-align: center;">
                  <p style="color: #1e40af; font-weight: bold; margin: 0; font-size: 16px;">📱 Phone</p>
                  <a href="tel:+306970077401" style="color: #3b82f6; text-decoration: none; font-size: 14px;">+30-697-00-77-401</a>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background: #1f2937; color: #9ca3af; padding: 20px; text-align: center; border-radius: 0 0 8px 8px;">
            <p style="margin: 0 0 10px 0; font-size: 14px;">
              <strong>Microns Hub</strong> - Precision Manufacturing Solutions
            </p>
            <p style="margin: 0; font-size: 12px;">
              Kosti Fragkouli 3, Heraklion, Greece 71414 | VAT ID: EL137232320
            </p>
            <p style="margin: 10px 0 0 0; font-size: 12px;">
              <a href="https://micronshub.eu" style="color: #3b82f6; text-decoration: none;">www.micronshub.eu</a>
            </p>
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

    console.log('RFQ PDF email sent successfully:', emailResult);

    return res.status(200).json({ 
      success: true, 
      message: 'RFQ PDF email sent successfully',
      emailId: emailResult.data?.id
    });

  } catch (error) {
    console.error('Error sending RFQ PDF email:', error);
    return res.status(500).json({ 
      error: 'Failed to send RFQ PDF email', 
      details: error.message 
    });
  }
}
