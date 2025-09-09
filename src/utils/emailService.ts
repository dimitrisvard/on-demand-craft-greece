interface RFQConfirmationEmailData {
  customerName: string;
  customerEmail: string;
  companyName: string;
  rfqNumber: string;
}

interface InternalNotificationEmailData {
  customerName: string;
  companyName: string;
  rfqNumber: string;
  customerEmail: string;
}

/**
 * Send both confirmation and notification emails after RFQ submission using Vercel API endpoint
 */
export const sendRFQEmails = async (data: RFQConfirmationEmailData): Promise<{ confirmationSent: boolean; notificationSent: boolean }> => {
  try {
    console.log('Sending RFQ emails via Vercel API...');
    console.log('RFQ data:', data);
    
    const emailData = {
      name: data.customerName,
      email: data.customerEmail,
      subject: `RFQ Request - ${data.rfqNumber}`,
      message: `RFQ Number: ${data.rfqNumber}\nCompany: ${data.companyName}\n\nThis is an automated RFQ submission notification.`,
      rfqNumber: data.rfqNumber,
      companyName: data.companyName
    };
    
    console.log('Sending email data:', emailData);
    
    // Use the existing /api/email.js endpoint with RFQ data
    const response = await fetch('/api/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API error:', errorData);
      return { confirmationSent: false, notificationSent: false };
    }

    const result = await response.json();
    console.log('Emails sent successfully:', result);
    
    return { confirmationSent: true, notificationSent: true };
  } catch (error) {
    console.error('Exception sending RFQ emails:', error);
    return { confirmationSent: false, notificationSent: false };
  }
};

// Keep the individual functions for backward compatibility
export const sendRFQConfirmationEmail = async (data: RFQConfirmationEmailData): Promise<boolean> => {
  const result = await sendRFQEmails(data);
  return result.confirmationSent;
};

export const sendInternalRFQNotificationEmail = async (data: InternalNotificationEmailData): Promise<boolean> => {
  const result = await sendRFQEmails({
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    companyName: data.companyName,
    rfqNumber: data.rfqNumber
  });
  return result.notificationSent;
};
