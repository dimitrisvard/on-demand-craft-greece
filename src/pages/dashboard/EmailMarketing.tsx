import React, { useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Plus, Users, BarChart2, Mail, LayoutTemplate } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import SubscribersTable from '@/components/dashboard/marketing/SubscribersTable';

// Placeholder components - will be implemented in subsequent steps
const SubscribersView = () => (
  <Card>
    <CardHeader>
      <CardTitle>Subscribers</CardTitle>
      <CardDescription>Manage your email list and subscribers.</CardDescription>
    </CardHeader>
    <CardContent>
      <SubscribersTable />
    </CardContent>
  </Card>
);

import CampaignsTable from '@/components/dashboard/marketing/CampaignsTable';

const CampaignsList = () => {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
        <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold tracking-tight">Campaigns</h2>
            <Button onClick={() => navigate('/dashboard/email-marketing/campaigns/new')}>
                <Plus className="mr-2 h-4 w-4" /> New Campaign
            </Button>
        </div>
      <Card>
        <CardContent className="pt-6">
          <CampaignsTable />
        </CardContent>
      </Card>
    </div>
  );
};

import AnalyticsDashboard from '@/components/dashboard/marketing/AnalyticsDashboard';

const AnalyticsView = () => (
  <Card>
    <CardHeader>
      <CardTitle>Analytics Dashboard</CardTitle>
      <CardDescription>View performance metrics for your campaigns.</CardDescription>
    </CardHeader>
    <CardContent>
      <AnalyticsDashboard />
    </CardContent>
  </Card>
);

import CampaignWizard from '@/components/dashboard/marketing/CampaignWizard';

// Placeholder components - will be implemented in subsequent steps

import EmailMarketingSettings from '@/components/dashboard/marketing/EmailMarketingSettings';

const SettingsView = () => (
    <div className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <EmailMarketingSettings />
    </div>
);

const EmailMarketing = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Determine active tab based on path
  const getActiveTab = () => {
    const path = location.pathname;
    if (path.includes('/subscribers')) return 'subscribers';
    if (path.includes('/analytics')) return 'analytics';
    if (path.includes('/settings')) return 'settings';
    if (path.includes('/campaigns')) return 'campaigns'; // Generic for list
    return 'overview'; // Default to overview/campaigns list
  };

  const handleTabChange = (value: string) => {
    switch (value) {
      case 'overview':
        navigate('/dashboard/email-marketing');
        break;
      case 'subscribers':
        navigate('/dashboard/email-marketing/subscribers');
        break;
      case 'analytics':
        navigate('/dashboard/email-marketing/analytics');
        break;
      case 'settings':
        navigate('/dashboard/email-marketing/settings');
        break;
      default:
        break;
    }
  };

  // If we are in the wizard, don't show the tabs layout, just the wizard
  // or show tabs but with wizard active. 
  // Let's keep the layout simple: The main route shows tabs. 
  // Sub-routes like /campaigns/new might want full focus or can stay within tabs.
  // For now, let's keep it within the layout.

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Email Marketing Hub</h1>
            <p className="text-muted-foreground">Manage campaigns, subscribers, and track performance.</p>
        </div>

        <Tabs value={getActiveTab()} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Campaigns
            </TabsTrigger>
            <TabsTrigger value="subscribers" className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Subscribers
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4" /> Analytics
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" /> Settings
            </TabsTrigger>
          </TabsList>

          <Routes>
            <Route path="/" element={<CampaignsList />} />
            <Route path="/subscribers" element={<SubscribersView />} />
            <Route path="/analytics" element={<AnalyticsView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/campaigns/new" element={<CampaignWizard />} />
            {/* Redirect any unknown sub-routes to overview */}
            <Route path="*" element={<Navigate to="/dashboard/email-marketing" replace />} />
          </Routes>
        </Tabs>
      </div>
    </PersistentDashboardLayout>
  );
};

export default EmailMarketing;

