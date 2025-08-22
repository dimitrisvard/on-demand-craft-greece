import { supabase } from '@/integrations/supabase/client';
import { FormValues } from '@/components/quote-form/types';

export interface CustomerData {
  id: string;
  company_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  address: string | null;
  status: string;
  contact_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  vat_tax_id: string | null;
  street_address: string | null;
  city: string | null;
  zip_code: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Check if a customer exists by email and return customer data if found
 * @param email - Customer email address
 * @returns Customer data if exists, null otherwise
 */
export async function checkCustomerExists(email: string): Promise<CustomerData | null> {
  try {
    const { data: existingCustomers, error } = await supabase
      .from('customers')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (error) {
      console.error('Error checking existing customer:', error);
      throw error;
    }

    return existingCustomers && existingCustomers.length > 0 ? existingCustomers[0] : null;
  } catch (error) {
    console.error('Error in checkCustomerExists:', error);
    throw error;
  }
}

/**
 * Create a new customer with the provided form values
 * @param values - Form values from quote form
 * @returns Newly created customer data
 */
export async function createNewCustomer(values: FormValues): Promise<CustomerData> {
  try {
    const { data: newCustomer, error } = await supabase
      .from('customers')
      .insert([
        {
          company_name: values.companyName,
          vat_tax_id: values.vatId,
          street_address: values.address.street,
          city: values.address.city,
          zip_code: values.address.zipCode,
          country: values.address.country,
          contact_name: `${values.contact.firstName} ${values.contact.lastName}`,
          first_name: values.contact.firstName,
          last_name: values.contact.lastName,
          position: values.contact.position,
          email: values.contact.email,
          phone: values.contact.phone,
          status: 'lead',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error creating customer:', error);
      throw error;
    }

    return newCustomer;
  } catch (error) {
    console.error('Error in createNewCustomer:', error);
    throw error;
  }
}

/**
 * Update an existing customer with the latest information from form
 * @param customerId - Existing customer ID
 * @param values - Form values from quote form
 * @returns Updated customer data
 */
export async function updateExistingCustomer(customerId: string, values: FormValues): Promise<void> {
  try {
    const { error } = await supabase
      .from('customers')
      .update({
        company_name: values.companyName,
        vat_tax_id: values.vatId,
        street_address: values.address.street,
        city: values.address.city,
        zip_code: values.address.zipCode,
        country: values.address.country,
        contact_name: `${values.contact.firstName} ${values.contact.lastName}`,
        first_name: values.contact.firstName,
        last_name: values.contact.lastName,
        position: values.contact.position,
        phone: values.contact.phone,
        updated_at: new Date().toISOString()
      })
      .eq('id', customerId);

    if (error) {
      console.error('Error updating existing customer:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in updateExistingCustomer:', error);
    throw error;
  }
}

/**
 * Get or create customer based on email address
 * This is the main function that handles customer existence check and creation/update
 * @param values - Form values from quote form
 * @returns Customer data (either existing or newly created)
 */
export async function getOrCreateCustomer(values: FormValues): Promise<CustomerData> {
  try {
    // First, check if customer exists by email
    const existingCustomer = await checkCustomerExists(values.contact.email);
    
    if (existingCustomer) {
      // Customer exists, update with latest information
      console.log('Using existing customer:', existingCustomer);
      await updateExistingCustomer(existingCustomer.id, values);
      return existingCustomer;
    } else {
      // Customer doesn't exist, create a new one
      console.log('Creating new customer');
      const newCustomer = await createNewCustomer(values);
      return newCustomer;
    }
  } catch (error) {
    console.error('Error in getOrCreateCustomer:', error);
    throw error;
  }
}








