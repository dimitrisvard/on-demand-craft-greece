
import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Package, PlusCircle, Search, Edit, Trash2, AlertCircle } from "lucide-react";

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  unit_price: number;
  stock_quantity: number;
  min_stock_level: number;
  status: string;
  category: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: "",
    description: "",
    sku: "",
    unit_price: 0,
    stock_quantity: 0,
    min_stock_level: 0,
    status: "active",
    category: "",
    currency: "USD"
  });
  
  const { toast } = useToast();

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load products",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    let parsedValue: any = value;
    
    // Parse numeric values
    if (name === "unit_price" || name === "stock_quantity" || name === "min_stock_level") {
      parsedValue = parseFloat(value) || 0;
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: parsedValue
    }));
  };

  const handleAddProduct = async () => {
    try {
      if (!formData.name) {
        toast({
          title: "Error",
          description: "Product name is required",
          variant: "destructive"
        });
        return;
      }

      const { error } = await supabase
        .from('products')
        .insert([{
          name: formData.name,
          description: formData.description || null,
          sku: formData.sku || null,
          unit_price: formData.unit_price || 0,
          stock_quantity: formData.stock_quantity || 0,
          min_stock_level: formData.min_stock_level || 0,
          status: formData.status || "active",
          category: formData.category || null,
          currency: formData.currency || "USD"
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Product added successfully",
      });

      fetchProducts();
      setIsAddDialogOpen(false);
      setFormData({
        name: "",
        description: "",
        sku: "",
        unit_price: 0,
        stock_quantity: 0,
        min_stock_level: 0,
        status: "active",
        category: "",
        currency: "USD"
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add product",
        variant: "destructive",
      });
    }
  };

  const handleEditProduct = async () => {
    try {
      if (!selectedProduct || !formData.name) {
        toast({
          title: "Error",
          description: "Product name is required",
          variant: "destructive"
        });
        return;
      }

      const { error } = await supabase
        .from('products')
        .update({
          name: formData.name,
          description: formData.description || null,
          sku: formData.sku || null,
          unit_price: formData.unit_price || 0,
          stock_quantity: formData.stock_quantity || 0,
          min_stock_level: formData.min_stock_level || 0,
          status: formData.status || "active",
          category: formData.category || null,
          currency: formData.currency || "USD",
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedProduct.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Product updated successfully",
      });

      fetchProducts();
      setIsEditDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update product",
        variant: "destructive",
      });
    }
  };

  const handleDeleteProduct = async () => {
    try {
      if (!selectedProduct) return;

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', selectedProduct.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Product deleted successfully",
      });

      fetchProducts();
      setIsDeleteDialogOpen(false);
      setSelectedProduct(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete product",
        variant: "destructive",
      });
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = searchTerm === "" || 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.description && product.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (product.sku && product.sku.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCategory = filterCategory === "" || 
      (product.category && product.category.toLowerCase() === filterCategory.toLowerCase());
    
    return matchesSearch && matchesCategory;
  });

  // Get unique categories for filtering
  const categories = [...new Set(products.filter(p => p.category).map(p => p.category))];

  return (
    <div className="container mx-auto px-4 py-8 pt-16">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-2">
          <Package className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Products & Inventory</h1>
        </div>
        <Button 
          onClick={() => setIsAddDialogOpen(true)}
          className="flex items-center gap-2"
        >
          <PlusCircle className="h-5 w-5" />
          <span>Add Product</span>
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle>Search Products</CardTitle>
          <CardDescription>Find products by name, SKU, or description</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 h-4 w-4" />
                <Input
                  id="search"
                  className="pl-9"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="category">Filter by Category</Label>
              <select
                id="category"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map((category, index) => (
                  <option key={index} value={category as string}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product Inventory</CardTitle>
          <CardDescription>
            {filteredProducts.length} products found
            {filterCategory && ` in category '${filterCategory}'`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading products...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-10 flex flex-col items-center text-muted-foreground">
              <AlertCircle className="h-12 w-12 mb-2" />
              <p className="mb-2">No products found</p>
              <p className="text-sm">Try adjusting your search or add a new product</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.sku || '-'}</TableCell>
                    <TableCell>{product.category || '-'}</TableCell>
                    <TableCell>{`${product.currency} ${product.unit_price.toFixed(2)}`}</TableCell>
                    <TableCell>
                      <div className="flex items-center">
                        <span className={product.stock_quantity <= product.min_stock_level ? "text-red-600" : ""}>
                          {product.stock_quantity}
                        </span>
                        {product.stock_quantity <= product.min_stock_level && (
                          <Badge variant="destructive" className="ml-2 text-xs">Low</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={product.status === "active" ? "default" : "outline"}>
                        {product.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setSelectedProduct(product);
                            setFormData(product);
                            setIsEditDialogOpen(true);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-red-600 hover:text-red-800 hover:bg-red-100"
                          onClick={() => {
                            setSelectedProduct(product);
                            setIsDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Product Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
            <DialogDescription>
              Enter the details for the new product
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Product Name *</Label>
                <Input
                  id="name"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  name="sku"
                  value={formData.sku || ''}
                  onChange={handleInputChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  name="category"
                  value={formData.category || ''}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                name="description"
                className="flex h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={formData.description || ''}
                onChange={handleInputChange}
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="unit_price">Price *</Label>
                <div className="flex">
                  <select
                    id="currency"
                    name="currency"
                    className="rounded-l-md border border-r-0 border-input bg-background px-2 py-2 text-sm"
                    value={formData.currency || 'USD'}
                    onChange={handleInputChange}
                  >
                    <option value="USD">$</option>
                    <option value="EUR">€</option>
                    <option value="GBP">£</option>
                  </select>
                  <Input
                    id="unit_price"
                    name="unit_price"
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded-l-none"
                    value={formData.unit_price || 0}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock_quantity">Stock *</Label>
                <Input
                  id="stock_quantity"
                  name="stock_quantity"
                  type="number"
                  min="0"
                  value={formData.stock_quantity || 0}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="min_stock_level">Min Stock Level</Label>
                <Input
                  id="min_stock_level"
                  name="min_stock_level"
                  type="number"
                  min="0"
                  value={formData.min_stock_level || 0}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={formData.status || 'active'}
                onChange={handleInputChange}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddProduct}>
              Add Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>
              Update product information
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_name">Product Name *</Label>
                <Input
                  id="edit_name"
                  name="name"
                  value={formData.name || ''}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_sku">SKU</Label>
                <Input
                  id="edit_sku"
                  name="sku"
                  value={formData.sku || ''}
                  onChange={handleInputChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_category">Category</Label>
                <Input
                  id="edit_category"
                  name="category"
                  value={formData.category || ''}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit_description">Description</Label>
              <textarea
                id="edit_description"
                name="description"
                className="flex h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={formData.description || ''}
                onChange={handleInputChange}
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_unit_price">Price *</Label>
                <div className="flex">
                  <select
                    id="edit_currency"
                    name="currency"
                    className="rounded-l-md border border-r-0 border-input bg-background px-2 py-2 text-sm"
                    value={formData.currency || 'USD'}
                    onChange={handleInputChange}
                  >
                    <option value="USD">$</option>
                    <option value="EUR">€</option>
                    <option value="GBP">£</option>
                  </select>
                  <Input
                    id="edit_unit_price"
                    name="unit_price"
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded-l-none"
                    value={formData.unit_price || 0}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_stock_quantity">Stock *</Label>
                <Input
                  id="edit_stock_quantity"
                  name="stock_quantity"
                  type="number"
                  min="0"
                  value={formData.stock_quantity || 0}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_min_stock_level">Min Stock Level</Label>
                <Input
                  id="edit_min_stock_level"
                  name="min_stock_level"
                  type="number"
                  min="0"
                  value={formData.min_stock_level || 0}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit_status">Status</Label>
              <select
                id="edit_status"
                name="status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={formData.status || 'active'}
                onChange={handleInputChange}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditProduct}>
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
              This action cannot be undone. This will permanently delete the product
              {selectedProduct && (
                <span className="font-semibold"> "{selectedProduct.name}"</span>
              )} from your inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProduct} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
