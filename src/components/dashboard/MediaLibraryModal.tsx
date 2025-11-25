import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Upload, Image as ImageIcon, Check } from "lucide-react";
import { uploadToBucket, listFiles } from "@/utils/mediaStorage";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface MediaLibraryModalProps {
  onSelect: (url: string) => void;
  trigger?: React.ReactNode;
}

const MediaLibraryModal = ({ onSelect, trigger }: MediaLibraryModalProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState<any[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      fetchImages();
    }
  }, [isOpen]);

  const fetchImages = async () => {
    setLoadingImages(true);
    const files = await listFiles('blog-images');
    // Map to include public URLs
    const imagesWithUrls = files.map(file => {
      const { data } = supabase.storage.from('blog-images').getPublicUrl(file.name);
      return { ...file, url: data.publicUrl };
    });
    setImages(imagesWithUrls);
    setLoadingImages(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Image must be less than 5MB",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    const url = await uploadToBucket(file, 'blog-images');
    setUploading(false);

    if (url) {
      toast({ title: "Success", description: "Image uploaded successfully" });
      fetchImages(); // Refresh list
      onSelect(url);
      setIsOpen(false);
    } else {
      toast({ title: "Error", description: "Failed to upload image", variant: "destructive" });
    }
  };

  const handleSelect = (url: string) => {
    onSelect(url);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || <Button variant="outline">Select Image</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Media Library</DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="library" className="flex-1 flex flex-col overflow-hidden">
          <TabsList>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="upload">Upload New</TabsTrigger>
          </TabsList>
          
          <TabsContent value="library" className="flex-1 overflow-y-auto p-4 border rounded-md mt-2 bg-slate-50">
            {loadingImages ? (
              <div className="flex justify-center items-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : images.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No images found. Upload one to get started.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {images.map((img) => (
                  <div 
                    key={img.id || img.name} 
                    className="group relative aspect-square bg-white rounded-lg border overflow-hidden cursor-pointer hover:border-primary transition-all"
                    onClick={() => handleSelect(img.url)}
                  >
                    <img 
                      src={img.url} 
                      alt={img.name} 
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Button size="sm" variant="secondary" className="opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all">
                        Select
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="upload" className="p-10 border rounded-md mt-2 bg-slate-50 text-center">
            <div className="max-w-sm mx-auto">
              <div className="border-2 border-dashed rounded-lg p-8 hover:bg-slate-100 transition-colors cursor-pointer relative">
                <input 
                  type="file" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  accept="image/*"
                  onChange={handleUpload}
                  disabled={uploading}
                />
                <div className="flex flex-col items-center">
                  {uploading ? (
                    <Loader2 className="h-10 w-10 animate-spin text-primary mb-2" />
                  ) : (
                    <Upload className="h-10 w-10 text-muted-foreground mb-2" />
                  )}
                  <p className="text-sm font-medium">
                    {uploading ? "Uploading..." : "Click to upload image"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP up to 5MB</p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default MediaLibraryModal;

