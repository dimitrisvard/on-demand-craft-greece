import { supabase } from '../integrations/supabase/client';

export interface PartnerNotificationData {
  orderId: string;
  orderTitle: string;
  startDate: string;
  deliveryDate: string;
  orderItems: Array<{
    product_name: string;
    description?: string;
    quantity: number;
    sku?: string;
  }>;
  totalAmount?: number;
  currency?: string;
  partnerId: string;
}

export interface ProductionPartner {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  country?: string;
  specializations?: string[];
  active?: boolean;
}

/**
 * Fetches production partner details by ID
 */
export async function getProductionPartner(partnerId: string): Promise<ProductionPartner | null> {
  try {
    const { data, error } = await supabase
      .from('production_partners')
      .select('*')
      .eq('id', partnerId)
      .eq('active', true)
      .single();

    if (error) {
      console.error('Error fetching production partner:', error);
      return null;
    }

    return data as ProductionPartner;
  } catch (error) {
    console.error('Error fetching production partner:', error);
    return null;
  }
}

/**
 * Fetches order items for a given order ID
 */
export async function getOrderItems(orderId: string) {
  try {
    const { data, error } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (error) {
      console.error('Error fetching order items:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching order items:', error);
    return [];
  }
}

/**
 * Sends partner notification email
 */
export async function sendPartnerNotification(notificationData: PartnerNotificationData): Promise<boolean> {
  try {
    // Get partner details
    const partner = await getProductionPartner(notificationData.partnerId);
    if (!partner) {
      console.error('Partner not found or inactive:', notificationData.partnerId);
      return false;
    }

    // Get order items
    const orderItems = await getOrderItems(notificationData.orderId);

    // Prepare email data
    const emailData = {
      partnerEmail: partner.email,
      partnerName: partner.contact_name,
      orderId: notificationData.orderId,
      orderTitle: notificationData.orderTitle,
      startDate: notificationData.startDate,
      deliveryDate: notificationData.deliveryDate,
      orderItems: orderItems.map(item => ({
        product_name: item.product_name,
        description: item.description,
        quantity: item.quantity,
        sku: item.sku
      })),
      totalAmount: notificationData.totalAmount,
      currency: notificationData.currency || 'EUR'
    };

    // Send email via API
    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...emailData, action: 'partner' }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to send partner notification:', errorData);
      return false;
    }

    const result = await response.json();
    console.log('Partner notification sent successfully:', result);
    return true;

  } catch (error) {
    console.error('Error sending partner notification:', error);
    return false;
  }
}

/**
 * Sends partner notification when an order is assigned to a partner
 */
export async function notifyPartnerOfOrderAssignment(
  orderId: string,
  partnerId: string,
  orderTitle: string,
  startDate: string,
  deliveryDate: string,
  totalAmount?: number,
  currency?: string
): Promise<boolean> {
  try {
    const notificationData: PartnerNotificationData = {
      orderId,
      orderTitle,
      startDate,
      deliveryDate,
      orderItems: [], // Will be fetched by the function
      totalAmount,
      currency,
      partnerId
    };

    return await sendPartnerNotification(notificationData);
  } catch (error) {
    console.error('Error notifying partner of order assignment:', error);
    return false;
  }
}
