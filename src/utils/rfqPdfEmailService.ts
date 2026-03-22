interface RFQPDFEmailData {
  customerName: string;
  customerEmail: string;
  companyName: string;
  rfqNumber: string;
  pdfBase64: string;
  pdfFileName?: string;
}

/**
 * Send RFQ PDF via email to customer
 */
export const sendRFQPDFEmail = async (data: RFQPDFEmailData): Promise<{ success: boolean; message: string }> => {
  try {
    console.log('Sending RFQ PDF email...');
    console.log('Email data:', { 
      customerName: data.customerName, 
      customerEmail: data.customerEmail, 
      companyName: data.companyName, 
      rfqNumber: data.rfqNumber,
      pdfFileName: data.pdfFileName 
    });
    
    const response = await fetch('/api/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...data, action: 'rfq-pdf' })
    });
    
    console.log('Response status:', response.status);

    if (!response.ok) {
      let errorData;
      try {
        const responseText = await response.text();
        errorData = responseText ? JSON.parse(responseText) : { error: 'Empty response' };
      } catch (parseError) {
        errorData = { error: 'Failed to parse error response', status: response.status };
      }
      console.error('API error:', errorData);
      return { success: false, message: errorData.error || 'Failed to send email' };
    }

    let result;
    try {
      const responseText = await response.text();
      result = responseText ? JSON.parse(responseText) : { success: true };
    } catch (parseError) {
      console.error('Failed to parse response:', parseError);
      return { success: false, message: 'Failed to parse server response' };
    }
    
    console.log('RFQ PDF email sent successfully:', result);
    
    return { success: true, message: result.message || 'Email sent successfully' };
  } catch (error) {
    console.error('Exception sending RFQ PDF email:', error);
    return { success: false, message: 'Network error occurred' };
  }
};

/**
 * Generate PDF and send via email
 */
export const generateAndSendRFQPDF = async (
  rfqData: any,
  customerData: any,
  pdfGenerator: () => Promise<string>
): Promise<{ success: boolean; message: string }> => {
  try {
    // Generate PDF and get base64
    const pdfBase64 = await pdfGenerator();
    
    // Prepare email data
    const emailData: RFQPDFEmailData = {
      customerName: `${customerData.first_name} ${customerData.last_name}`,
      customerEmail: customerData.email,
      companyName: customerData.company_name,
      rfqNumber: rfqData.rfq_number || rfqData.id,
      pdfBase64: pdfBase64,
      pdfFileName: `quote_${rfqData.rfq_number || rfqData.id}.pdf`
    };
    
    // Send email
    return await sendRFQPDFEmail(emailData);
  } catch (error) {
    console.error('Error generating and sending RFQ PDF:', error);
    return { success: false, message: 'Failed to generate or send PDF' };
  }
};
