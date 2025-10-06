import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { supabase } from "@/integrations/supabase/client"
import { PencilIcon, PlusCircle, Trash2, UserCircle, Search } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { BackToDashboardButton } from "@/components/dashboard/BackToDashboardButton"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { Customer, CustomerStatus } from "@/types/customer"
import { CustomerEditForm } from "@/components/customers/CustomerEditForm"
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout"
import { CustomerDetailsPanel } from "@/components/customers/CustomerDetailsPanel"
import { Input } from "@/components/ui/input"

const generateSimpleCustomerId = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isCustomerDetailsOpen, setIsCustomerDetailsOpen] = useState(false)
  const [newCustomer, setNewCustomer] = useState<Partial<Customer>>({
    company_name: "",
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    country: "",
    address: "",
    status: "lead",
    street_address: "",
    city: "",
    zip_code: "",
    vat_tax_id: "",
    position: "",
    contact_name: ""
  })
  const { toast } = useToast()

  useEffect(() => {
    fetchCustomers()
  }, [])

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredCustomers(customers);
      return;
    }
    
    const lowercaseQuery = searchQuery.toLowerCase();
    const filtered = customers.filter(customer =>
      customer.company_name.toLowerCase().includes(lowercaseQuery) ||
      customer.email.toLowerCase().includes(lowercaseQuery) ||
      (customer.vat_tax_id && customer.vat_tax_id.toLowerCase().includes(lowercaseQuery))
    );
    
    setFilteredCustomers(filtered);
  }, [searchQuery, customers]);

  async function fetchCustomers() {
    try {
      setLoading(true)
      console.log("Fetching customers...")
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error("Error fetching customers:", error)
        throw error
      }

      console.log("Fetched customers data:", data)

      const typedCustomers = data?.map(customer => {
        const typedCustomer: Customer = {
          ...customer,
          status: customer.status as CustomerStatus,
          customer_id: (customer as any).customer_id || generateSimpleCustomerId()
        };
        
        return typedCustomer;
      }) || [];

      console.log("Processed customers:", typedCustomers)
      setCustomers(typedCustomers)
      setFilteredCustomers(typedCustomers)
    } catch (error: any) {
      console.error("Error in fetchCustomers:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to load customers",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEditClick = (customer: Customer) => {
    console.log("Edit clicked for customer:", customer)
    setSelectedCustomer(customer)
    setIsEditDialogOpen(true)
  }

  const handleViewClick = (customer: Customer) => {
    console.log("View clicked for customer:", customer)
    setSelectedCustomer(customer)
    setIsCustomerDetailsOpen(true)
  }

  const handleDeleteClick = (customer: Customer) => {
    console.log("Delete clicked for customer:", customer)
    setSelectedCustomer(customer)
    setIsDeleteDialogOpen(true)
  }

  const handleAddClick = () => {
    console.log("Add customer clicked")
    setIsAddDialogOpen(true)
    setNewCustomer({
      company_name: "",
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      country: "",
      address: "",
      status: "lead",
      street_address: "",
      city: "",
      zip_code: "",
      vat_tax_id: "",
      position: "",
      contact_name: "",
      customer_id: generateSimpleCustomerId()
    })
  }

  const handleSaveChanges = async () => {
    if (!selectedCustomer) {
      console.error("No customer selected for editing")
      return
    }
    
    if (isProcessing) {
      console.log("Operation already in progress, please wait...")
      return
    }
    
    try {
      setIsProcessing(true)
      console.log("Saving changes for customer:", selectedCustomer)
      
      const contact_name = `${selectedCustomer.first_name} ${selectedCustomer.last_name}`.trim();
      
      const { customer_id, id, created_at, ...updateData } = selectedCustomer;
      
      const dataToSend = {
        ...updateData,
        contact_name: contact_name,
        updated_at: new Date().toISOString()
      };
      
      console.log("Update data being sent to Supabase:", dataToSend)
      
      const { data, error } = await supabase
        .from('customers')
        .update(dataToSend)
        .eq('id', id)
        .select();

      if (error) {
        console.error("Error updating customer:", error)
        throw error
      }

      console.log("Customer updated successfully in database:", data)
      
      setCustomers(prevCustomers => 
        prevCustomers.map(customer => 
          customer.id === selectedCustomer.id 
            ? { ...selectedCustomer, ...dataToSend } 
            : customer
        )
      );
      
      toast({
        title: "Success",
        description: "Customer updated successfully",
      })

      setIsEditDialogOpen(false)
    } catch (error: any) {
      console.error("Error in handleSaveChanges:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to update customer",
        variant: "destructive",
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDeleteCustomer = async () => {
    if (!selectedCustomer) {
      console.error("No customer selected for deletion")
      return
    }
    
    if (isProcessing) {
      console.log("Operation already in progress, please wait...")
      return
    }
    
    try {
      setIsProcessing(true)
      console.log("Deleting customer with ID:", selectedCustomer.id)
      
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', selectedCustomer.id)

      if (error) {
        console.error("Error deleting customer:", error)
        throw error
      }

      console.log("Customer deleted successfully from database")
      
      setIsDeleteDialogOpen(false)
      
      setCustomers(currentCustomers => 
        currentCustomers.filter(customer => customer.id !== selectedCustomer.id)
      )
      
      setSelectedCustomer(null)
      
      toast({
        title: "Success",
        description: "Customer deleted successfully",
      })
    } catch (error: any) {
      console.error("Error in handleDeleteCustomer:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to delete customer",
        variant: "destructive",
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAddCustomer = async () => {
    if (isProcessing) {
      console.log("Operation already in progress, please wait...");
      return;
    }
    
    try {
      setIsProcessing(true);
      console.log("Adding new customer:", newCustomer);
      
      if (!newCustomer.company_name || !newCustomer.first_name || !newCustomer.last_name || !newCustomer.email || !newCustomer.vat_tax_id || !newCustomer.street_address || !newCustomer.city || !newCustomer.zip_code) {
        toast({
          title: "Error",
          description: "Please fill in all required fields.",
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      const contact_name = `${newCustomer.first_name} ${newCustomer.last_name}`.trim();
      
      const insertData = {
        company_name: newCustomer.company_name,
        email: newCustomer.email,
        first_name: newCustomer.first_name || "",
        last_name: newCustomer.last_name || "",
        contact_name: contact_name,
        phone: newCustomer.phone || null,
        mobile: newCustomer.mobile || null,
        country: newCustomer.country || null,
        address: newCustomer.address || null,
        status: (newCustomer.status || 'lead') as CustomerStatus,
        street_address: newCustomer.street_address || "",
        city: newCustomer.city || "",
        zip_code: newCustomer.zip_code || "",
        vat_tax_id: newCustomer.vat_tax_id || "",
        position: newCustomer.position || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      
      console.log("Insert data being sent to Supabase:", insertData);
      
      const { data, error } = await supabase
        .from('customers')
        .insert(insertData)
        .select();

      if (error) {
        console.error("Error adding customer:", error);
        throw error;
      }
      
      console.log("Customer added successfully to database:", data);
      
      if (data && data.length > 0) {
        const newCustomerWithId: Customer = {
          ...data[0],
          status: data[0].status as CustomerStatus,
          customer_id: generateSimpleCustomerId()
        };
        
        setCustomers(prevCustomers => [newCustomerWithId, ...prevCustomers]);
      }
      
      toast({
        title: "Success",
        description: "Customer added successfully",
      });

      setIsAddDialogOpen(false);
    } catch (error: any) {
      console.error("Error in handleAddCustomer:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to add customer",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (selectedCustomer) {
      setSelectedCustomer({
        ...selectedCustomer,
        [e.target.name]: e.target.value
      })
    }
  }

  const handleNewCustomerInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setNewCustomer({
      ...newCustomer,
      [e.target.name]: e.target.value
    })
  }

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'lead':
        return <Badge variant="secondary">Lead</Badge>
      case 'prospect':
        return <Badge variant="outline">Prospect</Badge>
      case 'active':
        return <Badge variant="default">Active</Badge>
      case 'inactive':
        return <Badge variant="destructive">Inactive</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Customers</h1>
          </div>
        <Button 
          onClick={handleAddClick} 
          className="flex items-center gap-2"
          variant="default"
          type="button"
        >
          <PlusCircle className="h-5 w-5" />
          <span>New Customer</span>
        </Button>
      </div>
      
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search customers by company name, email, or VAT number..."
          className="pl-10"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company Name</TableHead>
              <TableHead>VAT/Tax ID</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">Loading...</TableCell>
              </TableRow>
            ) : filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">
                  {searchQuery ? 'No customers match your search' : 'No customers found'}
                </TableCell>
              </TableRow>
            ) : (
              filteredCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.company_name}</TableCell>
                  <TableCell>{customer.vat_tax_id || '-'}</TableCell>
                  <TableCell>{`${customer.first_name} ${customer.last_name}`}</TableCell>
                  <TableCell>{customer.email}</TableCell>
                  <TableCell>{customer.phone || '-'}</TableCell>
                  <TableCell>{getStatusBadge(customer.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        type="button"
                        onClick={() => handleViewClick(customer)}
                      >
                        <PencilIcon className="h-4 w-4 mr-1" />
                        View/Edit
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        type="button"
                        onClick={() => handleDeleteClick(customer)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        if (!isProcessing) setIsEditDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>
              Make changes to the customer details below.
            </DialogDescription>
          </DialogHeader>
          {selectedCustomer && (
            <CustomerEditForm 
              customer={selectedCustomer}
              onChange={handleInputChange}
              mode="edit"
            />
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsEditDialogOpen(false)}
              type="button"
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveChanges} 
              type="button"
              disabled={isProcessing}
            >
              {isProcessing ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        if (!isProcessing) setIsAddDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>
              Enter the details for the new customer.
            </DialogDescription>
          </DialogHeader>
          <CustomerEditForm 
            customer={newCustomer}
            onChange={handleNewCustomerInputChange}
            mode="add"
          />
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsAddDialogOpen(false)}
              type="button"
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAddCustomer} 
              type="button"
              disabled={isProcessing}
            >
              {isProcessing ? 'Adding...' : 'Add Customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => {
        if (!isProcessing) setIsDeleteDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this customer? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedCustomer && (
            <div className="py-4">
              <p className="mb-2"><strong>Company:</strong> {selectedCustomer.company_name}</p>
              <p><strong>Contact:</strong> {`${selectedCustomer.first_name} ${selectedCustomer.last_name}`}</p>
              <p><strong>VAT/Tax ID:</strong> {selectedCustomer.vat_tax_id || '-'}</p>
            </div>
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsDeleteDialogOpen(false)}
              type="button"
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteCustomer}
              type="button"
              disabled={isProcessing}
            >
              {isProcessing ? 'Deleting...' : 'Delete Customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Details Panel */}
      <CustomerDetailsPanel
        customer={selectedCustomer}
        isOpen={isCustomerDetailsOpen}
        onClose={() => setIsCustomerDetailsOpen(false)}
        onEdit={handleEditClick}
      />
      </div>
    </PersistentDashboardLayout>
  )
}
