import { format } from "date-fns";
import { 
  Reply, 
  ReplyAll, 
  Forward, 
  Trash2, 
  MoreVertical, 
  Star, 
  Printer,
  Archive,
  AlertOctagon
} from "lucide-react";
import { Email } from "./types";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface EmailDetailProps {
  email: Email | null;
  onDelete: (id: string) => void;
  onClose: () => void; // On mobile/tablet to go back to list
}

export function EmailDetail({ email, onDelete, onClose }: EmailDetailProps) {
  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground bg-background h-full border-l">
        Select an email to read
      </div>
    );
  }

  const initials = email.sender
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex-1 flex flex-col h-full bg-background border-l">
      {/* Toolbar */}
      <div className="h-14 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <Archive className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <AlertOctagon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Report Spam</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-red-500"
                  onClick={() => onDelete(email.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Separator orientation="vertical" className="mx-2 h-6" />
          <TooltipProvider>
            <Tooltip>
               <TooltipTrigger asChild>
                 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                   <FolderIcon className="h-4 w-4" />
                 </Button>
               </TooltipTrigger>
               <TooltipContent>Move to</TooltipContent>
            </Tooltip>
            <Tooltip>
               <TooltipTrigger asChild>
                 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                   <TagIcon className="h-4 w-4" />
                 </Button>
               </TooltipTrigger>
               <TooltipContent>Label</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        
        <div className="flex items-center gap-1">
           <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
             <Printer className="h-4 w-4" />
           </Button>
           <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
             <MoreVertical className="h-4 w-4" />
           </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-6">
           <div className="flex-1">
             <h2 className="text-xl font-semibold mb-2">{email.subject}</h2>
             <div className="flex items-center gap-3">
               <Avatar className="h-10 w-10">
                 <AvatarImage src="" />
                 <AvatarFallback className="bg-primary/10 text-primary">{initials}</AvatarFallback>
               </Avatar>
               <div>
                 <div className="flex items-baseline gap-2">
                   <span className="font-semibold">{email.sender}</span>
                   <span className="text-sm text-muted-foreground">&lt;{email.senderEmail}&gt;</span>
                 </div>
                 <div className="text-xs text-muted-foreground">
                   to me
                 </div>
               </div>
             </div>
           </div>
           <div className="text-sm text-muted-foreground whitespace-nowrap flex flex-col items-end gap-1">
             <span>{format(new Date(email.date), "MMM d, yyyy, h:mm a")}</span>
             {email.starred && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
           </div>
        </div>

        <div className="prose prose-sm max-w-none text-foreground/90 whitespace-pre-wrap">
          {email.content}
        </div>
        
        {/* Reply Box area */}
        <div className="mt-8 pt-6 border-t flex gap-2">
           <Button variant="outline" className="gap-2 text-muted-foreground">
             <Reply className="h-4 w-4" /> Reply
           </Button>
           <Button variant="outline" className="gap-2 text-muted-foreground">
             <ReplyAll className="h-4 w-4" /> Reply All
           </Button>
           <Button variant="outline" className="gap-2 text-muted-foreground">
             <Forward className="h-4 w-4" /> Forward
           </Button>
        </div>
      </div>
    </div>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" height="24" viewBox="0 0 24 24" 
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
      className={className}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

function TagIcon({ className }: { className?: string }) {
   return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" height="24" viewBox="0 0 24 24" 
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
      className={className}
    >
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l5 5a2 2 0 0 0 2.828 0l7.172-7.172a2 2 0 0 0 0-2.828l-5-5z" />
      <path d="M6 6h.01" />
    </svg>
   );
}

