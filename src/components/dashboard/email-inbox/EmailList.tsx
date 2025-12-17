import { format } from "date-fns";
import { Star, Paperclip } from "lucide-react";
import { Email } from "./types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

interface EmailListProps {
  emails: Email[];
  selectedEmailId: string | null;
  onSelectEmail: (email: Email) => void;
  onToggleStar: (e: React.MouseEvent, emailId: string) => void;
}

export function EmailList({ 
  emails, 
  selectedEmailId, 
  onSelectEmail,
  onToggleStar
}: EmailListProps) {
  if (emails.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No emails found
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-border">
      {emails.map((email) => (
        <div
          key={email.id}
          className={cn(
            "group flex items-start gap-3 p-4 hover:bg-accent/50 cursor-pointer transition-colors",
            selectedEmailId === email.id && "bg-accent",
            !email.read && "bg-background font-medium"
          )}
          onClick={() => onSelectEmail(email)}
        >
          <div className="pt-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
             <Checkbox />
             <button 
               className={cn("hover:text-yellow-400 transition-colors", email.starred ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground")}
               onClick={(e) => onToggleStar(e, email.id)}
             >
               <Star className={cn("h-4 w-4", email.starred && "fill-current")} />
             </button>
          </div>
          
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className={cn("truncate text-sm", !email.read ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
                {email.sender}
              </span>
              <span className={cn("text-xs whitespace-nowrap", !email.read ? "text-foreground font-medium" : "text-muted-foreground")}>
                {format(new Date(email.date), "MMM d")}
              </span>
            </div>
            
            <div className="text-sm text-foreground/90 truncate">
              {email.subject}
            </div>
            
            <div className="text-xs text-muted-foreground truncate flex items-center gap-2">
              <span>{email.preview}</span>
              {email.attachments && (
                <Paperclip className="h-3 w-3" />
              )}
            </div>

            {email.labels.length > 0 && (
              <div className="flex gap-1 mt-1">
                {email.labels.map(label => (
                  <Badge key={label} variant="outline" className="text-[10px] px-1 py-0 h-5">
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

