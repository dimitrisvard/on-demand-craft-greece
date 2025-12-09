import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { 
  DropdownMenu,
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { ChevronLeft, Loader2, Save, Image as ImageIcon, Globe, Plus, Sparkles } from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import MediaLibraryModal from "@/components/dashboard/MediaLibraryModal";
import { translateArticle } from "@/utils/translateArticle";

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
  const [generatingTranslations, setGeneratingTranslations] = useState(false);
  const quillRef = useRef<ReactQuill>(null);

  // Media Library State
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [mediaLibraryCallback, setMediaLibraryCallback] = useState<(url: string) => void>(() => {});
  
  // Translation State
  const [availableTranslations, setAvailableTranslations] = useState<Array<{id: string, language: string, title: string}>>([]);
  const [translationIdToLink, setTranslationIdToLink] = useState("");

  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    content: "",
    excerpt: "",
    language: "en",
    status: "draft",
    meta_title: "",
    meta_description: "",
    featured_image: "",
    featured_image_alt: "",
    translation_id: ""
  });

  useEffect(() => {
    if (id) {
      fetchArticle(id);
    } else {
      // New article - generate a fresh translation_id
      setFormData(prev => ({ ...prev, translation_id: crypto.randomUUID() }));
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
          featured_image: data.featured_image || "",
          featured_image_alt: data.featured_image_alt || "",
          translation_id: data.translation_id || crypto.randomUUID() // Fallback if null
        });

        // Fetch sibling translations
        if (data.translation_id) {
          fetchTranslations(data.translation_id, articleId);
        }
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

  const fetchTranslations = async (translationId: string, currentArticleId: string) => {
    const { data } = await supabase
      .from('articles')
      .select('id, language, title')
      .eq('translation_id', translationId)
      .neq('id', currentArticleId);
    
    if (data) {
      setAvailableTranslations(data);
    }
  };

  const handleLinkTranslation = async () => {
    if (!translationIdToLink) return;

    // Fetch the target article to get its translation_id
    const { data: targetArticle } = await supabase
      .from('articles')
      .select('translation_id')
      .eq('id', translationIdToLink)
      .single();

    if (targetArticle) {
      // Update the target translation_id to match THIS article's translation_id
      // (or vice-versa, but let's assume we're pulling them into this group)
      
      // Ideally, we'd pick one translation_id to be the "master" and update everyone.
      // Simpler approach: update THIS article to match the target's ID
      // But wait, if THIS article has other translations linked, we'd break them.
      
      // Better: Update the target article (and all its group) to match THIS article's translation_id
      // Assuming THIS article's ID is the one we want to keep.
      
      const targetTranslationId = targetArticle.translation_id;
      const myTranslationId = formData.translation_id;

      // Update all articles that had the target's ID to now have MY ID
      // This merges two groups if they existed
      const { error } = await supabase
        .from('articles')
        .update({ translation_id: myTranslationId })
        .eq('translation_id', targetTranslationId);

      if (error) {
        toast({ title: "Error", description: "Failed to link translation", variant: "destructive" });
      } else {
        toast({ title: "Success", description: "Translation linked successfully" });
        fetchTranslations(myTranslationId, id || ''); // Refresh list
        setTranslationIdToLink("");
      }
    }
  };

  const handleCreateTranslation = async (targetLang: string) => {
    // 1. Check if translation already exists
    const existing = availableTranslations.find(t => t.language === targetLang);
    if (existing) {
      toast({ 
        title: "Translation Exists", 
        description: `A ${targetLang.toUpperCase()} translation already exists.`,
        variant: "destructive" 
      });
      return;
    }

    if (!id) {
      toast({ 
        title: "Save First", 
        description: "Please save this article before creating translations.",
        variant: "destructive" 
      });
      return;
    }

    setGeneratingTranslations(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("User not authenticated");

      // 2. Translate Content (Stub for now)
      const translatedData = await translateArticle({
        title: formData.title,
        content: formData.content,
        excerpt: formData.excerpt,
        altText: formData.featured_image_alt,
        targetLanguage: targetLang
      });

      // 3. Create new article linked to same translation_id
      const newArticle = {
        title: translatedData.title,
        content: translatedData.content,
        excerpt: translatedData.excerpt,
        slug: `${formData.slug}-${targetLang}`, // Simple suffix for uniqueness
        language: targetLang,
        status: 'draft', // Always start as draft
        translation_id: formData.translation_id,
        author_id: user.id,
        featured_image: formData.featured_image, // Copy image
        featured_image_alt: translatedData.altText,
        meta_title: translatedData.title,
        meta_description: translatedData.excerpt
      };

      const { data, error } = await supabase
        .from('articles')
        .insert([newArticle])
        .select()
        .single();

      if (error) throw error;

      toast({ 
        title: "Translation Created", 
        description: `Created ${targetLang.toUpperCase()} translation successfully.` 
      });
      
      // Refresh list
      fetchTranslations(formData.translation_id, id);

    } catch (error: any) {
      console.error('Error creating translation:', error);
      toast({ 
        title: "Error", 
        description: "Failed to create translation.",
        variant: "destructive" 
      });
    } finally {
      setGeneratingTranslations(false);
    }
  };

  const handleCreateAllTranslations = async () => {
    if (!id) {
      toast({ 
        title: "Save First", 
        description: "Please save this article before creating translations.",
        variant: "destructive" 
      });
      return;
    }

    // Filter languages that don't have a translation yet
    const languagesToCreate = LANGUAGES.filter(l => 
      l.code !== formData.language && 
      !availableTranslations.some(t => t.language === l.code)
    );

    if (languagesToCreate.length === 0) {
      toast({ title: "No Missing Translations", description: "All languages already have translations." });
      return;
    }

    if (!confirm(`This will create ${languagesToCreate.length} new draft articles. Continue?`)) return;

    setGeneratingTranslations(true);
    let successCount = 0;

    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("User not authenticated");

      // Process in parallel or batch? Parallel for speed, but limit concurrency if needed.
      // For now, sequential to avoid hitting rate limits on simulated API
      for (const lang of languagesToCreate) {
        try {
          const translatedData = await translateArticle({
            title: formData.title,
            content: formData.content,
            excerpt: formData.excerpt,
            altText: formData.featured_image_alt,
            targetLanguage: lang.code
          });

          const newArticle = {
            title: translatedData.title,
            content: translatedData.content,
            excerpt: translatedData.excerpt,
            slug: `${formData.slug}-${lang.code}`,
            language: lang.code,
            status: 'draft',
            translation_id: formData.translation_id,
            author_id: user.id,
            featured_image: formData.featured_image,
            featured_image_alt: translatedData.altText,
            meta_title: translatedData.title,
            meta_description: translatedData.excerpt
          };

          const { error } = await supabase.from('articles').insert([newArticle]);
          if (error) throw error;
          
          successCount++;
        } catch (err) {
          console.error(`Failed to create ${lang.code} translation:`, err);
        }
      }

      toast({ 
        title: "Batch Creation Complete", 
        description: `Successfully created ${successCount} translations.` 
      });
      
      fetchTranslations(formData.translation_id, id);

    } catch (error) {
      console.error('Batch translation error:', error);
      toast({ title: "Error", description: "Batch process failed", variant: "destructive" });
    } finally {
      setGeneratingTranslations(false);
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

  // Custom Image Handler for Quill
  const imageHandler = useCallback(() => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;
    
    // Save current selection to restore later if needed, though we just insert at index
    const range = quill.getSelection();
    const index = range ? range.index : quill.getLength();

    // Set callback to insert image
    setMediaLibraryCallback(() => (url: string) => {
      quill.insertEmbed(index, 'image', url);
    });
    setMediaLibraryOpen(true);
  }, []);

  const quillModules = useMemo(() => ({
    toolbar: {
      container: [
        [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
        ['bold', 'italic', 'underline', 'strike', 'blockquote'],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
        ['link', 'image'],
        ['clean'],
        [{ 'align': [] }],
        [{ 'color': [] }, { 'background': [] }]
      ],
      handlers: {
        image: imageHandler
      }
    },
  }), [imageHandler]);

  const openFeaturedImageLibrary = () => {
    setMediaLibraryCallback(() => (url: string) => handleChange('featured_image', url));
    setMediaLibraryOpen(true);
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
                      ref={quillRef}
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
                  <div className="flex items-center justify-between">
                    <Label>Translations</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={generatingTranslations || !id}>
                          {generatingTranslations ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Plus className="h-3 w-3 mr-1" />
                          )}
                          Add
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Create Translation</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleCreateAllTranslations}>
                          <Sparkles className="h-4 w-4 mr-2 text-yellow-500" />
                          <span>Generate All ({LANGUAGES.length - 1 - availableTranslations.length})</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <div className="max-h-60 overflow-y-auto">
                          {LANGUAGES.filter(l => l.code !== formData.language).map(lang => {
                            const exists = availableTranslations.some(t => t.language === lang.code);
                            return (
                              <DropdownMenuItem 
                                key={lang.code} 
                                disabled={exists}
                                onClick={() => handleCreateTranslation(lang.code)}
                              >
                                <span className="w-6 uppercase text-xs text-muted-foreground">{lang.code}</span>
                                <span className={exists ? "line-through opacity-50" : ""}>{lang.name}</span>
                                {exists && <span className="ml-auto text-xs text-muted-foreground">(Exists)</span>}
                              </DropdownMenuItem>
                            );
                          })}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  
                  <div className="text-sm space-y-2 mb-2">
                    {availableTranslations.length > 0 ? (
                      availableTranslations.map(t => (
                        <div key={t.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                          <Globe className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium uppercase text-xs">{t.language}</span>
                          <span className="truncate flex-1">{t.title}</span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6" 
                            onClick={() => window.open(`/dashboard/blog/edit/${t.id}`, '_blank')}
                          >
                            <ChevronLeft className="h-3 w-3 rotate-180" />
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground italic">No linked translations</p>
                    )}
                  </div>
                  
                  {/* Note: A full UI to pick existing articles to link would go here. 
                      For now, users can rely on the 'translation_id' being set on creation 
                      or we can add a manual 'Link ID' input if really needed.
                      
                      Feature Idea: "Create Translation" button that duplicates this article 
                      to a new language but keeps the link.
                   */}
                   <div className="pt-2 border-t">
                     <p className="text-xs text-muted-foreground mb-2">
                       To link translations, ensure they share the same Translation ID in the database.
                     </p>
                     <div className="flex items-center gap-2">
                       <Input 
                         value={formData.translation_id} 
                         readOnly 
                         className="font-mono text-xs h-8 bg-slate-50"
                         title="Translation Group ID"
                       />
                       <Button 
                         variant="outline" 
                         size="icon" 
                         className="h-8 w-8"
                         onClick={() => {
                           navigator.clipboard.writeText(formData.translation_id);
                           toast({ title: "Copied", description: "ID copied to clipboard" });
                         }}
                       >
                         <Save className="h-3 w-3" /> 
                       </Button>
                     </div>
                     <p className="text-[10px] text-muted-foreground mt-1">
                       Copy this ID to other articles' "Translation ID" field in Supabase to link them.
                     </p>
                   </div>
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
                  <div className="flex gap-2">
                    <Input 
                      id="featured_image" 
                      placeholder="https://..."
                      value={formData.featured_image}
                      onChange={(e) => handleChange('featured_image', e.target.value)}
                    />
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={openFeaturedImageLibrary}
                      title="Select from Library"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  {formData.featured_image && (
                    <div className="mt-2 relative aspect-video rounded-md overflow-hidden border">
                      <img 
                        src={formData.featured_image} 
                        alt="Featured" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="featured_image_alt">Featured Image Alt Text (SEO)</Label>
                  <Input 
                    id="featured_image_alt" 
                    placeholder="Describe the image for SEO..."
                    value={formData.featured_image_alt}
                    onChange={(e) => handleChange('featured_image_alt', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Important for SEO. Describe the image in the article's language.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <MediaLibraryModal 
          open={mediaLibraryOpen} 
          onOpenChange={setMediaLibraryOpen}
          onSelect={mediaLibraryCallback}
          articleId={id}
        />
      </div>
    </PersistentDashboardLayout>
  );
};

export default BlogEditor;
