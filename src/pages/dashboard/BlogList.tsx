import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Pencil, PlusCircle, Search, Trash2, Eye, FileText, Languages, Globe, Loader2, Map, Download, RefreshCw, CheckCircle2, XCircle, ChevronDown, MoreHorizontal } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format as dateFormat } from "date-fns";
import { Calendar, Clock, ArrowLeft, X } from "lucide-react";

interface Article {
  id: string;
  title: string;
  slug: string;
  language: string;
  status: 'draft' | 'published';
  created_at: string;
  author_id: string;
  translation_id: string | null;
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "cs", label: "Czech" },
  { code: "hu", label: "Hungarian" },
  { code: "pt", label: "Portuguese" },
  { code: "nb", label: "Norwegian" },
];

interface FullArticle extends Article {
  content?: string;
  excerpt?: string;
  featured_image?: string;
  featured_image_alt?: string;
  meta_title?: string;
  meta_description?: string;
}

const BlogList = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateSort, setDateSort] = useState("newest");
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [generatingSitemap, setGeneratingSitemap] = useState(false);
  const [sitemapDialogOpen, setSitemapDialogOpen] = useState(false);
  const [sitemapData, setSitemapData] = useState<{ sitemap: string; stats: any; storage?: any } | null>(null);
  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [articleToDelete, setArticleToDelete] = useState<Article | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Preview dialog state
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewArticle, setPreviewArticle] = useState<FullArticle | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  // Selection state for bulk actions
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  // Bulk delete confirmation dialog
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    fetchArticles();
  }, []);

  const fetchArticles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      console.error('Error fetching articles:', error);
      toast({
        title: "Error",
        description: "Failed to load articles",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (article: Article) => {
    setArticleToDelete(article);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!articleToDelete) return;

    try {
      setDeleting(true);
      const { error } = await supabase
        .from('articles')
        .delete()
        .eq('id', articleToDelete.id);

      if (error) throw error;

      setArticles(articles.filter(a => a.id !== articleToDelete.id));
      toast({
        title: "Success",
        description: "Article deleted successfully",
      });
      setDeleteDialogOpen(false);
      setArticleToDelete(null);
    } catch (error: any) {
      console.error('Error deleting article:', error);
      toast({
        title: "Error",
        description: "Failed to delete article",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handlePreviewClick = async (article: Article) => {
    setLoadingPreview(true);
    setPreviewDialogOpen(true);
    
    try {
      // Fetch full article content for preview
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('id', article.id)
        .single();

      if (error) throw error;
      setPreviewArticle(data);
    } catch (error: any) {
      console.error('Error fetching article for preview:', error);
      toast({
        title: "Error",
        description: "Failed to load article preview",
        variant: "destructive",
      });
      setPreviewDialogOpen(false);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleTranslate = async (articleId: string) => {
    setTranslatingId(articleId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-article`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ article_id: articleId }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Translation failed");
      }

      // Success message with details
      const successfulTranslations = result.translations || 0;
      const totalLanguages = result.total_languages || 13;
      const indexNowStatus = result.indexing?.indexnow ? "✓" : "✗";

      toast({
        title: "✅ Translation Successful",
        description: `Article translated to ${successfulTranslations}/${totalLanguages} languages and published. IndexNow: ${indexNowStatus}`,
      });

      // Refresh articles list
      fetchArticles();
    } catch (error: any) {
      console.error("Translation error:", error);
      toast({
        title: "❌ Translation Failed",
        description: error.message || "Failed to translate article. Please try again.",
        variant: "destructive",
      });
    } finally {
      setTranslatingId(null);
    }
  };

  const handleGenerateSitemap = async () => {
    setGeneratingSitemap(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

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

      // Check if all uploads were successful
      const uploadedFiles = result.storage?.uploaded || [];
      const successfulUploads = uploadedFiles.filter((u: any) => u.success);
      const failedUploads = uploadedFiles.filter((u: any) => u.success === false);

      if (result.storage?.uploaded?.[0]?.success) {
        const publicUrl = result.storage.uploaded[0].publicUrl || `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/sitemaps/sitemap-complete.xml`;
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

      setSitemapData({
        sitemap: result.sitemap || "",
        stats: result.stats,
        storage: result.storage,
      });
      setSitemapDialogOpen(true);
    } catch (error: any) {
      console.error("Sitemap error:", error);
      toast({
        title: "❌ Sitemap Generation Failed",
        description: error.message || "Failed to generate sitemap. Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingSitemap(false);
    }
  };

  const handleDownloadSitemap = () => {
    if (!sitemapData?.sitemap) return;

    const blob = new Blob([sitemapData.sitemap], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sitemap.xml";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopySitemap = () => {
    if (!sitemapData?.sitemap) return;
    navigator.clipboard.writeText(sitemapData.sitemap);
    toast({
      title: "Copied",
      description: "Sitemap XML copied to clipboard",
    });
  };

  const filteredArticles = useMemo(() => {
    return articles
      .filter(article => {
        const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesLanguage = languageFilter === "all" || article.language === languageFilter;
        const matchesStatus = statusFilter === "all" || article.status === statusFilter;
        return matchesSearch && matchesLanguage && matchesStatus;
      })
      .sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateSort === "newest" ? dateB - dateA : dateA - dateB;
      });
  }, [articles, searchQuery, languageFilter, statusFilter, dateSort]);

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedArticles(new Set(filteredArticles.map(a => a.id)));
    } else {
      setSelectedArticles(new Set());
    }
  };

  const handleSelectArticle = (articleId: string, checked: boolean) => {
    const newSelected = new Set(selectedArticles);
    if (checked) {
      newSelected.add(articleId);
    } else {
      newSelected.delete(articleId);
    }
    setSelectedArticles(newSelected);
  };

  const isAllSelected = filteredArticles.length > 0 && filteredArticles.every(a => selectedArticles.has(a.id));
  const isSomeSelected = selectedArticles.size > 0 && !isAllSelected;

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedArticles.size === 0) return;

    try {
      setBulkDeleting(true);
      const idsToDelete = Array.from(selectedArticles);
      
      const { error } = await supabase
        .from('articles')
        .delete()
        .in('id', idsToDelete);

      if (error) throw error;

      setArticles(articles.filter(a => !selectedArticles.has(a.id)));
      toast({
        title: "Success",
        description: `${selectedArticles.size} article(s) deleted successfully`,
      });
      setSelectedArticles(new Set());
      setBulkDeleteDialogOpen(false);
    } catch (error: any) {
      console.error('Error deleting articles:', error);
      toast({
        title: "Error",
        description: "Failed to delete articles",
        variant: "destructive",
      });
    } finally {
      setBulkDeleting(false);
    }
  };

  // Check if an article has translations
  const hasTranslations = (article: Article) => {
    if (!article.translation_id) return false;
    return articles.some(
      a => a.translation_id === article.translation_id && a.id !== article.id
    );
  };

  const getLanguageFlag = (lang: string) => {
    const flags: Record<string, string> = {
      en: "🇬🇧",
      de: "🇩🇪",
      fr: "🇫🇷",
      es: "🇪🇸",
      it: "🇮🇹",
      nl: "🇳🇱",
      pl: "🇵🇱",
      sv: "🇸🇪",
      da: "🇩🇰",
      fi: "🇫🇮",
      cs: "🇨🇿",
      hu: "🇭🇺",
      pt: "🇵🇹",
      nb: "🇳🇴"
    };
    return flags[lang] || lang.toUpperCase();
  };

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Blog Management</h1>
            <p className="text-muted-foreground">Create and manage your multilingual blog posts.</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline"
              onClick={handleGenerateSitemap} 
              disabled={generatingSitemap}
              className="flex items-center gap-2"
            >
              {generatingSitemap ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Map className="h-4 w-4" />
              )}
              {generatingSitemap ? "Generating..." : "Generate / Update Sitemap"}
            </Button>
            <Button onClick={() => navigate('/dashboard/blog/new')} className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" />
              New Article
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center space-x-2 bg-background p-1 border rounded-md w-full sm:w-96">
            <Search className="h-4 w-4 text-muted-foreground ml-2" />
            <Input
              placeholder="Search by title..."
              aria-label="Search articles by title"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          
          <div className="flex flex-wrap gap-4 w-full sm:w-auto">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">Draft</Badge>
                  </div>
                </SelectItem>
                <SelectItem value="published">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="text-xs">Published</Badge>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            <Select value={languageFilter} onValueChange={setLanguageFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Languages</SelectItem>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {getLanguageFlag(lang.code)} {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dateSort} onValueChange={setDateSort}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort by Date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bulk Actions Bar - shows when articles are selected */}
        {selectedArticles.size > 0 && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-blue-700">
                {selectedArticles.size} article{selectedArticles.size > 1 ? 's' : ''} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedArticles(new Set())}
                className="text-blue-600 hover:text-blue-800"
              >
                Clear selection
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <MoreHorizontal className="h-4 w-4" />
                  Actions
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Bulk Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected ({selectedArticles.size})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <Card className="shadow-sm border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all articles"
                      className={isSomeSelected ? "data-[state=checked]:bg-blue-600" : ""}
                    />
                  </TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Loading articles...
                    </TableCell>
                  </TableRow>
                ) : filteredArticles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <FileText className="h-12 w-12 mb-2 opacity-20" />
                        <p>No articles found matching your filters.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredArticles.map((article) => (
                    <TableRow 
                      key={article.id}
                      className={selectedArticles.has(article.id) ? "bg-blue-50" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedArticles.has(article.id)}
                          onCheckedChange={(checked) => handleSelectArticle(article.id, checked as boolean)}
                          aria-label={`Select ${article.title}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {article.title}
                          {hasTranslations(article) && (
                            <Globe className="h-4 w-4 text-muted-foreground" title="Has translations" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="flex w-fit items-center gap-1">
                          <span>{getLanguageFlag(article.language)}</span>
                          <span className="uppercase text-xs">{article.language}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={article.status === 'published' ? 'default' : 'secondary'}>
                          {article.status === 'published' ? 'Published' : 'Draft'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(article.created_at), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {/* Translate button - only for English articles that haven't been translated */}
                          {article.language === 'en' && !hasTranslations(article) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTranslate(article.id)}
                              disabled={translatingId === article.id}
                              title="Translate to all languages"
                              className="text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                            >
                              {translatingId === article.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Languages className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {/* Preview button - works for both draft and published articles */}
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handlePreviewClick(article)}
                            title={article.status === 'published' ? "Preview Article" : "Preview Draft"}
                            className="text-purple-500 hover:text-purple-700 hover:bg-purple-50"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => navigate(`/dashboard/blog/edit/${article.id}`)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteClick(article)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Sitemap Dialog */}
      <Dialog open={sitemapDialogOpen} onOpenChange={setSitemapDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Map className="h-5 w-5" />
              Sitemap Generated & Saved
            </DialogTitle>
            <DialogDescription>
              {sitemapData?.stats && (
                <span>
                  {sitemapData.stats.urls} URLs • {sitemapData.stats.languages} languages • {sitemapData.stats.articles} articles
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {/* Success/Fail Status */}
          {sitemapData?.storage?.uploaded && (
            <Card className={`border-2 ${
              sitemapData.storage.uploaded.every((u: any) => u.success)
                ? 'border-green-200 bg-green-50/50'
                : 'border-yellow-200 bg-yellow-50/50'
            }`}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm flex items-center gap-2 ${
                  sitemapData.storage.uploaded.every((u: any) => u.success)
                    ? 'text-green-700'
                    : 'text-yellow-700'
                }`}>
                  {sitemapData.storage.uploaded.every((u: any) => u.success) ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {sitemapData.storage.uploaded.every((u: any) => u.success)
                    ? 'All Sitemaps Saved Successfully'
                    : 'Some Sitemaps Failed to Save'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="font-medium">Domain URL:</span>
                    <a 
                      href="https://www.micronshub.eu/sitemap.xml" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="ml-2 text-blue-600 hover:underline break-all"
                    >
                      https://www.micronshub.eu/sitemap.xml
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Submit this URL to Google Search Console and Bing Webmaster Tools.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Uploaded files list */}
          {sitemapData?.storage?.uploaded && (
            <div className="border rounded-md p-4 bg-muted/50 max-h-[200px] overflow-auto">
              <p className="text-sm font-medium mb-2">Uploaded Files:</p>
              <div className="space-y-1">
                {sitemapData.storage.uploaded.map((file: any, index: number) => (
                  <div key={index} className="text-xs flex items-center gap-2">
                    {file.success ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                    <span className="font-mono">{file.filename}</span>
                    {file.error && (
                      <span className="text-red-500 text-xs">({file.error})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button 
              onClick={() => window.open('https://www.micronshub.eu/sitemap.xml', '_blank')}
              className="flex items-center gap-2"
            >
              <Globe className="h-4 w-4" />
              View Live Sitemap
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Article</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the article{" "}
              <span className="font-semibold">"{articleToDelete?.title}"</span>?
              <br />
              <span className="text-red-500 mt-2 block">
                This action cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedArticles.size} Article{selectedArticles.size > 1 ? 's' : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold">{selectedArticles.size} article{selectedArticles.size > 1 ? 's' : ''}</span>?
              <br />
              <span className="text-red-500 mt-2 block">
                This action cannot be undone. All selected articles will be permanently deleted.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {bulkDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${selectedArticles.size} Article${selectedArticles.size > 1 ? 's' : ''}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Article Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Article Preview
                {previewArticle?.status === 'draft' && (
                  <Badge variant="secondary" className="ml-2">Draft</Badge>
                )}
                {previewArticle?.status === 'published' && (
                  <Badge variant="default" className="ml-2">Published</Badge>
                )}
              </DialogTitle>
            </div>
            <DialogDescription>
              Preview how this article will look when published
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto mt-4">
            {loadingPreview ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : previewArticle ? (
              <div className="bg-white rounded-lg border p-6">
                {/* Article Header */}
                <div className="space-y-4 mb-6">
                  <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                    <span className="flex items-center">
                      <Calendar className="h-4 w-4 mr-1" />
                      {dateFormat(new Date(previewArticle.created_at), 'MMMM dd, yyyy')}
                    </span>
                    {previewArticle.content && (
                      <span className="flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        {Math.max(1, Math.ceil(previewArticle.content.replace(/<[^>]*>/g, '').split(' ').length / 200))} min read
                      </span>
                    )}
                    <Badge variant="outline" className="flex items-center gap-1">
                      <span>{getLanguageFlag(previewArticle.language)}</span>
                      <span className="uppercase text-xs">{previewArticle.language}</span>
                    </Badge>
                  </div>

                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 leading-tight">
                    {previewArticle.title}
                  </h1>

                  {previewArticle.excerpt && (
                    <p className="text-lg text-muted-foreground italic">
                      {previewArticle.excerpt}
                    </p>
                  )}
                </div>

                {/* Featured Image */}
                {previewArticle.featured_image && (
                  <div className="mb-8 rounded-xl overflow-hidden shadow-md">
                    <img 
                      src={previewArticle.featured_image} 
                      alt={previewArticle.featured_image_alt || previewArticle.title} 
                      className="w-full h-auto object-cover max-h-[400px]"
                    />
                  </div>
                )}

                {/* Article Content */}
                {previewArticle.content && (
                  <div 
                    className="prose prose-lg prose-blue max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewArticle.content }}
                  />
                )}

                {/* SEO Preview Section */}
                <div className="mt-8 pt-6 border-t">
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3">SEO Preview</h3>
                  <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    <div className="text-blue-600 text-lg hover:underline cursor-pointer">
                      {previewArticle.meta_title || previewArticle.title}
                    </div>
                    <div className="text-green-700 text-sm">
                      {window.location.origin}/{previewArticle.language}/blog/{previewArticle.slug}
                    </div>
                    <div className="text-gray-600 text-sm">
                      {previewArticle.meta_description || previewArticle.excerpt || 'No description available'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                Failed to load article preview
              </div>
            )}
          </div>

          <DialogFooter className="flex-shrink-0 gap-2 mt-4">
            {previewArticle?.status === 'published' && (
              <Button 
                onClick={() => window.open(`/${previewArticle.language}/blog/${previewArticle.slug}`, '_blank')}
                className="flex items-center gap-2"
              >
                <Globe className="h-4 w-4" />
                View Live
              </Button>
            )}
            <Button 
              variant="outline"
              onClick={() => previewArticle && navigate(`/dashboard/blog/edit/${previewArticle.id}`)}
              className="flex items-center gap-2"
            >
              <Pencil className="h-4 w-4" />
              Edit Article
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PersistentDashboardLayout>
  );
};

export default BlogList;
