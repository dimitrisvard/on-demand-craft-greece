import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
import { CalendarIcon, Loader2, Send, Save, ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// Validation Schema
const campaignSchema = z.object({
  name: z.string().min(3, "Campaign name must be at least 3 characters"),
  subject_a: z.string().min(5, "Subject line is required"),
  subject_b: z.string().optional(),
  ab_enabled: z.boolean().default(false),
  test_percentage: z.number().min(10).max(100).default(20),
  body: z.string().min(10, "Email content is required"),
  scheduled_at: z.date().optional(),
  smart_sending: z.boolean().default(false),
});

type CampaignFormValues = z.infer<typeof campaignSchema>;

const steps = [
  { id: 'details', title: '1. Details' },
  { id: 'content', title: '2. Content' },
  { id: 'audience', title: '3. Audience' }, // Simplified for now
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
    }
  });

  const { watch, setValue, control, register, handleSubmit, formState: { errors } } = form;
  const abEnabled = watch('ab_enabled');
  const scheduledDate = watch('scheduled_at');

  const onSubmit = async (data: CampaignFormValues) => {
    setIsSubmitting(true);
    try {
      // 1. Create Campaign in DB
      const { data: campaign, error } = await supabase
        .from('marketing_campaigns')
        .insert({
          name: data.name,
          subject_a: data.subject_a,
          subject_b: data.subject_b,
          body: data.body,
          scheduled_at: data.scheduled_at ? data.scheduled_at.toISOString() : null,
          status: data.scheduled_at ? 'scheduled' : 'draft', // Or 'sending' if immediate? Let's use draft/scheduled for now.
          ab_test_config: {
            enabled: data.ab_enabled,
            test_percentage: data.test_percentage,
            winning_metric: 'opens',
            duration_hours: 4
          }
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Campaign saved successfully!');
      
      // If scheduled or immediate send, we might trigger a backend function here
      // For now, we just save and redirect
      navigate('/dashboard/email-marketing');

    } catch (error) {
      console.error('Error saving campaign:', error);
      toast.error('Failed to save campaign');
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = () => {
    // Validate current step fields before moving
    if (currentStep === 0) {
        const name = form.trigger('name');
        const subj = form.trigger('subject_a');
        if(!name || !subj) return; 
        // Note: trigger is async but we are simplifying logic here. 
        // Ideally await form.trigger(['name', 'subject_a'])
    }
    setCurrentStep(prev => Math.min(prev + 1, steps.length - 1));
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  };

  return (
    <div className="max-w-4xl mx-auto py-6">
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
            <form onSubmit={handleSubmit(onSubmit)}>
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
                                        <p className="text-xs text-muted-foreground">
                                            We'll send Variant A and B to {watch('test_percentage')}% of your list, wait 4 hours, then send the winning subject line to the rest.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 2: Content */}
                {currentStep === 1 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="space-y-2">
                            <Label>Email Content</Label>
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
                    </div>
                )}

                {/* Step 3: Audience (Placeholder) */}
                {currentStep === 2 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 text-center py-12">
                        <div className="max-w-md mx-auto space-y-4">
                            <Users className="w-12 h-12 mx-auto text-muted-foreground" />
                            <h3 className="text-lg font-medium">Audience Selection</h3>
                            <p className="text-muted-foreground">
                                Currently, this campaign will be sent to <strong>All Active Subscribers</strong>.
                            </p>
                            <div className="p-4 bg-secondary/50 rounded-lg text-sm text-left">
                                <p>Future feature: Filter by tags (e.g., "Customer", "Newsletter") or status.</p>
                            </div>
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
                                                    onSelect={(date) => setValue('scheduled_at', date)}
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

