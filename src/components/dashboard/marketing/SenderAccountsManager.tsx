import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Trash2, Edit, Loader2, Mail, ExternalLink, RefreshCw } from 'lucide-react';

interface SenderAccount {
  id: string;
  email: string;
  display_name: string;
  provider: 'resend' | 'google_workspace';
  provider_config: Record<string, any>;
  daily_limit: number;
  emails_sent_today: number;
  is_active: boolean;
  warmup_enabled: boolean;
  warmup_current_limit: number;
  warmup_daily_increment: number;
}

interface AccountFormData {
  email: string;
  display_name: string;
  provider: 'resend' | 'google_workspace';
  daily_limit: number;
  resend_api_key?: string;
}

const SenderAccountsManager = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SenderAccount | null>(null);
  const [formData, setFormData] = useState<AccountFormData>({
    email: '',
    display_name: '',
    provider: 'resend',
    daily_limit: 500,
    resend_api_key: '',
  });

  // Listen for OAuth popup messages
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'google-oauth-success') {
        toast.success(`Google account ${event.data.email || ''} connected successfully!`);
        queryClient.invalidateQueries({ queryKey: ['sender_accounts'] });
      } else if (event.data?.type === 'google-oauth-error') {
        toast.error(`Failed to connect Google: ${event.data.error || 'Unknown error'}`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [queryClient]);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['sender_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_sender_accounts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as SenderAccount[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: AccountFormData) => {
      const providerConfig: Record<string, any> = {};
      if (data.provider === 'resend' && data.resend_api_key) {
        providerConfig.api_key = data.resend_api_key;
      }

      const { error } = await supabase.from('marketing_sender_accounts').insert({
        email: data.email,
        display_name: data.display_name,
        provider: data.provider,
        daily_limit: data.daily_limit,
        provider_config: providerConfig,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender_accounts'] });
      toast.success('Sender account added');
      handleCloseDialog();
    },
    onError: (err: any) => toast.error(`Failed to add account: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AccountFormData> }) => {
      const updatePayload: Record<string, any> = {
        email: data.email,
        display_name: data.display_name,
        daily_limit: data.daily_limit,
      };
      if (data.resend_api_key) {
        updatePayload.provider_config = { api_key: data.resend_api_key };
      }
      const { error } = await supabase
        .from('marketing_sender_accounts')
        .update(updatePayload)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender_accounts'] });
      toast.success('Account updated');
      handleCloseDialog();
    },
    onError: (err: any) => toast.error(`Failed to update: ${err.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('marketing_sender_accounts')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sender_accounts'] }),
    onError: (err: any) => toast.error(`Failed to update status: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('marketing_sender_accounts')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender_accounts'] });
      toast.success('Account removed');
    },
    onError: (err: any) => toast.error(`Failed to delete: ${err.message}`),
  });

  const warmupMutation = useMutation({
    mutationFn: async ({ id, warmup_enabled }: { id: string; warmup_enabled: boolean }) => {
      const { error } = await supabase
        .from('marketing_sender_accounts')
        .update({ warmup_enabled })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sender_accounts'] }),
    onError: (err: any) => toast.error(`Failed to update warmup: ${err.message}`),
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingAccount(null);
    setFormData({ email: '', display_name: '', provider: 'resend', daily_limit: 500, resend_api_key: '' });
  };

  const handleEdit = (account: SenderAccount) => {
    setEditingAccount(account);
    setFormData({
      email: account.email,
      display_name: account.display_name,
      provider: account.provider,
      daily_limit: account.daily_limit,
      resend_api_key: '',
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.email || !formData.display_name) {
      toast.error('Email and display name are required');
      return;
    }
    if (editingAccount) {
      updateMutation.mutate({ id: editingAccount.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleGoogleConnect = (accountId?: string) => {
    const params = accountId ? `&step=authorize&account_id=${accountId}` : '&step=authorize';
    const url = `/api/marketing?action=google-auth${params}`;
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      url,
      'google-oauth',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
    );
    if (!popup) {
      toast.error('Popup blocked. Please allow popups for this site and try again.');
    }
  };

  const isGoogleConnected = (account: SenderAccount) => {
    return account.provider === 'google_workspace' && !!account.provider_config?.refresh_token;
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Sender Accounts
            </CardTitle>
            <CardDescription>
              Manage sending accounts for inbox rotation and higher deliverability.
            </CardDescription>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" /> Add Account
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!accounts || accounts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No sender accounts yet.</p>
            <p className="text-sm">Add accounts to enable inbox rotation and higher sending volume.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email / Name</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Daily Limit</TableHead>
                <TableHead>Warmup</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{account.display_name}</p>
                      <p className="text-xs text-muted-foreground">{account.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={account.provider === 'google_workspace' ? 'default' : 'secondary'}>
                        {account.provider === 'google_workspace' ? 'Google' : 'Resend'}
                      </Badge>
                      {account.provider === 'google_workspace' && (
                        <span className={`text-xs ${isGoogleConnected(account) ? 'text-green-600' : 'text-red-500'}`}>
                          {isGoogleConnected(account) ? '✓ Connected' : '✗ Not connected'}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <span className="font-medium">{account.emails_sent_today}</span>
                      <span className="text-muted-foreground"> / {account.daily_limit}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={account.warmup_enabled}
                        onCheckedChange={(checked) =>
                          warmupMutation.mutate({ id: account.id, warmup_enabled: checked })
                        }
                      />
                      {account.warmup_enabled && (
                        <span className="text-xs text-muted-foreground">
                          {account.warmup_current_limit}/day
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={account.is_active}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: account.id, is_active: checked })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {account.provider === 'google_workspace' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={isGoogleConnected(account) ? 'Reconnect Google' : 'Connect Google'}
                          onClick={() => handleGoogleConnect(account.id)}
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit"
                        onClick={() => handleEdit(account)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Remove ${account.email}?`)) {
                            deleteMutation.mutate(account.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit Sender Account' : 'Add Sender Account'}</DialogTitle>
            <DialogDescription>
              Add a sending email account for inbox rotation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={formData.provider}
                onValueChange={(v) => setFormData({ ...formData, provider: v as 'resend' | 'google_workspace' })}
                disabled={!!editingAccount}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resend">Resend</SelectItem>
                  <SelectItem value="google_workspace">Google Workspace / Gmail</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="sender@yourdomain.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder="Your Company Name"
              />
            </div>

            <div className="space-y-2">
              <Label>Daily Sending Limit</Label>
              <Input
                type="number"
                value={formData.daily_limit}
                onChange={(e) => setFormData({ ...formData, daily_limit: parseInt(e.target.value) || 500 })}
                min={1}
                max={10000}
              />
              <p className="text-xs text-muted-foreground">
                {formData.provider === 'google_workspace'
                  ? 'Gmail: 2,000/day recommended. Google Workspace can send up to 2,000/day.'
                  : 'Resend limits depend on your plan.'}
              </p>
            </div>

            {formData.provider === 'resend' && (
              <div className="space-y-2">
                <Label>Resend API Key {editingAccount && '(leave blank to keep existing)'}</Label>
                <Input
                  type="password"
                  value={formData.resend_api_key}
                  onChange={(e) => setFormData({ ...formData, resend_api_key: e.target.value })}
                  placeholder="re_..."
                />
                <p className="text-xs text-muted-foreground">
                  Each sender account can use a different Resend API key. Leave blank to use the default key.
                </p>
              </div>
            )}

            {formData.provider === 'google_workspace' && !editingAccount && (
              <div className="p-4 bg-muted rounded-lg space-y-3">
                <p className="text-sm font-medium">Google OAuth Required</p>
                <p className="text-xs text-muted-foreground">
                  After saving the basic details, you'll need to connect your Google account via OAuth to authorize sending.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => handleGoogleConnect()}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Connect Google Account
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {editingAccount ? 'Save Changes' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default SenderAccountsManager;
