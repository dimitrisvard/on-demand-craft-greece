import React, { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useToast } from '../hooks/use-toast';

export default function TestPartnerNotification() {
  const [partnerEmail, setPartnerEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleTestNotification = async () => {
    if (!partnerEmail) {
      toast({
        title: "Error",
        description: "Please enter a partner email address",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await fetch('/api/test-partner-notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ partnerEmail }),
      });

      const result = await response.json();

      if (response.ok) {
        toast({
          title: "Success",
          description: "Test partner notification email sent successfully!",
        });
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to send test email",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast({
        title: "Error",
        description: "Failed to send test notification",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Test Partner Notification</CardTitle>
            <CardDescription>
              Send a test email to verify the partner notification system is working correctly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="partnerEmail">Partner Email Address</Label>
              <Input
                id="partnerEmail"
                type="email"
                placeholder="Enter partner email address"
                value={partnerEmail}
                onChange={(e) => setPartnerEmail(e.target.value)}
              />
            </div>
            
            <Button 
              onClick={handleTestNotification}
              disabled={isLoading || !partnerEmail}
              className="w-full"
            >
              {isLoading ? 'Sending Test Email...' : 'Send Test Partner Notification'}
            </Button>
            
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">What this test does:</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Sends a professional email template to the specified partner email</li>
                <li>• Includes sample order details and production information</li>
                <li>• Tests the complete email notification system</li>
                <li>• Verifies that partners receive proper order assignment notifications</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
