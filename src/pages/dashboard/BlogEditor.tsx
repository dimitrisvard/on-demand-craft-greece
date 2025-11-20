import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { ChevronLeft, Loader2, Save } from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

// Available languages matching the rest of the app
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'cs', name: 'Czech' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nb', name: 'Norwegian' }
];

const BlogEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    content: "",
    excerpt: "",
    language: "en",
    status: "draft",
    meta_title: "",
    meta_description: "",
    featured_image: ""
  });

  useEffect(() => {
    if (id) {
      fetchArticle(id);
    }
  }, [id]);

  const fetchArticle = async (articleId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('id', articleId)
        .single();

      if (error) throw error;
      if (data) {
        setFormData({
          title: data.title,
          slug: data.slug,
          content: data.content,
          excerpt: data.excerpt || "",
          language: data.language,
          status: data.status,
          meta_title: data.meta_title || "",
          meta_description: data.meta_description || "",
          featured_image: data.featured_image || ""
        });
      }
    } catch (error: any) {
      console.error('Error fetching article:', error);
      toast({
        title: "Error",
        description: "Failed to load article",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      // Auto-generate slug from title if slug is empty
      if (field === 'title' && !prev.slug) {
        newData.slug = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');
      }
      return newData;
    });
  };

  const handleSave = async (status?: string) => {
    if (!formData.title || !formData.content) {
      toast({
        title: "Validation Error",
        description: "Title and Content are required",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);
      const user = (await supabase.auth.getUser()).data.user;
      
      if (!user) throw new Error("User not authenticated");

      const articleData = {
        ...formData,
        status: status || formData.status,
        author_id: user.id,
        updated_at: new Date().toISOString()
      };

      let error;
      
      if (id) {
        // Update existing
        const { error: updateError } = await supabase
          .from('articles')
          .update(articleData)
          .eq('id', id);
        error = updateError;
      } else {
        // Create new
        const { error: insertError } = await supabase
          .from('articles')
          .insert([articleData]);
        error = insertError;
      }

      if (error) throw error;

      toast({
        title: "Success",
        description: `Article ${status === 'published' ? 'published' : 'saved'} successfully`,
      });
      
      navigate('/dashboard/blog');
    } catch (error: any) {
      console.error('Error saving article:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save article",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
      ['bold', 'italic', 'underline', 'strike', 'blockquote'],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
      ['link', 'image'],
      ['clean'],
      [{ 'align': [] }],
      [{ 'color': [] }, { 'background': [] }]
    ],
  };

  if (loading) {
    return (
      <PersistentDashboardLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PersistentDashboardLayout>
    );
  }

  return (
    <PersistentDashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={() => navigate('/dashboard/blog')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">{id ? 'Edit Article' : 'New Article'}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              onClick={() => handleSave('draft')}
              disabled={saving}
            >
              Save Draft
            </Button>
            <Button 
              onClick={() => handleSave('published')}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Editor Column */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Article Title</Label>
                  <Input 
                    id="title" 
                    placeholder="Enter article title..." 
                    value={formData.title}
                    onChange={(e) => handleChange('title', e.target.value)}
                    className="text-lg font-medium"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Content</Label>
                  <div className="h-[500px] pb-12">
                    <ReactQuill 
                      theme="snow" 
                      value={formData.content} 
                      onChange={(value) => handleChange('content', value)}
                      modules={quillModules}
                      className="h-full"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-4">
                  <Label htmlFor="excerpt">Excerpt (Short Summary)</Label>
                  <Textarea 
                    id="excerpt" 
                    placeholder="A brief summary of the post..." 
                    value={formData.excerpt}
                    onChange={(e) => handleChange('excerpt', e.target.value)}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* SEO Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">SEO Settings</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="meta_title">Meta Title</Label>
                  <Input 
                    id="meta_title" 
                    placeholder="SEO Title (defaults to article title if empty)" 
                    value={formData.meta_title}
                    onChange={(e) => handleChange('meta_title', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="meta_description">Meta Description</Label>
                  <Textarea 
                    id="meta_description" 
                    placeholder="SEO Description for search engines..." 
                    value={formData.meta_description}
                    onChange={(e) => handleChange('meta_description', e.target.value)}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar Settings Column */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Publishing Settings</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select 
                    value={formData.language} 
                    onValueChange={(value) => handleChange('language', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Language" />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(lang => (
                        <SelectItem key={lang.code} value={lang.code}>
                          {lang.name} ({lang.code.toUpperCase()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This article will only appear on the /{formData.language}/blog path.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">URL Slug</Label>
                  <Input 
                    id="slug" 
                    value={formData.slug}
                    onChange={(e) => handleChange('slug', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground break-all">
                    Preview: .../{formData.language}/blog/{formData.slug}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="featured_image">Featured Image URL</Label>
                  <Input 
                    id="featured_image" 
                    placeholder="https://..."
                    value={formData.featured_image}
                    onChange={(e) => handleChange('featured_image', e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PersistentDashboardLayout>
  );
};

export default BlogEditor;
