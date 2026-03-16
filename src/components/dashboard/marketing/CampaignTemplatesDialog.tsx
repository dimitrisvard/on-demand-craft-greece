import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { LayoutTemplate, Save, Trash2, Loader2, Plus } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  tags: string[];
  created_at: string;
}

interface Props {
  // Called when user selects a template to use
  onSelect?: (template: { subject: string; body: string }) => void;
  // If provided, saves the current content as a new template
  currentSubject?: string;
  currentBody?: string;
  mode?: 'browse' | 'save';
}

const CampaignTemplatesDialog = ({
  onSelect,
  currentSubject = '',
  currentBody = '',
  mode = 'browse',
}: Props) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['marketing_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_templates')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Template[];
    },
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('marketing_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing_templates'] });
      toast.success('Template deleted');
    },
    onError: (err: any) => toast.error(`Failed to delete: ${err.message}`),
  });

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!currentSubject || !currentBody) {
      toast.error('Subject and body are required to save a template');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.from('marketing_templates').insert({
        name: newTemplateName.trim(),
        subject: currentSubject,
        body: currentBody,
        tags: [],
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['marketing_templates'] });
      toast.success(`Template "${newTemplateName}" saved`);
      setNewTemplateName('');
    } catch (err: any) {
      toast.error(`Failed to save template: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelect = (template: Template) => {
    onSelect?.({ subject: template.subject, body: template.body });
    setOpen(false);
    toast.success(`Template "${template.name}" applied`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <LayoutTemplate className="w-4 h-4 mr-2" />
          {mode === 'save' ? 'Save as Template' : 'Load Template'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5" /> Campaign Templates
          </DialogTitle>
          <DialogDescription>
            Save and reuse email templates across campaigns.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Save current as template */}
          {(mode === 'save' || mode === 'browse') && currentSubject && currentBody && (
            <div className="p-3 border rounded-lg space-y-3 bg-muted/30">
              <p className="text-sm font-medium flex items-center gap-2">
                <Save className="w-4 h-4" /> Save Current as Template
              </p>
              <div className="flex gap-2">
                <Input
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Template name..."
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleSaveTemplate}
                  disabled={isSaving || !newTemplateName.trim()}
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Save
                </Button>
              </div>
            </div>
          )}

          <Separator />

          <div>
            <Label className="mb-3 block">Saved Templates</Label>
            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : !templates || templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <LayoutTemplate className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No templates saved yet.</p>
              </div>
            ) : (
              <ScrollArea className="h-[320px] pr-2">
                <div className="space-y-2">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="border rounded-lg p-3 hover:border-primary transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{template.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            Subject: {template.subject}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {onSelect && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSelect(template)}
                            >
                              Use
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm(`Delete template "${template.name}"?`)) {
                                deleteMutation.mutate(template.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignTemplatesDialog;
