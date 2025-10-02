import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Search, User, Mail, Building, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Customer } from '@/types/customer';

interface CustomerSearchAssignProps {
  currentCustomerId?: string | null;
  onCustomerSelect: (customer: Customer | null) => void;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
}

export const CustomerSearchAssign = ({
  currentCustomerId,
  onCustomerSelect,
  isOpen,
  onClose,
  title = "Assign Customer",
  description = "Search and assign a customer to this RFQ/Order"
}: CustomerSearchAssignProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentCustomer, setCurrentCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      fetchCustomers();
      if (currentCustomerId) {
        fetchCurrentCustomer();
      }
    }
  }, [isOpen, currentCustomerId]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = customers.filter(customer =>
        customer.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (customer.vat_tax_id && customer.vat_tax_id.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (customer.first_name && customer.first_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (customer.last_name && customer.last_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (customer.contact_name && customer.contact_name.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      setFilteredCustomers(filtered);
    } else {
      setFilteredCustomers(customers.slice(0, 10)); // Show first 10 when no search
    }
  }, [searchQuery, customers]);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('company_name', { ascending: true });

      if (error) throw error;

      setCustomers(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to load customers',
        variant: 'destructive',
      });
      console.error('Error fetching customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentCustomer = async () => {
    if (!currentCustomerId) return;

    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', currentCustomerId)
        .single();

      if (error) throw error;

      setCurrentCustomer(data);
    } catch (error: any) {
      console.error('Error fetching current customer:', error);
    }
  };

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
  };

  const handleAssign = () => {
    if (selectedCustomer) {
      onCustomerSelect(selectedCustomer);
      toast({
        title: 'Success',
        description: `Customer ${selectedCustomer.company_name} has been assigned`,
      });
    }
    onClose();
    setSelectedCustomer(null);
    setSearchQuery('');
  };

  const handleRemove = () => {
    onCustomerSelect(null);
    toast({
      title: 'Success',
      description: 'Customer assignment has been removed',
    });
    onClose();
    setSelectedCustomer(null);
    setSearchQuery('');
  };

  const getStatusBadge = (status: string | undefined) => {
    if (!status) return null;
    
    switch (status) {
      case "lead":
        return <Badge className="bg-blue-100 text-blue-800 text-xs">Lead</Badge>;
      case "prospect":
        return <Badge className="bg-yellow-100 text-yellow-800 text-xs">Prospect</Badge>;
      case "active":
        return <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge>;
      case "inactive":
        return <Badge className="bg-gray-100 text-gray-800 text-xs">Inactive</Badge>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Customer Display */}
          {currentCustomer && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Building className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-medium text-blue-900">{currentCustomer.company_name}</p>
                    <p className="text-sm text-blue-700">{currentCustomer.email}</p>
                  </div>
                  {getStatusBadge(currentCustomer.status)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemove}
                  className="text-red-600 hover:text-red-700"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Search Input */}
          <div className="space-y-2">
            <Label htmlFor="search">Search Customers</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Search by company name, email, VAT number, or contact name..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Customer List */}
          <div className="border rounded-lg max-h-[300px] overflow-y-auto">
            <Command>
              <CommandList>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  </div>
                ) : filteredCustomers.length === 0 ? (
                  <CommandEmpty>No customers found.</CommandEmpty>
                ) : (
                  <CommandGroup>
                    {filteredCustomers.map((customer) => (
                      <CommandItem
                        key={customer.id}
                        value={`${customer.company_name} ${customer.email} ${customer.vat_tax_id || ''}`}
                        onSelect={() => handleCustomerSelect(customer)}
                        className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 ${
                          selectedCustomer?.id === customer.id ? 'bg-blue-50 border border-blue-200' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <User className="h-4 w-4 text-gray-500" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{customer.company_name}</p>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Mail className="h-3 w-3" />
                              <span className="truncate">{customer.email}</span>
                              {customer.vat_tax_id && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono text-xs">{customer.vat_tax_id}</span>
                                </>
                              )}
                            </div>
                            {customer.contact_name && (
                              <p className="text-xs text-gray-500 truncate">
                                Contact: {customer.contact_name}
                              </p>
                            )}
                          </div>
                          {getStatusBadge(customer.status)}
                        </div>
                        {selectedCustomer?.id === customer.id && (
                          <Check className="h-4 w-4 text-blue-600" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {selectedCustomer && (
            <Button onClick={handleAssign} className="gap-2">
              <Check className="h-4 w-4" />
              Assign Customer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
