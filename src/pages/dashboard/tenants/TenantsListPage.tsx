import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PencilIcon, PlusCircle, Trash2, Search, Building2, Globe } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { BackToDashboardButton } from '@/components/dashboard/BackToDashboardButton';
import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { format } from 'date-fns';
import { listTenants, deleteTenant } from '@/utils/tenantApi';
import type { Tenant } from '@/types/tenant';
import { DEFAULT_TENANT_ID } from '@/types/tenant';

export default function TenantsListPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<Tenant[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const data = await listTenants();
      setTenants(data);
      setFilteredTenants(data);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  useEffect(() => {
    if (!searchQuery) {
      setFilteredTenants(tenants);
      return;
    }
    const q = searchQuery.toLowerCase();
    setFilteredTenants(
      tenants.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.contact_email || '').toLowerCase().includes(q)
      )
    );
  }, [searchQuery, tenants]);

  const handleDelete = async () => {
    if (!selectedTenant) return;
    try {
      await deleteTenant(selectedTenant.id);
      toast({ title: 'Tenant deactivated', description: `${selectedTenant.name} has been deactivated.` });
      setIsDeleteDialogOpen(false);
      setSelectedTenant(null);
      fetchTenants();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <PersistentDashboardLayout>
      <div className="p-6 space-y-6">
        <BackToDashboardButton />

        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-7 w-7" />
              Tenants
            </h1>
            <p className="text-muted-foreground mt-1">Manage white-label tenant organizations</p>
          </div>
          <Button onClick={() => navigate('/dashboard/tenants/new')} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            New Tenant
          </Button>
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tenants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Logo</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Subdomain</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTenants.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      {tenant.logo_url ? (
                        <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-8 object-contain rounded" />
                      ) : (
                        <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{tenant.name}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Globe className="h-3 w-3" />
                        {tenant.slug}.micronshub.eu
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{tenant.contact_email || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={tenant.is_active ? 'default' : 'secondary'}>
                        {tenant.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(tenant.created_at), 'dd MMM yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/dashboard/tenants/${tenant.id}`)}
                        >
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                        {tenant.id !== DEFAULT_TENANT_ID && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              setSelectedTenant(tenant);
                              setIsDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredTenants.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No tenants found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>

        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Deactivate Tenant</DialogTitle>
              <DialogDescription>
                Are you sure you want to deactivate <strong>{selectedTenant?.name}</strong>?
                Their subdomain will stop working but data will be preserved.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>Deactivate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PersistentDashboardLayout>
  );
}
