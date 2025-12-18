import React, { useState, useEffect } from "react";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Check, Sparkles, FileText } from "lucide-react";
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

const AutoBlogDashboard = () => {
  const [titles, setTitles] = useState<ArticleTitle[]>([]);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newSiloCategory, setNewSiloCategory] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSiloCategory, setEditSiloCategory] = useState<string>("");
  const { toast } = useToast();

  useEffect(() => {
    fetchTitles();
    fetchLogs();
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
      setLogs(data || []);
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
                  <Select value={newSiloCategory} onValueChange={setNewSiloCategory}>
                    <SelectTrigger id="silo">
                      <SelectValue placeholder="Select silo category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      <SelectItem value="Pillar">Pillar</SelectItem>
                      <SelectItem value="Cluster">Cluster</SelectItem>
                    </SelectContent>
                  </Select>
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
                                value={editSiloCategory}
                                onValueChange={setEditSiloCategory}
                              >
                                <SelectTrigger className="w-[150px]">
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">None</SelectItem>
                                  <SelectItem value="Pillar">Pillar</SelectItem>
                                  <SelectItem value="Cluster">Cluster</SelectItem>
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
                                {!title.processed && (
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
                <CardTitle>Daily Generation Summary</CardTitle>
                <CardDescription>
                  Recent automated article generation runs and their status.
                </CardDescription>
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
      </div>
    </PersistentDashboardLayout>
  );
};

export default AutoBlogDashboard;

