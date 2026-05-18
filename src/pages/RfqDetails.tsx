import React, { useState, useEffect, Suspense, useRef, lazy } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import {
  Download, FileText, Plus, Edit2, Trash2, CheckCircle,
  XCircle, Loader2, ChevronLeft, Send, Edit,
  Trash, FileDown, ShoppingBag, Upload, User, Box, Eye, FileOutput, LayoutGrid
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PartSpecsCard from '@/components/shared/PartSpecsCard';
import { getSignedUrl } from '@/utils/awsS3Storage';

const PartThumbnail3D = lazy(() => import('@/components/shared/PartThumbnail3D'));
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import RfqFileList from '@/components/rfq/RfqFileList';
import RfqFileUpload from '@/components/rfq/RfqFileUpload';
import RfqFileDownload from '@/components/rfq/RfqFileDownload';
import { downloadAndSaveRfqFile, deleteRfqFile, getRfqFiles, downloadAllRfqFiles } from '@/utils/rfqFileStorage';
import { deleteFolderFromS3 } from '@/utils/awsS3Storage';
import { RFQ, RfqItem } from '@/types/customer';
import { Database } from '@/integrations/supabase/types';
import ThreeDViewerModal from '@/components/ThreeDViewerModal';
import { CustomerSearchAssign } from '@/components/customers/CustomerSearchAssign';
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
import { generateAndSendRFQPDF } from '@/utils/rfqPdfEmailService';
import { type PartInfo } from '@/utils/technicalDrawingPdf';
import { generateManufacturingPdfWithFallback, extractFlatPattern, type FlatPatternResponse } from '@/utils/serverManufacturingPdf';
import { TechnicalDrawingViewer } from '@/components/sheetmetal/TechnicalDrawingViewer';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  const [isCustomerAssignDialogOpen, setIsCustomerAssignDialogOpen] = useState(false);
  const [isDeletionError, setIsDeletionError] = useState(false);
  const [deletionErrorMessage, setDeletionErrorMessage] = useState('');
  const [rfqNumber, setRfqNumber] = useState<string>("");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<any>(null);
  const [drawingViewer, setDrawingViewer] = useState<{
    open: boolean;
    file?: QuoteFile;
    item?: any;
    data: FlatPatternResponse | null;
    loading: boolean;
  }>({ open: false, data: null, loading: false });
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
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const is3DFile = (name: string) => /\.(stl|obj|glb|gltf|step|stp|dxf)$/i.test(name);
  const is3DRenderable = (name: string) => /\.(step|stp|stl|obj|glb|gltf)$/i.test(name);
  const findBest3DFile = (files: any[]) => files.find(f => is3DRenderable(f.file_name)) || files.find(f => is3DFile(f.file_name));

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
      // Mark this RFQ as viewed (removes NEW badge in listing)
      try {
        const stored = JSON.parse(localStorage.getItem('viewedRfqIds') || '[]');
        if (!stored.includes(id)) {
          stored.push(id);
          localStorage.setItem('viewedRfqIds', JSON.stringify(stored));
        }
      } catch { /* ignore */ }
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

      // Generate signed URLs for 3D files
      const allFiles = [...general, ...Object.values(byPart).flat()];
      const threeDFiles = allFiles.filter(f => is3DFile(f.file_name));
      const urlMap: Record<string, string> = {};
      await Promise.all(threeDFiles.map(async (f) => {
        const url = await getSignedUrl(f.file_path);
        if (url) urlMap[f.id] = url;
      }));
      setSignedUrls(urlMap);
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
            mobile,
            vat_tax_id,
            street_address,
            address,
            city,
            zip_code,
            country,
            position
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
      // Use linked customer record, or fall back to contact info stored directly on the RFQ
      if (typedRfqData.customers) {
        setCustomer(typedRfqData.customers);
      } else if (typedRfqData.company_name || typedRfqData.contact_email) {
        // Build a synthetic customer object from RFQ-level contact fields
        setCustomer({
          id: null,
          company_name: typedRfqData.company_name || '',
          first_name: typedRfqData.contact_first_name || '',
          last_name: typedRfqData.contact_last_name || '',
          contact_name: `${typedRfqData.contact_first_name || ''} ${typedRfqData.contact_last_name || ''}`.trim(),
          email: typedRfqData.contact_email || '',
          phone: typedRfqData.contact_phone || '',
          mobile: typedRfqData.mobile || '',
          vat_tax_id: typedRfqData.vat_id || '',
          street_address: typedRfqData.address || '',
          address: typedRfqData.address || '',
          city: typedRfqData.city || '',
          zip_code: typedRfqData.zip_code || '',
          country: typedRfqData.country || '',
          position: typedRfqData.contact_position || '',
        });
      }
      
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
        // Note: fetchQuoteFiles() is triggered by the useEffect watching rfqItems
        // Do NOT call it here - rfqItems state has not updated yet in this render cycle,
        // so the function would read stale (empty) rfqItems and fail to match files.
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
        // Note: fetchQuoteFiles() is triggered by the useEffect watching rfqItems
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
    if (!rfq) return;
    
    setIsCreatingOrder(true);
    
    try {
      // Get the due date (2 days from now)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);
      
      // Generate PO number: PO-DDMMYYYY-N
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const dateStr = `${day}${month}${year}`;
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('id')
        .gte('created_at', startOfDay)
        .lt('created_at', endOfDay);
      const seq = (todayOrders?.length || 0) + 1;
      const poNumber = `PO-${dateStr}-${seq}`;
      const rfqNumberVal = rfqNumber || (rfq as any).rfq_number || '';

      // Create the order
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([
          {
            title: poNumber,
            po_number: poNumber,
            from_rfq_number: rfqNumberVal,
            customer_id: rfq.customer_id,
            rfq_id: rfq.id,
            partner_id: selectedPartnerId && selectedPartnerId !== 'none' ? selectedPartnerId : null,
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
      
      // Send partner notification if a partner is assigned
      if (selectedPartnerId && selectedPartnerId !== 'none') {
        try {
          const { notifyPartnerOfOrderAssignment } = await import('../utils/partnerNotificationUtils');
          const startDate = new Date().toISOString();
          await notifyPartnerOfOrderAssignment(
            orderData[0].id,
            selectedPartnerId,
            newOrderTitle,
            startDate,
            dueDate.toISOString(),
            rfq.total_amount,
            'EUR'
          );
        } catch (notificationError) {
          console.error('Failed to send partner notification:', notificationError);
          // Don't fail the order creation if notification fails
        }
      }
      
      toast({
        title: "Success",
        description: "Order created successfully",
      });
      
      setIsCreateOrderDialogOpen(false);
      
      // Navigate to the order page
      navigate(`/orders/${orderData[0].id}`);
      
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

  const handleCustomerAssign = async (customer: any) => {
    if (!rfq) return;
    
    try {
      const customerId = customer?.id || null;
      
      const { error } = await supabase
        .from('rfqs')
        .update({ customer_id: customerId })
        .eq('id', rfq.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: customer ? `Customer ${customer.company_name} assigned to RFQ successfully` : "Customer assignment removed successfully",
      });

      // Refresh RFQ details to get the updated customer information
      fetchRfqDetails();
      setIsCustomerAssignDialogOpen(false);
    } catch (error: any) {
      console.error('Error assigning customer:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to assign customer",
        variant: "destructive",
      });
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
    if (!rfq || !customer) return;
    
    try {
      // If marking as sent, send email with PDF
      if (newStatus === 'sent') {
        toast({
          title: "Sending Email",
          description: "Generating PDF and sending email to customer...",
        });

        const emailResult = await generateAndSendRFQPDF(
          rfq,
          customer,
          generateRFQPDF
        );

        if (!emailResult.success) {
          toast({
            title: "Email Error",
            description: emailResult.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Email Sent",
          description: "PDF has been sent to customer successfully!",
        });
      }

      // Update RFQ status
      const { error } = await supabase
        .from('rfqs')
        .update({ status: newStatus })
        .eq('id', rfq.id);

      if (error) throw error;

      if (newStatus !== 'sent') {
        toast({
          title: "Success",
          description: `RFQ status updated to ${newStatus}`,
        });
      }

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

  const generateRFQPDF = async (): Promise<string> => {
    if (!rfq) return '';
    // Use customer data if available, otherwise use empty defaults
    const pdfCustomer = customer || {
      first_name: '', last_name: '', company_name: '',
      street_address: '', city: '', zip_code: '', country: '',
      phone: '', email: '',
    };

    try {
    // Prepare the data structure as per requirements
    const data = {
      seller: {
        company_name: 'MICRONS HUB DV Ε.Ε.',
        address_lines: [
          'Industrial Area Street B Number 4',
          'Heraklion Greece 71601',
          '+302104447830',
          'info@micronshub.eu',
          'VAT ID EL803129638'
        ],
      },
      buyer: {
        name: (pdfCustomer.first_name || '') + ' ' + (pdfCustomer.last_name || ''),
        company: pdfCustomer.company_name || '',
        address_lines: [pdfCustomer.street_address || '', (pdfCustomer.city || '') + ', ' + (pdfCustomer.zip_code || '')],
        country: pdfCustomer.country || '',
      },
      project_no: rfq.project_no || '',
      receipt_no: rfqNumber,
      date: rfq.created_at,
      inquiry_date: rfq.inquiry_date || rfq.created_at,
      contact_partner: {
        name: (pdfCustomer.first_name || '') + ' ' + (pdfCustomer.last_name || ''),
        phone: pdfCustomer.phone || '',
        email: pdfCustomer.email || '',
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
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          total_price: item.total_price || 0,
          notes: item.notes || '',
        };
      }),
      shipping_cost: rfq.shipping_cost || 0,
      net_price: rfq.net_price || 0,
      vat_rate: 0,
      vat_amount: 0,
      total_price: rfq.total_amount || 0,
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

    // Brand palette (matches scripts/generate_offer_pdf.py reference)
    const TEAL = '#1FB8B8';
    const TEAL_LIGHT = '#E6F7F7';
    const DARK = '#2A2A2A';
    const GREY_TXT = '#555555';
    const GREY_LINE = '#D8D8D8';
    const GREY_BG = '#F5F7F8';

    const inquiryDate = data.inquiry_date ? new Date(data.inquiry_date) : new Date(data.date);
    const inquiryDateStr = format(inquiryDate, 'yyyy-MM-dd');
    const dateStr = format(new Date(data.date), 'yyyy-MM-dd');
    const validUntilStr = format(
      new Date(inquiryDate.getTime() + 14 * 24 * 60 * 60 * 1000),
      'yyyy-MM-dd'
    );
    const greetingName = (data.buyer.name || '').trim() || 'Sir/Madam';
    const buyerCompanyOrName = (data.buyer.company || '').trim() || greetingName;
    const buyerAddress = data.buyer.address_lines.filter(Boolean).join('<br/>');
    const contactPhone = data.contact_partner.phone ? `Tel: ${data.contact_partner.phone}<br/>` : '';
    const contactEmail = data.contact_partner.email || '';

    // Create a container for html2canvas rendering
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.fontFamily = 'Helvetica, Arial, sans-serif';
    container.style.fontSize = '12px';
    container.style.color = DARK;
    container.style.background = '#fff';
    container.style.padding = '0';

    const logoHtml = `<img src='/logo.png' style="width:200px;height:auto;display:block;" />`;

    container.innerHTML = `
      <!-- Top accent bar -->
      <div style="height:10px;background:${TEAL};"></div>
      <div style="height:2px;background:${DARK};"></div>

      <div style="padding:24px 32px 0 32px;">
        <!-- Header: logo left, company right -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          ${logoHtml}
          <div style="text-align:right;">
            <div style="font-size:15px;font-weight:bold;color:${DARK};">MICRONS HUB DV E.E.</div>
            <div style="font-size:10.5px;color:${GREY_TXT};line-height:1.5;margin-top:4px;">
              Industrial Area Street B, No. 4<br/>
              71601 Heraklion, Crete, Greece<br/>
              Tel: +30 210 444 7830<br/>
              info@micronshub.eu &middot; www.micronshub.eu<br/>
              VAT ID: EL803129638
            </div>
          </div>
        </div>

        <!-- Teal divider -->
        <div style="height:2px;background:${TEAL};margin:14px 0 18px 0;"></div>

        <!-- OFFER title + meta box -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:34px;font-weight:bold;color:${DARK};line-height:1;">OFFER</div>
            <div style="font-size:12px;font-weight:bold;color:${TEAL};margin-top:6px;">Quotation for manufactured parts</div>
          </div>
          <table style="border-collapse:collapse;background:${GREY_BG};border:1px solid ${GREY_LINE};font-size:11px;">
            <tr>
              <td style="padding:4px 12px;text-align:right;color:${GREY_TXT};font-weight:bold;font-size:9px;border-bottom:1px solid ${GREY_LINE};">OFFER NO.</td>
              <td style="padding:4px 12px;text-align:right;color:${DARK};font-weight:bold;border-bottom:1px solid ${GREY_LINE};">${data.receipt_no || ''}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px;text-align:right;color:${GREY_TXT};font-weight:bold;font-size:9px;border-bottom:1px solid ${GREY_LINE};">DATE</td>
              <td style="padding:4px 12px;text-align:right;color:${DARK};font-weight:bold;border-bottom:1px solid ${GREY_LINE};">${dateStr}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px;text-align:right;color:${GREY_TXT};font-weight:bold;font-size:9px;border-bottom:1px solid ${GREY_LINE};">INQUIRY DATE</td>
              <td style="padding:4px 12px;text-align:right;color:${DARK};font-weight:bold;border-bottom:1px solid ${GREY_LINE};">${inquiryDateStr}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px;text-align:right;color:${GREY_TXT};font-weight:bold;font-size:9px;">VALID UNTIL</td>
              <td style="padding:4px 12px;text-align:right;color:${DARK};font-weight:bold;">${validUntilStr}</td>
            </tr>
          </table>
        </div>

        <!-- Buyer + Supplier blocks -->
        <div style="display:flex;gap:14px;margin-top:18px;">
          <div style="flex:1;background:${GREY_BG};border:1px solid ${GREY_LINE};padding:12px 16px;">
            <div style="font-size:10px;font-weight:bold;color:${TEAL};margin-bottom:6px;letter-spacing:0.5px;">BILL TO</div>
            <div style="font-size:13px;font-weight:bold;color:${DARK};margin-bottom:4px;">${buyerCompanyOrName}</div>
            <div style="font-size:11px;color:${DARK};line-height:1.5;">
              ${data.buyer.name && data.buyer.company ? `Attn: ${greetingName}<br/>` : ''}
              ${buyerAddress ? `${buyerAddress}<br/>` : ''}
              ${data.buyer.country ? `${data.buyer.country}<br/>` : ''}
              ${contactPhone}
              ${contactEmail}
            </div>
          </div>
          <div style="flex:1;background:${TEAL_LIGHT};border:1px solid ${TEAL};padding:12px 16px;">
            <div style="font-size:10px;font-weight:bold;color:${TEAL};margin-bottom:6px;letter-spacing:0.5px;">SUPPLIED BY</div>
            <div style="font-size:13px;font-weight:bold;color:${DARK};margin-bottom:4px;">Microns Hub DV E.E.</div>
            <div style="font-size:11px;color:${DARK};line-height:1.5;">
              Attn: Mr. Dimitris Vardalachakis<br/>
              Founder &amp; Managing Director<br/>
              Industrial Area Street B, No. 4<br/>
              71601 Heraklion, Crete, Greece<br/>
              Tel: +30 210 444 7830<br/>
              info@micronshub.eu
            </div>
          </div>
        </div>

        <!-- Intro -->
        <div style="margin-top:18px;font-size:11.5px;color:${DARK};line-height:1.5;">
          <div>Dear ${greetingName},</div>
          <div style="margin-top:6px;">Thank you for your inquiry of ${inquiryDateStr}. We are pleased to submit the following quotation for the parts listed in your request.</div>
        </div>

        <!-- Items table -->
        <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:11px;">
          <thead>
            <tr style="background:${DARK};color:#fff;">
              <th style="padding:8px 6px;text-align:center;font-weight:bold;width:32px;">#</th>
              <th style="padding:8px 6px;text-align:left;font-weight:bold;">PART</th>
              <th style="padding:8px 6px;text-align:left;font-weight:bold;">DESCRIPTION</th>
              <th style="padding:8px 6px;text-align:left;font-weight:bold;">FILES</th>
              <th style="padding:8px 6px;text-align:center;font-weight:bold;border-left:2px solid ${TEAL};">QTY</th>
              <th style="padding:8px 6px;text-align:center;font-weight:bold;">UNIT PRICE</th>
              <th style="padding:8px 6px;text-align:center;font-weight:bold;">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map((item, idx) => `
              <tr style="${idx % 2 === 1 ? `background:${GREY_BG};` : 'background:#fff;'}border-bottom:1px solid ${GREY_LINE};">
                <td style="padding:6px;text-align:center;color:${DARK};">${idx + 1}</td>
                <td style="padding:6px;color:${DARK};font-weight:bold;">${item.product_name || ''}</td>
                <td style="padding:6px;color:${DARK};white-space:pre-line;">${item.description || ''}</td>
                <td style="padding:6px;color:${GREY_TXT};font-size:9.5px;white-space:pre-line;">${item.files && item.files.length > 0 ? item.files.join('<br/>') : '-'}</td>
                <td style="padding:6px;text-align:center;color:${DARK};background:${TEAL_LIGHT};border-left:2px solid ${TEAL};">${item.quantity}</td>
                <td style="padding:6px;text-align:center;color:${DARK};background:${TEAL_LIGHT};font-weight:bold;">${item.unit_price.toFixed(2)}</td>
                <td style="padding:6px;text-align:center;color:${DARK};background:${TEAL_LIGHT};font-weight:bold;">${item.total_price.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${data.items.filter(i => i.notes).length > 0 ? `
          <div style="margin-top:6px;font-size:10px;color:${GREY_TXT};line-height:1.4;">
            ${data.items.filter(i => i.notes).map(i => `<div>Note: ${i.notes}</div>`).join('')}
          </div>
        ` : ''}

        <!-- Totals -->
        <div style="display:flex;justify-content:flex-end;margin-top:14px;">
          <table style="font-size:11px;border-collapse:collapse;min-width:280px;background:${GREY_BG};border:1px solid ${GREY_LINE};">
            <tr>
              <td style="padding:6px 14px;color:${DARK};">Shipping Cost:</td>
              <td style="padding:6px 14px;text-align:right;color:${DARK};">${data.shipping_cost.toFixed(2)}</td>
            </tr>
            <tr style="border-top:1px solid ${GREY_LINE};">
              <td style="padding:6px 14px;color:${DARK};">VAT (${data.vat_rate}%):</td>
              <td style="padding:6px 14px;text-align:right;color:${DARK};">${data.vat_amount.toFixed(2)}</td>
            </tr>
            <tr style="background:${TEAL};color:#fff;font-weight:bold;font-size:12px;">
              <td style="padding:8px 14px;">TOTAL:</td>
              <td style="padding:8px 14px;text-align:right;">${data.total_price.toFixed(2)}</td>
            </tr>
          </table>
        </div>
        <div style="clear:both;"></div>

        <div style="margin-top:10px;font-size:10px;color:${GREY_TXT};line-height:1.5;">
          <b>Note on pricing:</b> All prices are in EUR, net of VAT.
        </div>

        <!-- Conditions strip -->
        <table style="width:100%;border-collapse:collapse;margin-top:14px;background:${GREY_BG};border:1px solid ${GREY_LINE};">
          <tr>
            <td style="padding:8px 14px;border-right:1px solid ${GREY_LINE};width:25%;">
              <div style="font-size:9px;font-weight:bold;color:${TEAL};letter-spacing:0.5px;">DELIVERY TIME</div>
              <div style="font-size:12px;font-weight:bold;color:${DARK};margin-top:2px;">${data.conditions.delivery_time}</div>
            </td>
            <td style="padding:8px 14px;border-right:1px solid ${GREY_LINE};width:25%;">
              <div style="font-size:9px;font-weight:bold;color:${TEAL};letter-spacing:0.5px;">INCOTERMS</div>
              <div style="font-size:12px;font-weight:bold;color:${DARK};margin-top:2px;">${data.conditions.shipping_terms}</div>
            </td>
            <td style="padding:8px 14px;border-right:1px solid ${GREY_LINE};width:25%;">
              <div style="font-size:9px;font-weight:bold;color:${TEAL};letter-spacing:0.5px;">PAYMENT TERMS</div>
              <div style="font-size:12px;font-weight:bold;color:${DARK};margin-top:2px;">${data.conditions.payment_terms}</div>
            </td>
            <td style="padding:8px 14px;width:25%;">
              <div style="font-size:9px;font-weight:bold;color:${TEAL};letter-spacing:0.5px;">OFFER VALIDITY</div>
              <div style="font-size:12px;font-weight:bold;color:${DARK};margin-top:2px;">${data.conditions.validity_days}</div>
            </td>
          </tr>
        </table>

        <!-- Intra-community supply notice -->
        <div style="margin-top:14px;background:${TEAL_LIGHT};border:1px solid ${TEAL};padding:10px 14px;font-size:10.5px;color:${GREY_TXT};line-height:1.5;">
          <b>Intra-Community Supply (0% VAT):</b> This offer is issued as an intra-Community supply at 0% VAT, conditional on the buyer providing a valid VAT identification number prior to invoicing. All prices shown are net prices. For any clarification regarding this offer, please contact us at <b>+30 210 444 7830</b> or <b>info@micronshub.eu</b>.
        </div>

        <!-- Closing -->
        <div style="margin-top:18px;font-size:11px;color:${DARK};line-height:1.5;">
          We look forward to working with ${buyerCompanyOrName} and remain at your disposal for any technical or commercial questions regarding this quotation.
        </div>
        <div style="margin-top:10px;font-size:11px;color:${DARK};">Mit freundlichen Gr&uuml;&szlig;en,</div>
        <div style="margin-top:2px;font-size:12px;font-weight:bold;color:${DARK};">Dimitris Vardalachakis</div>
        <div style="font-size:10px;color:${GREY_TXT};">Founder &amp; Managing Director, Microns Hub DV E.E.</div>

        <div style="height:20px;"></div>
      </div>

      <!-- Footer band -->
      <div style="height:2px;background:${TEAL};"></div>
      <div style="background:${DARK};color:#fff;padding:14px 32px;font-size:9px;line-height:1.5;">
        <table style="width:100%;border-collapse:collapse;">
          <tr style="vertical-align:top;">
            <td style="width:25%;padding-right:10px;">
              <div style="font-size:8px;font-weight:bold;color:${TEAL};margin-bottom:4px;letter-spacing:0.5px;">COMPANY</div>
              <div>MICRONS HUB DV E.E.</div>
              <div>Industrial Area Street B No. 4</div>
              <div>71601 Heraklion, Greece</div>
            </td>
            <td style="width:25%;padding-right:10px;">
              <div style="font-size:8px;font-weight:bold;color:${TEAL};margin-bottom:4px;letter-spacing:0.5px;">TRADE REGISTER</div>
              <div>Greece</div>
              <div>VAT ID: EL803129638</div>
              <div>GEMI: 169893827000</div>
            </td>
            <td style="width:25%;padding-right:10px;">
              <div style="font-size:8px;font-weight:bold;color:${TEAL};margin-bottom:4px;letter-spacing:0.5px;">MANAGEMENT</div>
              <div>Dimitris Vardalachakis</div>
              <div>Founder &amp; Managing Director</div>
              <div>info@micronshub.eu</div>
            </td>
            <td style="width:25%;">
              <div style="font-size:8px;font-weight:bold;color:${TEAL};margin-bottom:4px;letter-spacing:0.5px;">BANK ACCOUNT</div>
              <div>National Bank of Greece</div>
              <div>GR49 0110 2040 0000 2040 0891 170</div>
              <div>SWIFT/BIC: ETHNGRAA</div>
            </td>
          </tr>
        </table>
      </div>
    `;

    // Use html2canvas to render the container, then jsPDF to create a multi-page PDF
    document.body.appendChild(container);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for DOM
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Render the HTML to canvas (higher scale for better quality)
    const canvas = await html2canvas(container, { scale: 4, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const imgProps = pdf.getImageProperties(imgData);
    // Edge-to-edge so the top accent bar and dark footer reach the page border
    const pdfWidth = pageWidth;
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

    // Get PDF as base64
    const pdfBase64 = pdf.output('datauristring').split(',')[1];

    // Clean up
    document.body.removeChild(container);

    return pdfBase64;
    } catch (error) {
      console.error('Error in generateRFQPDF:', error);
      throw error;
    }
  };

  const handleDownloadPdf = async () => {
    if (!rfq || !customer) return;

    try {
      const pdfBase64 = await generateRFQPDF();
      if (!pdfBase64) return;

      // Create download link
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${pdfBase64}`;
      link.download = `offer_${rfq.rfq_number || rfq.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: 'Success',
        description: 'PDF downloaded successfully',
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate PDF',
        variant: 'destructive',
      });
    }
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

  // ── Inline price editing ──────────────────────────────────
  const handlePriceChange = async (itemId: string, unitPrice: number) => {
    const updatedItems = rfqItems.map((item: any) => {
      if (item.id === itemId) {
        const qty = item.quantity || 1;
        return { ...item, unit_price: unitPrice, total_price: unitPrice * qty };
      }
      return item;
    });
    setRfqItems(updatedItems);

    // Compute new total
    const newTotal = updatedItems.reduce((sum: number, item: any) => sum + (item.total_price || 0), 0);

    // Save to DB (parts_details JSONB + total_amount)
    try {
      const { error } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedItems, total_amount: newTotal } as any)
        .eq('id', id!);
      if (error) throw error;
      setRfq((prev: any) => prev ? { ...prev, total_amount: newTotal } : prev);
      toast({ title: 'Price updated', description: `Total: €${newTotal.toFixed(2)}` });
    } catch (err: any) {
      toast({ title: 'Error saving price', description: err.message, variant: 'destructive' });
    }
  };

  // Generate manufacturing drawing PDF from 3D files (client-side)
  const [drawingLoading, setDrawingLoading] = useState<string | null>(null);
  const [nestingOpen, setNestingOpen] = useState(false);
  const [nestingLoading, setNestingLoading] = useState(false);
  const [nestingResult, setNestingResult] = useState<any>(null);
  const [nestingError, setNestingError] = useState<string | null>(null);
  const [selectedSheetSize, setSelectedSheetSize] = useState<{ w: number; h: number } | null>(null);
  const [dbMaterials, setDbMaterials] = useState<any[]>([]);
  const [selectedDbMaterial, setSelectedDbMaterial] = useState<string>('');

  // Standard fallback sheets (used when no DB materials available)
  const STANDARD_SHEETS = [
    { w: 1000, h: 500, name: '1000 x 500' },
    { w: 1000, h: 1000, name: '1000 x 1000' },
    { w: 1250, h: 625, name: '1250 x 625' },
    { w: 1500, h: 750, name: '1500 x 750' },
    { w: 2000, h: 1000, name: '2000 x 1000' },
    { w: 2500, h: 1250, name: '2500 x 1250' },
    { w: 3000, h: 1500, name: '3000 x 1500' },
  ];

  // Fetch sheet metal materials from database
  useEffect(() => {
    const fetchDbMaterials = async () => {
      try {
        const { data, error } = await supabase
          .from('materials')
          .select('*')
          .eq('category', 'sheet_metal')
          .eq('is_active', true)
          .order('name');
        if (!error && data) setDbMaterials(data);
      } catch { /* DB materials optional */ }
    };
    fetchDbMaterials();
  }, []);

  const handleNesting = async () => {
    setNestingLoading(true);
    setNestingError(null);
    setNestingResult(null);
    setNestingOpen(true);

    try {
      // Collect all DXF files and their associated items
      const dxfEntries: { file: QuoteFile; item: any }[] = [];
      const stepItemsWithoutDxf: { file: QuoteFile; item: any }[] = [];

      for (const item of rfqItems) {
        const itemFiles = partFiles[item.id] || [];
        const dxfFiles = itemFiles.filter(f => /\.dxf$/i.test(f.file_name));
        if (dxfFiles.length > 0) {
          for (const file of dxfFiles) {
            dxfEntries.push({ file, item });
          }
        } else {
          // No DXF — check for STEP/STL files that can be converted
          const cadFiles = itemFiles.filter(f => /\.(step|stp|stl)$/i.test(f.file_name));
          if (cadFiles.length > 0) {
            stepItemsWithoutDxf.push({ file: cadFiles[0], item });
          }
        }
      }

      // Auto-extract DXF flat patterns from STEP/STL files
      if (stepItemsWithoutDxf.length > 0) {
        toast({ title: 'Extracting flat patterns', description: `Converting ${stepItemsWithoutDxf.length} CAD file(s) to DXF...` });
        const { extractFlatPattern } = await import('@/utils/serverManufacturingPdf');
        const { uploadFileToS3 } = await import('@/utils/awsS3Storage');
        for (const { file, item } of stepItemsWithoutDxf) {
          try {
            // Always mint a fresh presigned URL — cached ones in signedUrls
            // expire after 3600s and the unfold service then gets 403 Forbidden.
            const url = await getSignedUrl(file.file_path);
            if (!url) continue;
            const result = await extractFlatPattern(url, file.file_name, undefined, id);
            if (result?.dxf_base64) {
              // Decode base64 DXF and add to entries
              const dxfContent = atob(result.dxf_base64);
              const dxfName = file.file_name.replace(/\.[^.]+$/, '.dxf');
              dxfEntries.push({
                file: { ...file, file_name: dxfName },
                item,
                _dxfContent: dxfContent,
              } as any);

              // Persist the DXF back to S3 + rfq_files so the next nesting click
              // finds it directly without re-extracting.
              try {
                const stepDir = (file.file_path || '').split('/').slice(0, -1).join('/');
                const bytes = new Uint8Array(dxfContent.length);
                for (let i = 0; i < dxfContent.length; i++) bytes[i] = dxfContent.charCodeAt(i) & 0xff;
                const dxfFile = new File([bytes], dxfName, { type: 'application/dxf' });
                const dxfPath = await uploadFileToS3(dxfFile, stepDir);
                if (dxfPath && id) {
                  await supabase.from('rfq_files').insert({
                    rfq_id: id,
                    part_id: file.part_id || null,
                    file_name: dxfName,
                    file_path: dxfPath,
                    file_type: 'application/dxf',
                    file_size: bytes.length,
                  });
                }
              } catch (persistErr) {
                console.warn(`Could not persist extracted DXF for ${file.file_name}:`, persistErr);
              }
            }
          } catch (err) {
            console.warn(`Failed to extract flat pattern from ${file.file_name}:`, err);
          }
        }
      }

      if (dxfEntries.length === 0) {
        setNestingError('No DXF files found and flat pattern extraction failed. Upload DXF flat pattern files or ensure the FreeCAD service is running for STEP files.');
        return;
      }

      // Fetch DXF file contents from S3 (or use pre-extracted content)
      const dxfContents: string[] = [];
      const partsMetadata: any[] = [];

      for (let i = 0; i < dxfEntries.length; i++) {
        const entry = dxfEntries[i] as any;
        const { file, item } = entry;

        // Use pre-extracted DXF content if available (from STEP conversion)
        if (entry._dxfContent) {
          dxfContents.push(entry._dxfContent);
        } else {
          // Mint a fresh presigned URL — cached ones expire after 3600s.
          const url = await getSignedUrl(file.file_path);
          if (!url) {
            toast({ title: 'Warning', description: `Could not get URL for ${file.file_name}`, variant: 'destructive' });
            continue;
          }

          const response = await fetch(url);
          if (!response.ok) {
            toast({ title: 'Warning', description: `Could not download ${file.file_name}`, variant: 'destructive' });
            continue;
          }
          const content = await response.text();
          dxfContents.push(content);
        }

        const ov = item.original_values as Record<string, any> | undefined;
        partsMetadata.push({
          fileIndex: dxfContents.length - 1,
          name: item.product_name || file.file_name.replace(/\.dxf$/i, ''),
          material: (ov?.materialSubtypeLabel || ov?.materialLabel || ov?.material || 'unknown').trim(),
          thickness: parseFloat(ov?.thickness) || 1.0,
          quantity: item.quantity || 1,
        });
      }

      if (dxfContents.length === 0) {
        setNestingError('Failed to download any DXF files.');
        return;
      }

      // Call nesting API
      const nestResponse = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'nest',
          files: dxfContents,
          metadata: {
            parts: partsMetadata,
            config: {
              gap: 3,
              edgeMargin: 5,
              rotationMode: '90deg',
              optimizationLevel: 'balanced',
              ...(selectedSheetSize ? { sheetSize: selectedSheetSize } : {}),
            },
          },
        }),
      });

      const result = await nestResponse.json();
      if (!nestResponse.ok || !result.success) {
        setNestingError(result.error || result.message || 'Nesting failed');
        return;
      }

      setNestingResult(result);
    } catch (error: any) {
      console.error('Nesting error:', error);
      setNestingError(error.message || 'An unexpected error occurred during nesting.');
    } finally {
      setNestingLoading(false);
    }
  };

  const buildPartInfo = (file: QuoteFile, item: any): PartInfo => {
    const ov = item?.original_values as Record<string, any> | undefined;
    return {
      name: file.file_name.replace(/\.[^.]+$/, ''),
      material: ov?.materialSubtypeLabel || ov?.materialLabel || ov?.material || '',
      process: ov?.processLabel || ov?.process || '',
      thickness: ov?.thickness || '',
      tolerance: ov?.toleranceLabel || ov?.tolerance || '',
      surfaceRoughness: ov?.surfaceRoughnessLabel || ov?.surfaceRoughness || '',
      surfaceTreatment: ov?.surfaceTreatmentLabel || ov?.surfaceTreatment || '',
      needsBending: ov?.needsBending === true || ov?.needsBending === 'true',
    };
  };

  const handleManufacturingDrawing = async (file: QuoteFile, item: any) => {
    try {
      setDrawingLoading(file.id);
      const url = await getSignedUrl(file.file_path);
      if (!url) {
        toast({ title: 'Error', description: 'Could not get file URL', variant: 'destructive' });
        return;
      }
      const partInfo = buildPartInfo(file, item);
      await generateManufacturingPdfWithFallback(url, file.file_name, partInfo);
      toast({ title: 'Manufacturing Drawing Generated', description: 'PDF downloaded successfully.' });
    } catch (error: any) {
      console.error('Manufacturing drawing error:', error);
      toast({ title: 'Drawing Error', description: error.message || 'Failed to generate manufacturing drawing PDF.', variant: 'destructive' });
    } finally {
      setDrawingLoading(null);
    }
  };

  const handleViewDrawing = async (file: QuoteFile, item: any) => {
    setDrawingViewer({ open: true, file, item, data: null, loading: true });
    try {
      const url = await getSignedUrl(file.file_path);
      if (!url) {
        setDrawingViewer((s) => ({
          ...s,
          loading: false,
          data: { status: 'error', source: 'client', error: 'Could not get file URL' } as FlatPatternResponse,
        }));
        return;
      }
      const data = await extractFlatPattern(url, file.file_name);
      setDrawingViewer((s) => ({ ...s, loading: false, data }));
    } catch (error: any) {
      setDrawingViewer((s) => ({
        ...s,
        loading: false,
        data: {
          status: 'error',
          source: 'client',
          error: error?.message || 'Failed to fetch flat pattern',
        } as FlatPatternResponse,
      }));
    }
  };

  const downloadDxfFromBase64 = (base64: string, fileName: string) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseSpecsFromDescription = (description: string) => {
    const specs: Record<string, string | boolean> = {};
    if (!description) return specs;
    const lines = description.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith('process:') || lower.startsWith('manufacturing process:')) specs.process = line.split(':').slice(1).join(':').trim();
      else if (lower.startsWith('material:')) specs.material = line.split(':').slice(1).join(':').trim();
      else if (lower.startsWith('surface roughness:') || lower.startsWith('roughness:')) specs.surfaceRoughness = line.split(':').slice(1).join(':').trim();
      else if (lower.startsWith('surface treatment:') || lower.startsWith('treatment:') || lower.startsWith('finishing:')) specs.surfaceTreatment = line.split(':').slice(1).join(':').trim();
      else if (lower.startsWith('tolerance:') || lower.startsWith('tolerances:')) specs.tolerance = line.split(':').slice(1).join(':').trim();
      else if (lower.startsWith('thickness:')) specs.thickness = line.split(':').slice(1).join(':').trim().replace(/\s*mm\s*$/i, '');
      else if (lower.startsWith('bending:')) specs.needsBending = line.split(':').slice(1).join(':').trim().toLowerCase() === 'yes';
    }
    return specs;
  };

  const handleView3DFile = (fileId: string, fileName: string) => {
    const url = signedUrls[fileId];
    if (url) {
      setViewerFile({ url, type: 'model', name: fileName });
      setViewerOpen(true);
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
      <div className="w-full max-w-none px-6 py-6 pt-20 space-y-6">
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

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <Card className="xl:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>RFQ Information</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
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
                  onClick={() => setIsCustomerAssignDialogOpen(true)}
                >
                  <User className="h-4 w-4 mr-1" />
                  Assign Customer
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
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Items</h3>
                  {rfqItems.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={nestingLoading}
                      onClick={handleNesting}
                    >
                      {nestingLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Nesting...
                        </>
                      ) : (
                        <>
                          <LayoutGrid className="h-4 w-4" />
                          Nesting Layout
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div ref={animationParent} className="space-y-4">
                  {rfqItems.length === 0 ? (
                    <Card>
                      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <Box className="h-10 w-10 text-muted-foreground mb-3" />
                        <p className="text-base font-medium mb-1">No items added yet</p>
                        <p className="text-sm text-muted-foreground">Click "Add Item" below to add parts to this RFQ.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    rfqItems.map((item, index) => {
                      const specs = item.original_values
                        ? (() => {
                            const ov = item.original_values as Record<string, any>;
                            return {
                              process: ov.processLabel || ov.process || '',
                              material: ov.materialSubtypeLabel || ov.materialLabel || ov.material || '',
                              surfaceRoughness: ov.surfaceRoughnessLabel || ov.surfaceRoughness || '',
                              surfaceTreatment: ov.surfaceTreatmentLabel || ov.surfaceTreatment || '',
                              tolerance: ov.toleranceLabel || ov.tolerance || '',
                              thickness: ov.thickness || '',
                              needsBending: ov.needsBending === true || ov.needsBending === 'true',
                            } as Record<string, string | boolean>;
                          })()
                        : parseSpecsFromDescription(item.description || '');
                      const itemPartFiles = partFiles[item.id] || [];
                      const threeDFile = findBest3DFile(itemPartFiles);
                      const has3DFile = !!threeDFile;

                      return (
                        <div key={item.id} className="flex gap-3 items-start">
                          {/* 3D Thumbnail */}
                          <div className="hidden sm:block flex-shrink-0">
                            {threeDFile && signedUrls[threeDFile.id] ? (
                              <Suspense
                                fallback={
                                  <div className="h-[200px] w-[200px] rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-slate-600" />
                                  </div>
                                }
                              >
                                <PartThumbnail3D fileUrl={signedUrls[threeDFile.id]} fileName={threeDFile.file_name} />
                              </Suspense>
                            ) : (
                              <div className="h-[200px] w-[200px] rounded-lg bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
                                <Box className="h-8 w-8 text-slate-300" />
                                <span className="text-[10px] text-slate-400 mt-1">No 3D file</span>
                              </div>
                            )}
                          </div>

                          {/* Part card */}
                          <div className="flex-1 min-w-0">
                            <PartSpecsCard
                              index={index}
                              currency={rfq.currency || 'EUR'}
                              part={{
                                product_name: item.product_name,
                                description: item.description,
                                quantity: item.quantity,
                                unit_price: item.unit_price,
                                total_price: item.total_price,
                                material: specs.material as string | undefined,
                                process: specs.process as string | undefined,
                                tolerance: specs.tolerance as string | undefined,
                                surfaceRoughness: specs.surfaceRoughness as string | undefined,
                                surfaceTreatment: specs.surfaceTreatment as string | undefined,
                                thickness: specs.thickness as string | undefined,
                                needsBending: specs.needsBending as boolean | undefined,
                                dimensions: item.original_values?.dimensions || item.dimensions,
                                volume: item.original_values?.volume || item.volume,
                                fileCount: itemPartFiles.length,
                              }}
                              onView3D={has3DFile ? () => handleView3DFile(threeDFile!.id, threeDFile!.file_name) : undefined}
                              onEdit={() => {
                                setSelectedItem(item);
                                setIsEditItemDialogOpen(true);
                              }}
                              onDelete={() => {
                                setSelectedItem(item);
                                setIsDeleteItemDialogOpen(true);
                              }}
                              showPricing
                              showActions
                              onPriceChange={(unitPrice) => handlePriceChange(item.id, unitPrice)}
                            />
                            {/* Manufacturing Drawing buttons for 3D files */}
                            {itemPartFiles.filter(f => is3DFile(f.file_name)).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {itemPartFiles.filter(f => is3DFile(f.file_name)).map(file => (
                                  <div key={file.id} className="flex flex-wrap gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="gap-1.5 text-xs"
                                      onClick={() => handleViewDrawing(file, item)}
                                      title="View the flat pattern, bend schedule and parameters"
                                    >
                                      <FileOutput className="h-3.5 w-3.5" />
                                      View drawing
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="gap-1.5 text-xs"
                                      disabled={drawingLoading === file.id}
                                      onClick={() => handleManufacturingDrawing(file, item)}
                                      title="Generate manufacturing drawing PDF with isometric view and flat pattern"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      {drawingLoading === file.id ? 'Generating...' : 'Download PDF'}
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Summary row */}
                  {rfqItems.length > 0 && (
                    <Card className="bg-gray-50">
                      <CardContent className="py-3 px-5">
                        <div className="flex flex-col gap-1 text-sm">
                          {rfq.shipping_cost > 0 && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Shipping Cost:</span>
                              <span className="font-medium">{formatCurrency(rfq.shipping_cost, rfq.currency)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-base">
                            <span>Total:</span>
                            <span>{formatCurrency(rfq.total_amount, rfq.currency)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
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
            {/* Customer Information */}
            <div className="grid grid-cols-1 gap-6">
              <Card className="h-fit">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-semibold">Customer Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {customer && (
                    <>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Company</h3>
                        <p className="font-semibold text-gray-900">{customer.company_name}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">VAT/Tax ID</h3>
                        <p className="text-gray-900">{customer.vat_tax_id || 'Not provided'}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Contact Person</h3>
                        <p className="text-gray-900">{customer.first_name || 'Not provided'} {customer.last_name || ''}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Position</h3>
                        <p className="text-gray-900">{customer.position || 'Not provided'}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Email</h3>
                        <p className="text-gray-900">{customer.email || 'Not provided'}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Phone</h3>
                        <p className="text-gray-900">{customer.phone || 'Not provided'}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Mobile</h3>
                        <p className="text-gray-900">{customer.mobile || 'Not provided'}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Address</h3>
                        <p className="text-gray-900 whitespace-pre-line">{customer.address || 'Not provided'}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">City</h3>
                        <p className="text-gray-900">{customer.city || 'Not provided'}</p>
                      </div>
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="text-sm font-medium text-gray-600 mb-1">ZIP Code</h3>
                        <p className="text-gray-900">{customer.zip_code || 'Not provided'}</p>
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-gray-600 mb-1">Country</h3>
                        <p className="text-gray-900">{customer.country || 'Not provided'}</p>
                      </div>
                    </>
                  )}
                  {!customer && (
                    <div className="text-center py-8 text-gray-500">
                      <p>No customer assigned</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            
            <Card className="mt-6">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Delivery Options</CardTitle>
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
                <label className="text-sm text-muted-foreground">Order ID will be auto-generated (PO-DDMMYYYY-N)</label>
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="production_partner">Production Partner (Optional)</label>
                <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a production partner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No partner assigned</SelectItem>
                    {isLoadingPartners ? (
                      <SelectItem value="loading" disabled>Loading partners...</SelectItem>
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

        {/* Nesting Layout Dialog */}
        <Dialog open={nestingOpen} onOpenChange={setNestingOpen}>
          <DialogContent className="sm:max-w-[95vw] lg:max-w-[1400px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nesting Layout</DialogTitle>
              <DialogDescription>
                Parts grouped by material and thickness, nested onto standard sheets.
              </DialogDescription>
            </DialogHeader>

            {/* Sheet size & material selector */}
            <div className="flex flex-wrap items-center gap-3 border-b pb-3">
              {/* DB material selection */}
              {dbMaterials.length > 0 && (
                <>
                  <label className="text-sm font-medium whitespace-nowrap">Material:</label>
                  <Select
                    value={selectedDbMaterial}
                    onValueChange={(val) => {
                      setSelectedDbMaterial(val);
                      if (val) {
                        const mat = dbMaterials.find((m: any) => m.id === val);
                        if (mat) {
                          // If the material has associated stock with known dimensions, could auto-select
                          // For now just store the selection for display
                        }
                      }
                    }}
                  >
                    <SelectTrigger className="w-[260px]">
                      <SelectValue placeholder="Select from inventory..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any material</SelectItem>
                      {dbMaterials.map((m: any) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}{m.grade ? ` ${m.grade}` : ''}{m.thickness_mm ? ` — ${m.thickness_mm}mm` : ''}
                          {m.density_kg_per_m3 ? ` (${m.density_kg_per_m3} kg/m³)` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <label className="text-sm font-medium whitespace-nowrap">Sheet Size:</label>
              <Select
                value={selectedSheetSize ? `${selectedSheetSize.w}x${selectedSheetSize.h}` : 'auto'}
                onValueChange={(val) => {
                  if (val === 'auto') {
                    setSelectedSheetSize(null);
                  } else {
                    const [w, h] = val.split('x').map(Number);
                    setSelectedSheetSize({ w, h });
                  }
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (smallest fit)</SelectItem>
                  {STANDARD_SHEETS.map(s => (
                    <SelectItem key={s.name} value={`${s.w}x${s.h}`}>{s.name} mm</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={nestingLoading}
                onClick={handleNesting}
              >
                {nestingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Re-run Nesting'}
              </Button>
            </div>

            {nestingLoading && (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                <p className="text-sm text-muted-foreground">Running nesting algorithm...</p>
              </div>
            )}

            {nestingError && (
              <div className="py-8 text-center">
                <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
                <p className="text-sm text-destructive">{nestingError}</p>
              </div>
            )}

            {nestingResult && (
              <div className="space-y-6">
                {/* Summary */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-800">{nestingResult.summary?.totalParts || 0}</p>
                    <p className="text-xs text-blue-600 font-medium">Total Parts</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-800">{nestingResult.summary?.totalSheets || 0}</p>
                    <p className="text-xs text-emerald-600 font-medium">Sheets Needed</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-amber-800">{nestingResult.summary?.overallUtilization || 0}%</p>
                    <p className="text-xs text-amber-600 font-medium">Utilization</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-purple-800">{nestingResult.summary?.totalSheetsWeightKg ?? nestingResult.summary?.totalWeightKg ?? 0} kg</p>
                    <p className="text-xs text-purple-600 font-medium">Material to buy</p>
                    <p className="text-[10px] text-purple-500 mt-0.5">Finished: {nestingResult.summary?.totalPartsWeightKg ?? '—'} kg</p>
                  </div>
                </div>

                {/* Groups */}
                {nestingResult.groups?.map((group: any, gi: number) => (
                  <div key={gi} className="border rounded-lg overflow-hidden">
                    <div className="bg-slate-100 px-4 py-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm text-slate-800">
                          {group.material} &middot; {group.thickness}mm
                        </h4>
                        <div className="flex items-center gap-3 text-xs text-slate-600">
                          <span className="font-medium">Sheet: {group.sheetSize?.w} x {group.sheetSize?.h}mm</span>
                          <span>{group.totalSheets} sheet{group.totalSheets !== 1 ? 's' : ''}</span>
                          <span>Avg. util: {group.avgUtilization}%</span>
                        </div>
                      </div>
                      {/* Material summary: total dimensions + weight */}
                      <div className="flex items-center gap-4 mt-1.5 text-xs">
                        <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-medium">
                          Total area: {group.totalMaterialDimensions?.totalAreaM2 || '—'} m²
                        </span>
                        <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded font-medium">
                          Material to buy: {group.sheetsWeightKg ?? group.weightKg ?? '—'} kg
                        </span>
                        <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-medium">
                          Finished parts: {group.partsWeightKg ?? '—'} kg
                        </span>
                        <span className="text-slate-500">({group.densityKgM3 || '—'} kg/m³)</span>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      {group.sheets?.map((sheet: any, si: number) => (
                        <div key={si}>
                          <div className="flex flex-col gap-1 mb-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-muted-foreground">
                                Sheet {si + 1} &mdash; {sheet.placements?.length} part{sheet.placements?.length !== 1 ? 's' : ''} &middot; {sheet.utilization}% utilization
                              </p>
                            {sheet.nestedDxfBase64 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => {
                                  const byteCharacters = atob(sheet.nestedDxfBase64);
                                  const byteArray = new Uint8Array(byteCharacters.length);
                                  for (let i = 0; i < byteCharacters.length; i++) {
                                    byteArray[i] = byteCharacters.charCodeAt(i);
                                  }
                                  const blob = new Blob([byteArray], { type: 'application/dxf' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `nested_${group.material}_${group.thickness}mm_sheet${si + 1}.dxf`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                <Download className="h-3 w-3" />
                                DXF
                              </Button>
                            )}
                            </div>
                            {/* Used area info */}
                            {sheet.usedBbox && (
                              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span className="bg-green-50 text-green-800 border border-green-200 px-2 py-0.5 rounded">
                                  Used area: {sheet.usedBbox.w} x {sheet.usedBbox.h} mm
                                </span>
                                <span className="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded">
                                  Part fill: {sheet.usedUtilization || 0}% of used area
                                </span>
                                <span className="bg-orange-50 text-orange-800 border border-orange-200 px-2 py-0.5 rounded">
                                  Finished parts: {sheet.partsWeightKg ?? sheet.usedWeightKg ?? 0} kg
                                </span>
                                <span className="bg-purple-50 text-purple-800 border border-purple-200 px-2 py-0.5 rounded">
                                  Raw sheet: {sheet.sheetWeightKg ?? '—'} kg
                                </span>
                              </div>
                            )}
                          </div>
                          {sheet.previewSvg && (
                            <div
                              className="border rounded bg-white overflow-hidden"
                              dangerouslySetInnerHTML={{ __html: sheet.previewSvg }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Grand Total Summary */}
                {nestingResult.groups?.length > 1 && (
                  <div className="bg-slate-50 border border-slate-300 rounded-lg p-4">
                    <h4 className="font-semibold text-sm text-slate-800 mb-2">Total Material Required</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      {nestingResult.groups.map((group: any, gi: number) => (
                        <div key={gi} className="bg-white rounded border p-2">
                          <p className="text-xs text-muted-foreground">{group.material} {group.thickness}mm</p>
                          <p className="font-medium">{group.totalSheets} x {group.sheetSize?.w}x{group.sheetSize?.h}mm</p>
                          <p className="text-xs text-muted-foreground">{group.totalMaterialDimensions?.totalAreaM2 || '—'} m² &middot; raw {group.sheetsWeightKg ?? group.weightKg ?? '—'} kg / parts {group.partsWeightKg ?? '—'} kg</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 pt-2 border-t flex items-center gap-6 text-sm font-medium">
                      <span>Total Sheets: {nestingResult.summary?.totalSheets || 0}</span>
                      <span>Material to buy: {nestingResult.summary?.totalSheetsWeightKg ?? nestingResult.summary?.totalWeightKg ?? 0} kg</span>
                      <span>Finished parts: {nestingResult.summary?.totalPartsWeightKg ?? '—'} kg</span>
                      <span>Overall Utilization: {nestingResult.summary?.overallUtilization || 0}%</span>
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {nestingResult.warnings?.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-yellow-800 mb-1">Warnings</p>
                    <ul className="text-xs text-yellow-700 list-disc pl-4 space-y-0.5">
                      {nestingResult.warnings.map((w: string, i: number) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Customer Assignment Dialog */}
        <CustomerSearchAssign
          currentCustomerId={rfq?.customer_id}
          onCustomerSelect={handleCustomerAssign}
          isOpen={isCustomerAssignDialogOpen}
          onClose={() => setIsCustomerAssignDialogOpen(false)}
          title="Assign Customer to RFQ"
          description="Search and assign a customer to this RFQ"
        />
      </div>

      {/* 3D Viewer Modal */}
      {viewerFile && (
        <ThreeDViewerModal
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          fileUrl={viewerFile.url}
          fileType={viewerFile.type}
          fileName={viewerFile.name}
        />
      )}

      {/* Technical Drawing Viewer */}
      <Dialog
        open={drawingViewer.open}
        onOpenChange={(open) =>
          setDrawingViewer((s) => ({ ...s, open }))
        }
      >
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Technical drawing — {drawingViewer.file?.file_name || 'Part'}
            </DialogTitle>
          </DialogHeader>
          {drawingViewer.loading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Generating flat pattern…
            </div>
          ) : (
            <TechnicalDrawingViewer
              flatPattern={drawingViewer.data}
              partName={
                drawingViewer.file?.file_name?.replace(/\.[^.]+$/, '') || 'Part'
              }
              material={
                drawingViewer.item
                  ? buildPartInfo(drawingViewer.file as QuoteFile, drawingViewer.item).material
                  : undefined
              }
              onDownloadPdf={
                drawingViewer.file && drawingViewer.item
                  ? () =>
                      handleManufacturingDrawing(
                        drawingViewer.file as QuoteFile,
                        drawingViewer.item,
                      )
                  : undefined
              }
              onDownloadDxf={
                drawingViewer.data?.dxf_base64
                  ? () =>
                      downloadDxfFromBase64(
                        drawingViewer.data!.dxf_base64!,
                        (drawingViewer.file?.file_name?.replace(/\.[^.]+$/, '') ||
                          'part') + '_flat.dxf',
                      )
                  : undefined
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </ErrorBoundary>
  );
};

export default RfqDetails;
