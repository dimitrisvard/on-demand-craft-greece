import { Customer } from "@/types/customer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect } from "react";

interface CustomerEditFormProps {
  customer: (Customer | Partial<Customer>) & { password?: string };
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  mode: "edit" | "add";
}

// Function to generate a simple 6-digit customer ID
const generateSimpleCustomerId = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const CustomerEditForm = ({ customer, onChange, mode }: CustomerEditFormProps) => {
  // Generate a simple customer ID if in add mode and no ID exists
  useEffect(() => {
    if (mode === "add" && !customer.customer_id) {
      // Simulate an input change event to set the customer_id
      const event = {
        target: {
          name: "customer_id",
          value: generateSimpleCustomerId()
        }
      } as React.ChangeEvent<HTMLInputElement>;
      
      onChange(event);
    }
  }, [mode, customer.customer_id, onChange]);

  return (
    <div className="grid gap-6">
      {mode === "edit" && (
        <div className="space-y-2">
          <Label htmlFor="customer_id">Customer ID</Label>
          <Input
            id="customer_id"
            name="customer_id"
            value={customer.customer_id || ''}
            onChange={onChange}
            className="bg-slate-50 font-mono text-sm"
          />
        </div>
      )}

      <div>
        <h3 className="text-lg font-medium mb-4 border-b pb-2">Company Information</h3>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">Company Name <span className="text-red-500">*</span></Label>
              <Input
                id="company_name"
                name="company_name"
                value={customer.company_name || ''}
                onChange={onChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vat_tax_id">VAT/Tax ID <span className="text-red-500">*</span></Label>
              <Input
                id="vat_tax_id"
                name="vat_tax_id"
                value={customer.vat_tax_id || ''}
                onChange={onChange}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="street_address">Street Address <span className="text-red-500">*</span></Label>
            <Input
              id="street_address"
              name="street_address"
              value={customer.street_address || ''}
              onChange={onChange}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City <span className="text-red-500">*</span></Label>
              <Input
                id="city"
                name="city"
                value={customer.city || ''}
                onChange={onChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip_code">ZIP/Postal Code <span className="text-red-500">*</span></Label>
              <Input
                id="zip_code"
                name="zip_code"
                value={customer.zip_code || ''}
                onChange={onChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country <span className="text-red-500">*</span></Label>
              <Input
                id="country"
                name="country"
                value={customer.country || ''}
                onChange={onChange}
                required
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-4 border-b pb-2">Contact Person</h3>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name <span className="text-red-500">*</span></Label>
              <Input
                id="first_name"
                name="first_name"
                value={customer.first_name || ''}
                onChange={onChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name <span className="text-red-500">*</span></Label>
              <Input
                id="last_name"
                name="last_name"
                value={customer.last_name || ''}
                onChange={onChange}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="position">Position/Role</Label>
            <Input
              id="position"
              name="position"
              value={customer.position || ''}
              onChange={onChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={customer.email || ''}
                onChange={onChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                value={customer.phone || ''}
                onChange={onChange}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile Number</Label>
            <Input
              id="mobile"
              name="mobile"
              type="tel"
              value={customer.mobile || ''}
              onChange={onChange}
              placeholder="Enter mobile number"
            />
          </div>
        </div>
      </div>

      {mode === "edit" && (
        <div>
          <h3 className="text-lg font-medium mb-4 border-b pb-2">Status</h3>
          <div className="space-y-2">
            <Label htmlFor="status">Customer Status</Label>
            <select
              id="status"
              name="status"
              value={customer.status || 'lead'}
              onChange={onChange}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
            >
              <option value="lead">Lead</option>
              <option value="prospect">Prospect</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            value={(customer as any).password || ''}
            onChange={onChange}
            autoComplete="new-password"
            placeholder="Change password (leave blank to keep current)"
          />
        </div>
      )}
    </div>
  );
};
