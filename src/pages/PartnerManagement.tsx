import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Factory,
  Edit,
  Star,
  Plus,
  Phone,
  Mail,
  MapPin,
  Check,
  X,
  Trash2,
  CreditCard,
  PackageOpen
} from "lucide-react";
import { Partner, PartnerRating } from "@/types/customer";
import { createAuthUserForPartner } from "@/utils/partnerAuthUtils";

const ADMIN_PASSWORD_UPDATE_ENDPOINT = '/functions/v1/admin-update-partner-password';
const ADMIN_PASSWORD_UPDATE_SECRET = import.meta.env.VITE_ADMIN_PASSWORD_UPDATE_SECRET;

export default function PartnerManagement() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [ratings, setRatings] = useState<PartnerRating[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isRatingDialogOpen, setIsRatingDialogOpen] = useState(false);
  const [newRating, setNewRating] = useState<Partial<PartnerRating>>({ score: 5, comment: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSpecialization, setFilterSpecialization] = useState("");
  const [partnerOrders, setPartnerOrders] = useState<any[]>([]);
  const [formData, setFormData] = useState<Partial<Partner>>({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    country: "",
    specializations: [],
    active: true,
    password: ""
  });

  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchPartners();
  }, []);


  async function fetchPartners() {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('production_partners')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPartners(data as Partner[]);
      setIsLoading(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load production partners",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  }

  async function fetchPartnerRatings(partnerId: string) {
    try {
      const { data, error } = await supabase
        .from('partner_ratings')
        .select('*')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRatings(data as PartnerRating[]);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load partner ratings",
        variant: "destructive",
      });
    }
  }

  async function fetchPartnerOrders(partnerId: string) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(company_name)')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPartnerOrders(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load partner orders",
        variant: "destructive",
      });
    }
  }

  async function handlePartnerSelect(partner: Partner) {
    setSelectedPartner(partner);
    setFormData({ ...partner });
    await fetchPartnerRatings(partner.id);
    await fetchPartnerOrders(partner.id);
    setIsDialogOpen(true);
  }

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    
    setFormData(prev => {
      // Special case for specializations (comma-separated string)
      if (name === "specializations" && typeof value === "string") {
        return {
          ...prev,
          specializations: value.split(",").map(item => item.trim()).filter(Boolean)
        };
      }
      
      // Special case for active status
      if (name === "active") {
        return {
          ...prev,
          active: value === "true"
        };
      }
      
      return {
        ...prev,
        [name]: value
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!selectedPartner) return;

      // 1. Update partner info in production_partners
      const { error } = await supabase
        .from('production_partners')
        .update({
          company_name: formData.company_name,
          contact_name: formData.contact_name,
          email: formData.email,
          phone: formData.phone,
          country: formData.country,
          specializations: formData.specializations,
          active: formData.active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedPartner.id);

      if (error) throw error;

      // 2. Update password if provided
      if (formData.password && formData.password.length >= 6) {
        // Find the auth user by email
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
        if (authError) throw authError;

        const authUser = authUsers.users.find(user => user.email === formData.email);
        if (authUser) {
          const { error: passwordError } = await supabase.auth.admin.updateUserById(authUser.id, {
            password: formData.password
          });
          if (passwordError) {
            console.error('Error updating password:', passwordError);
            // Don't throw here as the partner info was updated successfully
          }
        }
      }

      toast({
        title: "Success",
        description: "Partner updated successfully",
      });

      fetchPartners();
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update partner",
        variant: "destructive",
      });
    }
  }

  async function handleCreatePartner(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!formData.company_name || !formData.contact_name || !formData.email) {
        toast({
          title: "Error",
          description: "Company name, contact name, and email are required",
          variant: "destructive",
        });
        return;
      }

      if (!formData.password || formData.password.length < 6) {
        toast({
          title: "Error",
          description: "Password is required and must be at least 6 characters",
          variant: "destructive",
        });
        return;
      }

      // 1. Create auth user first
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: formData.email,
        password: formData.password,
        email_confirm: true,
        user_metadata: {
          first_name: formData.contact_name,
          company_name: formData.company_name
        }
      });

      if (authError) throw authError;

      // 2. Insert into production_partners
      const { data, error } = await supabase
        .from('production_partners')
        .insert([{
          company_name: formData.company_name,
          contact_name: formData.contact_name,
          email: formData.email,
          phone: formData.phone || null,
          country: formData.country || null,
          specializations: formData.specializations || [],
          active: formData.active !== undefined ? formData.active : true
        }])
        .select();

      if (error) throw error;

      // 3. Create user role entry
      if (authData.user) {
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert([{
            user_id: authData.user.id,
            role: 'partner_seller'
          }]);

        if (roleError) {
          console.error('Error creating user role:', roleError);
          // Don't throw here as the partner was created successfully
        }
      }

      toast({
        title: "Success",
        description: "Partner created successfully with login credentials",
      });

      fetchPartners();
      setIsAddDialogOpen(false);
      setFormData({
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
        description: error.message || "Failed to create partner",
        variant: "destructive",
      });
    }
  }

  async function addRating() {
    try {
      if (!selectedPartner) return;
      if (!newRating.comment) {
        toast({
          title: "Error",
          description: "Please provide a comment for the rating",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase
        .from('partner_ratings')
        .insert([{
          partner_id: selectedPartner.id,
          score: newRating.score,
          comment: newRating.comment,
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Rating added successfully",
      });

      fetchPartnerRatings(selectedPartner.id);
      setIsRatingDialogOpen(false);
      setNewRating({ score: 5, comment: "" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add rating",
        variant: "destructive",
      });
    }
  }

  async function createAuthUserForExistingPartner() {
    if (!selectedPartner || !formData.password) {
      toast({
        title: "Error",
        description: "Please enter a password for the partner",
        variant: "destructive",
      });
      return;
    }

    try {
      const success = await createAuthUserForPartner(selectedPartner.id, formData.password);
      
      if (success) {
        toast({
          title: "Success",
          description: "Auth user created successfully for partner",
        });
        setFormData({ ...formData, password: "" });
      } else {
        toast({
          title: "Error",
          description: "Failed to create auth user for partner",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create auth user for partner",
        variant: "destructive",
      });
    }
  }

  const viewOrderDetails = (orderId: string) => {
    navigate(`/orders/${orderId}`);
  };

  const filteredPartners = partners.filter(partner => {
    // Apply search filter
    const matchesSearch = searchTerm === "" || 
      partner.company_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      partner.contact_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      partner.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Apply specialization filter
    const matchesSpecialization = filterSpecialization === "" || 
      (partner.specializations && partner.specializations.some(spec => 
        spec.toLowerCase().includes(filterSpecialization.toLowerCase())
      ));
    
    return matchesSearch && matchesSpecialization;
  });

  const averageRating = (ratings.length > 0) 
    ? (ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length).toFixed(1)
    : "No ratings";

  return (
    <div className="container mx-auto px-4 py-8 pt-16">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-2">
          <Factory className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Production Partners</h1>
        </div>
        <Button onClick={() => {
          setFormData({
            company_name: "",
            contact_name: "",
            email: "",
            phone: "",
            country: "",
            specializations: [],
            active: true
          });
          setIsAddDialogOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" />
          Add New Partner
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle>Partner Search</CardTitle>
          <CardDescription>Find production partners by name, contact, or specialization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="search">Search</Label>
              <Input 
                id="search" 
                placeholder="Search by name, contact or email" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="specialization">Filter by Specialization</Label>
              <Input 
                id="specialization" 
                placeholder="e.g. CNC, Sheet Metal" 
                value={filterSpecialization}
                onChange={(e) => setFilterSpecialization(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={() => {
            setSearchTerm("");
            setFilterSpecialization("");
          }}>
            Clear Filters
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Partner List</CardTitle>
          <CardDescription>
            {filteredPartners.length} partners found
            {filterSpecialization && ` with '${filterSpecialization}' specialization`}
            {searchTerm && ` matching '${searchTerm}'`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading partners data...</div>
          ) : filteredPartners.length === 0 ? (
            <div className="text-center py-8">No partners found. Try adjusting your filters.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Specializations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPartners.map((partner) => (
                  <TableRow key={partner.id} className={!partner.active ? "opacity-60" : ""}>
                    <TableCell className="font-medium">{partner.company_name}</TableCell>
                    <TableCell>
                      <div>{partner.contact_name}</div>
                      <div className="text-sm text-muted-foreground">{partner.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {partner.specializations && partner.specializations.map((spec, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {spec}
                          </Badge>
                        ))}
                        {!partner.specializations || partner.specializations.length === 0 && (
                          <span className="text-muted-foreground text-sm">None specified</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {partner.active ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handlePartnerSelect(partner)}
                      >
                        <Edit className="h-4 w-4 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* View/Edit Partner Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5" />
              {selectedPartner?.company_name || "Partner Details"}
            </DialogTitle>
            <DialogDescription>
              View and update partner information
            </DialogDescription>
          </DialogHeader>

          {selectedPartner && (
            <Tabs defaultValue="details">
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="details">Partner Details</TabsTrigger>
                <TabsTrigger value="orders">Orders</TabsTrigger>
              </TabsList>
              
              <TabsContent value="details">
                <form onSubmit={handleSubmit}>
                  <div className="space-y-4 mb-4">
                  
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="company_name">Company Name</Label>
                        <Input
                          id="company_name"
                          name="company_name"
                          value={formData.company_name || ""}
                          onChange={handleFormChange}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="active">Status</Label>
                        <Select 
                          name="active" 
                          value={formData.active ? "true" : "false"}
                          onValueChange={(value) => handleFormChange({
                            target: { name: "active", value }
                          } as any)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Active</SelectItem>
                            <SelectItem value="false">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="contact_name">Contact Person</Label>
                      <Input
                        id="contact_name"
                        name="contact_name"
                        value={formData.contact_name || ""}
                        onChange={handleFormChange}
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          value={formData.email || ""}
                          onChange={handleFormChange}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone Number</Label>
                        <Input
                          id="phone"
                          name="phone"
                          value={formData.phone || ""}
                          onChange={handleFormChange}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">Password (leave blank to keep current)</Label>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        value={formData.password || ""}
                        onChange={handleFormChange}
                        placeholder="Enter new password (minimum 6 characters)"
                      />
                      <Button 
                        type="button"
                        variant="outline" 
                        size="sm"
                        onClick={createAuthUserForExistingPartner}
                        className="mt-2"
                      >
                        Create Auth User for Existing Partner
                      </Button>
                    </div>


                    <div className="space-y-2">
                      <Label htmlFor="country">Country</Label>
                      <Input
                        id="country"
                        name="country"
                        value={formData.country || ""}
                        onChange={handleFormChange}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="specializations">Specializations (comma-separated)</Label>
                      <Input
                        id="specializations"
                        name="specializations"
                        placeholder="CNC, Sheet Metal, Laser Cutting, etc."
                        value={formData.specializations?.join(", ") || ""}
                        onChange={handleFormChange}
                      />
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" type="button" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">Save Changes</Button>
                  </DialogFooter>
                </form>
              </TabsContent>
              
              <TabsContent value="orders">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium">Orders Assigned to Partner</h3>
                  </div>

                  {partnerOrders.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <PackageOpen className="mx-auto h-12 w-12 mb-2 opacity-50" />
                      <p>No orders assigned to this partner yet</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order ID</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {partnerOrders.map((order) => (
                          <TableRow key={order.id}>
                            <TableCell>{order.id.slice(0, 8)}</TableCell>
                            <TableCell>{order.title}</TableCell>
                            <TableCell>{order.customers?.company_name || "-"}</TableCell>
                            <TableCell>
                              <Badge variant={
                                order.status === "completed" ? "default" : 
                                order.status === "in_progress" ? "secondary" :
                                "outline"
                              }>
                                {order.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {order.total_amount ? 
                                `${order.currency || 'USD'} ${Number(order.total_amount).toFixed(2)}` : 
                                '-'}
                            </TableCell>
                            <TableCell>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => viewOrderDetails(order.id)}
                              >
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Partner Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5" />
              Add New Partner
            </DialogTitle>
            <DialogDescription>
              Enter details to add a new production partner
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreatePartner}>
            <div className="space-y-4 mb-4">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new_company_name">Company Name *</Label>
                  <Input
                    id="new_company_name"
                    name="company_name"
                    value={formData.company_name || ""}
                    onChange={handleFormChange}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_active">Status</Label>
                  <Select 
                    name="active" 
                    value={formData.active ? "true" : "false"}
                    onValueChange={(value) => handleFormChange({
                      target: { name: "active", value }
                    } as any)}
                  >
                    <SelectTrigger id="new_active">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new_contact_name">Contact Person *</Label>
                <Input
                  id="new_contact_name"
                  name="contact_name"
                  value={formData.contact_name || ""}
                  onChange={handleFormChange}
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new_email">Email *</Label>
                  <Input
                    id="new_email"
                    name="email"
                    type="email"
                    value={formData.email || ""}
                    onChange={handleFormChange}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_phone">Phone Number</Label>
                  <Input
                    id="new_phone"
                    name="phone"
                    value={formData.phone || ""}
                    onChange={handleFormChange}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new_password">Password *</Label>
                <Input
                  id="new_password"
                  name="password"
                  type="password"
                  value={formData.password || ""}
                  onChange={handleFormChange}
                  placeholder="Minimum 6 characters"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new_country">Country</Label>
                <Input
                  id="new_country"
                  name="country"
                  value={formData.country || ""}
                  onChange={handleFormChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new_specializations">Specializations (comma-separated)</Label>
                <Input
                  id="new_specializations"
                  name="specializations"
                  placeholder="CNC, Sheet Metal, Laser Cutting, etc."
                  value={formData.specializations?.join(", ") || ""}
                  onChange={handleFormChange}
                />
              </div>

            </div>

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Partner</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
