import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bell } from 'lucide-react';

const NotificationsPage = () => {
  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-8 w-8" />
            Notifications & Alerts
          </h1>
          <p className="text-muted-foreground">Manage your notifications and alerts.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Notifications and alerts system will be implemented here.</p>
          </CardContent>
        </Card>
      </div>
    </PersistentDashboardLayout>
  );
};

export default NotificationsPage;

