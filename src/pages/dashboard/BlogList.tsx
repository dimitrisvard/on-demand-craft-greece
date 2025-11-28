import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Pencil, PlusCircle, Search, Trash2, Eye, FileText } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Article {
  id: string;
  title: string;
  slug: string;
  language: string;
  status: 'draft' | 'published';
  created_at: string;
  author_id: string;
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

const BlogList = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [dateSort, setDateSort] = useState("newest");
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

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this article?")) return;

    try {
      const { error } = await supabase
        .from('articles')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setArticles(articles.filter(a => a.id !== id));
      toast({
        title: "Success",
        description: "Article deleted successfully",
      });
    } catch (error: any) {
      console.error('Error deleting article:', error);
      toast({
        title: "Error",
        description: "Failed to delete article",
        variant: "destructive",
      });
    }
  };

  const filteredArticles = useMemo(() => {
    return articles
      .filter(article => {
        const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesLanguage = languageFilter === "all" || article.language === languageFilter;
        return matchesSearch && matchesLanguage;
      })
      .sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateSort === "newest" ? dateB - dateA : dateA - dateB;
      });
  }, [articles, searchQuery, languageFilter, dateSort]);

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
          <Button onClick={() => navigate('/dashboard/blog/new')} className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            New Article
          </Button>
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
          
          <div className="flex gap-4 w-full sm:w-auto">
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

        <Card className="shadow-sm border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading articles...
                    </TableCell>
                  </TableRow>
                ) : filteredArticles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <FileText className="h-12 w-12 mb-2 opacity-20" />
                        <p>No articles found matching your filters.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredArticles.map((article) => (
                    <TableRow key={article.id}>
                      <TableCell className="font-medium">{article.title}</TableCell>
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
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => window.open(`/${article.language}/blog/${article.slug}`, '_blank')}
                            disabled={article.status !== 'published'}
                            title="View Live"
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
                            onClick={() => handleDelete(article.id)}
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
    </PersistentDashboardLayout>
  );
};

export default BlogList;
