import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, ArrowLeft, Mail, Users, Calendar, GitBranch } from 'lucide-react';
import { format } from 'date-fns';
import FollowUpImportDialog from '@/components/dashboard/marketing/FollowUpImportDialog';

interface ContactPreview {
  email: string;
  name: string | null;
  subject: string;
  body: string;
  sent_at: string | null;
}

const CampaignDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedContact, setSelectedContact] = useState<ContactPreview | null>(null);

  // 1. Fetch Campaign Details
  const { data: campaign, isLoading: isLoadingCampaign } = useQuery({
    queryKey: ['campaign', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // 2. Fetch Analytics Stats (Opens, Clicks, Bounces)
  const { data: analytics } = useQuery({
    queryKey: ['campaign-analytics', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('marketing_analytics')
        .select('*')
        .eq('campaign_id', id)
        .maybeSingle();
      
      if (error) throw error;
      return data || { opens: 0, clicks: 0, bounces: 0 };
    },
    enabled: !!id,
  });

  // 3. Fetch Subscribers/Recipients (with custom content for CSV campaigns)
  const { data: subscribers, isLoading: isLoadingSubscribers } = useQuery({
    queryKey: ['campaign-subscribers', id],
    queryFn: async () => {
      if (!id || !campaign) return null;

      // Check for CSV-imported recipients first (they have custom_subject/body)
      const { data: csvRecipients } = await supabase
        .from('marketing_campaign_recipients')
        .select('custom_subject, custom_body, status, sent_at, marketing_subscribers(email, name)')
        .eq('campaign_id', id)
        .eq('sequence_number', 1);

      if (csvRecipients && csvRecipients.length > 0) {
        return csvRecipients.map((r: any) => ({
          email: r.marketing_subscribers?.email,
          name: r.marketing_subscribers?.name,
          sent_at: r.sent_at || null,
          status: r.status === 'sent' ? 'Sent' : 'Targeted',
          custom_subject: r.custom_subject,
          custom_body: r.custom_body,
        }));
      }

      // Try to get actual sent events for standard campaigns
      const { data: events } = await supabase
        .from('marketing_events')
        .select('subscriber_id, event_type, created_at, marketing_subscribers(email, name)')
        .eq('campaign_id', id)
        .eq('event_type', 'sent');

      if (events && events.length > 0) {
        return events.map(e => ({
          email: e.marketing_subscribers?.email,
          name: e.marketing_subscribers?.name,
          sent_at: e.created_at,
          status: 'Sent',
          custom_subject: campaign.subject_a,
          custom_body: campaign.body,
        }));
      }

      // Fallback: Calculate based on tags if no events found yet
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
            status: 'Targeted',
            custom_subject: campaign.subject_a,
            custom_body: campaign.body,
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
            status: 'Targeted',
            custom_subject: campaign.subject_a,
            custom_body: campaign.body,
        }));
    },
    enabled: !!id && !!campaign,
  });

  const isLoading = isLoadingCampaign || isLoadingSubscribers;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <h2 className="text-xl font-semibold">Campaign not found</h2>
        <Button onClick={() => navigate('/dashboard/email-marketing')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Campaigns
        </Button>
      </div>
    );
  }

  const followUps = Array.isArray(campaign.follow_up_config) ? campaign.follow_up_config : [];
  const abTest = campaign.ab_test_config as any;

  // Metrics Calculations
  const sentCount = campaign.sent_count || 0;
  const opens = analytics?.opens || 0;
  const clicks = analytics?.clicks || 0;
  const bounces = analytics?.bounces || 0;

  // Avoid division by zero
  const openRate = sentCount > 0 ? Math.round((opens / sentCount) * 100) : 0;
  const clickRate = sentCount > 0 ? Math.round((clicks / sentCount) * 100) : 0;
  const bounceRate = sentCount > 0 ? Math.round((bounces / sentCount) * 100) : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button 
          variant="outline" 
          size="icon"
          onClick={() => navigate('/dashboard/email-marketing')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'}>
              {campaign.status}
            </Badge>
            <span>•</span>
            <span>Created on {format(new Date(campaign.created_at), 'PPP')}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Content - Left Column */}
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Campaign Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <span className="text-sm font-medium text-muted-foreground block">Subject Line</span>
                <div className="flex items-center gap-2 p-3 bg-muted rounded-md border">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{campaign.subject_a}</span>
                </div>
                {campaign.subject_b && (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-md border mt-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{campaign.subject_b}</span>
                    <Badge variant="outline" className="ml-auto">Variant B</Badge>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                 <span className="text-sm font-medium text-muted-foreground block">Email Body</span>
                 <div className="rounded-md border p-6 bg-white min-h-[200px] prose max-w-none">
                    <div dangerouslySetInnerHTML={{ __html: campaign.body }} />
                 </div>
              </div>
            </CardContent>
          </Card>

           {/* Follow-ups Section */}
           {followUps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Follow-up Sequence</CardTitle>
                <CardDescription>Scheduled follow-up emails for this campaign.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {followUps.map((followUp: any, index: number) => (
                    <div key={index} className="border rounded-lg p-4 relative">
                      <div className="absolute top-4 right-4">
                        <Badge variant="outline">
                          +{followUp.delayDays} days
                        </Badge>
                      </div>
                      <h4 className="font-medium mb-2">Follow-up #{index + 1}</h4>
                      <p className="text-sm text-muted-foreground mb-2">Subject: {followUp.subject}</p>
                      <div className="bg-muted p-3 rounded text-sm text-muted-foreground line-clamp-3">
                         <div dangerouslySetInnerHTML={{ __html: followUp.body }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <CardTitle>Recipients</CardTitle>
                  <Badge variant="secondary">{subscribers?.length || 0} Total</Badge>
                </div>
                {id && (
                  <FollowUpImportDialog
                    campaignId={id}
                    onImported={() => {
                      queryClient.invalidateQueries({ queryKey: ['campaign-subscribers', id] });
                    }}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Sent At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscribers && subscribers.length > 0 ? (
                      subscribers.map((sub, idx) => (
                        <TableRow
                          key={idx}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedContact({
                            email: sub.email,
                            name: sub.name,
                            subject: sub.custom_subject || campaign.subject_a,
                            body: sub.custom_body || campaign.body,
                            sent_at: sub.sent_at,
                          })}
                        >
                          <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{sub.email}</TableCell>
                          <TableCell>{sub.name || '-'}</TableCell>
                          <TableCell>
                            {sub.status === 'Sent' ? (
                                <Badge variant="default" className="bg-green-600 hover:bg-green-700">Sent</Badge>
                            ) : (
                                <Badge variant="outline">Targeted</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                             {sub.sent_at ? format(new Date(sub.sent_at), 'PP p') : '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No recipients found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Right Column */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="text-sm font-medium block">Schedule</span>
                  <span className="text-sm text-muted-foreground">
                     {campaign.scheduled_at 
                        ? format(new Date(campaign.scheduled_at), 'PPP p')
                        : 'Not scheduled (Draft)'}
                  </span>
                </div>
              </div>

              <Separator />

              <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="text-sm font-medium block">Target Audience</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {campaign.target_tags && campaign.target_tags.length > 0 ? (
                      campaign.target_tags.map((tag: string) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">All Subscribers</span>
                    )}
                  </div>
                </div>
              </div>

              {abTest?.enabled && (
                <>
                  <Separator />
                  <div className="flex items-start gap-3">
                    <GitBranch className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <span className="text-sm font-medium block">A/B Testing</span>
                      <div className="space-y-1 mt-1 text-sm text-muted-foreground">
                        <p>Test Percentage: {abTest.test_percentage}%</p>
                        <p>Winning Metric: {abTest.winning_metric}</p>
                        <p>Duration: {abTest.duration_hours} hours</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
                <CardTitle>Performance</CardTitle>
            </CardHeader>
            <CardContent>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="bg-muted/50 p-3 rounded-lg text-center">
                        <span className="text-xs text-muted-foreground uppercase font-bold">Sent</span>
                        <p className="text-2xl font-bold text-primary">{sentCount}</p>
                    </div>
                    
                    <div className="bg-muted/50 p-3 rounded-lg text-center">
                        <span className="text-xs text-muted-foreground uppercase font-bold">Open Rate</span>
                        <p className="text-2xl font-bold text-primary">{openRate}%</p>
                        <span className="text-xs text-muted-foreground">({opens})</span>
                    </div>

                    <div className="bg-muted/50 p-3 rounded-lg text-center">
                        <span className="text-xs text-muted-foreground uppercase font-bold">Click Rate</span>
                        <p className="text-2xl font-bold text-primary">{clickRate}%</p>
                         <span className="text-xs text-muted-foreground">({clicks})</span>
                    </div>

                     <div className="bg-muted/50 p-3 rounded-lg text-center">
                        <span className="text-xs text-muted-foreground uppercase font-bold">Bounce Rate</span>
                        <p className="text-2xl font-bold text-destructive">{bounceRate}%</p>
                        <span className="text-xs text-muted-foreground">({bounces})</span>
                    </div>
                 </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    {/* Contact Email Preview Dialog */}
    <Dialog open={!!selectedContact} onOpenChange={(open) => { if (!open) setSelectedContact(null); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email for {selectedContact?.email}
          </DialogTitle>
          {selectedContact?.sent_at && (
            <p className="text-sm text-muted-foreground">
              Sent: {format(new Date(selectedContact.sent_at), 'PPP p')}
            </p>
          )}
        </DialogHeader>
        <div className="space-y-4 flex-1 overflow-y-auto">
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Subject</span>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md border">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium">{selectedContact?.subject}</span>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Email Body</span>
            <div className="rounded-md border p-4 bg-white min-h-[200px] prose max-w-none overflow-auto">
              <div dangerouslySetInnerHTML={{ __html: selectedContact?.body || '' }} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignDetailsPage;
