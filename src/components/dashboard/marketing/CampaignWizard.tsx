import React, { useState, useEffect } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { CalendarIcon, Loader2, Send, Save, ArrowLeft, ArrowRight, Users, Plus, Trash2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

// Validation Schema
const followUpSchema = z.object({
  delay_days: z.number().min(1, "Delay must be at least 1 day"),
  subject: z.string().min(5, "Subject is required"),
  body: z.string().min(10, "Content is required"),
});

const campaignSchema = z.object({
  name: z.string().min(3, "Campaign name must be at least 3 characters"),
  subject_a: z.string().min(5, "Subject line is required"),
  subject_b: z.string().optional(),
  ab_enabled: z.boolean().default(false),
  test_percentage: z.number().min(10).max(100).default(20),
  body: z.string().min(10, "Email content is required"),
  scheduled_at: z.date().optional(),
  smart_sending: z.boolean().default(false),
  target_tags: z.array(z.string()).default([]),
  follow_up_config: z.array(followUpSchema).default([]),
});

type CampaignFormValues = z.infer<typeof campaignSchema>;

const steps = [
  { id: 'details', title: '1. Details' },
  { id: 'content', title: '2. Content' },
  { id: 'audience', title: '3. Audience' },
  { id: 'review', title: '4. Review & Schedule' }
];

const CampaignWizard = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: '',
      subject_a: '',
      subject_b: '',
      ab_enabled: false,
      test_percentage: 20,
      body: '',
      smart_sending: false,
      target_tags: [],
      follow_up_config: [],
    }
  });

  const { watch, setValue, control, register, handleSubmit, formState: { errors } } = form;
  const abEnabled = watch('ab_enabled');
  const scheduledDate = watch('scheduled_at');

  const { fields: followUpFields, append: appendFollowUp, remove: removeFollowUp } = useFieldArray({
    control,
    name: "follow_up_config"
  });

  const { data: tagStats } = useQuery({
    queryKey: ['marketing_tags_stats'],
    queryFn: async () => {
        const { data, error } = await supabase
            .from('marketing_subscribers')
            .select('tags');
        
        if (error) throw error;
        
        const stats: Record<string, number> = {
            'all': data.length
        };

        // Initialize tags from data
        const uniqueTags = new Set<string>();
        
        data?.forEach(sub => {
            if (Array.isArray(sub.tags)) {
                sub.tags.forEach((t: string) => {
                    uniqueTags.add(t);
                    stats[t] = (stats[t] || 0) + 1;
                });
            }
        });
        
        return { uniqueTags: Array.from(uniqueTags), stats };
    }
  });

  const availableTags = tagStats?.uniqueTags;
  
  // Calculate total recipients based on selection
  const selectedTags = watch('target_tags');
  const totalRecipients = selectedTags.length === 0 
    ? (tagStats?.stats['all'] || 0)
    : selectedTags.reduce((acc, tag) => {
        // This is an approximation as subscribers might have multiple tags.
        // For precise count, we'd need to query the DB or filter the full list in memory.
        // Since we only fetched tags, let's use the stats but be aware of overlap.
        // Actually, fetching full subscriber list is better for precise count if list is not huge.
        // For now, let's assume simple sum or just show "Approx". 
        // OR better: Filter from the fetched data if we store it.
        return acc; // logic below
      }, 0);

  // Better approach: Calculate unique subscribers matching the selection
  const { data: recipientCount } = useQuery({
    queryKey: ['recipient_count', selectedTags],
    enabled: !!tagStats, // Only run if we have base data
    queryFn: async () => {
        if (selectedTags.length === 0) {
            return tagStats?.stats['all'] || 0;
        }
        
        // If we want precise count without overlap
        const { count, error } = await supabase
            .from('marketing_subscribers')
            .select('*', { count: 'exact', head: true })
            .contains('tags', selectedTags); // This checks if tags column contains ALL selected tags (AND logic)
            // But usually marketing lists are OR logic (send to list A OR list B).
            // Supabase/Postgres array overlap: tags && ARRAY['tag1', 'tag2']
            
        // Complex OR logic with JSONB tags is harder in simple query builder without RPC.
        // Let's settle for fetching all tags (lightweight) and filtering in memory for this UI estimate.
        // We already fetched all tags in 'marketing_tags_stats'.
        
        // Actually, let's just use the 'marketing_tags_stats' query to return the full tags map
        // so we can calculate unique count locally.
        return 0;
    }
  });

  // Refactor: Fetch all subscribers' tags to calculate counts locally
  const { data: subscribersTags } = useQuery({
    queryKey: ['subscribers_tags_full'],
    queryFn: async () => {
        const { data, error } = await supabase
            .from('marketing_subscribers')
            .select('id, tags');
        if (error) throw error;
        return data;
    }
  });

  const calculateRecipientCount = () => {
      if (!subscribersTags) return 0;
      if (selectedTags.length === 0) return subscribersTags.length;
      
      const uniqueRecipients = new Set();
      subscribersTags.forEach(sub => {
          const subTags = Array.isArray(sub.tags) ? sub.tags : [];
          // OR logic: if subscriber has ANY of the selected tags
          if (selectedTags.some(tag => subTags.includes(tag))) {
              uniqueRecipients.add(sub.id);
          }
      });
      return uniqueRecipients.size;
  };

  const recipientCountValue = calculateRecipientCount();

  const onSubmit = async (data: CampaignFormValues) => {
    setIsSubmitting(true);
    console.log("Submitting campaign:", data);

    try {
      const { data: campaign, error } = await supabase
        .from('marketing_campaigns')
        .insert({
          name: data.name,
          subject_a: data.subject_a,
          subject_b: data.subject_b || null, // Ensure optional fields are null if empty
          body: data.body,
          scheduled_at: data.scheduled_at ? data.scheduled_at.toISOString() : null,
          status: data.scheduled_at ? 'scheduled' : 'draft',
          target_tags: data.target_tags,
          follow_up_config: data.follow_up_config, 
          ab_test_config: {
            enabled: data.ab_enabled,
            test_percentage: data.test_percentage,
            winning_metric: 'opens',
            duration_hours: 4
          }
        })
        .select()
        .single();

      // 2. Trigger Sending Function (if not scheduled)
      if (!data.scheduled_at) {
          try {
              const { error: fnError } = await supabase.functions.invoke('send-campaign', {
                  body: { campaign_id: campaign.id }
              });
              if (fnError) {
                  console.error("Function error:", fnError);
                  toast.error("Campaign created but failed to start sending.");
              } else {
                  toast.success("Campaign sent successfully!");
              }
          } catch (invokeError) {
              console.error("Invoke error:", invokeError);
              toast.error("Failed to trigger send function.");
          }
      } else {
          toast.success('Campaign scheduled successfully!');
      }

      navigate('/dashboard/email-marketing');

    } catch (error: any) {
      console.error('Error saving campaign:', error);
      toast.error('Failed to save campaign: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = async () => {
    if (currentStep === 0) {
        const isNameValid = await form.trigger('name');
        const isSubjectValid = await form.trigger('subject_a');
        if (!isNameValid || !isSubjectValid) return;
    }
    setCurrentStep(prev => Math.min(prev + 1, steps.length - 1));
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  };

  const insertPlaceholder = (placeholder: string) => {
    // This is a simple append. Ideally, insert at cursor position.
    // ReactQuill doesn't easily expose ref to cursor.
    // We will just append for now or copy to clipboard.
    const currentBody = watch('body');
    setValue('body', currentBody + ` {{${placeholder}}} `);
    toast.info(`Added {{${placeholder}}} to content`);
  };

  return (
    <div className="max-w-5xl mx-auto py-6">
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold">Create Campaign</h1>
            <Button variant="outline" onClick={() => navigate('/dashboard/email-marketing')}>Cancel</Button>
        </div>
        {/* Progress Bar */}
        <div className="flex justify-between relative">
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-secondary -z-10 -translate-y-1/2" />
            {steps.map((step, index) => (
                <div key={step.id} className={cn("flex flex-col items-center bg-background px-2", index <= currentStep ? "text-primary" : "text-muted-foreground")}>
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center border-2 mb-2 bg-background transition-colors", 
                        index <= currentStep ? "border-primary text-primary" : "border-muted-foreground text-muted-foreground",
                        index === currentStep && "ring-2 ring-primary ring-offset-2"
                    )}>
                        {index + 1}
                    </div>
                    <span className="text-xs font-medium">{step.title}</span>
                </div>
            ))}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
            <form onSubmit={handleSubmit(onSubmit, (errors) => console.error("Validation Errors:", errors))}>
                {/* Step 1: Details */}
                {currentStep === 0 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="space-y-2">
                            <Label htmlFor="name">Campaign Name</Label>
                            <Input id="name" placeholder="e.g. Monthly Newsletter - January" {...register('name')} />
                            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
                        </div>

                        <div className="space-y-4 border p-4 rounded-lg">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="ab-switch" className="flex flex-col gap-1">
                                    <span>A/B Testing</span>
                                    <span className="font-normal text-muted-foreground text-xs">Test two subject lines to optimize open rates</span>
                                </Label>
                                <Controller
                                    name="ab_enabled"
                                    control={control}
                                    render={({ field }) => (
                                        <Switch 
                                            id="ab-switch" 
                                            checked={field.value} 
                                            onCheckedChange={field.onChange} 
                                        />
                                    )}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="subject_a">Subject Line {abEnabled && '(Variant A)'}</Label>
                                <Input id="subject_a" placeholder="Enter subject line..." {...register('subject_a')} />
                                {errors.subject_a && <p className="text-sm text-destructive">{errors.subject_a.message}</p>}
                            </div>

                            {abEnabled && (
                                <div className="space-y-4 pt-2 animate-in fade-in height-auto">
                                    <div className="space-y-2">
                                        <Label htmlFor="subject_b">Subject Line (Variant B)</Label>
                                        <Input id="subject_b" placeholder="Enter alternative subject line..." {...register('subject_b')} />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Test Distribution</Label>
                                        <div className="flex items-center gap-4">
                                            <span className="text-sm font-medium w-12">{watch('test_percentage')}% Test</span>
                                            <Controller 
                                                name="test_percentage"
                                                control={control}
                                                render={({ field }) => (
                                                    <Slider 
                                                        value={[field.value]} 
                                                        onValueChange={(vals) => field.onChange(vals[0])} 
                                                        min={10} 
                                                        max={100} 
                                                        step={5} 
                                                        className="flex-1"
                                                    />
                                                )}
                                            />
                                            <span className="text-sm font-medium w-24 text-right">{(100 - watch('test_percentage'))}% Winner</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 2: Content & Follow-ups */}
                {currentStep === 1 && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label>Email Content</Label>
                                <div className="flex gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={() => insertPlaceholder('name')}>+ Name</Button>
                                    <Button type="button" variant="outline" size="sm" onClick={() => insertPlaceholder('company')}>+ Company</Button>
                                </div>
                            </div>
                            <Controller
                                name="body"
                                control={control}
                                render={({ field }) => (
                                    <div className="h-[400px] mb-12">
                                        <ReactQuill 
                                            theme="snow" 
                                            value={field.value} 
                                            onChange={field.onChange} 
                                            className="h-full"
                                            modules={{
                                                toolbar: [
                                                    [{ 'header': [1, 2, 3, false] }],
                                                    ['bold', 'italic', 'underline', 'strike'],
                                                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                                                    ['link', 'image'],
                                                    ['clean']
                                                ],
                                            }}
                                        />
                                    </div>
                                )}
                            />
                             {errors.body && <p className="text-sm text-destructive mt-2">{errors.body.message}</p>}
                        </div>
                        
                        <Separator />

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">Follow-up Emails</h3>
                                <Button type="button" variant="outline" size="sm" onClick={() => appendFollowUp({ delay_days: 1, subject: '', body: '' })}>
                                    <Plus className="w-4 h-4 mr-2" /> Add Follow-up
                                </Button>
                            </div>
                            
                            {followUpFields.length === 0 && (
                                <p className="text-sm text-muted-foreground italic">No follow-up emails configured. Add one to create a sequence.</p>
                            )}

                            {followUpFields.map((field, index) => (
                                <Card key={field.id} className="relative">
                                    <Button 
                                        type="button" 
                                        variant="ghost" 
                                        size="icon" 
                                        className="absolute right-2 top-2 text-destructive hover:bg-destructive/10"
                                        onClick={() => removeFollowUp(index)}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Clock className="w-4 h-4" /> Follow-up #{index + 1}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="flex items-center gap-4">
                                            <Label>Send after</Label>
                                            <div className="w-24">
                                                <Input 
                                                    type="number" 
                                                    min="1" 
                                                    {...register(`follow_up_config.${index}.delay_days`, { valueAsNumber: true })} 
                                                />
                                            </div>
                                            <span className="text-sm text-muted-foreground">days from previous email</span>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Subject</Label>
                                            <Input placeholder="Follow-up subject..." {...register(`follow_up_config.${index}.subject`)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Body</Label>
                                            <Controller
                                                name={`follow_up_config.${index}.body`}
                                                control={control}
                                                render={({ field }) => (
                                                    <div className="h-[200px] mb-12">
                                                        <ReactQuill theme="snow" value={field.value} onChange={field.onChange} className="h-full" />
                                                    </div>
                                                )}
                                            />
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 3: Audience */}
                {currentStep === 2 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                         <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5" />
                                <h3 className="text-lg font-medium">Select Audience</h3>
                            </div>
                            <p className="text-muted-foreground">Select the lists (tags) you want to target with this campaign.</p>
                            
                            <Card>
                                <CardContent className="pt-6">
                                    <ScrollArea className="h-[300px] pr-4">
                                        <div className="space-y-4">
                                            <div className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id="all-subscribers" 
                                                    checked={watch('target_tags').length === 0}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) setValue('target_tags', []);
                                                    }}
                                                />
                                                <Label htmlFor="all-subscribers" className="font-medium">All Subscribers</Label>
                                            </div>
                                            <Separator />
                                            {availableTags && availableTags.length > 0 ? (
                                                availableTags.map((tag) => (
                                                <div key={tag} className="flex items-center space-x-2 justify-between">
                                                    <div className="flex items-center space-x-2">
                                                        <Checkbox 
                                                            id={`tag-${tag}`} 
                                                            checked={watch('target_tags').includes(tag)}
                                                            onCheckedChange={(checked) => {
                                                                const current = watch('target_tags');
                                                                if (checked) {
                                                                    setValue('target_tags', [...current, tag]);
                                                                } else {
                                                                    setValue('target_tags', current.filter(t => t !== tag));
                                                                }
                                                            }}
                                                        />
                                                        <Label htmlFor={`tag-${tag}`}>{tag}</Label>
                                                    </div>
                                                    <span className="text-xs text-muted-foreground">
                                                        ({tagStats?.stats[tag] || 0})
                                                    </span>
                                                </div>
                                            ))) : (
                                                <p className="text-sm text-muted-foreground italic pl-6">
                                                    No lists (tags) found. Create lists by importing CSVs with a list name.
                                                </p>
                                            )}
                                        </div>
                                    </ScrollArea>
                                </CardContent>
                                <CardFooter className="bg-muted/50 text-sm text-muted-foreground">
                                    {watch('target_tags').length === 0 
                                        ? "Targeting all subscribers." 
                                        : `Targeting subscribers with tags: ${watch('target_tags').join(', ')}`}
                                </CardFooter>
                            </Card>
                        </div>
                    </div>
                )}

                {/* Step 4: Review & Schedule */}
                {currentStep === 3 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Review Details</Label>
                                <div className="p-4 border rounded-lg space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Name:</span>
                                        <span className="font-medium">{watch('name')}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Audience:</span>
                                        <div className="text-right">
                                            <span className="font-medium block">
                                                {watch('target_tags').length === 0 ? 'All Subscribers' : watch('target_tags').join(', ')}
                                            </span>
                                            <span className="text-xs text-muted-foreground block">
                                                ~{recipientCountValue} recipients
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Follow-ups:</span>
                                        <span className="font-medium">{followUpFields.length} configured</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Subject A:</span>
                                        <span className="font-medium">{watch('subject_a')}</span>
                                    </div>
                                    {watch('ab_enabled') && (
                                         <div className="flex justify-between">
                                            <span className="text-muted-foreground">Subject B:</span>
                                            <span className="font-medium">{watch('subject_b')}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                             <div className="space-y-2">
                                <Label>Sending Options</Label>
                                <div className="p-4 border rounded-lg space-y-4">
                                     <div className="flex flex-col space-y-2">
                                        <Label>Schedule Send (Optional)</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full justify-start text-left font-normal",
                                                        !scheduledDate && "text-muted-foreground"
                                                    )}
                                                >
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {scheduledDate ? format(scheduledDate, "PPP p") : <span>Pick a date</span>}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0">
                                                <Calendar
                                                    mode="single"
                                                    selected={scheduledDate}
                                                    onSelect={(date) => {
                                                        // Allow deselection by passing undefined if date is undefined (Calendar might return undefined on deselect if configured, but default single mode doesn't always. 
                                                        // However, checking if date is same as selected can work, but standard Calendar behavior usually handles toggle if configured.
                                                        // We can explicitly clear if same date, or just set what we get.
                                                        setValue('scheduled_at', date); 
                                                    }}
                                                    initialFocus
                                                />
                                                <div className="p-3 border-t">
                                                    <Input 
                                                        type="time" 
                                                        onChange={(e) => {
                                                            const date = scheduledDate || new Date();
                                                            const [hours, minutes] = e.target.value.split(':');
                                                            date.setHours(parseInt(hours), parseInt(minutes));
                                                            setValue('scheduled_at', new Date(date));
                                                        }} 
                                                    />
                                                    <Button variant="ghost" size="sm" className="w-full mt-2" onClick={() => setValue('scheduled_at', undefined)}>
                                                        Clear Date
                                                    </Button>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                     </div>

                                     <div className="flex items-center justify-between">
                                        <Label htmlFor="smart-sending" className="flex flex-col gap-1 cursor-pointer">
                                            <span>Smart Sending</span>
                                            <span className="font-normal text-muted-foreground text-xs">Optimize send time for each user</span>
                                        </Label>
                                        <Controller
                                            name="smart_sending"
                                            control={control}
                                            render={({ field }) => (
                                                <Switch 
                                                    id="smart-sending" 
                                                    checked={field.value} 
                                                    onCheckedChange={field.onChange} 
                                                />
                                            )}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex justify-between pt-8 border-t mt-8">
                    <Button type="button" variant="outline" onClick={prevStep} disabled={currentStep === 0}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    
                    {currentStep < steps.length - 1 ? (
                        <Button type="button" onClick={nextStep}>
                            Next <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    ) : (
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {watch('scheduled_at') ? 'Schedule Campaign' : 'Save as Draft'}
                        </Button>
                    )}
                </div>
            </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default CampaignWizard;
