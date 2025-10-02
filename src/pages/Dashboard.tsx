import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Users, 
  Factory, 
  ShoppingBag, 
  FileText, 
  Package, 
  Calendar, 
  Bell, 
  Settings,
  LayoutDashboard,
  BarChart3
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import DashboardOverview from "@/components/dashboard/DashboardOverview";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeModule, setActiveModule] = useState("overview");

  // Check if user is a production partner
  const isProductionPartner = user?.role === 'partner_seller';

  return (
    <PersistentDashboardLayout>
      {activeModule === "overview" && <DashboardOverview />}
      {activeModule === "products" && !isProductionPartner && <ProductsModule />}
      {activeModule === "orders" && <OrdersModule />}
      {activeModule === "calendar" && <CalendarModule />}
      {activeModule === "notifications" && !isProductionPartner && <NotificationsModule />}
      {activeModule === "settings" && !isProductionPartner && <SettingsModule />}
    </PersistentDashboardLayout>
  );
};

const ProductsModule = () => {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Products & Inventory</h2>
        <div className="space-x-2">
          <Button onClick={() => navigate('/products')}>
            <ShoppingBag className="h-4 w-4 mr-2" />
            <span>Manage Products</span>
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Products Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium">Total Products</h3>
              <p className="text-2xl font-bold mt-2">--</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium">Low Stock Items</h3>
              <p className="text-2xl font-bold mt-2 text-yellow-600">--</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium">Out of Stock</h3>
              <p className="text-2xl font-bold mt-2 text-red-600">--</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const OrdersModule = () => {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Order Management</h2>
        <Button 
          className="flex items-center space-x-2"
          onClick={() => navigate('/orders')}
        >
          <Package className="h-4 w-4 mr-2" />
          <span>Manage Orders</span>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Orders Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium">New Orders</h3>
              <p className="text-2xl font-bold mt-2">--</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium">In Progress</h3>
              <p className="text-2xl font-bold mt-2 text-blue-600">--</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-medium">Completed This Month</h3>
              <p className="text-2xl font-bold mt-2 text-green-600">--</p>
            </div>
          </div>
          
          <div className="mt-6">
            <h3 className="font-medium mb-2">Recent Orders</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 border rounded-md">
                <div>
                  <p className="font-medium">Order #12345</p>
                  <p className="text-sm text-muted-foreground">Acme Corp</p>
                </div>
                <div className="text-right">
                  <Badge>New</Badge>
                  <p className="text-sm text-muted-foreground">Apr 25, 2025</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-2 border rounded-md">
                <div>
                  <p className="font-medium">Order #12344</p>
                  <p className="text-sm text-muted-foreground">TechStart Inc</p>
                </div>
                <div className="text-right">
                  <Badge variant="default">In Progress</Badge>
                  <p className="text-sm text-muted-foreground">Apr 24, 2025</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const CalendarModule = () => {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Calendar & Scheduling</h2>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => navigate("/calendar")}>
            <Calendar className="h-4 w-4 mr-2" />
            Full Calendar
          </Button>
          <Button className="flex items-center space-x-2">
            <Calendar className="h-4 w-4" />
            <span>New Event</span>
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-2 border rounded-md bg-green-50">
              <div>
                <p className="font-medium">Bracket Assembly</p>
                <p className="text-sm text-muted-foreground">Acme Corp</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">Due Today</p>
                <p className="text-xs text-muted-foreground">Apr 24, 2025</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-2 border rounded-md">
              <div>
                <p className="font-medium">CNC Machined Housings</p>
                <p className="text-sm text-muted-foreground">TechStart Inc</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">Due in 3 days</p>
                <p className="text-xs text-muted-foreground">Apr 27, 2025</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-2 border rounded-md">
              <div>
                <p className="font-medium">Sheet Metal Brackets</p>
                <p className="text-sm text-muted-foreground">BuildRight Ltd</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">Due in 6 days</p>
                <p className="text-xs text-muted-foreground">Apr 30, 2025</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const NotificationsModule = () => {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Notifications & Alerts</h2>
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Notifications and alerts system will be implemented here.</p>
        </CardContent>
      </Card>
    </div>
  );
};

const SettingsModule = () => {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>
      <Tabs defaultValue="account" className="w-full">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>
        <TabsContent value="account" className="p-4 border rounded-md mt-2">
          <h3 className="text-lg font-medium">Account Settings</h3>
          <p className="text-muted-foreground">Manage your account settings and preferences.</p>
        </TabsContent>
        <TabsContent value="notifications" className="p-4 border rounded-md mt-2">
          <h3 className="text-lg font-medium">Notification Settings</h3>
          <p className="text-muted-foreground">Configure how and when you receive notifications.</p>
        </TabsContent>
        <TabsContent value="security" className="p-4 border rounded-md mt-2">
          <h3 className="text-lg font-medium">Security Settings</h3>
          <p className="text-muted-foreground">Manage your security settings and preferences.</p>
        </TabsContent>
        <TabsContent value="appearance" className="p-4 border rounded-md mt-2">
          <h3 className="text-lg font-medium">Appearance Settings</h3>
          <p className="text-muted-foreground">Customize the appearance of your dashboard.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Dashboard;
