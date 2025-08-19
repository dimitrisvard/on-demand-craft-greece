import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { 
  Download, FileText, Plus, Edit2, Trash2, CheckCircle, 
  XCircle, Loader2, ChevronLeft, Send, Edit, 
  Trash, FileDown, ShoppingBag, Upload 
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import html2pdf from 'html2pdf.js';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import RfqFileList from '@/components/rfq/RfqFileList';
import RfqFileUpload from '@/components/rfq/RfqFileUpload';
import RfqFileDownload from '@/components/rfq/RfqFileDownload';
import { downloadAndSaveRfqFile, deleteRfqFile, getRfqFiles, downloadAllRfqFiles } from '@/utils/rfqFileStorage';
import { deleteFolderFromS3 } from '@/utils/awsS3Storage';
import { RFQ, RfqItem } from '@/types/customer';
import { Database } from '@/integrations/supabase/types';
import ThreeDViewerModal from '@/components/ThreeDViewerModal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// import Breadcrumbs from '@/components/Breadcrumbs';
import ErrorBoundary from '@/components/ErrorBoundary';
import { BackToDashboardButton } from '@/components/dashboard/BackToDashboardButton';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Add QuoteFile interface
interface QuoteFile {
  id: string;
  rfq_id: string;
  part_id?: string | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

interface RfqDetailsProps {
  // ... keep existing props if any
}

type RfqRow = Database['public']['Tables']['rfqs']['Row'];

const RfqDetails = (props: RfqDetailsProps) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  
  const [rfq, setRfq] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [quoteFiles, setQuoteFiles] = useState<QuoteFile[]>([]);
  const [rfqItems, setRfqItems] = useState<any[]>([]);
  const [generalFiles, setGeneralFiles] = useState<QuoteFile[]>([]);
  const [partFiles, setPartFiles] = useState<Record<string, QuoteFile[]>>({});
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAddItemDialogOpen, setIsAddItemDialogOpen] = useState(false);
  const [isEditItemDialogOpen, setIsEditItemDialogOpen] = useState(false);
  const [isDeleteItemDialogOpen, setIsDeleteItemDialogOpen] = useState(false);
  const [isDeleteRfqDialogOpen, setIsDeleteRfqDialogOpen] = useState(false);
  const [isCreateOrderDialogOpen, setIsCreateOrderDialogOpen] = useState(false);
  const [isDeletionError, setIsDeletionError] = useState(false);
  const [deletionErrorMessage, setDeletionErrorMessage] = useState('');
  const [rfqNumber, setRfqNumber] = useState<string>("");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<any>(null);
  const [isCheckingReferences, setIsCheckingReferences] = useState(false);
  const [newOrderTitle, setNewOrderTitle] = useState('');
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [filesRefreshTrigger, setFilesRefreshTrigger] = useState(0);
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [selectedPartIdForFiles, setSelectedPartIdForFiles] = useState<string | null>(null);
  const [animationParent] = useAutoAnimate();
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('');
  const [productionPartners, setProductionPartners] = useState<any[]>([]);
  const [isLoadingPartners, setIsLoadingPartners] = useState(false);

  const [newItem, setNewItem] = useState<Partial<RfqItem>>({
    product_name: "",
    description: "",
    quantity: 1,
    unit_price: 0,
    total_price: 0
  });

  useEffect(() => {
    if (id) {
      fetchRfqDetails();
    }
  }, [id]);

  // Fetch files when rfqItems are loaded
  useEffect(() => {
    if (id && rfqItems.length > 0) {
      fetchQuoteFiles();
    }
  }, [id, rfqItems]);

  // Fetch files associated with this RFQ
  const fetchQuoteFiles = async () => {
    if (!id) return;
    
    try {
      console.log('Fetching quote files for RFQ:', id);
      const files = await getRfqFiles(id);
      console.log('Files retrieved:', files);
      setQuoteFiles(files);
      
      // Organize files by parts
      const general: QuoteFile[] = [];
      const byPart: Record<string, QuoteFile[]> = {};
      
      // Get the list of part IDs from rfqItems
      const partIds = rfqItems.map(item => item.id);
      
      // Create mapping of part name to part ID for matching by name
      const partNameToId: Record<string, string> = {};
      rfqItems.forEach(item => {
        // Clean part name for matching
        const cleanName = item.product_name.replace(/\s+/g, '-').toLowerCase();
        partNameToId[cleanName] = item.id;
        
        // Also add simplified versions
        if (cleanName.includes('part-')) {
          const simpleName = cleanName.replace('part-', '');
          partNameToId[simpleName] = item.id;
        }
      });
      
      console.log('Part name to ID mapping:', partNameToId);
      
      files.forEach(file => {
        // First try using part_id if it exists
        if (file.part_id && partIds.includes(file.part_id)) {
          if (!byPart[file.part_id]) {
            byPart[file.part_id] = [];
          }
          byPart[file.part_id].push(file);
          console.log(`File ${file.file_name} associated with part_id: ${file.part_id}`);
        } 
        // Otherwise, try to match based on file path (looking for part-(name) pattern)
        else {
          let matchedPartId = null;
          
          // Try to extract part name from file path
          if (file.file_path) {
            console.log(`Analyzing file path for ${file.file_name}: ${file.file_path}`);
            
            // Extract folder names from path
            const pathParts = file.file_path.split('/');
            
            // Look for parts that match the expected pattern
            for (const pathPart of pathParts) {
              // Check for part-* pattern
              if (pathPart.toLowerCase().startsWith('part-')) {
                const partNameRaw = pathPart.substring(5); // Remove "part-" prefix
                const partNameClean = partNameRaw.toLowerCase();
                
                console.log(`Found part folder in path: ${pathPart}, extracted name: ${partNameRaw}`);
                
                // Try direct match with part IDs first
                for (const item of rfqItems) {
                  // Try with exact match
                  if (partNameClean === item.id.toLowerCase()) {
                    matchedPartId = item.id;
                    console.log(`Matched part by ID: ${matchedPartId}`);
                    break;
                  }
                }
                
                // If no match by ID, try matching with our name mapping
                if (!matchedPartId) {
                  // Try matching with our name mapping
                  for (const [name, id] of Object.entries(partNameToId)) {
                    if (partNameClean.includes(name) || name.includes(partNameClean)) {
                      matchedPartId = id;
                      console.log(`Matched part by name pattern: ${name} -> ${matchedPartId}`);
                      break;
                    }
                  }
                  
                  // Try matching directly with rfqItems
                  if (!matchedPartId) {
                    for (const item of rfqItems) {
                      const itemNameClean = item.product_name.toLowerCase().replace(/\s+/g, '-');
                      if (partNameClean.includes(itemNameClean) || 
                          itemNameClean.includes(partNameClean) ||
                          // Also try with numeric patterns like "part-1" matching "Part 1"
                          (partNameClean.match(/^\d+$/) && itemNameClean.includes(partNameClean))) {
                        matchedPartId = item.id;
                        console.log(`Matched part by name comparison: ${itemNameClean} -> ${matchedPartId}`);
                        break;
                      }
                    }
                  }
                }
                
                if (matchedPartId) break;
              }
            }
          }
          
          // If we found a matching part, add the file to that part
          if (matchedPartId) {
            if (!byPart[matchedPartId]) {
              byPart[matchedPartId] = [];
            }
            byPart[matchedPartId].push(file);
            
            // Attempt to update the database with the part_id if it's not set
            if (!file.part_id) {
              console.log(`Updating file ${file.id} with part_id ${matchedPartId}`);
              supabase
                .from('rfq_files')
                .update({ part_id: matchedPartId })
                .eq('id', file.id)
                .then(({ error }) => {
                  if (error) {
                    console.error(`Error updating part_id for file ${file.id}:`, error);
                  } else {
                    console.log(`Successfully updated part_id for file ${file.id}`);
                  }
                });
            }
          } else {
            // If no match found, add to general files
            general.push(file);
          }
        }
      });
      
      console.log('General files:', general.length);
      console.log('Files by part:', Object.keys(byPart).map(k => `${k}: ${byPart[k].length}`));
      
      setGeneralFiles(general);
      setPartFiles(byPart);
    } catch (error) {
      console.error('Error fetching quote files:', error);
    }
  };

  useEffect(() => {
    if (newItem.quantity !== undefined && newItem.unit_price !== undefined) {
      setNewItem({
        ...newItem,
        total_price: newItem.quantity * newItem.unit_price
      });
    }
  }, [newItem.quantity, newItem.unit_price]);

  useEffect(() => {
    if (selectedItem) {
      setNewItem({
        product_name: selectedItem.product_name,
        description: selectedItem.description,
        quantity: selectedItem.quantity,
        unit_price: selectedItem.unit_price,
        total_price: selectedItem.total_price
      });
    }
  }, [selectedItem]);

  const fetchRfqDetails = async () => {
    if (!id) return;
    
    try {
      setLoading(true);
      
      // Fetch RFQ details
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .select(`
          *,
          customers (
            id,
            company_name,
            contact_name,
            first_name,
            last_name,
            email,
            phone,
            vat_tax_id,
            address,
            street_address,
            city,
            zip_code,
            country
          )
        `)
        .eq('id', id)
        .single();
      
      if (rfqError) {
        console.error('Error fetching RFQ:', rfqError);
        toast({
          title: "Error",
          description: "Failed to load RFQ details",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      
      if (!rfqData) {
        console.error('RFQ not found');
        setLoading(false);
        return;
      }

      // Cast rfqData to include the custom fields (type assertion)
      const typedRfqData = rfqData as any;
      
      setRfq(typedRfqData);
      setCustomer(typedRfqData.customers);
      
      // Set RFQ number from the database or generate one
      if (typedRfqData.rfq_number) {
        setRfqNumber(typedRfqData.rfq_number);
      } else {
        // Fallback to RFQ-ID-DATE format
        const createdDate = new Date(typedRfqData.created_at);
        const formattedDate = format(createdDate, 'ddMMyyyy');
        const tempRfqNumber = `RFQ-${formattedDate}-1`;
        setRfqNumber(tempRfqNumber);
        
        // Update the RFQ with the generated number if it doesn't have one
        await supabase
          .from('rfqs')
          .update({ rfq_number: tempRfqNumber } as any)
          .eq('id', id);
      }
      
      // Parse parts_details from JSONB
      if (typedRfqData.parts_details && Array.isArray(typedRfqData.parts_details)) {
        // Use parts_details from JSONB field
        setRfqItems(typedRfqData.parts_details);
        await fetchQuoteFiles();
      } else {
        // Fetch from rfq_items table as fallback (though we're not using this table now)
        const { data: itemsData, error: itemsError } = await supabase
          .from('rfq_items')
          .select('*')
          .eq('rfq_id', id)
          .order('id');
        
        if (itemsError) {
          console.error('Error fetching RFQ items:', itemsError);
        } else {
          setRfqItems(itemsData || []);
        }
        await fetchQuoteFiles();
      }
      
    } catch (error) {
      console.error('Error in fetchRfqDetails:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch production partners for order creation
  const fetchProductionPartners = async () => {
    setIsLoadingPartners(true);
    try {
      const { data: partners, error } = await supabase
        .from('production_partners')
        .select('id, company_name, contact_name, email, specializations')
        .eq('active', true);
      
      if (error) throw error;
      setProductionPartners(partners || []);
    } catch (error) {
      console.error('Error fetching production partners:', error);
      toast({
        title: "Error",
        description: "Failed to load production partners",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPartners(false);
    }
  };

  const handleCreateOrder = async () => {
    if (!rfq || !customer) return;
    
    setIsCreatingOrder(true);
    
    try {
      // Get the due date (2 days from now)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);
      
      // Create the order
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([
          {
            title: newOrderTitle,
            customer_id: rfq.customer_id,
            rfq_id: rfq.id,
            partner_id: selectedPartnerId || null,
            currency: 'EUR',
            status: 'new',
            total_amount: rfq.total_amount,
            delivery_date: dueDate.toISOString()
          }
        ])
        .select();
        
      if (orderError) throw orderError;
      
      // Create order items from RFQ items
      const orderItems = rfqItems.map(item => ({
        order_id: orderData[0].id,
        product_name: item.product_name,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price
      }));
      
      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);
        
      if (itemsError) throw itemsError;
      
      toast({
        title: "Success",
        description: "Order created successfully",
      });
      
      setIsCreateOrderDialogOpen(false);
      
      // Navigate to the order page
      navigate(`/order/${orderData[0].id}`);
      
    } catch (error: any) {
      console.error("Error creating order:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create order",
        variant: "destructive",
      });
    } finally {
      setIsCreatingOrder(false);
    }
  };

  // Modified handleFileDownload function
  const handleFileDownload = async (file: QuoteFile) => {
    try {
      toast({
        title: "Download started",
        description: `Downloading file: ${file.file_name}`,
      });
      
      await downloadAndSaveRfqFile(file.file_path, file.file_name);
    } catch (error: any) {
      console.error("Error downloading file:", error);
      toast({
        title: "Download failed",
        description: error.message || "Failed to download file",
        variant: "destructive",
      });
    }
  };

  const handleAddItem = async () => {
    if (!id || !newItem.product_name) return;
    
    try {
      // Get current RFQ data
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .select('parts_details')
        .eq('id', id)
        .single();
      
      if (rfqError) throw rfqError;
      
      const now = new Date().toISOString();
      
      // Create new item with ID
      const newItemWithId: RfqItem = {
        id: crypto.randomUUID(),
        rfq_id: id,
        product_name: newItem.product_name || '',
        description: newItem.description || '',
        quantity: newItem.quantity || 0,
        unit_price: newItem.unit_price || 0,
        total_price: newItem.total_price || 0,
        created_at: now,
        updated_at: now
      };
      
      // Update parts_details array
      const currentParts = ((rfqData as unknown as { parts_details: RfqItem[] })?.parts_details || []) as RfqItem[];
      const updatedParts = [...currentParts, newItemWithId];
      
      // Update RFQ with new parts_details
      const { error: updateError } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedParts } as unknown as RfqRow)
        .eq('id', id);
      
      if (updateError) throw updateError;
      
      // Update local state
      setRfqItems([...rfqItems, newItemWithId]);
      setIsAddItemDialogOpen(false);
      resetItemForm();
      
      toast({
        title: "Success",
        description: "Item added successfully",
      });
      
      // Update total
      const newTotal = rfqItems.reduce((sum, item) => sum + item.total_price, 0) + newItemWithId.total_price;
      await updateRfqTotal(newTotal);
    } catch (error) {
      console.error('Error adding item:', error);
      toast({
        title: "Error",
        description: "Failed to add item",
        variant: "destructive",
      });
    }
  };

  const handleUpdateItem = async () => {
    if (!id || !selectedItem || !newItem.product_name) return;
    
    try {
      // Get current RFQ data
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .select('parts_details')
        .eq('id', id)
        .single();
      
      if (rfqError) throw rfqError;
      
      const now = new Date().toISOString();
      
      // Update item in parts_details array
      const currentParts = ((rfqData as unknown as { parts_details: RfqItem[] })?.parts_details || []) as RfqItem[];
      const updatedParts = currentParts.map((part) => 
        part.id === selectedItem.id
          ? {
              ...part,
              product_name: newItem.product_name || '',
              description: newItem.description || '',
              quantity: newItem.quantity || 0,
              unit_price: newItem.unit_price || 0,
              total_price: newItem.total_price || 0,
              updated_at: now
            }
          : part
      );
      
      // Update RFQ with new parts_details
      const { error: updateError } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedParts } as unknown as RfqRow)
        .eq('id', id);
      
      if (updateError) throw updateError;
      
      // Update local state
      setRfqItems(rfqItems.map(item =>
        item.id === selectedItem.id
          ? {
              ...item,
              product_name: newItem.product_name || '',
              description: newItem.description || '',
              quantity: newItem.quantity || 0,
              unit_price: newItem.unit_price || 0,
              total_price: newItem.total_price || 0,
              updated_at: now
            }
          : item
      ));
      
      setIsEditItemDialogOpen(false);
      resetItemForm();
      setSelectedItem(null);
      
      toast({
        title: "Success",
        description: "Item updated successfully",
      });
      
      // Update total
      const newTotal = rfqItems.reduce((sum, item) => 
        item.id === selectedItem.id ? sum + (newItem.total_price || 0) : sum + item.total_price, 0
      );
      await updateRfqTotal(newTotal);
    } catch (error) {
      console.error('Error updating item:', error);
      toast({
        title: "Error",
        description: "Failed to update item",
        variant: "destructive",
      });
    }
  };

  const handleDeleteItem = async () => {
    if (!id || !selectedItem) return;
    
    try {
      // Get current RFQ data
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .select('parts_details')
        .eq('id', id)
        .single();
      
      if (rfqError) throw rfqError;
      
      // Remove item from parts_details array
      const currentParts = ((rfqData as unknown as { parts_details: RfqItem[] })?.parts_details || []) as RfqItem[];
      const updatedParts = currentParts.filter((part) => part.id !== selectedItem.id);
      
      // Update RFQ with new parts_details
      const { error: updateError } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedParts } as unknown as RfqRow)
        .eq('id', id);
      
      if (updateError) throw updateError;
      
      // Update local state
      setRfqItems(rfqItems.filter(item => item.id !== selectedItem.id));
      setIsDeleteItemDialogOpen(false);
      setSelectedItem(null);
      
      toast({
        title: "Success",
        description: "Item deleted successfully",
      });
      
      // Update total
      const newTotal = rfqItems.reduce((sum, item) => 
        item.id === selectedItem.id ? sum : sum + item.total_price, 0
      );
      await updateRfqTotal(newTotal);
    } catch (error) {
      console.error('Error deleting item:', error);
      toast({
        title: "Error",
        description: "Failed to delete item",
        variant: "destructive",
      });
    }
  };

  const handleDeleteRfq = async () => {
    if (!rfq) return;
    
    try {
      setIsCheckingReferences(true);
      
      const { data: relatedOrders, error: ordersError } = await supabase
        .from('orders')
        .select('id')
        .eq('rfq_id', rfq.id);

      if (ordersError) throw ordersError;

      if (relatedOrders && relatedOrders.length > 0) {
        setIsDeletionError(true);
        setDeletionErrorMessage("Cannot delete this RFQ because it is referenced by one or more orders. Please remove the references from the orders first.");
        setIsDeleteRfqDialogOpen(false);
        setIsCheckingReferences(false);
        return;
      }

      // Delete all files from S3 bucket
      if (rfqNumber) {
        try {
          // Delete the entire folder for this RFQ
          const success = await deleteFolderFromS3(rfqNumber);
          if (success) {
            console.log(`Successfully deleted S3 folder for RFQ ${rfqNumber}`);
          } else {
            console.log(`No files found to delete for RFQ ${rfqNumber}`);
          }
        } catch (s3Error) {
          console.error("Error deleting files from S3:", s3Error);
          // Continue with RFQ deletion even if S3 deletion fails
        }
      }

      // Delete RFQ files references from database
      const { data: rfqFiles, error: filesError } = await supabase
        .from('rfq_files')
        .select('id')
        .eq('rfq_id', rfq.id);
      
      if (filesError) throw filesError;
      
      if (rfqFiles && rfqFiles.length > 0) {
        const { error: deleteFilesError } = await supabase
          .from('rfq_files')
          .delete()
          .eq('rfq_id', rfq.id);
        
        if (deleteFilesError) throw deleteFilesError;
      }

      // Delete the RFQ itself (parts_details is stored within the RFQ as JSONB)
      const { error: rfqError } = await supabase
        .from('rfqs')
        .delete()
        .eq('id', rfq.id);

      if (rfqError) {
        throw rfqError;
      }

      toast({
        title: "Success",
        description: "RFQ deleted successfully",
      });

      navigate('/rfq-management');
    } catch (error: any) {
      console.error("Delete error:", error);
      setIsDeletionError(true);
      
      if (error.code === '23503') {
        setDeletionErrorMessage("Cannot delete this RFQ because it is referenced by another record. Please remove all dependencies first.");
      } else {
        setDeletionErrorMessage(error.message || "Failed to delete RFQ");
      }
    } finally {
      setIsCheckingReferences(false);
      setIsDeleteRfqDialogOpen(false);
    }
  };

  const updateRfqTotal = async (newTotal: number) => {
    if (!rfq) return;
    
    try {
      const { error } = await supabase
        .from('rfqs')
        .update({ total_amount: newTotal })
        .eq('id', rfq.id);

      if (error) throw error;
    } catch (error: any) {
      console.error("Failed to update RFQ total:", error);
    }
  };

  const handleUpdateStatus = async (newStatus: 'draft' | 'sent' | 'received' | 'approved' | 'rejected') => {
    if (!rfq) return;
    
    try {
      const { error } = await supabase
        .from('rfqs')
        .update({ status: newStatus })
        .eq('id', rfq.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `RFQ status updated to ${newStatus}`,
      });

      fetchRfqDetails();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    }
  };

  const handleItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name === 'quantity' || name === 'unit_price') {
      const numValue = parseFloat(value) || 0;
      setNewItem({
        ...newItem,
        [name]: numValue
      });
    } else {
      setNewItem({
        ...newItem,
        [name]: value
      });
    }
  };

  const resetItemForm = () => {
    setNewItem({
      product_name: "",
      description: "",
      quantity: 1,
      unit_price: 0,
      total_price: 0
    });
  };

  const handleDownloadPdf = async () => {
    if (!rfq || !customer) return;

    // Prepare the data structure as per requirements
    const data = {
      seller: {
        company_name: 'Microns Hub',
        address_lines: [
          'Kosti Fragkouli 3',
          'Heraklion Greece 71414',
          '+30-210-444-7830',
          'info@micronshub.eu',
          'VAT ID EL137232320'
        ],
      },
      buyer: {
        name: customer.first_name + ' ' + customer.last_name,
        company: customer.company_name,
        address_lines: [customer.street_address, customer.city + ', ' + customer.zip_code],
        country: customer.country,
      },
      project_no: rfq.project_no || '',
      receipt_no: rfqNumber,
      date: rfq.created_at,
      inquiry_date: rfq.inquiry_date || rfq.created_at,
      contact_partner: {
        name: customer.first_name + ' ' + customer.last_name,
        phone: customer.phone || '',
        email: customer.email,
      },
      items: rfqItems.map((item) => {
        const filesForPartArr = (partFiles[item.id] || []).map(f => {
          // Show the full filename as it appears on AWS server
          // If file_path contains the full path, extract just the filename
          if (f.file_path) {
            // Extract filename from path (e.g., "RFQ-123/part-1/filename.stl" -> "filename.stl")
            const pathParts = f.file_path.split('/');
            return pathParts[pathParts.length - 1] || f.file_name;
          }
          return f.file_name;
        });
        return {
          product_name: item.product_name, // e.g. Part 1 RFQ-08052025-1-1
          files: filesForPartArr,
          description: item.description || '',
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          notes: item.notes || '',
        };
      }),
      shipping_cost: rfq.shipping_cost || 0,
      net_price: rfq.net_price || 0,
      vat_rate: 0,
      vat_amount: 0,
      total_price: rfq.total_amount,
      conditions: {
        delivery_time: '21 working days',
        shipping_terms: 'CIP',
        payment_terms: '14 days net',
        validity_days: '14 days',
      },
      footer_notes: rfq.footer_notes || [
        'This offer is subject to our general terms and conditions.',
        'All prices are net, plus VAT where applicable.'
      ],
      terms_url: 'https://microns-hub.com/terms',
    };

    // Create a container for html2canvas rendering
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.fontFamily = 'Helvetica, Arial, sans-serif';
    container.style.fontSize = '12px';
    container.style.color = '#222';
    container.style.background = '#fff';
    container.style.padding = '32px';

    // Use an absolute path for the logo and set width for reliability (restore to previous size)
    const logoHtml = `<img src='/logo.png' style="width:180px;height:auto;display:block;" />`;

    // Build the HTML for the PDF (header, info, items table, totals, conditions, footer)
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        ${logoHtml}
        <div style="text-align:right;">
          <div style="font-size:20px;font-weight:bold;">${data.seller.company_name}</div>
          <div style="font-size:12px;">${data.seller.address_lines.join('<br/>')}</div>
        </div>
      </div>
      <hr style="margin:16px 0; border: 1px solid #e0e0e0;" />
      <div style="display:flex;justify-content:space-between;">
        <div>
          <b>Buyer:</b><br/>
          ${data.buyer.name}<br/>
          ${data.buyer.company}<br/>
          ${data.buyer.address_lines.join('<br/>')}<br/>
          ${data.buyer.country}
        </div>
        <div style="text-align:right;">
          <b>Receipt No:</b> ${data.receipt_no}<br/>
          <b>Date:</b> ${format(new Date(data.date), 'yyyy-MM-dd')}<br/>
          <b>Inquiry Date:</b> ${format(new Date(data.inquiry_date), 'yyyy-MM-dd')}
        </div>
      </div>
      <h2 style="text-align:center;margin:24px 0 8px 0; color:#1a237e;">OFFER</h2>
      <div>Dear ${data.buyer.name},<br/>Thank you for your inquiry dated ${format(new Date(data.inquiry_date), 'yyyy-MM-dd')}. We are pleased to submit our offer as follows:</div>
      <table style="width:100%;border-collapse:collapse;margin-top:24px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="border:1px solid #ccc;padding:6px;">Item</th>
            <th style="border:1px solid #ccc;padding:6px;">Files</th>
            <th style="border:1px solid #ccc;padding:6px;">Description</th>
            <th style="border:1px solid #ccc;padding:6px;">Quantity</th>
            <th style="border:1px solid #ccc;padding:6px;">Unit Price</th>
            <th style="border:1px solid #ccc;padding:6px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${data.items.map(item => `
            <tr>
              <td style="border:1px solid #ccc;padding:6px;">${item.product_name}</td>
              <td style="border:1px solid #ccc;padding:6px;white-space:pre-line;color:#1976d2;">${item.files && item.files.length > 0 ? item.files.join('<br/>') : '-'}</td>
              <td style="border:1px solid #ccc;padding:6px;white-space:pre-line;">${item.description}</td>
              <td style="border:1px solid #ccc;padding:6px;text-align:right;">${item.quantity}</td>
              <td style="border:1px solid #ccc;padding:6px;text-align:right;">${item.unit_price.toFixed(2)}</td>
              <td style="border:1px solid #ccc;padding:6px;text-align:right;">${item.total_price.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:8px;font-size:10px;color:#666;">
        ${data.items.filter(i => i.notes).map(i => `<div>Note: ${i.notes}</div>`).join('')}
      </div>
      
      <div style="margin-top:24px;float:right;width:320px;">
        <table style="width:100%;font-size:13px;background:#f5f7fa;border-radius:8px;box-shadow:0 1px 4px #e0e0e0;">
          <tr><td style="color:#333;">Shipping Cost:</td><td style="text-align:right;color:#333;">${data.shipping_cost.toFixed(2)}</td></tr>
          <tr><td style="color:#333;">VAT (${data.vat_rate}%):</td><td style="text-align:right;color:#333;">${data.vat_amount.toFixed(2)}</td></tr>
          <tr style="font-weight:bold;"><td style="padding:8px 0 8px 8px;">Total Price:</td><td style="text-align:right;padding:8px 8px 8px 0;">${data.total_price.toFixed(2)}</td></tr>
        </table>
      </div>
      <div style="clear:both;"></div>
      <div style="margin-top:32px;">
        <b style="color:#1a237e;">Conditions:</b><br/>
        <ul style="margin:0 0 0 16px;padding:0;font-size:13px;color:#333;background:#f5f7fa;border-radius:8px;padding:12px 16px;box-shadow:0 1px 4px #e0e0e0;">
          <li><b>Delivery Time:</b> ${data.conditions.delivery_time}</li>
          <li><b>Shipping Terms:</b> ${data.conditions.shipping_terms}</li>
          <li><b>Payment Terms:</b> ${data.conditions.payment_terms}</li>
          <li><b>Offer Validity:</b> ${data.conditions.validity_days}</li>
        </ul>
      </div>
      
      <div style="margin-top:32px;text-align:center;font-size:12px;color:#1a237e;background:#f8f9fa;padding:16px;border-radius:8px;border:1px solid #e0e0e0;">
        <strong>This offer is made as an intra-community supply (tax rate 0%) under the condition that the required VAT identification<br/>
        number of the invoice recipient is subsequently submitted.</strong><br/><br/>
        The listed prices are net prices. Should you have any questions, please do not hesitate to call us at <strong>+30-210-444-7830</strong>
      </div>
      
      <div style="margin-top:32px;display:flex;justify-content:space-between;font-size:10px;color:#444;">
        <div style="text-align:left;">
          <div style="font-weight:bold;margin-bottom:4px;">Microns Hub</div>
          <div>Kosti Fragkouli 3</div>
          <div>Heraklion Greece</div>
          <div>71414</div>
        </div>
        
        <div style="text-align:center;">
          <div style="font-weight:bold;margin-bottom:4px;">Trade Register</div>
          <div>Greece</div>
          <div style="margin-top:8px;font-weight:bold;">VAT ID</div>
          <div>EL137232320</div>
        </div>
        
        <div style="text-align:center;">
          <div style="font-weight:bold;margin-bottom:4px;">Managing Directors</div>
          <div>Dimitris Vardalachakis</div>
        </div>
        
        <div style="text-align:right;">
          <div style="font-weight:bold;margin-bottom:4px;">Bank Account</div>
          <div>National Bank of Greece</div>
          <div style="margin-top:4px;">SWIFT Code: ETHNGRAA</div>
          <div style="margin-top:4px;">GR4901102040000020400891170</div>
          <div style="margin-top:4px;">SWIFT/BIC: ETHNGRAA</div>
        </div>
      </div>
      
      <div style="margin-top:32px;font-size:10px;color:#444;">
        ${data.footer_notes.map(note => `<div>${note}</div>`).join('')}
        <div style="margin-top:8px;"><a href='${data.terms_url}' style='color:#1976d2;text-decoration:underline;'>General Sale and Delivery Terms and Conditions</a></div>
      </div>
    `;

    // Use html2canvas to render the container, then jsPDF to create a multi-page PDF
    document.body.appendChild(container);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for DOM
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Render the HTML to canvas (higher scale for better quality)
    const canvas = await html2canvas(container, { scale: 4, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pageWidth - 20; // 10mm margin each side
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    // Only add the image once (no duplicate pages)
    pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth, pdfHeight);
    pdf.setFontSize(9);
    pdf.text(`Page 1`, pageWidth - 30, pageHeight - 10);

    // Always use the same filename for the same RFQ
    pdf.save(`offer_${rfqNumber}.pdf`);
    document.body.removeChild(container);
    toast({
      title: 'Success',
      description: 'PDF downloaded successfully',
    });
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency 
    }).format(amount);
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      case 'sent':
        return <Badge variant="secondary">Sent</Badge>;
      case 'approved':
        return <Badge className="bg-green-500">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const refreshFiles = () => {
    console.log('Refreshing files...');
    setFilesRefreshTrigger(prev => prev + 1);
    fetchQuoteFiles();
  };

  const handleFileUploadComplete = (success: boolean) => {
    console.log('File upload complete, success:', success);
    if (success) {
      refreshFiles();
      // Close the dialog after a short delay to show the success message
      setTimeout(() => {
        setFileDrawerOpen(false);
      }, 1500);
    }
  };

  const showPartFiles = (partId: string) => {
    setSelectedPartIdForFiles(partId);
    setFileDrawerOpen(true);
  };

  // Handle downloading all files as a zip
  const handleDownloadAllFiles = async () => {
    if (!id || !rfqNumber) {
      toast({
        title: "Error",
        description: "Missing RFQ information",
        variant: "destructive",
      });
      return;
    }
    
    try {
      toast({
        title: "Preparing Download",
        description: "Creating zip file of all RFQ files...",
      });
      
      await downloadAllRfqFiles(id, rfqNumber);
      
      toast({
        title: "Success",
        description: "All files downloaded as zip",
      });
    } catch (error: any) {
      console.error("Error downloading all files:", error);
      toast({
        title: "Download failed",
        description: error.message || "Failed to download files",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"></div>
          <p>Loading RFQ details...</p>
        </div>
      </div>
    );
  }

  if (!rfq) {
    return (
      <div className="p-6 pt-20">
        <div className="flex items-center gap-4 mb-6">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => navigate('/rfq-management')}
            className="flex items-center gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Quotes
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Button>
          <h1 className="text-2xl font-bold">RFQ Not Found</h1>
        </div>
        <Card>
          <CardContent className="p-6">
            <p>The requested RFQ could not be found. It may have been deleted or you may not have permission to view it.</p>
            <Button 
              onClick={() => navigate('/rfq-management')} 
              className="mt-4"
            >
              Return to Quotes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="container mx-auto p-6 pt-20 space-y-6">
        <div className="flex items-center gap-4 mb-6">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => navigate('/rfq-management')}
            className="flex items-center gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Quotes
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Button>
          <h1 className="text-2xl font-bold">RFQ Details</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>RFQ Information</CardTitle>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleDownloadPdf}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download PDF
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setIsCreateOrderDialogOpen(true)}
                >
                  <ShoppingBag className="h-4 w-4 mr-1" />
                  Create Order
                </Button>
                {rfq.status === 'draft' && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleUpdateStatus('sent')}
                  >
                    <Send className="h-4 w-4 mr-1" />
                    Mark as Sent
                  </Button>
                )}
                {rfq.status === 'sent' && (
                  <>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleUpdateStatus('received')}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Mark as Received
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row justify-between gap-6 mb-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">RFQ Number</h3>
                    <p className="text-lg font-semibold">{rfq.rfq_number}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Title</h3>
                    <p className="font-semibold">{rfq.title}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Customer</h3>
                    <p>{rfq.customer_name}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Status</h3>
                    <div className="mt-1">{getStatusBadge(rfq.status)}</div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Created Date</h3>
                    <p>{format(new Date(rfq.created_at), "MMMM d, yyyy")}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Due Date</h3>
                    <p>{format(new Date(rfq.due_date), "MMMM d, yyyy")}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Total Amount</h3>
                    <p className="text-xl font-bold">{formatCurrency(rfq.total_amount, rfq.currency)}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Shipping Cost</h3>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={rfq.shipping_cost || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          // Allow any input for better user experience
                          // We'll validate and save when user finishes typing
                          setRfq({
                            ...rfq,
                            shipping_cost: value === '' ? 0 : parseFloat(value.replace(',', '.')) || 0
                          });
                        }}
                        onBlur={async () => {
                          // Save to database when user finishes editing
                          const value = rfq.shipping_cost || '';
                          const shippingCost = value === '' ? 0 : parseFloat(value.toString().replace(',', '.')) || 0;
                          
                          try {
                            const { error } = await supabase
                              .from('rfqs')
                              .update({ shipping_cost: shippingCost })
                              .eq('id', rfq.id);
                            
                            if (error) throw error;
                            
                            // Recalculate total amount
                            const itemsTotal = rfqItems.reduce((sum, item) => sum + item.total_price, 0);
                            const newTotal = itemsTotal + shippingCost;
                            
                            // Update RFQ total
                            await updateRfqTotal(newTotal);
                            
                            toast({
                              title: "Success",
                              description: "Shipping cost updated successfully",
                            });
                          } catch (error) {
                            console.error('Error updating shipping cost:', error);
                            toast({
                              title: "Error",
                              description: "Failed to update shipping cost",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="w-24"
                        placeholder="0.00"
                      />
                      <span className="text-sm text-gray-500">EUR</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Version</h3>
                    <p>v{rfq.version}</p>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-lg font-semibold mb-3">Items</h3>
                <div ref={animationParent} className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <Suspense fallback={
                      <TableBody>
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center">
                            <div className="flex justify-center">
                              <Loader2 className="h-5 w-5 animate-spin" />
                            </div>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    }>
                      <TableBody>
                        {rfqItems.map(item => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.product_name}</TableCell>
                            <TableCell className="max-w-[400px] whitespace-pre-line break-words">{item.description}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">{formatCurrency(item.unit_price, rfq.currency)}</TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(item.total_price, rfq.currency)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => showPartFiles(item.id)}
                                  className="h-8 w-8"
                                  title="View files"
                                >
                                  <FileText className="h-4 w-4" />
                                </Button>
                                <Button 
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setSelectedItem(item);
                                    setIsEditItemDialogOpen(true);
                                  }}
                                  className="h-8 w-8"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => {
                                    setSelectedItem(item);
                                    setIsDeleteItemDialogOpen(true);
                                  }}
                                  className="h-8 w-8 text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {rfqItems.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="h-24 text-center">
                              No items added yet.
                            </TableCell>
                          </TableRow>
                        )}
                        {rfq.shipping_cost && rfq.shipping_cost > 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-right font-medium text-gray-600">
                              Shipping Cost:
                            </TableCell>
                            <TableCell className="text-right font-medium text-gray-600">
                              {formatCurrency(rfq.shipping_cost, rfq.currency)}
                            </TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        )}
                        <TableRow>
                          <TableCell colSpan={4} className="text-right font-bold">
                            Total:
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            {formatCurrency(rfq.total_amount, rfq.currency)}
                          </TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      </TableBody>
                    </Suspense>
                  </Table>
                </div>
                
                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={() => setIsAddItemDialogOpen(true)}
                    className="flex items-center gap-2"
                    size="sm"
                  >
                    <Plus className="h-4 w-4" />
                    Add Item
                  </Button>
                </div>
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Files</h3>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedPartIdForFiles(null);
                        setFileDrawerOpen(true);
                      }}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Files
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadAllFiles}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download All
                    </Button>
                  </div>
                </div>
                
                {/* Files grouped by part */}
                <div className="space-y-6">
                  {rfqItems.map((item) => {
                    const filesForThisPart = partFiles[item.id] || [];
                    
                    return (
                      <div key={item.id} className="bg-gray-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-medium text-gray-700">Part: {item.product_name}</h4>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => showPartFiles(item.id)}
                            className="text-xs"
                          >
                            Upload Files for this Part
                          </Button>
                        </div>
                        
                        {filesForThisPart.length > 0 ? (
                          <RfqFileList 
                            rfqId={rfq.id}
                            partId={item.id}
                            key={`part-files-${item.id}-${filesRefreshTrigger}`}
                            onRefreshRequest={refreshFiles}
                          />
                        ) : (
                          <div className="text-center py-3 text-gray-500 text-sm">
                            No files uploaded for this part yet
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {customer && (
                  <>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Company</h3>
                      <p className="font-semibold">{customer.company_name}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Contact</h3>
                      <p>{customer.first_name} {customer.last_name}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Email</h3>
                      <p>{customer.email}</p>
                    </div>
                    {customer.phone && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">Phone</h3>
                        <p>{customer.phone}</p>
                      </div>
                    )}
                    {customer.vat_tax_id && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">VAT/Tax ID</h3>
                        <p>{customer.vat_tax_id}</p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Delivery Options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {rfq && (
                  <>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Delivery Speed</h3>
                      <p className="font-semibold">{rfq.delivery_speed || 'Standard'}</p>
                    </div>
                    {rfq.max_delivery_date && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">Delivery Needed By</h3>
                        <p>{rfq.max_delivery_date}</p>
                      </div>
                    )}
                    {rfq.latest_offer_date && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">Quote Needed By</h3>
                        <p>{rfq.latest_offer_date}</p>
                      </div>
                    )}
                    {rfq.general_notes && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">General Notes</h3>
                        <p className="whitespace-pre-line">{rfq.general_notes}</p>
                      </div>
                    )}
                    {rfq.internal_request_number && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">Internal Request Number</h3>
                        <p>{rfq.internal_request_number}</p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  {rfq.status !== 'approved' && rfq.status !== 'rejected' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button 
                        variant="outline"
                        className="w-full bg-green-50 hover:bg-green-100 border-green-200"
                        onClick={() => handleUpdateStatus('approved')}
                      >
                        <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                        Approve
                      </Button>
                      
                      <Button 
                        variant="outline"
                        className="w-full bg-red-50 hover:bg-red-100 border-red-200"
                        onClick={() => handleUpdateStatus('rejected')}
                      >
                        <XCircle className="h-4 w-4 mr-2 text-red-500" />
                        Reject
                      </Button>
                    </div>
                  )}
                  
                  <Button 
                    variant="outline"
                    className="w-full"
                    onClick={() => setIsDeleteRfqDialogOpen(true)}
                  >
                    <Trash className="h-4 w-4 mr-2 text-red-500" />
                    Delete RFQ
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Dialog for file upload */}
        <Dialog open={fileDrawerOpen} onOpenChange={setFileDrawerOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>
                {selectedPartIdForFiles 
                  ? `Upload Files for Part: ${rfqItems.find(i => i.id === selectedPartIdForFiles)?.product_name || ''}` 
                  : 'Upload RFQ Files'}
              </DialogTitle>
            </DialogHeader>
            <ErrorBoundary>
              <RfqFileUpload 
                rfqId={rfq.id} 
                partId={selectedPartIdForFiles || undefined}
                onUploadComplete={handleFileUploadComplete}
              />
              <div className="mt-6">
                <h3 className="text-md font-medium mb-3">Uploaded Files</h3>
                <RfqFileList 
                  rfqId={rfq.id}
                  partId={selectedPartIdForFiles || undefined}
                  key={`upload-files-${filesRefreshTrigger}-${selectedPartIdForFiles || 'general'}`}
                  onRefreshRequest={refreshFiles}
                />
              </div>
            </ErrorBoundary>
          </DialogContent>
        </Dialog>

        {/* Add Item Dialog */}
        <Dialog open={isAddItemDialogOpen} onOpenChange={setIsAddItemDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Item</DialogTitle>
              <DialogDescription>
                Add a new item to this RFQ.
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label htmlFor="product_name">Product Name</label>
                <Input
                  id="product_name"
                  name="product_name"
                  value={newItem.product_name || ""}
                  onChange={handleItemInputChange}
                  placeholder="Enter product name"
                />
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="description">Description</label>
                <Textarea
                  id="description"
                  name="description"
                  value={newItem.description || ""}
                  onChange={handleItemInputChange}
                  placeholder="Enter product description"
                  rows={3}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label htmlFor="quantity">Quantity</label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    value={newItem.quantity || ""}
                    onChange={handleItemInputChange}
                    min={1}
                  />
                </div>
                
                <div className="grid gap-2">
                  <label htmlFor="unit_price">Unit Price ({rfq?.currency})</label>
                  <Input
                    id="unit_price"
                    name="unit_price"
                    type="number"
                    value={newItem.unit_price || ""}
                    onChange={handleItemInputChange}
                    min={0}
                    step={0.01}
                  />
                </div>
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="total_price">Total Price</label>
                <Input
                  id="total_price"
                  value={formatCurrency(newItem.total_price || 0, rfq?.currency || "EUR")}
                  disabled
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddItemDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddItem}>Add Item</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Item Dialog */}
        <Dialog open={isEditItemDialogOpen} onOpenChange={setIsEditItemDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Item</DialogTitle>
              <DialogDescription>
                Make changes to the selected item.
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label htmlFor="edit_product_name">Product Name</label>
                <Input
                  id="edit_product_name"
                  name="product_name"
                  value={newItem.product_name || ""}
                  onChange={handleItemInputChange}
                />
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="edit_description">Description</label>
                <Textarea
                  id="edit_description"
                  name="description"
                  value={newItem.description || ""}
                  onChange={handleItemInputChange}
                  rows={3}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label htmlFor="edit_quantity">Quantity</label>
                  <Input
                    id="edit_quantity"
                    name="quantity"
                    type="number"
                    value={newItem.quantity || ""}
                    onChange={handleItemInputChange}
                    min={1}
                  />
                </div>
                
                <div className="grid gap-2">
                  <label htmlFor="edit_unit_price">Unit Price ({rfq?.currency})</label>
                  <Input
                    id="edit_unit_price"
                    name="unit_price"
                    type="number"
                    value={newItem.unit_price || ""}
                    onChange={handleItemInputChange}
                    min={0}
                    step={0.01}
                  />
                </div>
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="edit_total_price">Total Price</label>
                <Input
                  id="edit_total_price"
                  value={formatCurrency(newItem.total_price || 0, rfq?.currency || "EUR")}
                  disabled
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditItemDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateItem}>Update Item</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Item Dialog */}
        <AlertDialog open={isDeleteItemDialogOpen} onOpenChange={setIsDeleteItemDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete this item
                from the RFQ.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDeleteItem}
                className="bg-red-500 hover:bg-red-600"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete RFQ Dialog */}
        <AlertDialog open={isDeleteRfqDialogOpen} onOpenChange={setIsDeleteRfqDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete RFQ</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete this RFQ and all its items.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDeleteRfq}
                className="bg-red-500 hover:bg-red-600"
                disabled={isCheckingReferences}
              >
                {isCheckingReferences ? (
                  <>
                    <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    Checking...
                  </>
                ) : (
                  'Delete'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Deletion Error Dialog */}
        <AlertDialog open={isDeletionError} onOpenChange={setIsDeletionError}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cannot Delete RFQ</AlertDialogTitle>
              <AlertDialogDescription>
                {deletionErrorMessage}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>Ok</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Create Order Dialog */}
        <Dialog open={isCreateOrderDialogOpen} onOpenChange={(open) => {
          setIsCreateOrderDialogOpen(open);
          if (open) {
            fetchProductionPartners();
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Order</DialogTitle>
              <DialogDescription>
                Create a new order based on this RFQ. This will copy all items and customer information.
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label htmlFor="order_title">Order Title</label>
                <Input
                  id="order_title"
                  value={newOrderTitle}
                  onChange={(e) => setNewOrderTitle(e.target.value)}
                  placeholder="Enter order title"
                />
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="production_partner">Production Partner (Optional)</label>
                <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a production partner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No partner assigned</SelectItem>
                    {isLoadingPartners ? (
                      <SelectItem value="" disabled>Loading partners...</SelectItem>
                    ) : (
                      productionPartners.map((partner) => (
                        <SelectItem key={partner.id} value={partner.id}>
                          {partner.company_name} - {partner.specializations?.join(', ') || 'No specializations'}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Assigning a production partner will give them access to view and manage this order.
                </p>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOrderDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreateOrder}
                disabled={isCreatingOrder}
              >
                {isCreatingOrder ? (
                  <>
                    <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    Creating...
                  </>
                ) : (
                  'Create Order'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 3D Viewer Modal */}
      {viewerFile && (
        <ThreeDViewerModal
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          fileUrl={`https://cfjrtmtaitwzggzpkhxi.supabase.co/storage/v1/object/public/rfq-files/${viewerFile.file_path}`}
          fileType={viewerFile.file_type}
          fileName={viewerFile.file_name}
        />
      )}
    </ErrorBoundary>
  );
};

export default RfqDetails;
