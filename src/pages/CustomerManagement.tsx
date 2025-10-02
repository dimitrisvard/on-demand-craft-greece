import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BackToDashboardButton } from "@/components/dashboard/BackToDashboardButton"
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout"
import { useToast } from "@/components/ui/use-toast"
import { supabase } from "@/integrations/supabase/client"
import { 
  AlertCircle, PencilIcon, PlusCircle, Search, Trash, 
  UserRound, Building2, Mail, Phone, MapPin, Building
} from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Customer, CustomerStatus } from "@/types/customer"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CustomerEditForm } from "@/components/customers/CustomerEditForm"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CustomerDetailsPanel } from "@/components/customers/CustomerDetailsPanel"

export default function CustomerManagement() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<CustomerStatus | "all">("all")
  const [formData, setFormData] = useState<Partial<Customer>>({
    company_name: "",
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    country: "",
    street_address: "",
    city: "",
    zip_code: "",
    vat_tax_id: "",
    position: "",
    status: "lead"
  })
  const { toast } = useToast()

  useEffect(() => {
    fetchCustomers()
  }, [activeTab, searchQuery])

  const generateCustomerId = () => {
    const prefix = "CUST";
    const timestamp = Date.now().toString().slice(-6); // Use last 6 digits of timestamp
    const randomDigits = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${timestamp}-${randomDigits}`;
  };

  async function fetchCustomers() {
    try {
      setLoading(true)
      console.log("Fetching customers with filter:", { activeTab, searchQuery })
      
      let query = supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })

      if (activeTab !== "all") {
        query = query.eq('status', activeTab)
      }

      if (searchQuery) {
        query = query.or(`company_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,vat_tax_id.ilike.%${searchQuery}%`)
      }

      const { data, error } = await query

      if (error) throw error

      console.log("Fetched customers:", data)

      // Ensure correct typing of the status field
      const typedCustomers = data?.map((customer: any) => ({
        ...customer,
        status: customer.status as CustomerStatus
      })) || []

      setCustomers(typedCustomers)
    } catch (error: any) {
      console.error("Error fetching customers:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to load customers",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddClick = () => {
    setFormData({
      company_name: "",
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      country: "",
      street_address: "",
      city: "",
      zip_code: "",
      vat_tax_id: "",
      position: "",
      status: "lead",
      customer_id: generateCustomerId()
    })
    setIsAddDialogOpen(true)
  }

  const handleRowClick = (customer: Customer) => {
    console.log("Row clicked, customer:", customer)
    setSelectedCustomer(customer)
  }

  const handleEditClick = (customer: Customer, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
    }
    setSelectedCustomer(customer)
    setFormData(customer)
    setIsEditDialogOpen(true)
  }

  const handleDeleteClick = (customer: Customer, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
    }
    setCustomerToDelete(customer)
    setIsDeleteDialogOpen(true)
  }

  const handleDeleteCustomer = async () => {
    if (!customerToDelete) return;
    
    try {
      // Check if the customer has any RFQs
      const { data: rfqs, error: rfqError } = await supabase
        .from('rfqs')
        .select('id')
        .eq('customer_id', customerToDelete.id);

      if (rfqError) {
        console.error("Error checking for RFQs:", rfqError);
        throw rfqError;
      }

      // If there are related RFQs, we need to delete them first
      if (rfqs && rfqs.length > 0) {
        console.log(`Found ${rfqs.length} related RFQs for customer ${customerToDelete.id}`);
        
        for (const rfq of rfqs) {
          // Delete the RFQ itself (parts_details will be deleted automatically)
          const { error: rfqDeleteError } = await supabase
            .from('rfqs')
            .delete()
            .eq('id', rfq.id);
            
          if (rfqDeleteError) {
            console.error(`Error deleting RFQ ${rfq.id}:`, rfqDeleteError);
            throw rfqDeleteError;
          }
        }
      }
      
      // Check if the customer has any orders
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id')
        .eq('customer_id', customerToDelete.id);

      if (ordersError) {
        console.error("Error checking for orders:", ordersError);
        throw ordersError;
      }

      // If there are related orders, we need to delete them first
      if (orders && orders.length > 0) {
        console.log(`Found ${orders.length} related orders for customer ${customerToDelete.id}`);
        
        for (const order of orders) {
          // 1. First delete related items
          const { error: itemsError } = await supabase
            .from('order_items')
            .delete()
            .eq('order_id', order.id);
            
          if (itemsError) {
            console.error(`Error deleting items for order ${order.id}:`, itemsError);
            throw itemsError;
          }
          
          // 2. Finally delete the order itself
          const { error: orderDeleteError } = await supabase
            .from('orders')
            .delete()
            .eq('id', order.id);
            
          if (orderDeleteError) {
            console.error(`Error deleting order ${order.id}:`, orderDeleteError);
            throw orderDeleteError;
          }
        }
      }

      // Finally delete the customer
      const { error: deleteError } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerToDelete.id);

      if (deleteError) throw deleteError;

      toast({
        title: "Success",
        description: "Customer deleted successfully",
      });

      setIsDeleteDialogOpen(false);
      setCustomerToDelete(null);
      fetchCustomers();
    } catch (error: any) {
      console.error("Error deleting customer:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete customer",
        variant: "destructive",
      });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleAddCustomer = async () => {
    try {
      if (!formData.company_name || !formData.email || !formData.first_name || !formData.last_name || !formData.vat_tax_id || !formData.street_address || !formData.city || !formData.zip_code) {
        toast({
          title: "Error",
          description: "Please fill in all required fields.",
          variant: "destructive",
        })
        return
      }

      const contact_name = `${formData.first_name} ${formData.last_name}`.trim()
      const customer_id = formData.customer_id || generateCustomerId()
      
      const { error } = await supabase
        .from('customers')
        .insert({
          company_name: formData.company_name,
          email: formData.email,
          first_name: formData.first_name,
          last_name: formData.last_name,
          contact_name: contact_name,
          phone: formData.phone || null,
          country: formData.country || null,
          street_address: formData.street_address || null,
          city: formData.city || null,
          zip_code: formData.zip_code || null,
          vat_tax_id: formData.vat_tax_id || null,
          position: formData.position || null,
          status: formData.status || 'lead',
          customer_id: customer_id
        })

      if (error) throw error

      toast({
        title: "Success",
        description: "Customer added successfully",
      })

      fetchCustomers()
      setIsAddDialogOpen(false)
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add customer",
        variant: "destructive",
      })
    }
  }

  const handleSaveChanges = async () => {
    if (!selectedCustomer) return

    try {
      const contact_name = `${formData.first_name} ${formData.last_name}`.trim()
      
      const { error } = await supabase
        .from('customers')
        .update({
          company_name: formData.company_name,
          email: formData.email,
          first_name: formData.first_name,
          last_name: formData.last_name,
          contact_name: contact_name,
          phone: formData.phone || null,
          country: formData.country || null,
          street_address: formData.street_address || null,
          city: formData.city || null,
          zip_code: formData.zip_code || null,
          vat_tax_id: formData.vat_tax_id || null,
          position: formData.position || null,
          status: formData.status
        })
        .eq('id', selectedCustomer.id)

      if (error) throw error

      toast({
        title: "Success",
        description: "Customer updated successfully",
      })

      fetchCustomers()
      setIsEditDialogOpen(false)
      
      // Update the selected customer
      if (selectedCustomer) {
        const updatedCustomer = { 
          ...selectedCustomer,
          ...formData,
          contact_name: contact_name
        } as Customer;
        setSelectedCustomer(updatedCustomer);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update customer",
        variant: "destructive",
      })
    }
  }

  const getStatusBadge = (status: CustomerStatus) => {
    const statusConfig = {
      lead: { className: "bg-blue-100 text-blue-800", label: "Lead" },
      prospect: { className: "bg-yellow-100 text-yellow-800", label: "Prospect" },
      active: { className: "bg-green-100 text-green-800", label: "Active" },
      inactive: { className: "bg-gray-100 text-gray-800", label: "Inactive" }
    }
    const config = statusConfig[status]
    return <Badge className={config.className}>{config.label}</Badge>
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
        >
          <PlusCircle className="h-5 w-5" />
          <span>New Customer</span>
        </Button>
      </div>

      <Card className="mb-6">
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 h-4 w-4" />
              <Input
                className="pl-10"
                placeholder="Search by company, contact, email, or VAT number"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div>
              <Tabs defaultValue={activeTab} className="w-full" onValueChange={(value) => setActiveTab(value as CustomerStatus | "all")}>
                <TabsList className="w-full grid grid-cols-5">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="lead">Leads</TabsTrigger>
                  <TabsTrigger value="prospect">Prospects</TabsTrigger>
                  <TabsTrigger value="active">Active</TabsTrigger>
                  <TabsTrigger value="inactive">Inactive</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-6">
        <Card className="w-3/5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">Loading...</TableCell>
                </TableRow>
              ) : customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <AlertCircle className="h-8 w-8 mb-2" />
                      <p>No customers found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((customer) => (
                  <TableRow 
                    key={customer.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(customer)}
                  >
                    <TableCell className="font-medium">{customer.company_name}</TableCell>
                    <TableCell>
                      <div>{customer.contact_name}</div>
                      <div className="text-sm text-muted-foreground">{customer.position || '-'}</div>
                    </TableCell>
                    <TableCell>{customer.email}</TableCell>
                    <TableCell>{customer.city || customer.country || '-'}</TableCell>
                    <TableCell>{getStatusBadge(customer.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={(e) => handleEditClick(customer, e)}
                        >
                          <PencilIcon className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-red-600 hover:text-red-800 hover:bg-red-100"
                          onClick={(e) => handleDeleteClick(customer, e)}
                        >
                          <Trash className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
        
        <CustomerDetailsPanel customer={selectedCustomer} />
      </div>

      {/* Add Customer Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>
              Enter details to add a new customer to the system
            </DialogDescription>
          </DialogHeader>
          
          <CustomerEditForm 
            customer={formData} 
            onChange={handleInputChange}
            mode="add"
          />
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCustomer}>
              Add Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>
              Make changes to customer information below
            </DialogDescription>
          </DialogHeader>
          
          <CustomerEditForm 
            customer={formData} 
            onChange={handleInputChange}
            mode="edit"
          />
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveChanges}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the customer
              {customerToDelete && (
                <span className="font-semibold"> {customerToDelete.company_name}</span>
              )} and remove their data from the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCustomer} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </PersistentDashboardLayout>
  )
}
