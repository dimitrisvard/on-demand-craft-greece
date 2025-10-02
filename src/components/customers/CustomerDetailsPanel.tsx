
import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Customer } from "@/types/customer";
import { format } from "date-fns";
import { 
  Building,
  Mail,
  Phone,
  MapPin,
  Calendar,
  FileText,
  User,
  Briefcase
} from "lucide-react";
import { CustomerRFQsList } from "./CustomerRFQsList";
import { CustomerOrdersList } from "./CustomerOrdersList";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CustomerDetailsPanelProps {
  customer: Customer | null;
}

export const CustomerDetailsPanel = ({ customer }: CustomerDetailsPanelProps) => {
  const [isRFQsListOpen, setIsRFQsListOpen] = useState(false);
  const [isOrdersListOpen, setIsOrdersListOpen] = useState(false);

  const getStatusColor = (status: string | undefined) => {
    if (!status) return "bg-gray-100 text-gray-800";
    
    switch (status) {
      case "lead":
        return "bg-blue-100 text-blue-800";
      case "prospect":
        return "bg-yellow-100 text-yellow-800";
      case "active":
        return "bg-green-100 text-green-800";
      case "inactive":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getFormattedDate = (dateString: string | undefined) => {
    if (!dateString) return "N/A";
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch (e) {
      return "Invalid date";
    }
  };

  if (!customer) {
    return (
      <Card className="w-2/5 p-6 flex flex-col items-center justify-center text-muted-foreground h-[400px]">
        <User className="h-16 w-16 mb-4 opacity-20" />
        <p className="text-lg">Select a customer to view details</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-2/5 p-6">
        <div className="space-y-6">
          <div>
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-xl font-semibold">{customer.company_name}</h3>
              <Badge className={getStatusColor(customer.status)}>
                {customer.status?.charAt(0).toUpperCase() + customer.status?.slice(1)}
              </Badge>
            </div>
            
            <div className="text-sm text-muted-foreground mb-4">
              {customer.customer_id && (
                <p className="font-mono">ID: {customer.customer_id}</p>
              )}
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center gap-2">
                <Building className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">Company</span>
              </div>
              
              <div className="grid grid-cols-1 gap-2 ml-6">
                <div>
                  <span className="text-sm font-medium block">VAT/Tax ID</span>
                  <span className="text-sm">{customer.vat_tax_id || "—"}</span>
                </div>
                
                <div>
                  <span className="text-sm font-medium block">Address</span>
                  <span className="text-sm">
                    {customer.street_address ? (
                      <>
                        {customer.street_address}
                        {customer.city && customer.zip_code 
                          ? `, ${customer.city}, ${customer.zip_code}` 
                          : customer.city 
                            ? `, ${customer.city}` 
                            : customer.zip_code 
                              ? `, ${customer.zip_code}` 
                              : ''}
                        {customer.country ? `, ${customer.country}` : ''}
                      </>
                    ) : customer.address || "—"}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">Contact Person</span>
              </div>
              
              <div className="grid grid-cols-1 gap-2 ml-6">
                <div>
                  <span className="text-sm font-medium block">Name</span>
                  <span className="text-sm">
                    {customer.first_name && customer.last_name 
                      ? `${customer.first_name} ${customer.last_name}`
                      : customer.contact_name || "—"}
                  </span>
                </div>
                
                {customer.position && (
                  <div>
                    <span className="text-sm font-medium block">Position</span>
                    <span className="text-sm">{customer.position}</span>
                  </div>
                )}
                
                <div className="flex items-center gap-2 mt-1">
                  <Mail className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">{customer.email || "—"}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">{customer.phone || "—"}</span>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">Dates</span>
              </div>
              
              <div className="grid grid-cols-1 gap-2 ml-6">
                <div>
                  <span className="text-sm font-medium block">Created</span>
                  <span className="text-sm">{getFormattedDate(customer.created_at)}</span>
                </div>
                
                <div>
                  <span className="text-sm font-medium block">Last Updated</span>
                  <span className="text-sm">{getFormattedDate(customer.updated_at)}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="pt-4 border-t mt-4">
            <Tabs defaultValue="rfqs" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="rfqs" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  RFQs
                </TabsTrigger>
                <TabsTrigger value="orders" className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  Orders
                </TabsTrigger>
              </TabsList>
              <TabsContent value="rfqs" className="mt-4">
                <Button 
                  variant="outline" 
                  className="w-full flex items-center gap-2"
                  onClick={() => setIsRFQsListOpen(true)}
                >
                  <FileText className="h-4 w-4" />
                  View Customer RFQs
                </Button>
              </TabsContent>
              <TabsContent value="orders" className="mt-4">
                <Button 
                  variant="outline" 
                  className="w-full flex items-center gap-2"
                  onClick={() => setIsOrdersListOpen(true)}
                >
                  <Briefcase className="h-4 w-4" />
                  View Customer Orders
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </Card>

      {/* RFQs List Dialog */}
      <CustomerRFQsList 
        customerId={customer.id}
        isOpen={isRFQsListOpen}
        onClose={() => setIsRFQsListOpen(false)}
      />

      {/* Orders List Dialog */}
      <CustomerOrdersList 
        customerId={customer.id}
        isOpen={isOrdersListOpen}
        onClose={() => setIsOrdersListOpen(false)}
      />
    </>
  );
};
