
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { BackToDashboardButton } from "@/components/dashboard/BackToDashboardButton"
import { useToast } from "@/components/ui/use-toast"
import { supabase } from "@/integrations/supabase/client"
import { PencilIcon, PlusCircle, ChevronLeft } from "lucide-react"
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

type Partner = {
  id: string
  company_name: string
  contact_name: string
  email: string
  phone: string | null
  specializations: string[]
  country: string | null
  active: boolean
  created_at: string
  partner_id: string
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newPartner, setNewPartner] = useState<Partial<Partner>>({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    country: "",
    specializations: [],
    active: true,
    password: ""
  })
  const { toast } = useToast()

  useEffect(() => {
    fetchPartners()
  }, [])

  async function fetchPartners() {
    try {
      const { data, error } = await supabase
        .from('production_partners')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      // Map to ensure each partner has a partner_id field
      const mappedPartners = data.map(partner => ({
        ...partner,
        partner_id: partner.id
      })) as Partner[];

      setPartners(mappedPartners);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load production partners",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddClick = () => {
    setIsAddDialogOpen(true);
  };

  const handleAddPartner = async () => {
    try {
      if (!newPartner.company_name || !newPartner.contact_name || !newPartner.email) {
        toast({
          title: "Error",
          description: "Company name, contact name, and email are required",
          variant: "destructive",
        });
        return;
      }

      if (!newPartner.password || newPartner.password.length < 6) {
        toast({
          title: "Error",
          description: "Password is required and must be at least 6 characters",
          variant: "destructive",
        });
        return;
      }

      // 1. Insert into production_partners first
      const { data, error } = await supabase
        .from('production_partners')
        .insert([
          {
            company_name: newPartner.company_name,
            contact_name: newPartner.contact_name,
            email: newPartner.email,
            phone: newPartner.phone,
            country: newPartner.country,
            specializations: newPartner.specializations,
            active: newPartner.active
          }
        ])
        .select();

      if (error) throw error;

      // 2. Create auth user using Edge Function
      if (data && data[0]) {
        const { createAuthUserForPartner } = await import('@/utils/partnerAuthUtils');
        const authSuccess = await createAuthUserForPartner(data[0].id, newPartner.password!);
        if (!authSuccess) {
          // If auth user creation fails, we should clean up the partner record
          await supabase.from('production_partners').delete().eq('id', data[0].id);
          throw new Error('Failed to create auth user for partner');
        }
      }

      toast({
        title: "Success",
        description: "Production partner added successfully with login credentials",
      });

      fetchPartners();
      setIsAddDialogOpen(false);
      setNewPartner({
        company_name: "",
        contact_name: "",
        email: "",
        phone: "",
        country: "",
        specializations: [],
        active: true,
        password: ""
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add production partner",
        variant: "destructive",
      });
    }
  };

  const handleEditClick = (partner: Partner) => {
    setSelectedPartner(partner);
    setIsEditDialogOpen(true);
  };

  const handleSaveChanges = async () => {
    if (selectedPartner) {
      try {
        const { error } = await supabase
          .from('production_partners')
          .update({
            company_name: selectedPartner.company_name,
            contact_name: selectedPartner.contact_name,
            email: selectedPartner.email,
            phone: selectedPartner.phone,
            specializations: selectedPartner.specializations,
            country: selectedPartner.country,
            active: selectedPartner.active
          })
          .eq('id', selectedPartner.id);

        if (error) throw error;

        toast({
          title: "Success",
          description: "Production partner updated successfully",
        });

        fetchPartners();
        setIsEditDialogOpen(false);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to update production partner",
          variant: "destructive",
        });
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (selectedPartner) {
      if (e.target.name === "active") {
        setSelectedPartner({
          ...selectedPartner,
          active: (e.target as HTMLSelectElement).value === "true"
        });
      } else if (e.target.name === "specializations") {
        setSelectedPartner({
          ...selectedPartner,
          specializations: (e.target as HTMLInputElement).value.split(',').map(s => s.trim())
        });
      } else {
        setSelectedPartner({
          ...selectedPartner,
          [e.target.name]: e.target.value
        });
      }
    }
  };

  const handleNewPartnerInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.target.name === "specializations") {
      setNewPartner({
        ...newPartner,
        specializations: (e.target as HTMLInputElement).value.split(',').map(s => s.trim())
      });
    } else if (e.target.name === "active") {
      setNewPartner({
        ...newPartner,
        active: (e.target as HTMLSelectElement).value === "true"
      });
    } else {
      setNewPartner({
        ...newPartner,
        [e.target.name]: e.target.value
      });
    }
  };

  return (
    <div className="p-6 pt-20 space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <BackToDashboardButton />
          <h1 className="text-2xl font-bold">Production Partners</h1>
        </div>
        <Button 
          onClick={handleAddClick} 
          variant="default" 
          size="default"
          className="flex items-center gap-2"
        >
          <PlusCircle className="h-5 w-5" />
          <span>New Partner</span>
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
              <TableHead>Specializations</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">Loading...</TableCell>
              </TableRow>
            ) : partners.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">No production partners found</TableCell>
              </TableRow>
            ) : (
              partners.map((partner) => (
                <TableRow key={partner.id}>
                  <TableCell className="font-medium">{partner.company_name}</TableCell>
                  <TableCell>{partner.contact_name}</TableCell>
                  <TableCell>{partner.email}</TableCell>
                  <TableCell>{partner.phone || '-'}</TableCell>
                  <TableCell>{partner.specializations?.join(', ') || '-'}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      partner.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {partner.active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleEditClick(partner)}
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
            <DialogTitle>Edit Production Partner</DialogTitle>
            <DialogDescription>
              Make changes to the production partner details below.
            </DialogDescription>
          </DialogHeader>
          {selectedPartner && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="company_name" className="text-right font-medium">
                  Company
                </label>
                <input
                  id="company_name"
                  name="company_name"
                  value={selectedPartner.company_name}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="contact_name" className="text-right font-medium">
                  Contact
                </label>
                <input
                  id="contact_name"
                  name="contact_name"
                  value={selectedPartner.contact_name}
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
                  value={selectedPartner.email}
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
                  value={selectedPartner.phone || ''}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="specializations" className="text-right font-medium">
                  Specializations
                </label>
                <input
                  id="specializations"
                  name="specializations"
                  value={selectedPartner.specializations?.join(', ') || ''}
                  onChange={handleInputChange}
                  placeholder="CNC, Sheet Metal, etc. (comma-separated)"
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
                  value={selectedPartner.country || ''}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="active" className="text-right font-medium">
                  Status
                </label>
                <select
                  id="active"
                  name="active"
                  value={selectedPartner.active.toString()}
                  onChange={handleInputChange}
                  className="col-span-3 p-2 border rounded"
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
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
            <DialogTitle className="text-xl">Add New Production Partner</DialogTitle>
            <DialogDescription>
              Enter the details for the new production partner.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Company Information Section */}
            <div>
              <h3 className="text-lg font-medium mb-3 border-b pb-2">Company Information</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label htmlFor="new_company_name" className="block text-sm font-medium mb-1">
                      Company Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="new_company_name"
                      name="company_name"
                      value={newPartner.company_name}
                      onChange={handleNewPartnerInputChange}
                      className="w-full p-2 border rounded"
                      required
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="new_specializations" className="block text-sm font-medium mb-1">
                        Specializations
                      </label>
                      <input
                        id="new_specializations"
                        name="specializations"
                        value={newPartner.specializations?.join(', ') || ''}
                        onChange={handleNewPartnerInputChange}
                        placeholder="CNC, Sheet Metal, etc. (comma-separated)"
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <div>
                      <label htmlFor="new_active" className="block text-sm font-medium mb-1">
                        Status
                      </label>
                      <select
                        id="new_active"
                        name="active"
                        value={newPartner.active?.toString()}
                        onChange={handleNewPartnerInputChange}
                        className="w-full p-2 border rounded"
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Contact Person Section */}
            <div>
              <h3 className="text-lg font-medium mb-3 border-b pb-2">Contact Person</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="new_contact_name" className="block text-sm font-medium mb-1">
                    Contact Person <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="new_contact_name"
                    name="contact_name"
                    value={newPartner.contact_name}
                    onChange={handleNewPartnerInputChange}
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
                      value={newPartner.email}
                      onChange={handleNewPartnerInputChange}
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
                      value={newPartner.phone || ''}
                      onChange={handleNewPartnerInputChange}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                </div>
                
                <div>
                  <label htmlFor="new_password" className="block text-sm font-medium mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="new_password"
                    name="password"
                    type="password"
                    value={newPartner.password || ''}
                    onChange={handleNewPartnerInputChange}
                    placeholder="Minimum 6 characters"
                    className="w-full p-2 border rounded"
                    required
                  />
                </div>
              </div>
            </div>
            
            {/* Address Section */}
            <div>
              <h3 className="text-lg font-medium mb-3 border-b pb-2">Location</h3>
              <div>
                <label htmlFor="new_country" className="block text-sm font-medium mb-1">
                  Country
                </label>
                <input
                  id="new_country"
                  name="country"
                  value={newPartner.country || ''}
                  onChange={handleNewPartnerInputChange}
                  className="w-full p-2 border rounded"
                />
              </div>
            </div>
          </div>
                    
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPartner} className="bg-primary hover:bg-primary/90">Add Partner</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
