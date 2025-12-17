import { useState, useMemo } from "react";
import { Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

interface ComposeEmailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (to: string, subject: string, content: string) => void;
}

export function ComposeEmail({ open, onOpenChange, onSend }: ComposeEmailProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");

  const handleSend = () => {
    onSend(to, subject, content);
    onOpenChange(false);
    setTo("");
    setSubject("");
    setContent("");
  };

  const quillModules = useMemo(() => ({
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      ['link', 'image'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'align': [] }],
      ['clean']
    ],
  }), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] p-0 gap-0 overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader className="p-4 bg-muted/40 border-b flex flex-row items-center justify-between space-y-0 shrink-0">
          <DialogTitle className="text-base font-semibold">New Message</DialogTitle>
        </DialogHeader>
        
        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
           <div className="grid gap-2">
             <Input 
               placeholder="To" 
               className="border-0 border-b rounded-none px-0 focus-visible:ring-0 shadow-none"
               value={to}
               onChange={(e) => setTo(e.target.value)}
             />
           </div>
           <div className="grid gap-2">
             <Input 
               placeholder="Subject" 
               className="border-0 border-b rounded-none px-0 focus-visible:ring-0 shadow-none font-medium"
               value={subject}
               onChange={(e) => setSubject(e.target.value)}
             />
           </div>
           <div className="border rounded-md overflow-hidden">
             <ReactQuill 
               theme="snow" 
               value={content} 
               onChange={setContent}
               modules={quillModules}
               className="bg-background"
               placeholder="Write your message..."
               style={{ minHeight: '350px' }}
             />
           </div>
        </div>

        <DialogFooter className="p-4 border-t flex items-center justify-between sm:justify-between shrink-0">
          <div className="flex items-center gap-2">
             <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Attach file">
               <Paperclip className="h-4 w-4" />
             </Button>
          </div>
          <div className="flex items-center gap-2">
             <Button variant="ghost" onClick={() => {
               setTo("");
               setSubject("");
               setContent("");
               onOpenChange(false);
             }}>
               Discard
             </Button>
             <Button 
               onClick={handleSend} 
               className="bg-brand-primary text-white hover:bg-brand-dark gap-2"
               disabled={!to || !subject || !content.trim()}
             >
               Send <Send className="h-4 w-4" />
             </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

