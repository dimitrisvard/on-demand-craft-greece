import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface CampaignProgressProps {
  campaignId: string;
  totalRecipients: number;
  initialSentCount?: number;
  status: string;
}

const CampaignProgress: React.FC<CampaignProgressProps> = ({ 
  campaignId, 
  totalRecipients, 
  initialSentCount = 0,
  status 
}) => {
  const [sentCount, setSentCount] = useState(initialSentCount);
  const [currentStatus, setCurrentStatus] = useState(status);

  useEffect(() => {
    // Initial fetch to get latest status if component mounts late
    const fetchLatest = async () => {
        const { data } = await supabase
            .from('marketing_campaigns')
            .select('sent_count, status')
            .eq('id', campaignId)
            .single();
        if (data) {
            setSentCount(data.sent_count || 0);
            setCurrentStatus(data.status || 'draft');
        }
    };
    fetchLatest();

    // Subscribe to real-time changes for this campaign
    const channel = supabase
      .channel(`campaign-progress-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'marketing_campaigns',
          filter: `id=eq.${campaignId}`,
        },
        (payload) => {
          const newData = payload.new as any;
          if (newData.sent_count !== undefined) setSentCount(newData.sent_count);
          if (newData.status !== undefined) setCurrentStatus(newData.status);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Realtime subscription unavailable, using polling fallback');
        }
      });

    // Polling fallback: fetch every 3s while campaign is sending
    // This ensures progress updates even if WebSocket is unavailable
    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from('marketing_campaigns')
        .select('sent_count, status')
        .eq('id', campaignId)
        .single();
      if (data) {
        setSentCount(data.sent_count || 0);
        setCurrentStatus(data.status || 'draft');
      }
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [campaignId]);

  // Calculate percentage
  const percentage = totalRecipients > 0 ? Math.min(100, Math.round((sentCount / totalRecipients) * 100)) : 0;

  if (currentStatus === 'draft' || currentStatus === 'scheduled') {
      return <Badge variant="outline">{currentStatus}</Badge>;
  }

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-between text-xs mb-1">
        <div className="flex items-center gap-2">
            {currentStatus === 'sending' && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            {currentStatus === 'sent' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
            <span className="capitalize font-medium">{currentStatus}</span>
        </div>
        <span className="text-muted-foreground">
          {sentCount} / {totalRecipients} ({percentage}%)
        </span>
      </div>
      <Progress value={percentage} className="h-2" />
    </div>
  );
};

export default CampaignProgress;

