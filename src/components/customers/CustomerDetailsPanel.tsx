import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  Briefcase,
  X,
  Edit
} from "lucide-react";
import { CustomerRFQsList } from "./CustomerRFQsList";
import { CustomerOrdersList } from "./CustomerOrdersList";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CustomerDetailsPanelProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (customer: Customer) => void;
}

export const CustomerDetailsPanel = ({ customer, isOpen, onClose, onEdit }: CustomerDetailsPanelProps) => {
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
    } catch {
      return "Invalid Date";
    }
  };

  if (!customer) {
    return null;
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto w-[95vw]">
          <DialogHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                <Building className="h-6 w-6 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-2xl">{customer.company_name}</DialogTitle>
                <Badge className={getStatusColor(customer.status)}>
                  {customer.status?.charAt(0).toUpperCase() + customer.status?.slice(1)}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(customer)}
                  className="flex items-center gap-2"
                >
                  <Edit className="h-4 w-4" />
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Professional Tabs */}
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="details" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Details
                </TabsTrigger>
                <TabsTrigger value="rfqs" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  RFQs
                </TabsTrigger>
                <TabsTrigger value="orders" className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  Orders
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Contact Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        Contact Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center space-x-3">
                        <User className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium">
                            {customer.first_name} {customer.last_name}
                          </p>
                          <p className="text-xs text-gray-500">{customer.position || "Position not specified"}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Mail className="h-4 w-4 text-gray-500" />
                        <p className="text-sm">{customer.email}</p>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Phone className="h-4 w-4 text-gray-500" />
                        <p className="text-sm">{customer.phone || "Phone not provided"}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Company Information */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Building className="h-5 w-5" />
                        Company Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center space-x-3">
                        <Building className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium">VAT/Tax ID</p>
                          <p className="text-sm text-gray-600">{customer.vat_tax_id || "Not provided"}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <MapPin className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium">Address</p>
                          <p className="text-sm text-gray-600">
                            {customer.street_address ? (
                              <>
                                {customer.street_address}<br />
                                {customer.city}, {customer.zip_code}<br />
                                {customer.country}
                              </>
                            ) : (
                              "Address not provided"
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium">Created</p>
                          <p className="text-sm text-gray-600">{getFormattedDate(customer.created_at)}</p>
                        </div>
                      </div>

                      {customer.updated_at && customer.updated_at !== customer.created_at && (
                        <div className="flex items-center space-x-3">
                          <Calendar className="h-4 w-4 text-gray-500" />
                          <div>
                            <p className="text-sm font-medium">Last Updated</p>
                            <p className="text-sm text-gray-600">{getFormattedDate(customer.updated_at)}</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="rfqs" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Customer RFQs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CustomerRFQsList
                      customerId={customer.id}
                      isOpen={true}
                      onClose={() => {}}
                      embedded={true}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="orders" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Briefcase className="h-5 w-5" />
                      Customer Orders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CustomerOrdersList
                      customerId={customer.id}
                      isOpen={true}
                      onClose={() => {}}
                      embedded={true}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
};