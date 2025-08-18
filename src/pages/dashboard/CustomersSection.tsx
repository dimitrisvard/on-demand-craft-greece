import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BackToDashboardButton } from "@/components/dashboard/BackToDashboardButton";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PencilIcon, PlusCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Customer } from "@/types/customer";

export default function CustomersSection() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState<Partial<Customer>>({
    company_name: "",
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    country: "",
    address: "",
    street_address: "",
    city: "",
    zip_code: "",
    vat_tax_id: "",
    position: "",
    status: "lead",
    contact_name: ""
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchCustomers();
  }, []);

  async function fetchCustomers() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const typedCustomers = data?.map((customer: any) => ({
        ...customer,
        status: customer.status as 'lead' | 'prospect' | 'active' | 'inactive'
      })) || [];

      setCustomers(typedCustomers);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load customers",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const handleEditClick = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsEditDialogOpen(true);
  };

  const handleAddClick = () => {
    setIsAddDialogOpen(true);
  };

  const handleSaveChanges = async () => {
    if (selectedCustomer) {
      try {
        const contact_name = `${selectedCustomer.first_name} ${selectedCustomer.last_name}`.trim();
        
        const { error } = await supabase
          .from('customers')
          .update({
            company_name: selectedCustomer.company_name,
            first_name: selectedCustomer.first_name,
            last_name: selectedCustomer.last_name,
            email: selectedCustomer.email,
            phone: selectedCustomer.phone,
            country: selectedCustomer.country,
            address: selectedCustomer.address,
            street_address: selectedCustomer.street_address,
            city: selectedCustomer.city,
            zip_code: selectedCustomer.zip_code,
            vat_tax_id: selectedCustomer.vat_tax_id,
            position: selectedCustomer.position,
            contact_name: contact_name
          })
          .eq('id', selectedCustomer.id);

        if (error) throw error;

        toast({
          title: "Success",
          description: "Customer updated successfully",
        });

        fetchCustomers();
        setIsEditDialogOpen(false);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to update customer",
          variant: "destructive",
        });
      }
    }
  };

  const handleAddCustomer = async () => {
    try {
      if (!newCustomer.company_name || !newCustomer.first_name || !newCustomer.last_name || !newCustomer.email) {
        toast({
          title: "Error",
          description: "Company name, first name, last name, and email are required",
          variant: "destructive",
        });
        return;
      }

      const contact_name = `${newCustomer.first_name} ${newCustomer.last_name}`.trim();
      
      const { error } = await supabase
        .from('customers')
        .insert({
          company_name: newCustomer.company_name,
          first_name: newCustomer.first_name,
          last_name: newCustomer.last_name,
          email: newCustomer.email,
          phone: newCustomer.phone,
          country: newCustomer.country,
          address: newCustomer.address,
          street_address: newCustomer.street_address || '',
          city: newCustomer.city || '',
          zip_code: newCustomer.zip_code || '',
          vat_tax_id: newCustomer.vat_tax_id || '',
          position: newCustomer.position || null,
          status: newCustomer.status || 'lead',
          contact_name: contact_name
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Customer added successfully",
      });

      fetchCustomers();
      setIsAddDialogOpen(false);
      setNewCustomer({
        company_name: "",
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        country: "",
        address: "",
        street_address: "",
        city: "",
        zip_code: "",
        vat_tax_id: "",
        position: "",
        status: "lead",
        contact_name: ""
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add customer",
        variant: "destructive",
      });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedCustomer) {
      setSelectedCustomer({
        ...selectedCustomer,
        [e.target.name]: e.target.value
      });
    }
  };

  const handleNewCustomerInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewCustomer({
      ...newCustomer,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <BackToDashboardButton />
          <h1 className="text-2xl font-bold">Customers</h1>
        </div>
        <Button 
          onClick={handleAddClick} 
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white"
          variant="default"
          size="default"
        >
          <PlusCircle className="h-5 w-5" />
          <span>New Customer</span>
        </Button>
      </div>
      
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company Name</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">Loading...</TableCell>
              </TableRow>
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">No customers found</TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.company_name}</TableCell>
                  <TableCell>{`${customer.first_name} ${customer.last_name}`}</TableCell>
                  <TableCell>{customer.email}</TableCell>
                  <TableCell>{customer.phone || '-'}</TableCell>
                  <TableCell>{customer.country || '-'}</TableCell>
                  <TableCell>{customer.address || '-'}</TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleEditClick(customer)}
                    >
                      <PencilIcon className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>
              Make changes to the customer details below.
            </DialogDescription>
          </DialogHeader>
          {selectedCustomer && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="company_name" className="text-right font-medium">
                  Company
                </label>
                <input
                  id="company_name"
                  name="company_name"
                  value={selectedCustomer.company_name}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="first_name" className="text-right font-medium">
                  First Name
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  value={selectedCustomer.first_name}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="last_name" className="text-right font-medium">
                  Last Name
                </label>
                <input
                  id="last_name"
                  name="last_name"
                  value={selectedCustomer.last_name}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="email" className="text-right font-medium">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={selectedCustomer.email}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="phone" className="text-right font-medium">
                  Phone
                </label>
                <input
                  id="phone"
                  name="phone"
                  value={selectedCustomer.phone || ''}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="country" className="text-right font-medium">
                  Country
                </label>
                <input
                  id="country"
                  name="country"
                  value={selectedCustomer.country || ''}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="address" className="text-right font-medium">
                  Address
                </label>
                <input
                  id="address"
                  name="address"
                  value={selectedCustomer.address || ''}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveChanges}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Add New Customer</DialogTitle>
            <DialogDescription>
              Enter the details for the new customer.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div>
              <h3 className="text-lg font-medium mb-3 border-b pb-2">Company Information</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="new_company_name" className="block text-sm font-medium mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="new_company_name"
                    name="company_name"
                    value={newCustomer.company_name}
                    onChange={handleNewCustomerInputChange}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="text-lg font-medium mb-3 border-b pb-2">Contact Person</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="new_first_name" className="block text-sm font-medium mb-1">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="new_first_name"
                    name="first_name"
                    value={newCustomer.first_name}
                    onChange={handleNewCustomerInputChange}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="new_last_name" className="block text-sm font-medium mb-1">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="new_last_name"
                    name="last_name"
                    value={newCustomer.last_name}
                    onChange={handleNewCustomerInputChange}
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="new_email" className="block text-sm font-medium mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="new_email"
                      name="email"
                      type="email"
                      value={newCustomer.email}
                      onChange={handleNewCustomerInputChange}
                      className="w-full p-2 border rounded"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="new_phone" className="block text-sm font-medium mb-1">
                      Phone
                    </label>
                    <input
                      id="new_phone"
                      name="phone"
                      value={newCustomer.phone || ''}
                      onChange={handleNewCustomerInputChange}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="text-lg font-medium mb-3 border-b pb-2">Location</h3>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label htmlFor="new_country" className="block text-sm font-medium mb-1">
                    Country
                  </label>
                  <input
                    id="new_country"
                    name="country"
                    value={newCustomer.country || ''}
                    onChange={handleNewCustomerInputChange}
                    className="w-full p-2 border rounded"
                  />
                </div>
                <div>
                  <label htmlFor="new_address" className="block text-sm font-medium mb-1">
                    Address
                  </label>
                  <input
                    id="new_address"
                    name="address"
                    value={newCustomer.address || ''}
                    onChange={handleNewCustomerInputChange}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCustomer} className="bg-primary hover:bg-primary/90">Add Customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
