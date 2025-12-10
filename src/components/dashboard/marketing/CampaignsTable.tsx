import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Edit, Trash2, Send, Loader2, Play } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface Campaign {
  id: string;
  name: string;
  subject_a: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  created_at: string;
  sent_count: number;
}

const CampaignsTable = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Campaign[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('marketing_campaigns')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign deleted');
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (id: string) => {
        // In a real app, this would call our Edge Function
        // For now, we simulate the call or assuming we might implement the client-side trigger
        
        // Let's trigger the edge function
        const { data, error } = await supabase.functions.invoke('send-campaign', {
            body: { campaign_id: id }
        });

        if (error) throw error;
        return data;
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        toast.success('Campaign sending started!');
    },
    onError: (error) => {
        console.error("Send error:", error);
        toast.error("Failed to start sending");
    }
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
        case 'sent': return 'default'; // primary/black
        case 'draft': return 'secondary'; // gray
        case 'scheduled': return 'outline';
        case 'sending': return 'destructive'; // Or warning color
        default: return 'secondary';
    }
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Scheduled / Sent</TableHead>
            <TableHead>Stats</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns?.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                No campaigns found. Create your first one!
              </TableCell>
            </TableRow>
          ) : (
            campaigns?.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="font-medium">{campaign.name}</TableCell>
                <TableCell className="max-w-[200px] truncate" title={campaign.subject_a}>
                    {campaign.subject_a}
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusColor(campaign.status) as any}>
                    {campaign.status}
                  </Badge>
                </TableCell>
                <TableCell>
                    {campaign.scheduled_at 
                        ? format(new Date(campaign.scheduled_at), 'PPP p') 
                        : (campaign.status === 'sent' ? 'Sent' : 'Not scheduled')}
                </TableCell>
                <TableCell>
                    {campaign.status === 'sent' ? `${campaign.sent_count} Sent` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {campaign.status === 'draft' && (
                        <Button 
                            variant="outline" 
                            size="sm"
                            title="Send Now"
                            onClick={() => {
                                if(confirm('Are you sure you want to send this campaign now?')) {
                                    sendMutation.mutate(campaign.id);
                                }
                            }}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    )}
                     <Button 
                        variant="ghost" 
                        size="icon" 
                        title="Delete"
                        onClick={() => {
                            if(confirm('Are you sure you want to delete this campaign?')) {
                                deleteMutation.mutate(campaign.id);
                            }
                        }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default CampaignsTable;

