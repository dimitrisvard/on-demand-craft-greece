import { useState } from 'react';
import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Settings, Globe, RefreshCw, CheckCircle, ExternalLink, FileText, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';

interface SitemapResult {
  stats: {
    type: string;
    urls: number;
    languages: number;
    articles: number;
  };
  storage: {
    uploaded: Array<{
      filename: string;
      publicUrl: string | null;
      success: boolean;
    }>;
  };
}

const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [generatingSitemap, setGeneratingSitemap] = useState(false);
  const [sitemapResult, setSitemapResult] = useState<SitemapResult | null>(null);

  const handleGenerateSitemap = async () => {
    setGeneratingSitemap(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("You must be logged in to generate sitemaps");
      }

      // Generate single complete sitemap (SEO-perfect format) and save to storage
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-sitemap?type=complete`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Sitemap generation failed");
      }

      setSitemapResult(result);

      if (result.storage?.uploaded?.[0]?.success) {
        toast({
          title: "✅ Sitemap Generated Successfully",
          description: `Generated sitemap-complete.xml with ${result.stats.urls} URLs across ${result.stats.languages} languages. ${result.stats.articles} articles included.`,
        });
      } else {
        toast({
          title: "❌ Sitemap Generation Failed",
          description: result.error || "Failed to generate and save sitemap.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Sitemap generation error:", error);
      toast({
        title: "❌ Sitemap Generation Failed",
        description: error.message || "Failed to generate sitemap. Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingSitemap(false);
    }
  };

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6 w-full">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-8 w-8" />
            Settings
          </h1>
          <p className="text-muted-foreground">Manage your account settings and preferences.</p>
        </div>

        <Tabs defaultValue="account" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="seo">SEO & Sitemap</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Account Information</CardTitle>
                <CardDescription>Update your account details and personal information.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={user?.email || ''} disabled />
                  <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Input id="role" value={user?.role?.replace('_', ' ') || 'User'} disabled />
                </div>
                <Button>Save Changes</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="seo" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Sitemap Management
                </CardTitle>
                <CardDescription>
                  Generate and update your XML sitemaps to help search engines discover your content.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div>
                      <h4 className="font-medium">Generate Complete Sitemap</h4>
                      <p className="text-sm text-muted-foreground">
                        Creates a single SEO-optimized sitemap-complete.xml file with all languages and pages. Google Search Console compatible format.
                      </p>
                    </div>
                    <Button 
                      onClick={handleGenerateSitemap} 
                      disabled={generatingSitemap}
                      className="shrink-0"
                    >
                      {generatingSitemap ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Generate & Update Sitemap
                        </>
                      )}
                    </Button>
                  </div>

                  {sitemapResult && (
                    <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                        <span className="font-medium">Last Generation Result</span>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Total URLs</p>
                          <p className="text-lg font-semibold">{sitemapResult.stats.urls}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Languages</p>
                          <p className="text-lg font-semibold">{sitemapResult.stats.languages}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Articles</p>
                          <p className="text-lg font-semibold">{sitemapResult.stats.articles}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Files Generated</p>
                          <p className="text-lg font-semibold">{sitemapResult.storage.uploaded.length}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">Generated Files:</p>
                        <div className="flex flex-wrap gap-2">
                          {sitemapResult.storage.uploaded.map((file, index) => (
                            <Badge 
                              key={index} 
                              variant={file.success ? "default" : "destructive"}
                              className="flex items-center gap-1"
                            >
                              {file.success ? (
                                <CheckCircle className="h-3 w-3" />
                              ) : (
                                <AlertCircle className="h-3 w-3" />
                              )}
                              {file.filename}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-4 space-y-4">
                    <div>
                      <h4 className="font-medium mb-2 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        Submit to Google Search Console
                      </h4>
                      <p className="text-sm text-muted-foreground mb-2">
                        Submit this URL to Google Search Console. It contains all pages with proper hreflang tags for multi-language SEO.
                      </p>
                      <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                        <FileText className="h-4 w-4 text-green-600" />
                        <a 
                          href="https://www.micronshub.eu/sitemap-complete.xml" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-green-700 dark:text-green-400 hover:underline flex items-center gap-1 font-medium"
                        >
                          https://www.micronshub.eu/sitemap-complete.xml
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        The sitemap is automatically updated after new articles are translated. 
                        You can also manually regenerate it using the button above.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Configure how and when you receive notifications.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Notification settings will be implemented here.</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
                <CardDescription>Manage your security settings and password.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Security settings will be implemented here.</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Customize the appearance of your dashboard.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Appearance settings will be implemented here.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PersistentDashboardLayout>
  );
};

export default SettingsPage;

