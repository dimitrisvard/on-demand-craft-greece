// Temporary version that works without RESEND_API_KEY for immediate deployment
// TODO: Set up RESEND_API_KEY in Vercel environment variables

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

    // TEMPORARY: Return success without sending email
    // This allows deployment to succeed while you set up RESEND_API_KEY
    console.log('Contact form submission received (temporary mode):', {
      name, email, phone, subject, message, to
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Contact form received successfully (email sending temporarily disabled)',
      note: 'Please set up RESEND_API_KEY in Vercel environment variables to enable email sending'
    });

    /* 
    // ORIGINAL EMAIL CODE (uncomment after setting up RESEND_API_KEY):
    
    import { Resend } from 'resend';
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    // Send email to company
    const emailResponse = await resend.emails.send({
      from: 'MicronsHub Contact <hello@resend.dev>',
      to: [to || 'info@micronshub.eu'],
      replyTo: email,
      subject: `Contact Form: ${subject}`,
      html: `...`
    });

    // Send auto-reply to customer
    await resend.emails.send({
      from: 'MicronsHub <hello@resend.dev>',
      to: [email],
      subject: 'Thank you for contacting MicronsHub',
      html: `...`
    });
    */

  } catch (error) {
    console.error('Error in contact form:', error);
    
    return res.status(500).json({ 
      error: 'Failed to process contact form',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
