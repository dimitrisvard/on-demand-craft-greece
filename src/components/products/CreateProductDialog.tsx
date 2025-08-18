
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface CreateProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onProductCreated: () => void;
}

export function CreateProductDialog({ isOpen, onClose, onProductCreated }: CreateProductDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = React.useState({
    sku: '',
    name: '',
    unit_price: '',
  });
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.sku || !formData.name || !formData.unit_price) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      console.log("Submitting product data:", formData);
      
      const { data, error } = await supabase
        .from('products')
        .insert([{
          sku: formData.sku,
          name: formData.name,
          unit_price: parseFloat(formData.unit_price),
        }])
        .select();

      if (error) {
        console.error("Error creating product:", error);
        throw error;
      }

      console.log("Product created successfully:", data);
      
      toast({
        title: "Success",
        description: "Product created successfully",
      });
      
      onProductCreated();
      onClose();
      setFormData({ sku: '', name: '', unit_price: '' });
    } catch (error: any) {
      console.error("Error in product creation:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create product",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Product</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="sku">Part ID (SKU)</Label>
            <Input
              id="sku"
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              placeholder="Enter SKU"
              required
            />
          </div>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Enter product name"
              required
            />
          </div>
          <div>
            <Label htmlFor="unit_price">Price (USD)</Label>
            <Input
              id="unit_price"
              type="number"
              step="0.01"
              min="0"
              value={formData.unit_price}
              onChange={(e) => setFormData({ ...formData, unit_price: e.target.value })}
              placeholder="Enter price"
              required
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
