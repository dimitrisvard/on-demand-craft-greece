import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Save, Settings } from 'lucide-react';

const settingsSchema = z.object({
  daily_limit: z.number().min(1).max(100000),
  sending_window_start: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  sending_window_end: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  delay_between_emails_seconds: z.number().min(0).max(3600),
  active_days: z.array(z.number()).min(1, "Select at least one active day"),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

const DAYS_OF_WEEK = [
  { id: 1, label: 'Monday' },
  { id: 2, label: 'Tuesday' },
  { id: 3, label: 'Wednesday' },
  { id: 4, label: 'Thursday' },
  { id: 5, label: 'Friday' },
  { id: 6, label: 'Saturday' },
  { id: 7, label: 'Sunday' },
];

const EmailMarketingSettings = () => {
  const queryClient = useQueryClient();

  // Fetch settings
  const { data: settings, isLoading, error: queryError } = useQuery({
    queryKey: ['marketing_settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_settings')
        .select('*')
        .maybeSingle(); // Use maybeSingle to avoid error if no row exists yet
      
      if (error) {
        console.error('Error fetching settings:', error);
        throw error;
      }
      
      return data || {
        daily_limit: 1000,
        sending_window_start: '09:00',
        sending_window_end: '17:00',
        delay_between_emails_seconds: 60,
        active_days: [1, 2, 3, 4, 5],
      };
    },
    retry: 1, // Don't retry endlessly on 404
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
        daily_limit: 1000,
        sending_window_start: '09:00',
        sending_window_end: '17:00',
        delay_between_emails_seconds: 60,
        active_days: [1, 2, 3, 4, 5],
    },
    values: settings ? {
        daily_limit: settings.daily_limit,
        sending_window_start: settings.sending_window_start?.slice(0, 5) || '09:00',
        sending_window_end: settings.sending_window_end?.slice(0, 5) || '17:00',
        delay_between_emails_seconds: settings.delay_between_emails_seconds,
        active_days: settings.active_days || [1, 2, 3, 4, 5],
    } : undefined,
  });

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = form;

  const mutation = useMutation({
    mutationFn: async (data: SettingsFormValues) => {
      // Check if row exists to decide insert vs update (though we only have one row policy usually)
      // We can just upsert if we had a fixed ID or check.
      // Since we fetched `settings`, if it has an ID, we update. If not, we insert.
      
      const payload = {
        daily_limit: data.daily_limit,
        sending_window_start: data.sending_window_start,
        sending_window_end: data.sending_window_end,
        delay_between_emails_seconds: data.delay_between_emails_seconds,
        active_days: data.active_days,
        updated_at: new Date().toISOString(),
      };

      if (settings?.id) {
         const { error } = await supabase
            .from('marketing_settings')
            .update(payload)
            .eq('id', settings.id);
         if (error) throw error;
      } else {
         const { error } = await supabase
            .from('marketing_settings')
            .insert([payload]);
         if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing_settings'] });
      toast.success('Settings saved successfully');
    },
    onError: (error) => {
      console.error(error);
      toast.error('Failed to save settings');
    }
  });

  const onSubmit = (data: SettingsFormValues) => {
    mutation.mutate(data);
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Sending Configuration
        </CardTitle>
        <CardDescription>
          Configure how your email campaigns are sent to ensure good deliverability and compliance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="daily_limit">Daily Sending Limit</Label>
              <Input
                id="daily_limit"
                type="number"
                {...register('daily_limit', { valueAsNumber: true })}
              />
              <p className="text-xs text-muted-foreground">Maximum number of emails to send per 24-hour period.</p>
              {errors.daily_limit && <p className="text-sm text-destructive">{errors.daily_limit.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="delay">Delay Between Emails (Seconds)</Label>
              <Input
                id="delay"
                type="number"
                {...register('delay_between_emails_seconds', { valueAsNumber: true })}
              />
              <p className="text-xs text-muted-foreground">Wait time between individual emails to prevent spam flagging.</p>
              {errors.delay_between_emails_seconds && <p className="text-sm text-destructive">{errors.delay_between_emails_seconds.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="window_start">Sending Window Start</Label>
              <Input
                id="window_start"
                type="time"
                {...register('sending_window_start')}
              />
              {errors.sending_window_start && <p className="text-sm text-destructive">{errors.sending_window_start.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="window_end">Sending Window End</Label>
              <Input
                id="window_end"
                type="time"
                {...register('sending_window_end')}
              />
              {errors.sending_window_end && <p className="text-sm text-destructive">{errors.sending_window_end.message}</p>}
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <Label>Active Sending Days</Label>
            <div className="flex flex-wrap gap-4">
              <Controller
                name="active_days"
                control={control}
                render={({ field }) => (
                  <>
                    {DAYS_OF_WEEK.map((day) => (
                      <div key={day.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`day-${day.id}`}
                          checked={(field.value || []).includes(day.id)}
                          onCheckedChange={(checked) => {
                            const currentValues = field.value || [];
                            if (checked) {
                              field.onChange([...currentValues, day.id]);
                            } else {
                              field.onChange(currentValues.filter((d) => d !== day.id));
                            }
                          }}
                        />
                        <Label htmlFor={`day-${day.id}`}>{day.label}</Label>
                      </div>
                    ))}
                  </>
                )}
              />
            </div>
            {errors.active_days && <p className="text-sm text-destructive">{errors.active_days.message}</p>}
          </div>

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default EmailMarketingSettings;

