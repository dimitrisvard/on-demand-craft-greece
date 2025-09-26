// Update existing types to match database structure
export type CustomerStatus = 'lead' | 'prospect' | 'active' | 'inactive';

export type Customer = {
  id: string;
  company_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  created_at: string;
  address: string | null;
  status: CustomerStatus;
  updated_at: string;
  // Database still has this field
  contact_name: string;
  // New fields
  vat_tax_id: string;
  street_address: string;
  city: string;
  zip_code: string;
  first_name: string;
  last_name: string;
  position: string | null;
  customer_id: string; // Ensure this is explicitly defined
};

export type Contact = {
  id: string;
  customer_id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string | null;
  is_primary: boolean;
  created_at: string;
};

export type RFQ = {
  id: string;
  title: string;
  customer_id: string;
  customer_name?: string;
  status: 'draft' | 'sent' | 'received' | 'approved' | 'rejected';
  total_amount: number;
  currency: string;
  created_at: string;
  due_date: string;
  version: number;
  rfq_number?: string;
  shipping_cost?: number;
  customer_details?: {
    vat_tax_id?: string;
    phone?: string;
    email?: string;
  };
  parts_details?: RfqItem[];
  description?: string;
  updated_at?: string;
  customer?: Customer;
};

export type RfqItem = {
  id: string;
  rfq_id: string;
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
  updated_at: string;
};

// Add Order type
export type OrderStatus = 'new' | 'in_progress' | 'completed' | 'cancelled';

export type Order = {
  id: string;
  customer_id: string;
  customer_name?: string;
  customer_vat?: string;
  rfq_id?: string;
  partner_id?: string;
  status: OrderStatus;
  production_status?: 'pending' | 'in_production' | 'ready' | 'completed';
  total_amount: number;
  currency: string;
  created_at: string;
  title: string;
  start_date: string;  // When production starts
  delivery_date: string; // Expected delivery date
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
};

// Add Partner and PartnerRating types for PartnerManagement.tsx
export type Partner = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  specializations: string[] | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  partner_id: string; // Added partner_id field
  password?: string; // Optional, for UI form use only
};

export type PartnerRating = {
  id: string;
  partner_id: string;
  score: number;
  comment: string;
  created_at: string;
};
