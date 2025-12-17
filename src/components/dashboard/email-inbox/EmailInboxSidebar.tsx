import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { 
  Inbox, 
  Send, 
  FileText, 
  Trash2, 
  AlertOctagon, 
  Plus,
  Star,
  Tag
} from "lucide-react";
import { FolderId } from "./types";

interface EmailInboxSidebarProps {
  currentFolder: FolderId;
  onFolderChange: (folder: FolderId) => void;
  onCompose: () => void;
  unreadCounts: Record<FolderId, number>;
}

export function EmailInboxSidebar({ 
  currentFolder, 
  onFolderChange, 
  onCompose,
  unreadCounts
}: EmailInboxSidebarProps) {
  
  const folders = [
    { id: 'inbox', label: 'Inbox', icon: Inbox },
    { id: 'sent', label: 'Sent', icon: Send },
    { id: 'drafts', label: 'Drafts', icon: FileText },
    { id: 'spam', label: 'Spam', icon: AlertOctagon },
    { id: 'trash', label: 'Trash', icon: Trash2 },
  ] as const;

  return (
    <div className="w-64 flex flex-col gap-4 border-r pr-4 h-full">
      <Button 
        onClick={onCompose} 
        className="w-full gap-2 bg-brand-primary hover:bg-brand-dark text-white shadow-md"
        size="lg"
      >
        <Plus className="h-4 w-4" /> Compose
      </Button>

      <div className="space-y-1">
        {folders.map((folder) => {
          const Icon = folder.icon;
          const isActive = currentFolder === folder.id;
          return (
            <Button
              key={folder.id}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-3 font-normal",
                isActive && "bg-secondary font-medium"
              )}
              onClick={() => onFolderChange(folder.id)}
            >
              <Icon className={cn("h-4 w-4", isActive ? "text-foreground" : "text-muted-foreground")} />
              <span className="flex-1 text-left">{folder.label}</span>
              {unreadCounts[folder.id] > 0 && (
                <span className="text-xs text-muted-foreground font-medium">
                  {unreadCounts[folder.id]}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="pt-4 border-t">
        <h3 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Labels
        </h3>
        <div className="space-y-1">
          <Button variant="ghost" className="w-full justify-start gap-3 font-normal text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            Important
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-3 font-normal text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            Work
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-3 font-normal text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            Personal
          </Button>
        </div>
      </div>
    </div>
  );
}

