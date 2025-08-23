// Simple contact form handler - no environment variables required
// This allows immediate deployment while you set up email functionality later

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

    // Log the contact form submission (for debugging)
    console.log('Contact form submission received:', {
      name, email, phone, subject, message, to,
      timestamp: new Date().toISOString()
    });

    // Return success response
    return res.status(200).json({ 
      success: true, 
      message: 'Contact form received successfully',
      note: 'Email functionality will be enabled after setting up Resend integration'
    });

  } catch (error) {
    console.error('Error in contact form:', error);
    
    return res.status(500).json({ 
      error: 'Failed to process contact form',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
