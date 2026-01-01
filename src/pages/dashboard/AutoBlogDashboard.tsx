import React, { useState, useEffect } from "react";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Check, Sparkles, FileText, Settings, Play, Loader2, RotateCcw, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ArticleTitle {
  id: string;
  title: string;
  processed: boolean;
  processed_at: string | null;
  silo_category: string | null;
  created_at: string;
}

interface GenerationLog {
  id: string;
  summary_data: {
    title?: string;
    translations?: Record<string, { success: boolean; article_id?: string; url?: string }>;
    indexing?: {
      google?: boolean;
      indexnow?: boolean;
    };
    errors?: string[];
  };
  created_at: string;
}

interface SiloCategory {
  id: string;
  name: string;
  created_at: string;
}

const AutoBlogDashboard = () => {
  const [titles, setTitles] = useState<ArticleTitle[]>([]);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [siloCategories, setSiloCategories] = useState<SiloCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newSiloCategory, setNewSiloCategory] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSiloCategory, setEditSiloCategory] = useState<string>("");
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchTitles();
    fetchLogs();
    fetchCategories();
  }, []);

  const fetchTitles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("article_titles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTitles(data || []);
    } catch (error: any) {
      console.error("Error fetching titles:", error);
      toast({
        title: "Error",
        description: "Failed to load article titles",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      setLogsLoading(true);
      const { data, error } = await supabase
        .from("article_generation_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      setLogs((data || []) as GenerationLog[]);
    } catch (error: any) {
      console.error("Error fetching logs:", error);
      toast({
        title: "Error",
        description: "Failed to load generation logs",
        variant: "destructive",
      });
    } finally {
      setLogsLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      setCategoriesLoading(true);
      const { data, error } = await supabase
        .from("silo_categories")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      setSiloCategories(data || []);
    } catch (error: any) {
      console.error("Error fetching categories:", error);
      toast({
        title: "Error",
        description: "Failed to load silo categories",
        variant: "destructive",
      });
    } finally {
      setCategoriesLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) {
      toast({
        title: "Validation Error",
        description: "Category name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("silo_categories")
        .insert([{ name: newCategoryName.trim() }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Category created successfully",
      });

      setNewCategoryName("");
      fetchCategories();
    } catch (error: any) {
      console.error("Error creating category:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create category",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the category "${name}"? This will remove it from all articles using it.`)) return;

    try {
      // First, remove the category from all articles that use it
      await supabase
        .from("article_titles")
        .update({ silo_category: null })
        .eq("silo_category", name);

      // Then delete the category
      const { error } = await supabase
        .from("silo_categories")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Category deleted successfully",
      });

      fetchCategories();
      fetchTitles(); // Refresh titles to update category references
    } catch (error: any) {
      console.error("Error deleting category:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete category",
        variant: "destructive",
      });
    }
  };

  const handleGenerateArticleNow = async () => {
    // Check if there are unprocessed titles
    const pendingTitles = titles.filter(t => !t.processed);
    if (pendingTitles.length === 0) {
      toast({
        title: "No Pending Titles",
        description: "Add at least one unprocessed title before generating an article.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    toast({
      title: "Generating Article",
      description: "This may take 1-2 minutes. Please wait...",
    });

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-daily-article`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({}),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to generate article");
      }

      if (result.message === "No unprocessed titles found") {
        toast({
          title: "No Titles Available",
          description: `No unprocessed titles found. Scheduled silo: ${result.scheduled_silo}`,
          variant: "destructive",
        });
      } else if (result.success) {
        toast({
          title: "Article Generated Successfully!",
          description: `"${result.title}" has been published. Translations will follow in 2 hours.`,
        });
        // Refresh the lists
        fetchTitles();
        fetchLogs();
      } else {
        throw new Error(result.error || "Unknown error occurred");
      }
    } catch (error: any) {
      console.error("Error generating article:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate article. Check the logs for details.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddTitle = async () => {
    if (!newTitle.trim()) {
      toast({
        title: "Validation Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.from("article_titles").insert([
        {
          title: newTitle.trim(),
          silo_category: newSiloCategory || null,
        },
      ]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Title added successfully",
      });

      setNewTitle("");
      setNewSiloCategory("");
      fetchTitles();
    } catch (error: any) {
      console.error("Error adding title:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to add title",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (title: ArticleTitle) => {
    setEditingId(title.id);
    setEditTitle(title.title);
    setEditSiloCategory(title.silo_category || "");
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim()) {
      toast({
        title: "Validation Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("article_titles")
        .update({
          title: editTitle.trim(),
          silo_category: editSiloCategory || null,
        })
        .eq("id", editingId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Title updated successfully",
      });

      setEditingId(null);
      setEditTitle("");
      setEditSiloCategory("");
      fetchTitles();
    } catch (error: any) {
      console.error("Error updating title:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update title",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this title?")) return;

    try {
      const { error } = await supabase.from("article_titles").delete().eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Title deleted successfully",
      });

      fetchTitles();
    } catch (error: any) {
      console.error("Error deleting title:", error);
      toast({
        title: "Error",
        description: "Failed to delete title",
        variant: "destructive",
      });
    }
  };

  const handleResetTitleStatus = async (id: string) => {
    if (!window.confirm("Are you sure you want to reset this title status to pending? This will remove the processed date.")) return;

    try {
      const { error } = await supabase
        .from("article_titles")
        .update({
          processed: false,
          processed_at: null,
        })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Title status reset to pending",
      });

      fetchTitles();
    } catch (error: any) {
      console.error("Error resetting title status:", error);
      toast({
        title: "Error",
        description: "Failed to reset title status",
        variant: "destructive",
      });
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm("Are you sure you want to clear all generation logs? This action cannot be undone.")) return;

    try {
      // Delete all logs by selecting all IDs first, then deleting
      const { data: allLogs } = await supabase
        .from("article_generation_logs")
        .select("id");

      if (allLogs && allLogs.length > 0) {
        const { error } = await supabase
          .from("article_generation_logs")
          .delete()
          .in("id", allLogs.map(log => log.id));

        if (error) throw error;
      }

      toast({
        title: "Success",
        description: "All logs cleared successfully",
      });

      fetchLogs();
    } catch (error: any) {
      console.error("Error clearing logs:", error);
      toast({
        title: "Error",
        description: "Failed to clear logs",
        variant: "destructive",
      });
    }
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
      nb: "🇳🇴",
    };
    return flags[lang] || lang.toUpperCase();
  };

  const LANGUAGES = [
    "en", "de", "fr", "es", "it", "nl", "pl", "sv", "da", "fi", "cs", "hu", "pt", "nb"
  ];

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6" />
              Auto-Blog Dashboard
            </h1>
            <p className="text-muted-foreground">
              Manage article titles and view automated generation reports.
            </p>
          </div>
          <Button 
            onClick={handleGenerateArticleNow} 
            disabled={isGenerating}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Generate Article Now
              </>
            )}
          </Button>
        </div>

        <Tabs defaultValue="titles" className="space-y-4">
          <TabsList>
            <TabsTrigger value="titles">Title Manager</TabsTrigger>
            <TabsTrigger value="logs">Daily Generation Summary</TabsTrigger>
          </TabsList>

          <TabsContent value="titles" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Add New Title</CardTitle>
                <CardDescription>
                  Add article titles to the queue for automated generation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Article Title</Label>
                  <Input
                    id="title"
                    placeholder="Enter article title..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleAddTitle();
                      }
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="silo">Silo Category (Optional)</Label>
                  <div className="flex gap-2">
                    <Select value={newSiloCategory || "none"} onValueChange={(value) => setNewSiloCategory(value === "none" ? "" : value)}>
                      <SelectTrigger id="silo" className="flex-1">
                        <SelectValue placeholder="Select silo category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {siloCategories.map((category) => (
                          <SelectItem key={category.id} value={category.name}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsCategoryDialogOpen(true)}
                      className="flex items-center gap-2"
                    >
                      <Settings className="h-4 w-4" />
                      Manage
                    </Button>
                  </div>
                </div>
                <Button onClick={handleAddTitle} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Title
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Article Titles</CardTitle>
                <CardDescription>
                  Manage your article title queue. Processed titles are shown in gray.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Silo Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Processed At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Loading titles...
                        </TableCell>
                      </TableRow>
                    ) : titles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          <div className="flex flex-col items-center justify-center">
                            <FileText className="h-12 w-12 mb-2 opacity-20" />
                            <p>No titles found. Add your first title above.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      titles.map((title) => (
                        <TableRow
                          key={title.id}
                          className={title.processed ? "opacity-60" : ""}
                        >
                          <TableCell className="font-medium">
                            {editingId === title.id ? (
                              <Input
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full"
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                {title.processed && (
                                  <Check className="h-4 w-4 text-green-500" />
                                )}
                                {title.title}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {editingId === title.id ? (
                              <Select
                                value={editSiloCategory || "none"}
                                onValueChange={(value) => setEditSiloCategory(value === "none" ? "" : value)}
                              >
                                <SelectTrigger className="w-[150px]">
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {siloCategories.map((category) => (
                                    <SelectItem key={category.id} value={category.name}>
                                      {category.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              title.silo_category ? (
                                <Badge variant="outline">{title.silo_category}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={title.processed ? "secondary" : "default"}
                            >
                              {title.processed ? "Processed" : "Pending"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {title.processed_at
                              ? format(new Date(title.processed_at), "MMM dd, yyyy HH:mm")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {editingId === title.id ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleSaveEdit}
                                >
                                  Save
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditTitle("");
                                    setEditSiloCategory("");
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                {title.processed ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => handleResetTitleStatus(title.id)}
                                    title="Reset to Pending"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleEdit(title)}
                                      title="Edit"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => handleDelete(title.id)}
                                      title="Delete"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Daily Generation Summary</CardTitle>
                    <CardDescription>
                      Recent automated article generation runs and their status.
                    </CardDescription>
                  </div>
                  {logs.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearLogs}
                      className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="h-4 w-4" />
                      Clear History
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Translations</TableHead>
                      <TableHead>Indexing</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Loading logs...
                        </TableCell>
                      </TableRow>
                    ) : logs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          <div className="flex flex-col items-center justify-center">
                            <FileText className="h-12 w-12 mb-2 opacity-20" />
                            <p>No generation logs found yet.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      logs.map((log) => {
                        const translations = log.summary_data.translations || {};
                        const translationCount = Object.keys(translations).length;
                        const successCount = Object.values(translations).filter(
                          (t) => t.success
                        ).length;
                        const indexing = log.summary_data.indexing || {};
                        const hasErrors = log.summary_data.errors && log.summary_data.errors.length > 0;

                        return (
                          <TableRow key={log.id}>
                            <TableCell className="text-muted-foreground text-sm">
                              {format(new Date(log.created_at), "MMM dd, yyyy HH:mm")}
                            </TableCell>
                            <TableCell className="font-medium">
                              {log.summary_data.title || "N/A"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(translations).map(([lang, data]) => (
                                  <Badge
                                    key={lang}
                                    variant={data.success ? "default" : "destructive"}
                                    className="text-xs"
                                  >
                                    {getLanguageFlag(lang)} {lang.toUpperCase()}
                                  </Badge>
                                ))}
                                {translationCount === 0 && (
                                  <span className="text-muted-foreground text-sm">None</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Badge
                                  variant={indexing.google ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  Google {indexing.google ? "✓" : "—"}
                                </Badge>
                                <Badge
                                  variant={indexing.indexnow ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  IndexNow {indexing.indexnow ? "✓" : "—"}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              {hasErrors ? (
                                <Badge variant="destructive">Errors</Badge>
                              ) : successCount === translationCount && translationCount > 0 ? (
                                <Badge variant="default">Success</Badge>
                              ) : (
                                <Badge variant="secondary">Partial</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Category Management Dialog */}
        <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Manage Silo Categories</DialogTitle>
              <DialogDescription>
                Create and delete silo categories for organizing your articles.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-category">Create New Category</Label>
                <div className="flex gap-2">
                  <Input
                    id="new-category"
                    placeholder="Enter category name..."
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCreateCategory();
                      }
                    }}
                  />
                  <Button onClick={handleCreateCategory} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Existing Categories</Label>
                {categoriesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading categories...</p>
                ) : siloCategories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No categories yet. Create your first one above.</p>
                ) : (
                  <div className="border rounded-md divide-y">
                    {siloCategories.map((category) => (
                      <div
                        key={category.id}
                        className="flex items-center justify-between p-3 hover:bg-muted/50"
                      >
                        <span className="font-medium">{category.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDeleteCategory(category.id, category.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCategoryDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PersistentDashboardLayout>
  );
};

export default AutoBlogDashboard;

