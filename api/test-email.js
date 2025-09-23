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

  try {
    console.log('[TEST API] Request received');
    console.log('[TEST API] RESEND_API_KEY present:', !!process.env.RESEND_API_KEY);
    console.log('[TEST API] RESEND_API_KEY length:', process.env.RESEND_API_KEY?.length || 0);

    // Test sending a simple email
    const testEmail = await resend.emails.send({
      from: 'MicronsHub Test <info@micronshub.eu>',
      to: ['dimitrisvard@hotmail.com'],
      subject: 'Test Email from MicronsHub',
      html: '<p>This is a test email to verify the email system is working.</p>'
    });

    console.log('[TEST API] Test email result:', testEmail);

    return res.status(200).json({
      success: true,
      message: 'Test email sent successfully',
      emailResult: testEmail
    });

  } catch (error) {
    console.error('[TEST API] Error:', error);
    return res.status(500).json({
      error: 'Failed to send test email',
      details: error.message,
      success: false
    });
  }
}
