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
    console.log('[API] Test partner notification handler start');
    
    const { partnerEmail } = req.body;
    
    if (!partnerEmail) {
      return res.status(400).json({ 
        error: 'Missing required field: partnerEmail' 
      });
    }

    console.log('Sending test partner notification email to:', partnerEmail);

    // Format dates
    const formatDate = (dateString) => {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const startDate = new Date();
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 14);

    // Send test partner notification email
    const partnerEmailResult = await resend.emails.send({
      from: 'MicronsHub Production <info@micronshub.eu>',
      to: [partnerEmail],
      subject: `[TEST] New Production Order Received - Test Production Order`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
          
          <div style="background: #f0f9ff; border: 2px solid #0ea5e9; padding: 25px; border-radius: 12px; margin: 20px 0;">
            <h2 style="color: #0c4a6e; font-size: 24px; margin: 0 0 20px 0;">🏭 New Production Order Received</h2>
            
            <p style="color: #0c4a6e; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              Dear Test Partner,
            </p>
            
            <p style="color: #0c4a6e; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              This is a test email to verify the partner notification system is working correctly.
            </p>
          </div>
          
          <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 20px 0;">
            <h3 style="color: #1e293b; font-size: 20px; margin: 0 0 20px 0;">Order Information</h3>
            
            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
              <p style="color: #374151; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">Order Title</p>
              <p style="color: #1f2937; font-size: 16px; margin: 0;">Test Production Order</p>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
              <div style="background: #ecfdf5; padding: 15px; border-radius: 8px; border: 1px solid #a7f3d0;">
                <p style="color: #065f46; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">📅 Production Start Date</p>
                <p style="color: #047857; font-size: 16px; margin: 0; font-weight: 500;">${formatDate(startDate)}</p>
              </div>
              <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border: 1px solid #fde68a;">
                <p style="color: #92400e; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">🚚 Delivery Date</p>
                <p style="color: #b45309; font-size: 16px; margin: 0; font-weight: 500;">${formatDate(deliveryDate)}</p>
              </div>
            </div>
          </div>
          
          <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 20px 0;">
            <h3 style="color: #1e293b; font-size: 20px; margin: 0 0 20px 0;">Production Items</h3>
            
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Product Name</th>
                    <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Description</th>
                    <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Quantity</th>
                    <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">SKU</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 12px; border-right: 1px solid #e5e7eb; font-weight: 500; color: #1f2937;">
                      Test Product 1
                    </td>
                    <td style="padding: 12px; border-right: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                      Test description for product 1
                    </td>
                    <td style="padding: 12px; border-right: 1px solid #e5e7eb; text-align: center; color: #1f2937; font-weight: 500;">
                      10
                    </td>
                    <td style="padding: 12px; text-align: center; color: #1f2937; font-weight: 500;">
                      TEST-001
                    </td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 12px; border-right: 1px solid #e5e7eb; font-weight: 500; color: #1f2937;">
                      Test Product 2
                    </td>
                    <td style="padding: 12px; border-right: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
                      Test description for product 2
                    </td>
                    <td style="padding: 12px; border-right: 1px solid #e5e7eb; text-align: center; color: #1f2937; font-weight: 500;">
                      5
                    </td>
                    <td style="padding: 12px; text-align: center; color: #1f2937; font-weight: 500;">
                      TEST-002
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h4 style="color: #1e40af; font-size: 16px; margin: 0 0 10px 0;">📋 Next Steps</h4>
            <ul style="color: #1e40af; font-size: 14px; margin: 0; padding-left: 20px;">
              <li>Review the order details and production requirements</li>
              <li>Confirm your acceptance and production timeline</li>
              <li>Access the order in your partner dashboard for detailed specifications</li>
              <li>Contact us if you have any questions or concerns</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f1f5f9; border-radius: 8px;">
            <p style="color: #1e293b; font-size: 16px; margin: 0 0 10px 0;"><strong>Best regards,</strong></p>
            <p style="color: #1e293b; font-size: 16px; margin: 0;">Microns Hubs Production Team</p>
            <p style="color: #64748b; font-size: 14px; margin: 10px 0 0 0;">📧 info@micronshub.eu | 📞 +30-697-00-77-401</p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">
            This is a TEST email from the Microns Hubs production management system at ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });

    console.log('Test partner notification email sent:', partnerEmailResult);

    return res.status(200).json({ 
      success: true, 
      partnerEmail: partnerEmailResult,
      message: 'Test partner notification email sent successfully' 
    });

  } catch (error) {
    console.error('Error sending test partner notification email:', error);
    return res.status(500).json({ 
      error: 'Failed to send test partner notification email', 
      details: error.message 
    });
  }
}
