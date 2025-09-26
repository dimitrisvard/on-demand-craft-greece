import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from "@/integrations/supabase/client";
import { Order, OrderItem, Partner } from "@/types/customer";
import { BackToDashboardButton } from "@/components/dashboard/BackToDashboardButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { 
  Calendar, 
  Package, 
  Download, 
  Trash2, 
  Factory,
  FileText,
  Edit3,
  Save,
  X
} from "lucide-react";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  Dialog,
  DialogContent, 
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CustomerDetailsPanel } from "@/components/customers/CustomerDetailsPanel";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { downloadAndSaveFile } from "@/utils/fileStorage";
import ThreeDViewerModal from '@/components/ThreeDViewerModal';
import { downloadAllRfqFiles, getRfqFiles } from '@/utils/rfqFileStorage';
import { getSignedUrl } from '@/utils/awsS3Storage';
import { useAuth } from '@/contexts/AuthContext';
import { trackFileDownload, trackUserInteraction } from '@/utils/analytics';

interface QuoteFile {
  id: string;
  rfq_id: string;
  part_id?: string | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at?: string;
}

interface QuoteRequestPart {
  id: string;
  name: string;
  material: string;
  material_other?: string;
  quantity: number;
  tolerance?: string;
  comments?: string;
  manufacturing_processes: string[];
  surface_finish?: string; // Added surface finish field
}

export default function OrderDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [quoteFiles, setQuoteFiles] = useState<QuoteFile[]>([]);
  const [parts, setParts] = useState<QuoteRequestPart[]>([]);
  const [partFiles, setPartFiles] = useState<Record<string, QuoteFile[]>>({});
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const { toast } = useToast();
  const pdfContentRef = useRef<HTMLDivElement>(null);
  // 3D Viewer modal state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFileUrl, setViewerFileUrl] = useState<string | null>(null);
  const [viewerFileType, setViewerFileType] = useState<string | null>(null);
  const [viewerFileName, setViewerFileName] = useState<string | null>(null);
  const [rfq, setRfq] = useState<any>(null);
  const { user } = useAuth();

  // Helper function to check if a file is a 3D model
  const is3DFile = (fileName: string): boolean => {
    const threeDExtensions = ['.stl', '.obj', '.fbx', '.dae', '.3ds', '.blend', '.max', '.ma', '.mb', '.c4d'];
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return threeDExtensions.includes(extension);
  };

  useEffect(() => {
    fetchOrderDetails();
    fetchPartners();
  }, [id]);

  const fetchOrderDetails = async () => {
    if (!id) return;
    try {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*, customers(*)')
        .eq('id', id)
        .single();
      if (orderError) throw orderError;
      setOrder({
        ...orderData as Order,
        customer_name: orderData.customers?.company_name
      });
      setCustomer(orderData.customers);
      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);
      if (itemsError) throw itemsError;
      setOrderItems(itemsData as OrderItem[]);
      if (orderData.rfq_id) {
        // Fetch RFQ and its parts_details
        const { data: rfqData, error: rfqError } = await supabase
          .from('rfqs')
          .select('*')
          .eq('id', orderData.rfq_id)
          .single();
        if (rfqError) throw rfqError;
        setRfq(rfqData);
        // Defensive: parts_details may be undefined or not an array
        const partsDetails = (rfqData as any).parts_details;
        setParts(Array.isArray(partsDetails) ? partsDetails : []);
        // Fetch files from rfq_files and organize them by parts
        await fetchQuoteFiles(orderData.rfq_id, partsDetails);
      }
      if (orderData.partner_id) {
        setSelectedPartnerId(orderData.partner_id);
      }
    } catch (error: any) {
      console.error('Error fetching order details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load order details',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch and organize files by parts like in RFQ page
  const fetchQuoteFiles = async (rfqId: string, partsDetails: any[]) => {
    try {
      setIsProcessingFiles(true);
      console.log('Fetching quote files for RFQ:', rfqId);
      
      // Validate inputs
      if (!rfqId) {
        console.warn('No RFQ ID provided to fetchQuoteFiles');
        return;
      }
      
      if (!Array.isArray(partsDetails)) {
        console.warn('partsDetails is not an array:', partsDetails);
        return;
      }
      
      const files = await getRfqFiles(rfqId);
      console.log('Files retrieved:', files);
      setQuoteFiles(files as QuoteFile[]);
      
      // Organize files by parts
      const general: QuoteFile[] = [];
      const byPart: Record<string, QuoteFile[]> = {};
      
      // Get the list of part IDs from partsDetails
      const partIds = partsDetails.map(item => item.id).filter(Boolean);
      
      // Create mapping of part name to part ID for matching by name
      const partNameToId: Record<string, string> = {};
      partsDetails.forEach(item => {
        // Get the name property (could be 'name' or 'product_name')
        const itemName = item.name || item.product_name;
        if (!itemName) {
          console.warn('Item missing name property:', item);
          return;
        }
        
        // Clean part name for matching
        const cleanName = itemName.replace(/\s+/g, '-').toLowerCase();
        partNameToId[cleanName] = item.id;
        
        // Also add simplified versions
        if (cleanName.includes('part-')) {
          const simpleName = cleanName.replace('part-', '');
          partNameToId[simpleName] = item.id;
        }
        
        // Add the original name as well
        partNameToId[itemName.toLowerCase()] = item.id;
      });
      
      console.log('Part name to ID mapping:', partNameToId);
      
      files.forEach(file => {
        try {
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
                for (const item of partsDetails) {
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
                  
                  // Try matching directly with partsDetails
                  if (!matchedPartId) {
                    for (const item of partsDetails) {
                      const itemName = item.name || item.product_name;
                      if (!itemName) continue;
                      
                      const itemNameClean = itemName.toLowerCase().replace(/\s+/g, '-');
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
        } catch (fileError) {
          console.error('Error processing file:', file, fileError);
          // Add to general files as fallback
          general.push(file);
        }
      });
      
      console.log('General files:', general.length);
      console.log('Files by part:', Object.keys(byPart).map(k => `${k}: ${byPart[k].length}`));
      
      // Store the organized files in state for PDF generation
      setPartFiles(byPart);
      
      // Debug: Log the final state
      console.log('Final partFiles state set to:', byPart);
      console.log('Parts details:', partsDetails);
      console.log('Quote files:', files);
      
    } catch (error) {
      console.error('Error fetching quote files:', error);
    } finally {
      setIsProcessingFiles(false);
    }
  };

  const fetchPartners = async () => {
    try {
      const { data, error } = await supabase
        .from('production_partners')
        .select('*')
        .eq('active', true)
        .order('company_name');

      if (error) throw error;
      
      const mappedData = data ? data.map(partner => ({
        ...partner,
        partner_id: partner.id
      })) as Partner[] : [];
      
      setPartners(mappedData);
    } catch (error: any) {
      console.error('Error fetching partners:', error);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    
    try {
      const { error: itemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', id);
        
      if (itemsError) throw itemsError;
        
      const { error: orderError } = await supabase
        .from('orders')
        .delete()
        .eq('id', id);
        
      if (orderError) throw orderError;
      
      toast({
        title: "Success",
        description: "Order deleted successfully",
      });
      
      navigate('/orders');
    } catch (error: any) {
      console.error('Error deleting order:', error);
      toast({
        title: "Error",
        description: "Failed to delete order",
        variant: "destructive",
      });
    }
  };

  const generateOrderId = () => {
    if (!order) return 'PO-DDMMYYYY-1';
    
    const orderDate = new Date(order.created_at);
    const day = String(orderDate.getDate()).padStart(2, '0');
    const month = String(orderDate.getMonth() + 1).padStart(2, '0');
    const year = orderDate.getFullYear();
    
    return `PO-${day}${month}${year}-1`;
  };
  
  // Helper: Generate 3D model screenshot
  const generate3DModelScreenshot = async (partId: string): Promise<string | null> => {
    if (!order?.rfq_id) return null;
    
    try {
      // Get 3D files for this part
      const files = await getRfqFiles(order.rfq_id, partId);
      const modelFiles = files.filter(file => is3DFile(file.file_name));
      
      if (modelFiles.length === 0) return null;
      
      // Use the first 3D model file
      const modelFile = modelFiles[0];
      
      // Create a simple placeholder image with model information
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        // Background
        ctx.fillStyle = '#2d3748';
        ctx.fillRect(0, 0, 200, 150);
        
        // Border
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 2;
        ctx.strokeRect(4, 4, 192, 142);
        
        // 3D icon
        ctx.fillStyle = '#718096';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🧊', 100, 60);
        
        // File type
        ctx.fillStyle = '#a0aec0';
        ctx.font = '12px Arial';
        ctx.fillText(modelFile.file_name.split('.').pop()?.toUpperCase() || '3D', 100, 85);
        
        // Model name
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10px Arial';
        const fileName = modelFile.file_name.length > 15 
          ? modelFile.file_name.substring(0, 12) + '...' 
          : modelFile.file_name;
        ctx.fillText(fileName, 100, 105);
        
        // "3D Model" text
        ctx.fillStyle = '#cbd5e0';
        ctx.font = '8px Arial';
        ctx.fillText('3D Model', 100, 120);
      }
      
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error generating 3D model screenshot:', error);
      return null;
    }
  };

  // Helper: Capture screenshot from 3D viewer
  const capture3DViewerScreenshot = async (file: QuoteFile): Promise<string | null> => {
    try {
      const url = await getSignedUrl(file.file_path);
      if (!url) return null;
      
      // Create a temporary container for the 3D viewer
      const container = document.createElement('div');
      container.style.width = '200px';
      container.style.height = '150px';
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.background = '#2d3748';
      document.body.appendChild(container);
      
      // Create a simple 3D viewer component
      const viewerHtml = `
        <div style="width:200px;height:150px;background:#2d3748;border:2px solid #4a5568;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:24px;color:#718096;">🧊</div>
          <div style="font-size:12px;color:#a0aec0;margin-top:8px;">${file.file_name.split('.').pop()?.toUpperCase() || '3D'}</div>
          <div style="font-size:10px;color:#e2e8f0;margin-top:4px;text-align:center;max-width:180px;overflow:hidden;text-overflow:ellipsis;">
            ${file.file_name.length > 15 ? file.file_name.substring(0, 12) + '...' : file.file_name}
          </div>
          <div style="font-size:8px;color:#cbd5e0;margin-top:4px;">3D Model</div>
        </div>
      `;
      
      container.innerHTML = viewerHtml;
      
      // Convert to canvas
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 150;
      
      // Use html2canvas to capture the viewer
      const screenshot = await html2canvas(container, { 
        scale: 2,
        backgroundColor: '#2d3748',
        width: 200,
        height: 150
      });
      
      // Cleanup
      document.body.removeChild(container);
      
      return screenshot.toDataURL('image/png');
    } catch (error) {
      console.error('Error capturing 3D viewer screenshot:', error);
      return null;
    }
  };

  const downloadPdf = async () => {
    if (!order || !customer) return;

    // Check if files are still being loaded
    if (isProcessingFiles) {
      toast({
        title: 'Please wait',
        description: 'Files are still being organized. Please try again in a moment.',
        variant: 'destructive',
      });
      return;
    }

    // Check if user is a partner
    const isPartner = user?.role === 'partner_seller';

    // Use the organized partFiles state instead of creating a local variable
    // The partFiles state is populated by fetchQuoteFiles function

    // Generate file list for all items using organized files
    const itemsWithFiles = orderItems.map((item) => {
      let filesForItem = [];
      
      // Find the corresponding RFQ part for this order item
      const correspondingPart = parts.find(part => part.name === item.product_name);
      
      console.log(`Processing item: ${item.product_name}`);
      console.log(`Corresponding RFQ part:`, correspondingPart);
      console.log(`Available partFiles keys:`, Object.keys(partFiles));
      
      if (correspondingPart && partFiles[correspondingPart.id]) {
        // Use the same logic as RFQ section: partFiles[part.id]
        console.log(`Files for part ${correspondingPart.id}:`, partFiles[correspondingPart.id]);
        filesForItem = partFiles[correspondingPart.id].map(f => {
          if (f.file_path) {
            const pathParts = f.file_path.split('/');
            return pathParts[pathParts.length - 1] || f.file_name;
          }
          return f.file_name;
        });
        console.log(`Processed files for item:`, filesForItem);
      } else {
        // WORKAROUND: If no part found, try to find files by searching through all files
        console.log(`No corresponding part found, trying workaround...`);
        
        // Search through all quoteFiles to find files that might belong to this item
        const potentialFiles = quoteFiles.filter(file => {
          const productNameLower = item.product_name.toLowerCase();
          const fileNameLower = file.file_name.toLowerCase();
          const filePathLower = file.file_path.toLowerCase();
          
          // Try to match by file name containing product name
          if (fileNameLower.includes(productNameLower) || productNameLower.includes(fileNameLower)) {
            return true;
          }
          
          // Try to match by file path containing product name
          if (filePathLower.includes(productNameLower)) {
            return true;
          }
          
          // Try to match by part number patterns (e.g., "Part 1" matching "part-1")
          const partNumberMatch = productNameLower.match(/part\s*(\d+)/i);
          if (partNumberMatch) {
            const partNum = partNumberMatch[1];
            if (filePathLower.includes(`part-${partNum}`) || filePathLower.includes(`part_${partNum}`)) {
              return true;
            }
          }
          
          return false;
        });
        
        console.log(`Found ${potentialFiles.length} potential files for item ${item.product_name}:`, potentialFiles);
        
        filesForItem = potentialFiles.map(f => {
          if (f.file_path) {
            const pathParts = f.file_path.split('/');
            return pathParts[pathParts.length - 1] || f.file_name;
          }
          return f.file_name;
        });
      }
      
      return {
        ...item,
        files: filesForItem
      };
    });
    
    console.log('Final itemsWithFiles:', itemsWithFiles);

    // Prepare the data structure for PDF
    const data = {
      seller: {
        company_name: 'Microns Hub',
        address_lines: [
          'Kosti Fragkouli 3',
          'Heraklion Greece 71414',
          '+30-697-00-77-401',
          'info@micronshub.eu',
          'VAT ID EL137232320'
        ],
      },
      buyer: isPartner ? {
        name: '',
        company: '',
        address_lines: [''],
        country: '',
      } : {
        name: customer.first_name + ' ' + customer.last_name,
        company: customer.company_name,
        address_lines: [customer.street_address, customer.city + ', ' + customer.zip_code],
        country: customer.country,
      },
      order_id: generateOrderId(),
      title: order.title,
      date: order.created_at,
      start_date: order.start_date,
      delivery_date: order.delivery_date,
      status: order.status,
      partner: partners.find(p => p.id === order.partner_id)?.company_name || '',
      items: itemsWithFiles.map((item) => ({
        product_name: item.product_name,
        description: item.description || '',
        quantity: item.quantity,
        files: item.files,
        // Hide prices for partners and make them blank as requested
        unit_price: null,
        total_price: null,
      })),
      conditions: {
        delivery_time: '21 working days',
        shipping_terms: 'CIP',
        payment_terms: '14 days net',
        validity_days: '14 days',
      },
      footer_notes: [
        'This order is subject to our general terms and conditions.',
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

    // Use an absolute path for the logo and set width for reliability
    const logoHtml = `<img src='/logo.png' style="width:180px;height:auto;display:block;" />`;

    // Build the HTML for the PDF (header, info, items table, conditions, footer)
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
          <b>Order ID:</b> ${data.order_id}<br/>
          <b>Order Title:</b> ${data.title}<br/>
          <b>Order Date:</b> ${format(new Date(data.date), 'yyyy-MM-dd')}<br/>
          <b>Start Date:</b> ${data.start_date ? format(new Date(data.start_date), 'yyyy-MM-dd') : 'Not set'}<br/>
          <b>Delivery Date:</b> ${data.delivery_date ? format(new Date(data.delivery_date), 'yyyy-MM-dd') : 'Not set'}<br/>
          <b>Status:</b> ${data.status.toUpperCase()}<br/>
          ${data.partner ? `<b>Production Partner:</b> ${data.partner}` : ''}
        </div>
      </div>
      <h2 style="text-align:center;margin:24px 0 8px 0; color:#1a237e;">PURCHASE ORDER</h2>
      <table style="width:100%;border-collapse:collapse;margin-top:24px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="border:1px solid #ccc;padding:6px;">Item</th>
            <th style="border:1px solid #ccc;padding:6px;">Files</th>
            <th style="border:1px solid #ccc;padding:6px;">Description</th>
            <th style="border:1px solid #ccc;padding:6px;">Quantity</th>
          </tr>
        </thead>
        <tbody>
          ${data.items.map(item => `
            <tr>
              <td style="border:1px solid #ccc;padding:6px;">${item.product_name}</td>
              <td style="border:1px solid #ccc;padding:6px;white-space:pre-line;color:#1976d2;font-size:10px;">
                ${item.files && item.files.length > 0 ? item.files.join('<br/>') : '—'}
              </td>
              <td style="border:1px solid #ccc;padding:6px;white-space:pre-line;">${item.description}</td>
              <td style="border:1px solid #ccc;padding:6px;text-align:right;">${item.quantity}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:24px;float:right;width:320px;">
        <table style="width:100%;font-size:13px;background:#f5f7fa;border-radius:8px;box-shadow:0 1px 4px #e0e0e0;">
          <tr><td style="color:#333;">Total Amount:</td><td style="text-align:right;color:#333;">—</td></tr>
          <tr><td style="color:#333;">Currency:</td><td style="text-align:right;color:#333;">—</td></tr>
          <tr style="font-weight:bold;"><td style="padding:8px 0 8px 8px;">Shipping Cost:</td><td style="text-align:right;padding:8px 8px 8px 0;">—</td></tr>
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
        <strong>This order is subject to our general terms and conditions.</strong><br/><br/>
        All prices and shipping costs will be provided separately. Should you have any questions, please do not hesitate to call us at <strong>+30-697-00-77-401</strong>
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

    document.body.appendChild(container);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for DOM
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
    const canvas = await html2canvas(container, { scale: 4, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const imgProps = pdf.getImageProperties(imgData);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pdfWidth = pageWidth - 20; // 10mm margin each side
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth, pdfHeight);
    pdf.setFontSize(9);
    pdf.text(`Page 1`, pageWidth - 30, pageHeight - 10);

    pdf.save(`order_${data.order_id}.pdf`);
    document.body.removeChild(container);
    
    // Track PDF download
    trackFileDownload(`order_${data.order_id}.pdf`, 'pdf');
    trackUserInteraction('download', 'order_pdf');
    
    toast({
      title: 'Success',
      description: 'PDF downloaded successfully',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <Badge>New</Badge>;
      case 'in_progress':
        return <Badge variant="default">In Progress</Badge>;
      case 'completed':
        return <Badge variant="secondary">Completed</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getProductionStatusBadge = (productionStatus?: string) => {
    if (!productionStatus) return null;
    
    switch (productionStatus) {
      case 'pending':
        return <Badge variant="outline" className="ml-2">Pending Production</Badge>;
      case 'in_production':
        return <Badge variant="default" className="ml-2 bg-blue-600">In Production</Badge>;
      case 'ready':
        return <Badge variant="default" className="ml-2 bg-green-600">Ready for Delivery</Badge>;
      case 'completed':
        return <Badge variant="secondary" className="ml-2">Production Completed</Badge>;
      default:
        return <Badge variant="outline" className="ml-2">{productionStatus}</Badge>;
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

  const handleEditToggle = () => {
    if (order?.partner_id) {
      setSelectedPartnerId(order.partner_id);
    }
    setIsEditMode(!isEditMode);
  };

  const handleSaveChanges = async () => {
    if (!order || !id) return;
    
    try {
      const previousPartnerId = order.partner_id;
      const newPartnerId = selectedPartnerId || order.partner_id;
      
      const { error } = await supabase
        .from('orders')
        .update({
          title: order.title,
          status: order.status,
          partner_id: newPartnerId,
          start_date: order.start_date,
          delivery_date: order.delivery_date,
          total_amount: order.total_amount,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
        
      if (error) throw error;
      
      // Send partner notification if a new partner is assigned
      if (newPartnerId && newPartnerId !== previousPartnerId) {
        try {
          const { notifyPartnerOfOrderAssignment } = await import('../utils/partnerNotificationUtils');
          await notifyPartnerOfOrderAssignment(
            id,
            newPartnerId,
            order.title,
            order.start_date || new Date().toISOString(),
            order.delivery_date || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            order.total_amount,
            order.currency || 'EUR'
          );
        } catch (notificationError) {
          console.error('Failed to send partner notification:', notificationError);
          // Don't fail the order update if notification fails
        }
      }
      
      toast({
        title: "Success",
        description: "Order updated successfully",
      });
      
      setIsEditMode(false);
      fetchOrderDetails();
    } catch (error: any) {
      console.error('Error updating order:', error);
      toast({
        title: "Error",
        description: "Failed to update order",
        variant: "destructive",
      });
    }
  };

  const handleCancelEdit = () => {
    setIsEditMode(false);
    // Reset to original values
    fetchOrderDetails();
  };

  const handleProductionStatusChange = async (newStatus: 'in_production' | 'ready') => {
    if (!order || !id) return;
    
    try {
      const updateData: any = { production_status: newStatus };
      
      // If starting production, update the start_date to current date
      if (newStatus === 'in_production' && order.production_status !== 'in_production') {
        updateData.start_date = new Date().toISOString();
      }
      
      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', id);
        
      if (error) throw error;
      
      // Update local state
      setOrder(prev => prev ? { 
        ...prev, 
        production_status: newStatus,
        start_date: newStatus === 'in_production' ? new Date().toISOString() : prev.start_date
      } : null);
      
      // Send email notification
      try {
        const partner = partners.find(p => p.id === order.partner_id);
        if (partner) {
          await fetch('/api/send-production-status-notification', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              partnerName: partner.company_name,
              orderId: order.id,
              orderTitle: order.title,
              status: newStatus === 'in_production' ? 'started' : 'finished',
              startDate: newStatus === 'in_production' ? new Date().toISOString() : order.start_date,
              deliveryDate: order.delivery_date,
              totalAmount: order.total_amount,
              currency: order.currency
            }),
          });
        }
      } catch (emailError) {
        console.error('Error sending production status notification:', emailError);
        // Don't fail the main operation if email fails
      }
      
      toast({
        title: "Success",
        description: `Order status updated to ${newStatus === 'in_production' ? 'In Production' : 'Ready'}`,
      });
    } catch (error: any) {
      console.error('Error updating production status:', error);
      toast({
        title: "Error",
        description: "Failed to update production status",
        variant: "destructive",
      });
    }
  };

  const handleProductionCostsUpdate = async (costs: {
    material_costs: number;
    working_hours_costs: number;
    total_production_costs: number;
  }) => {
    if (!order || !id) return;
    
    try {
      const { error } = await supabase
        .from('orders')
        .update(costs)
        .eq('id', id);
        
      if (error) throw error;
      
      // Update local state
      setOrder(prev => prev ? { ...prev, ...costs } : null);
      
      toast({
        title: "Success",
        description: "Production costs updated successfully",
      });
    } catch (error: any) {
      console.error('Error updating production costs:', error);
      toast({
        title: "Error",
        description: "Failed to update production costs",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!order) return;
    setOrder({
      ...order,
      status: e.target.value as any
    });
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (!order) return;
    const { name, value, type } = e.target;
    
    if (type === 'number') {
      setOrder({
        ...order,
        [name]: parseFloat(value)
      });
    } else {
      setOrder({
        ...order,
        [name]: value
      });
    }
  };

  const handleDownloadFile = async (filePath: string, fileName?: string) => {
    try {
      await downloadAndSaveFile(filePath, fileName);
      
      // Track file download
      if (fileName) {
        const fileExtension = fileName.split('.').pop() || 'unknown';
        trackFileDownload(fileName, fileExtension);
      }
      
      toast({
        title: "Download started",
        description: `Downloading ${fileName || 'file'}`,
      });
    } catch (error: any) {
      console.error('Download error:', error);
      toast({
        title: "Download Error",
        description: error.message || "Failed to download file",
        variant: "destructive",
      });
    }
  };

  const getFilesForPart = (partId: string | null) => {
    if (!partId) return [];
    return quoteFiles.filter(file => file.part_id === partId);
  };
  
  const getGeneralFiles = () => {
    return quoteFiles.filter(file => file.part_id === null);
  };

  // Helper: Download all files as zip (using RFQ number and ID)
  const handleDownloadAllFiles = async () => {
    if (!order?.rfq_id || !rfq?.rfq_number) {
      toast({ title: 'Error', description: 'Missing RFQ info', variant: 'destructive' });
      return;
    }
    await downloadAllRfqFiles(order.rfq_id, rfq.rfq_number);
  };

  // Helper: Download all files for a part as zip
  const handleDownloadPartFiles = async (partId: string, partName: string) => {
    if (!order?.rfq_id) return;
    // Get all files for this part
    const files = await getRfqFiles(order.rfq_id, partId);
    if (!files.length) {
      toast({ title: 'No files', description: 'No files for this part', variant: 'destructive' });
      return;
    }
    // Use JSZip to zip and download
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const downloadPromises = files.map(async (file) => {
      const signedUrl = await getSignedUrl(file.file_path);
      if (!signedUrl) return null;
      const response = await fetch(signedUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      zip.file(file.file_name, blob);
      return file.file_name;
    });
    await Promise.all(downloadPromises);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `${partName.replace(/\s+/g, '_')}-Files.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper: Open 3D viewer modal for a file
  const handleOpen3DViewer = async (file: QuoteFile) => {
    const url = await getSignedUrl(file.file_path);
    setViewerFileUrl(url);
    setViewerFileType(file.file_type);
    setViewerFileName(file.file_name);
    setViewerOpen(true);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-8 bg-gray-200 rounded w-1/2"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <BackToDashboardButton />
        <div className="text-center mt-8">
          <h2 className="text-2xl font-bold">Order not found</h2>
          <p className="text-muted-foreground mt-2">The order you're looking for doesn't exist.</p>
          <Button className="mt-4" onClick={() => navigate('/dashboard')}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 pt-20 space-y-6">
      <div className="flex justify-between items-center">
        <BackToDashboardButton />
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => navigate('/orders')}>
            Back to Orders
          </Button>
          <Button 
            variant="outline" 
            onClick={downloadPdf}
            disabled={isProcessingFiles}
            title={isProcessingFiles ? "Files are being organized..." : "Download PDF"}
          >
            <Download className="h-4 w-4 mr-2" />
            {isProcessingFiles ? "Processing..." : "Download PDF"}
          </Button>
          {user?.role === 'partner_seller' && order?.partner_id && (
            <div className="flex gap-2">
              <Button
                variant="default"
                onClick={() => handleProductionStatusChange('in_production')}
                disabled={order.production_status === 'in_production'}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Factory className="h-4 w-4 mr-2" />
                Start Production
              </Button>
              <Button
                variant="default"
                onClick={() => handleProductionStatusChange('ready')}
                disabled={order.production_status === 'ready' || order.production_status === 'completed'}
                className="bg-green-600 hover:bg-green-700"
              >
                <Package className="h-4 w-4 mr-2" />
                Order Ready
              </Button>
            </div>
          )}
          {user?.role !== 'partner_seller' && (
            <>
          {!isEditMode ? (
            <Button variant="outline" onClick={handleEditToggle}>
              <Edit3 className="h-4 w-4 mr-2" />
              Edit Order
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button onClick={handleSaveChanges}>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
              <Button variant="outline" onClick={handleCancelEdit}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          )}
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <Card className="md:col-span-7">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                {isEditMode ? (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="edit_title" className="text-sm font-medium">Order Title</Label>
                      <input
                        id="edit_title"
                        name="title"
                        value={order.title}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="edit_status" className="text-sm font-medium">Status</Label>
                        <select
                          id="edit_status"
                          name="status"
                          value={order.status}
                          onChange={handleStatusChange}
                          className="w-full p-2 border rounded mt-1"
                        >
                          <option value="new">New</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor="edit_partner" className="text-sm font-medium">Production Partner</Label>
                        <select
                          id="edit_partner"
                          value={selectedPartnerId}
                          onChange={(e) => setSelectedPartnerId(e.target.value)}
                          className="w-full p-2 border rounded mt-1"
                        >
                          <option value="">Select a partner...</option>
                          {partners.map((partner) => (
                            <option key={partner.id} value={partner.id}>
                              {partner.company_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <CardTitle>{order.title}</CardTitle>
                    <div className="flex items-center space-x-2 mt-1">
                      <p className="text-sm text-muted-foreground">
                        Order ID: <span className="font-mono">{generateOrderId()}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        | Order for {user?.role === 'partner_seller' ? '' : order?.customer_name}
                      </p>
                    </div>
                  </>
                )}
              </div>
              {!isEditMode && (
                <div className="flex items-center space-x-4">
                  <div className="flex items-center">
                    {getStatusBadge(order.status)}
                    {getProductionStatusBadge(order.production_status)}
                  </div>
                  {(user?.role === 'admin' || user?.role === 'partner_seller') && (
                    <ProductionCostsBox 
                      order={order}
                      onUpdate={handleProductionCostsUpdate}
                    />
                  )}
                  {/* Debug info - remove in production */}
                  {process.env.NODE_ENV === 'development' && (
                    <div className="text-xs text-gray-500">
                      Debug: User role = {user?.role || 'undefined'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium mb-2">Order Details</h3>
                <div className="space-y-2">
                  {isEditMode ? (
                    <div>
                      <Label htmlFor="edit_total_amount" className="text-sm font-medium">Total Amount</Label>
                      <input
                        id="edit_total_amount"
                        name="total_amount"
                        type="number"
                        value={order.total_amount}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded mt-1"
                        disabled={user?.role === 'partner_seller'}
                      />
                    </div>
                  ) : (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Total Amount:</span>{' '}
                      {user?.role === 'partner_seller' ? '' : formatCurrency(order.total_amount, order.currency)}
                    </p>
                  )}
                  <p className="text-sm">
                    <span className="text-muted-foreground">Created:</span>{' '}
                    {format(new Date(order.created_at), 'PPP')}
                  </p>
                  {order.partner_id && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Production Partner:</span>{' '}
                      {partners.find(p => p.id === order.partner_id)?.company_name || 'Assigned'}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="font-medium mb-2">Production Schedule</h3>
                <div className="space-y-2">
                  {isEditMode ? (
                    <div className="space-y-2">
                      <div>
                        <Label htmlFor="edit_start_date" className="text-sm font-medium">Start Date</Label>
                        <input
                          id="edit_start_date"
                          name="start_date"
                          type="date"
                          value={order.start_date ? new Date(order.start_date).toISOString().split('T')[0] : ''}
                          onChange={handleInputChange}
                          className="w-full p-2 border rounded mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="edit_delivery_date" className="text-sm font-medium">Delivery Date</Label>
                        <input
                          id="edit_delivery_date"
                          name="delivery_date"
                          type="date"
                          value={order.delivery_date ? new Date(order.delivery_date).toISOString().split('T')[0] : ''}
                          onChange={handleInputChange}
                          className="w-full p-2 border rounded mt-1"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Start Date:</span>{' '}
                        {order.start_date ? format(new Date(order.start_date), 'PPP') : 'Not set'}
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Delivery Date:</span>{' '}
                        {order.delivery_date ? format(new Date(order.delivery_date), 'PPP') : 'Not set'}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* General files */}
            {isProcessingFiles && (
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center gap-2 text-blue-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-sm">Organizing files...</span>
                </div>
              </div>
            )}
            
            {getGeneralFiles().length > 0 && (
              <div className="border-t pt-4 mt-4">
                <h3 className="font-medium mb-2">Quote Files</h3>
                <div className="flex flex-wrap gap-2">
                  {getGeneralFiles().map((file) => (
                    <Button
                      key={file.id}
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadFile(file.file_path, file.file_name)}
                      className="flex items-center gap-1"
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      <span className="truncate max-w-[150px]">{file.file_name}</span>
                      <Download className="h-4 w-4 ml-1" />
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Add Download All Files as Zip button if there are any files */}
            {quoteFiles.length > 0 && (
              <div className="mb-4 flex gap-2">
                <Button variant="outline" onClick={handleDownloadAllFiles}>
                  <Download className="h-4 w-4 mr-2" />
                  Download All Files (Zip)
                </Button>
              </div>
            )}



            <div>
              <h3 className="font-medium mb-4">Order Items</h3>
              {console.log('Parts array:', parts)}
              {console.log('Quote files:', quoteFiles)}
              <div className="border rounded-lg divide-y">
                {orderItems.map((item, idx) => {
                  // Find files associated with this order item
                  let itemFiles: QuoteFile[] = [];
                  
                  // First try to match by part_id if we have parts data
                  if (parts[idx] && parts[idx].id) {
                    // Match by part_id (most reliable)
                    itemFiles = quoteFiles.filter(file => file.part_id === parts[idx].id);
                    console.log(`Part ${idx + 1} (${parts[idx].id}): Found ${itemFiles.length} files`, itemFiles.map(f => f.file_name));
                  } else {
                    // Fallback: try to match by part name or index-based matching
                    itemFiles = quoteFiles.filter(file => {
                      // Try to match by part name
                      if (file.part_name === item.product_name) return true;
                      
                      // Try to match by checking if the file name contains part indicators
                      const productNameLower = item.product_name.toLowerCase();
                      const fileNameLower = file.file_name.toLowerCase();
                      
                      // Check if file name contains part number from product name
                      const partNumberMatch = productNameLower.match(/part\s*(\d+)/i);
                      if (partNumberMatch) {
                        const partNum = partNumberMatch[1];
                        return fileNameLower.includes(`-${partNum}.`) || fileNameLower.includes(`-${partNum}-`);
                      }
                      
                      return false;
                    });
                    console.log(`Part ${idx + 1} (fallback): Found ${itemFiles.length} files`, itemFiles.map(f => f.file_name));
                  }
                  
                  return (
                  <div key={item.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium">{item.product_name}</h4>
                        {item.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {item.description}
                          </p>
                        )}
                          {/* Add files information */}
                          {itemFiles.length > 0 && (
                            <div className="mt-2">
                              <p className="text-sm font-medium text-gray-700">Files:</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {itemFiles.map((file) => (
                                  <span key={file.id} className="text-xs bg-gray-100 px-2 py-1 rounded">
                                    {file.file_name}
                                  </span>
                                ))}
                              </div>
                            </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-medium">
                          {user?.role === 'partner_seller' ? '' : formatCurrency(item.total_price, order.currency)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} × {user?.role === 'partner_seller' ? '' : formatCurrency(item.unit_price, order.currency)}
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {customer && user?.role !== 'partner_seller' && (
          <div className="md:col-span-5">
            <CustomerDetailsPanel customer={customer} />
          </div>
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Order</DialogTitle>
          </DialogHeader>
          <p>Are you sure you want to delete this order? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3D Viewer Modal */}
      <ThreeDViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        fileUrl={viewerFileUrl}
        fileType={viewerFileType}
        fileName={viewerFileName}
      />
    </div>
  );
}

// Production Costs Box Component
const ProductionCostsBox = ({ 
  order, 
  onUpdate 
}: { 
  order: Order | null; 
  onUpdate: (costs: { material_costs: number; working_hours_costs: number; total_production_costs: number }) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [costs, setCosts] = useState({
    material_costs: order?.material_costs || 0,
    working_hours_costs: order?.working_hours_costs || 0,
    total_production_costs: order?.total_production_costs || 0,
  });

  useEffect(() => {
    setCosts({
      material_costs: order?.material_costs || 0,
      working_hours_costs: order?.working_hours_costs || 0,
      total_production_costs: order?.total_production_costs || 0,
    });
  }, [order]);

  const handleInputChange = (field: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setCosts(prev => ({
      ...prev,
      [field]: numValue,
      total_production_costs: field === 'material_costs' || field === 'working_hours_costs' 
        ? (field === 'material_costs' ? numValue : prev.material_costs) + 
          (field === 'working_hours_costs' ? numValue : prev.working_hours_costs)
        : prev.total_production_costs
    }));
  };

  const handleSave = () => {
    onUpdate(costs);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setCosts({
      material_costs: order?.material_costs || 0,
      working_hours_costs: order?.working_hours_costs || 0,
      total_production_costs: order?.total_production_costs || 0,
    });
    setIsEditing(false);
  };

  return (
    <Card className="w-80">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center">
          <Factory className="h-5 w-5 mr-2" />
          Production Costs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <>
            <div className="space-y-3">
              <div>
                <Label htmlFor="material_costs" className="text-sm font-medium">Material Costs (€)</Label>
                <Input
                  id="material_costs"
                  type="number"
                  step="0.01"
                  value={costs.material_costs}
                  onChange={(e) => handleInputChange('material_costs', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="working_hours_costs" className="text-sm font-medium">Working Hours Costs (€)</Label>
                <Input
                  id="working_hours_costs"
                  type="number"
                  step="0.01"
                  value={costs.working_hours_costs}
                  onChange={(e) => handleInputChange('working_hours_costs', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="pt-2 border-t">
                <Label htmlFor="total_production_costs" className="text-sm font-medium">Total Production Costs (€)</Label>
                <Input
                  id="total_production_costs"
                  type="number"
                  step="0.01"
                  value={costs.total_production_costs}
                  readOnly
                  className="mt-1 bg-gray-50"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} size="sm" className="flex-1">
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
              <Button onClick={handleCancel} variant="outline" size="sm" className="flex-1">
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Material Costs:</span>
                <span className="font-medium">€{costs.material_costs.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Working Hours:</span>
                <span className="font-medium">€{costs.working_hours_costs.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <span className="text-sm font-medium">Total:</span>
                <span className="font-bold text-lg">€{costs.total_production_costs.toFixed(2)}</span>
              </div>
            </div>
            <Button 
              onClick={() => setIsEditing(true)} 
              variant="outline" 
              size="sm" 
              className="w-full"
            >
              <Edit3 className="h-4 w-4 mr-1" />
              Edit Costs
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};
