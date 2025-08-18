
import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Package, Search, Filter, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import { BackToDashboardButton } from '@/components/dashboard/BackToDashboardButton';

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  unit_price: number;
  currency: string;
  stock_quantity: number;
  min_stock_level: number;
  category: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const ProductsPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    description: '',
    sku: '',
    unit_price: 0,
    currency: 'USD',
    stock_quantity: 0,
    min_stock_level: 0,
    category: '',
    status: 'active'
  });

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
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
      setIsLoading(false);
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
          currency: formData.currency || 'USD',
          stock_quantity: formData.stock_quantity || 0,
          min_stock_level: formData.min_stock_level || 0,
          status: formData.status || 'active',
          category: formData.category || null,
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Product added successfully",
      });

      fetchProducts();
      setIsAddDialogOpen(false);
      resetForm();
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
          currency: formData.currency || 'USD',
          stock_quantity: formData.stock_quantity || 0,
          min_stock_level: formData.min_stock_level || 0,
          status: formData.status || 'active',
          category: formData.category || null,
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

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      sku: '',
      unit_price: 0,
      currency: 'USD',
      stock_quantity: 0,
      min_stock_level: 0,
      category: '',
      status: 'active'
    });
  };

  const openEditDialog = (product: Product) => {
    setSelectedProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      sku: product.sku || '',
      unit_price: product.unit_price,
      currency: product.currency,
      stock_quantity: product.stock_quantity,
      min_stock_level: product.min_stock_level,
      category: product.category || '',
      status: product.status
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (product: Product) => {
    setSelectedProduct(product);
    setIsDeleteDialogOpen(true);
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = searchTerm === "" || 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.description && product.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (product.sku && product.sku.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCategory = categoryFilter === "" || 
      (product.category && product.category.toLowerCase() === categoryFilter.toLowerCase());
    
    return matchesSearch && matchesCategory;
  });

  // Get unique categories for filtering
  const categories = [...new Set(products.filter(p => p.category).map(p => p.category))];

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount);
  };

  return (
    <div className="container mx-auto p-6 pt-16 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <BackToDashboardButton />
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            Products & Inventory
          </h1>
        </div>
        <Button 
          onClick={() => {
            resetForm();
            setIsAddDialogOpen(true);
          }}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add New Product
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Search & Filter</CardTitle>
          <CardDescription>Find products by name, SKU, or category</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 h-4 w-4" />
              <Input
                placeholder="Search products..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map((category) => (
                  <option key={category} value={category || ''}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => {
                setSearchTerm("");
                setCategoryFilter("");
              }}>
                Reset Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory ({filteredProducts.length} products)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading products...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-10">
              <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <p className="text-xl font-medium text-gray-500">No products found</p>
              <p className="text-gray-500 mt-2">Try adjusting your search or add a new product.</p>
              <Button 
                onClick={() => {
                  resetForm();
                  setIsAddDialogOpen(true);
                }}
                className="mt-4"
              >
                Add Product
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
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
                      <TableCell>
                        <div>
                          <div className="font-medium">{product.name}</div>
                          {product.description && (
                            <div className="text-sm text-gray-500 truncate max-w-[250px]">
                              {product.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{product.sku || '-'}</TableCell>
                      <TableCell>{product.category || '-'}</TableCell>
                      <TableCell>{formatCurrency(product.unit_price, product.currency)}</TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          <span className={product.stock_quantity <= product.min_stock_level ? "text-red-600 font-medium" : ""}>
                            {product.stock_quantity}
                          </span>
                          {product.stock_quantity <= product.min_stock_level && (
                            <Badge variant="destructive" className="ml-2">Low Stock</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.status === 'active' ? 'default' : 'outline'}>
                          {product.status.charAt(0).toUpperCase() + product.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline" 
                            size="sm"
                            onClick={() => openEditDialog(product)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline" 
                            size="sm"
                            onClick={() => openDeleteDialog(product)}
                            className="text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Product Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
            <DialogDescription>Enter the details for the new product</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Product Name *</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  name="sku"
                  value={formData.sku || ''}
                  onChange={handleInputChange}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  name="category"
                  value={formData.category || ''}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={formData.description || ''}
                onChange={handleInputChange}
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="unit_price">Price *</Label>
                <div className="flex">
                  <select
                    id="currency"
                    name="currency"
                    className="rounded-l-md border border-r-0 border-input bg-background px-2 py-2 text-sm"
                    value={formData.currency}
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
                    value={formData.unit_price}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="stock_quantity">Stock *</Label>
                <Input
                  id="stock_quantity"
                  name="stock_quantity"
                  type="number"
                  min="0"
                  value={formData.stock_quantity}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="min_stock_level">Min Stock Level</Label>
                <Input
                  id="min_stock_level"
                  name="min_stock_level"
                  type="number"
                  min="0"
                  value={formData.min_stock_level}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={formData.status}
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
            <DialogDescription>Update the product information</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_name">Product Name *</Label>
              <Input
                id="edit_name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_sku">SKU</Label>
                <Input
                  id="edit_sku"
                  name="sku"
                  value={formData.sku || ''}
                  onChange={handleInputChange}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_category">Category</Label>
                <Input
                  id="edit_category"
                  name="category"
                  value={formData.category || ''}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="edit_description">Description</Label>
              <Textarea
                id="edit_description"
                name="description"
                value={formData.description || ''}
                onChange={handleInputChange}
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_unit_price">Price *</Label>
                <div className="flex">
                  <select
                    id="edit_currency"
                    name="currency"
                    className="rounded-l-md border border-r-0 border-input bg-background px-2 py-2 text-sm"
                    value={formData.currency}
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
                    value={formData.unit_price}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_stock_quantity">Stock *</Label>
                <Input
                  id="edit_stock_quantity"
                  name="stock_quantity"
                  type="number"
                  min="0"
                  value={formData.stock_quantity}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_min_stock_level">Min Stock Level</Label>
                <Input
                  id="edit_min_stock_level"
                  name="min_stock_level"
                  type="number"
                  min="0"
                  value={formData.min_stock_level}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="edit_status">Status</Label>
              <select
                id="edit_status"
                name="status"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={formData.status}
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
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the product {selectedProduct?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProduct} className="bg-red-600 hover:bg-red-700 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProductsPage;
