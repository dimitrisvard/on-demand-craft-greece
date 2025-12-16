import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Mail, Users, Calendar, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface CampaignDetailsSheetProps {
  campaignId: string | null;
  onClose: () => void;
}

const CampaignDetailsSheet = ({ campaignId, onClose }: CampaignDetailsSheetProps) => {
  const { data: campaign, isLoading: isLoadingCampaign } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: async () => {
      if (!campaignId) return null;
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!campaignId,
  });

  const { data: subscribers, isLoading: isLoadingSubscribers } = useQuery({
    queryKey: ['campaign-subscribers', campaignId],
    queryFn: async () => {
      if (!campaignId || !campaign) return null;

      // fetch all subscribers to filter client side or use the tags logic
      // Ideally we would have a campaign_recipients table, but we'll use the target logic
      // or check if there are events for this campaign
      
      const { data: events } = await supabase
        .from('marketing_events')
        .select('subscriber_id, event_type, created_at, marketing_subscribers(email, name)')
        .eq('campaign_id', campaignId)
        .eq('event_type', 'sent');

      if (events && events.length > 0) {
        return events.map(e => ({
          email: e.marketing_subscribers?.email,
          name: e.marketing_subscribers?.name,
          sent_at: e.created_at,
          status: 'Sent'
        }));
      }

      // Fallback: If no events (maybe not sent yet, or events not tracked), calculate based on tags
      const { data: allSubscribers } = await supabase
        .from('marketing_subscribers')
        .select('*');

      if (!allSubscribers) return [];

      const targetTags = campaign.target_tags || [];
      
      if (!targetTags || targetTags.length === 0) {
        return allSubscribers.map(s => ({
            email: s.email,
            name: s.name,
            sent_at: null,
            status: 'Targeted'
        }));
      }

      return allSubscribers
        .filter(sub => {
          const subTags = Array.isArray(sub.tags) ? sub.tags : [];
          return targetTags.some((tag: string) => subTags.includes(tag));
        })
        .map(s => ({
            email: s.email,
            name: s.name,
            sent_at: null,
            status: 'Targeted'
        }));
    },
    enabled: !!campaignId && !!campaign,
  });

  const isLoading = isLoadingCampaign || isLoadingSubscribers;

  if (!campaignId) return null;

  return (
    <Sheet open={!!campaignId} onOpenChange={() => onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Campaign Details</SheetTitle>
          <SheetDescription>
            Detailed view of your campaign performance and recipients.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : campaign ? (
          <div className="space-y-6 py-6">
            {/* Campaign Info Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Subject
                </span>
                <p className="font-medium text-sm">{campaign.subject_a}</p>
              </div>
              <div className="space-y-1">
                 <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Status
                </span>
                <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'}>
                  {campaign.status}
                </Badge>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Schedule
                </span>
                <p className="text-sm">
                  {campaign.scheduled_at 
                    ? format(new Date(campaign.scheduled_at), 'PPP p')
                    : 'Not scheduled'}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4" /> Recipients
                </span>
                <p className="text-sm font-medium">
                  {subscribers?.length || 0} users
                </p>
              </div>
            </div>

            <Separator />

            {/* Campaign Body Preview */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Message Preview</h3>
              <div className="rounded-md border p-4 bg-muted/50 text-sm max-h-[200px] overflow-y-auto">
                <div dangerouslySetInnerHTML={{ __html: campaign.body }} />
              </div>
            </div>

            <Separator />

            {/* Recipients List */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                 <h3 className="text-sm font-medium">Recipients List</h3>
                 <Badge variant="outline">{subscribers?.length || 0} Users</Badge>
              </div>
             
              <ScrollArea className="h-[300px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscribers && subscribers.length > 0 ? (
                      subscribers.map((sub, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium text-xs">{sub.email}</TableCell>
                          <TableCell className="text-xs">{sub.name || '-'}</TableCell>
                          <TableCell className="text-xs">
                            {sub.status === 'Sent' ? (
                                <span className="text-green-600">Sent</span>
                            ) : (
                                <span className="text-muted-foreground">Pending</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          No recipients found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>
        ) : (
            <div className="text-center py-8">Campaign not found</div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default CampaignDetailsSheet;

