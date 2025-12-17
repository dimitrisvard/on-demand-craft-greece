import { useState } from "react";
import { X, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 bg-muted/40 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-base font-semibold">New Message</DialogTitle>
        </DialogHeader>
        
        <div className="p-4 space-y-4">
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
           <div className="min-h-[300px]">
             <Textarea 
               placeholder="Write your message..." 
               className="min-h-[300px] border-0 focus-visible:ring-0 resize-none p-0 shadow-none"
               value={content}
               onChange={(e) => setContent(e.target.value)}
             />
           </div>
        </div>

        <DialogFooter className="p-4 border-t flex items-center justify-between sm:justify-between">
          <div className="flex items-center gap-2">
             <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
               <span className="font-bold font-serif">A</span>
             </Button>
             <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
               <Paperclip className="h-4 w-4" />
             </Button>
          </div>
          <div className="flex items-center gap-2">
             <Button variant="ghost" onClick={() => onOpenChange(false)}>
               Discard
             </Button>
             <Button onClick={handleSend} className="bg-brand-primary text-white hover:bg-brand-dark gap-2">
               Send <Send className="h-4 w-4" />
             </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

