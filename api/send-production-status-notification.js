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
    console.log('[API] Production status notification handler start');
    console.log('[API] Using RESEND key present:', !!API_KEY);
    console.log('[API] Content-Type:', req.headers['content-type']);
    
    const { 
      partnerName, 
      orderId, 
      orderTitle, 
      status, // 'started' or 'finished'
      startDate, 
      deliveryDate, 
      totalAmount, 
      currency 
    } = req.body;
    
    console.log('[API] Parsed body:', { 
      partnerName, 
      orderId, 
      orderTitle, 
      status, 
      startDate, 
      deliveryDate, 
      totalAmount, 
      currency 
    });

    // Validate required fields
    if (!partnerName || !orderId || !orderTitle || !status) {
      return res.status(400).json({ 
        error: 'Missing required fields: partnerName, orderId, orderTitle, status are required' 
      });
    }

    console.log('Sending production status notification email for order:', orderId);

    // Format dates
    const formatDate = (dateString) => {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const isStarted = status === 'started';
    const statusText = isStarted ? 'Production Started' : 'Production Finished';
    const statusIcon = isStarted ? '🏭' : '✅';
    const statusColor = isStarted ? '#0ea5e9' : '#10b981';
    const statusBgColor = isStarted ? '#f0f9ff' : '#f0fdf4';
    const statusBorderColor = isStarted ? '#0ea5e9' : '#10b981';

    // Send production status notification email to admin
    const adminEmailResult = await resend.emails.send({
      from: 'MicronsHub Production <info@micronshub.eu>',
      to: ['dimitrisvard@hotmail.com', 'info@micronshub.eu'],
      subject: `${statusIcon} ${statusText} - ${orderTitle} by ${partnerName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
          
          <div style="background: ${statusBgColor}; border: 2px solid ${statusBorderColor}; padding: 25px; border-radius: 12px; margin: 20px 0;">
            <h2 style="color: ${statusColor}; font-size: 24px; margin: 0 0 20px 0;">${statusIcon} ${statusText}</h2>
            
            <p style="color: ${statusColor}; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
              ${isStarted ? 
                `Production has been started by ${partnerName} for order ${orderTitle}.` : 
                `Production has been completed by ${partnerName} for order ${orderTitle}.`
              }
            </p>
          </div>
          
          <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 20px 0;">
            <h3 style="color: #1e293b; font-size: 20px; margin: 0 0 20px 0;">Order Information</h3>
            
            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
              <p style="color: #374151; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">Order Title</p>
              <p style="color: #1f2937; font-size: 16px; margin: 0;">${orderTitle}</p>
            </div>
            
            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
              <p style="color: #374151; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">Production Partner</p>
              <p style="color: #1f2937; font-size: 16px; margin: 0;">${partnerName}</p>
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
            
            ${totalAmount ? `
            <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; border: 1px solid #bae6fd;">
              <p style="color: #1e40af; font-size: 14px; margin: 0 0 5px 0; font-weight: bold;">💰 Order Value</p>
              <p style="color: #1e40af; font-size: 18px; margin: 0; font-weight: 600;">${totalAmount.toLocaleString()} ${currency}</p>
            </div>
            ` : ''}
          </div>
          
          <div style="background: ${isStarted ? '#fef3c7' : '#f0fdf4'}; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid ${isStarted ? '#fde68a' : '#bbf7d0'};">
            <h4 style="color: ${isStarted ? '#92400e' : '#065f46'}; font-size: 16px; margin: 0 0 10px 0;">
              ${isStarted ? '🚀 Production Started' : '🎉 Production Completed'}
            </h4>
            <ul style="color: ${isStarted ? '#92400e' : '#065f46'}; font-size: 14px; margin: 0; padding-left: 20px;">
              ${isStarted ? [
                'Production has officially begun',
                'Monitor progress through the dashboard',
                'Expect regular updates from the production partner',
                'Contact partner if you have any questions'
              ].map(item => `<li>${item}</li>`).join('') : [
                'Production has been completed successfully',
                'Order is ready for quality inspection',
                'Prepare for delivery or pickup',
                'Update order status in the system'
              ].map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
          
          <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f1f5f9; border-radius: 8px;">
            <p style="color: #1e293b; font-size: 16px; margin: 0 0 10px 0;"><strong>Best regards,</strong></p>
            <p style="color: #1e293b; font-size: 16px; margin: 0;">Microns Hubs Production Team</p>
            <p style="color: #64748b; font-size: 14px; margin: 10px 0 0 0;">📧 info@micronshub.eu | 📞 +302104447830</p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">
            This email was sent from the Microns Hubs production management system at ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });

    console.log('Production status notification email sent:', adminEmailResult);

    return res.status(200).json({ 
      success: true, 
      adminEmail: adminEmailResult,
      message: 'Production status notification email sent successfully' 
    });

  } catch (error) {
    console.error('Error sending production status notification email:', error);
    return res.status(500).json({ 
      error: 'Failed to send production status notification email', 
      details: error.message 
    });
  }
}
