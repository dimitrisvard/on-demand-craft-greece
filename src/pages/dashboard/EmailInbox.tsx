import { useState, useMemo, useEffect } from 'react';
import { PersistentDashboardLayout } from '@/components/dashboard/PersistentDashboardLayout';
import { EmailInboxSidebar } from '@/components/dashboard/email-inbox/EmailInboxSidebar';
import { EmailList } from '@/components/dashboard/email-inbox/EmailList';
import { EmailDetail } from '@/components/dashboard/email-inbox/EmailDetail';
import { ComposeEmail } from '@/components/dashboard/email-inbox/ComposeEmail';
import { Email, FolderId } from '@/components/dashboard/email-inbox/types';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

const EmailInbox = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentFolder, setCurrentFolder] = useState<FolderId>('inbox');
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch emails from Supabase
  useEffect(() => {
    if (!user) return;

    const fetchEmails = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('user_emails')
          .select('*')
          .eq('user_id', user.id)
          .eq('folder', currentFolder)
          .order('created_at', { ascending: false });

        const { data, error } = await query;

        if (error) {
          throw error;
        }

        // Map DB data to UI Email type
        const mappedEmails: Email[] = (data || []).map((item: any) => ({
          id: item.id,
          sender: item.sender || 'Unknown',
          senderEmail: item.folder === 'sent' ? item.recipient : (item.sender.match(/<(.+)>/)?.[1] || item.sender), // Extract email if possible
          subject: item.subject || '(No Subject)',
          preview: item.content?.slice(0, 100) + '...' || '',
          content: item.content || '',
          date: item.created_at,
          read: item.read,
          starred: item.starred,
          folder: item.folder as FolderId,
          labels: item.labels || [],
        }));

        setEmails(mappedEmails);
      } catch (error: any) {
        console.error('Error fetching emails:', error);
        toast({
          title: 'Error',
          description: 'Failed to load emails.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchEmails();
    
    // Subscribe to realtime changes (optional, for receiving new emails if we had that)
    const subscription = supabase
      .channel('user_emails_changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'user_emails',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
         // Refresh list on change
         fetchEmails();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };

  }, [currentFolder, user, toast]);

  const filteredEmails = useMemo(() => {
    return emails
      .filter(email => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          return (
            email.subject.toLowerCase().includes(query) ||
            email.sender.toLowerCase().includes(query) ||
            email.content.toLowerCase().includes(query)
          );
        }
        return true;
      });
  }, [emails, searchQuery]);

  const selectedEmail = useMemo(() => 
    emails.find(e => e.id === selectedEmailId) || null,
  [emails, selectedEmailId]);

  const unreadCounts = useMemo(() => {
    // This assumes we have fetched ALL emails, which isn't true as we filter by folder in DB query.
    // To get accurate counts we might need a separate query or fetch all folders (which might be heavy).
    // For now, let's just count what's loaded, or we could run a count query.
    // Since we only load current folder, this unread count will be 0 for other folders unless we fetch counts separately.
    // Let's keep it simple: unread counts only show for current view or we need to fetch stats.
    
    // Correct approach: Fetch unread counts for all folders.
    // For this MVP, we won't implement real-time unread counts for other folders to save requests.
    return emails.reduce((acc, email) => {
      if (!email.read) {
        acc[email.folder] = (acc[email.folder] || 0) + 1;
      }
      return acc;
    }, {} as Record<FolderId, number>);
  }, [emails]);

  // Fetch unread counts separately (optional optimization)
  useEffect(() => {
     if(!user) return;
     const fetchCounts = async () => {
         // This is a bit complex in Supabase without a group by count view or multiple queries
         // Skipping for MVP
     };
     fetchCounts();
  }, [user]);

  const handleSelectEmail = async (email: Email) => {
    setSelectedEmailId(email.id);
    if (!email.read) {
      // Optimistic update
      setEmails(prev => prev.map(e => 
        e.id === email.id ? { ...e, read: true } : e
      ));

      // DB update
      const { error } = await supabase
        .from('user_emails')
        .update({ read: true })
        .eq('id', email.id);
        
      if (error) {
          console.error("Error marking read:", error);
      }
    }
  };

  const handleToggleStar = async (e: React.MouseEvent, emailId: string) => {
    e.stopPropagation();
    const email = emails.find(e => e.id === emailId);
    if (!email) return;

    // Optimistic
    setEmails(prev => prev.map(e => 
      e.id === emailId ? { ...e, starred: !e.starred } : e
    ));

    // DB update
    const { error } = await supabase
        .from('user_emails')
        .update({ starred: !email.starred })
        .eq('id', emailId);

    if (error) {
        console.error("Error toggling star:", error);
    }
  };

  const handleDeleteEmail = async (id: string) => {
    // Optimistic
    setEmails(prev => prev.map(e => 
      e.id === id ? { ...e, folder: 'trash' } : e
    ));
    if (selectedEmailId === id) {
      setSelectedEmailId(null);
    }

    // DB update
    // If already in trash, delete permanently? Or just keep in trash.
    // Let's say if in trash -> delete row, else -> move to trash.
    const email = emails.find(e => e.id === id);
    if (email?.folder === 'trash') {
        const { error } = await supabase.from('user_emails').delete().eq('id', id);
        if (error) {
             console.error("Error deleting email:", error);
             toast({ title: "Error", description: "Failed to delete email", variant: "destructive" });
        } else {
             setEmails(prev => prev.filter(e => e.id !== id));
             toast({ title: "Email deleted permanently" });
        }
    } else {
        const { error } = await supabase
            .from('user_emails')
            .update({ folder: 'trash' })
            .eq('id', id);

        if (error) {
            console.error("Error moving to trash:", error);
            toast({ title: "Error", description: "Failed to move to trash", variant: "destructive" });
        } else {
            toast({ title: "Moved to trash" });
        }
    }
  };

  const handleSendEmail = async (to: string, subject: string, content: string) => {
    toast({
        title: "Sending email...",
        description: "Please wait.",
    });

    try {
        const { data, error } = await supabase.functions.invoke('send-user-email', {
            body: { to, subject, content }
        });

        if (error) throw error;

        toast({
            title: "Email sent!",
            description: "Your email has been sent successfully.",
        });

        // If we are in 'sent' folder, refresh or add to list
        if (currentFolder === 'sent') {
            // Re-fetching would be safest, or we can manually add.
            // But since we use subscription, it might auto-update. 
            // Let's assume subscription handles it or we manually add:
             const newEmail: Email = {
              id: data.id || Date.now().toString(),
              sender: 'Me',
              senderEmail: user?.email || 'me@example.com',
              subject,
              preview: content.slice(0, 50) + '...',
              content,
              date: new Date().toISOString(),
              read: true,
              starred: false,
              folder: 'sent',
              labels: [],
            };
            setEmails(prev => [newEmail, ...prev]);
        }
    } catch (error: any) {
        console.error("Error sending email:", error);
        toast({
            title: "Error sending email",
            description: error.message || "Something went wrong.",
            variant: "destructive"
        });
    }
  };

  return (
    <PersistentDashboardLayout>
      <div className="flex flex-col h-[calc(100vh-8rem)] rounded-lg border bg-background shadow-sm overflow-hidden">
        {/* Header / Search */}
        <div className="h-16 border-b px-4 flex items-center justify-between gap-4 bg-background">
          <h1 className="text-xl font-semibold hidden md:block">Inbox</h1>
          <div className="relative flex-1 max-w-xl">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
             <Input 
               placeholder="Search mail" 
               className="pl-9 bg-secondary/50 border-0 focus-visible:ring-1"
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
             />
          </div>
          <div className="w-10"></div> {/* Spacer for balance */}
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="hidden md:block">
            <EmailInboxSidebar 
              currentFolder={currentFolder}
              onFolderChange={(folder) => {
                setCurrentFolder(folder);
                setSelectedEmailId(null);
              }}
              onCompose={() => setIsComposeOpen(true)}
              unreadCounts={unreadCounts}
            />
          </div>

          {/* Email List */}
          <div className={`w-full md:w-[350px] lg:w-[400px] border-r flex flex-col ${selectedEmailId ? 'hidden md:flex' : 'flex'}`}>
            <EmailList 
              emails={filteredEmails}
              selectedEmailId={selectedEmailId}
              onSelectEmail={handleSelectEmail}
              onToggleStar={handleToggleStar}
            />
          </div>

          {/* Email Content */}
          <div className={`flex-1 flex flex-col ${!selectedEmailId ? 'hidden md:flex' : 'flex'}`}>
            <EmailDetail 
              email={selectedEmail}
              onDelete={handleDeleteEmail}
              onClose={() => setSelectedEmailId(null)}
            />
          </div>
        </div>
      </div>

      <ComposeEmail 
        open={isComposeOpen} 
        onOpenChange={setIsComposeOpen}
        onSend={handleSendEmail}
      />
    </PersistentDashboardLayout>
  );
};

export default EmailInbox;
