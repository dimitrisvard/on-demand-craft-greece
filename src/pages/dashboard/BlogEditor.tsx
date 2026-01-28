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
import { ChevronLeft, Loader2, Save, Image as ImageIcon, Globe, Plus, Sparkles, Code, Eye, Link, ExternalLink, Share2 } from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import MediaLibraryModal from "@/components/dashboard/MediaLibraryModal";

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
  const [fixingLinks, setFixingLinks] = useState(false);
  const [postingToSocial, setPostingToSocial] = useState(false);
  const [isSourceView, setIsSourceView] = useState(false);
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

    // Must be an English article to translate from
    if (formData.language !== 'en') {
      toast({ 
        title: "English Article Required", 
        description: "Translations can only be created from English articles.",
        variant: "destructive" 
      });
      return;
    }

    setGeneratingTranslations(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("User not authenticated");

      // Call the Edge Function with specific target language
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-article`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ 
            article_id: id,
            target_languages: [targetLang] // Single language
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || "Translation failed");
      }

      const langName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang.toUpperCase();
      
      toast({ 
        title: "✅ Translation Created", 
        description: `Successfully translated to ${langName}.` 
      });
      
      // Refresh list
      fetchTranslations(formData.translation_id, id);

    } catch (error: any) {
      console.error('Error creating translation:', error);
      toast({ 
        title: "❌ Translation Failed", 
        description: error.message || "Failed to create translation.",
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

    // Must be an English article to translate from
    if (formData.language !== 'en') {
      toast({ 
        title: "English Article Required", 
        description: "Translations can only be created from English articles.",
        variant: "destructive" 
      });
      return;
    }

    // Filter languages that don't have a translation yet
    const languagesToCreate = LANGUAGES.filter(l => 
      l.code !== 'en' && 
      !availableTranslations.some(t => t.language === l.code)
    );

    if (languagesToCreate.length === 0) {
      toast({ title: "No Missing Translations", description: "All languages already have translations." });
      return;
    }

    if (!confirm(`This will translate the article to ${languagesToCreate.length} languages using AI. This may take several minutes as translations are processed in batches. Continue?`)) return;

    setGeneratingTranslations(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("User not authenticated");

      // Process in batches of 1 language to avoid rate limiting with 2500-word articles
      // With retry logic and longer articles, batches of 2+ can trigger Gemini API rate limits
      const BATCH_SIZE = 1;
      const langCodes = languagesToCreate.map(l => l.code);
      const batches: string[][] = [];
      
      for (let i = 0; i < langCodes.length; i += BATCH_SIZE) {
        batches.push(langCodes.slice(i, i + BATCH_SIZE));
      }

      let totalSuccessful = 0;
      let totalFailed = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchLangNames = batch.map(code => LANGUAGES.find(l => l.code === code)?.name || code).join(', ');
        
        toast({
          title: `🔄 Translating batch ${batchIndex + 1}/${batches.length}`,
          description: `Processing: ${batchLangNames}...`,
        });

        try {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-article`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
              },
              body: JSON.stringify({ 
                article_id: id,
                target_languages: batch
              }),
            }
          );

          const result = await response.json();

          if (!response.ok || result.success === false) {
            // Handle both error formats: result.error or result.message
            const errorMessage = result.error || result.message || 'Unknown error';
            console.error(`Batch ${batchIndex + 1} failed:`, errorMessage);
            console.error(`Full response:`, result);
            
            // Check if it's a rate limit error
            const isRateLimited = errorMessage.toLowerCase().includes('rate') || 
                                  errorMessage.includes('429') ||
                                  errorMessage.toLowerCase().includes('too many');
            
            // Count actual failures from details if available
            if (result.details) {
              const detailsArray = Object.values(result.details);
              const successCount = detailsArray.filter((d: any) => d.success).length;
              const failCount = detailsArray.filter((d: any) => !d.success).length;
              totalSuccessful += successCount;
              totalFailed += failCount;
            } else {
              totalFailed += batch.length;
            }
            
            toast({
              title: isRateLimited ? `⏳ Rate limited - Batch ${batchIndex + 1}` : `⚠️ Batch ${batchIndex + 1} had issues`,
              description: isRateLimited 
                ? "API rate limit reached. Waiting 30s before continuing..."
                : errorMessage,
              variant: "destructive"
            });
            
            // Extra wait time if rate limited
            if (isRateLimited && batchIndex < batches.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 30000));
            }
          } else {
            totalSuccessful += result.translations || 0;
            totalFailed += result.failed_count || 0;
            console.log(`Batch ${batchIndex + 1} completed: ${result.translations} translations`);
          }
        } catch (batchError: any) {
          console.error(`Batch ${batchIndex + 1} error:`, batchError);
          totalFailed += batch.length;
        }

        // Wait 20 seconds between batches to be safe with Gemini API rate limits
        // The API has strict RPM limits, especially with large articles and table translations
        if (batchIndex < batches.length - 1) {
          toast({
            title: `⏳ Rate limit protection`,
            description: `Waiting 20s before next batch to avoid API limits...`,
          });
          await new Promise(resolve => setTimeout(resolve, 20000));
        }
      }

      if (totalSuccessful > 0) {
        toast({ 
          title: "✅ Batch Translation Complete", 
          description: `Successfully translated to ${totalSuccessful}/${languagesToCreate.length} languages.${totalFailed > 0 ? ` (${totalFailed} failed)` : ''}` 
        });
      } else {
        toast({ 
          title: "❌ Translation Failed", 
          description: "All translation batches failed. Please try again.",
          variant: "destructive" 
        });
      }
      
      fetchTranslations(formData.translation_id, id);

    } catch (error: any) {
      console.error('Batch translation error:', error);
      toast({ 
        title: "❌ Translation Failed", 
        description: error.message || "Batch translation process failed.",
        variant: "destructive" 
      });
    } finally {
      setGeneratingTranslations(false);
    }
  };

  const handleFixLinks = async () => {
    if (!formData.translation_id) {
      toast({
        title: "No Translation Group",
        description: "This article is not part of a translation group.",
        variant: "destructive",
      });
      return;
    }

    if (!id) {
      toast({
        title: "Save First",
        description: "Please save this article before fixing links.",
        variant: "destructive",
      });
      return;
    }

    setFixingLinks(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error("User not authenticated");

      toast({
        title: "Fixing Links",
        description: "Updating links in all translations...",
      });

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fix-article-links`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            translation_id: formData.translation_id,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fix links");
      }

      toast({
        title: "✅ Links Fixed",
        description: `Fixed ${result.links_fixed || 0} link(s) in ${result.articles_updated || 0} article(s). All translations have been automatically saved.`,
      });

      // Refresh the current article to show updated content
      await fetchArticle(id);
    } catch (error: any) {
      console.error("Error fixing links:", error);
      toast({
        title: "❌ Fix Links Failed",
        description: error.message || "Failed to fix links.",
        variant: "destructive",
      });
    } finally {
      setFixingLinks(false);
    }
  };

  const handlePostToSocialMedia = async () => {
    if (!id || formData.status !== 'published') {
      toast({
        title: "Article must be published",
        description: "Please publish the article before posting to social media.",
        variant: "destructive",
      });
      return;
    }

    setPostingToSocial(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("User not authenticated");

      toast({
        title: "Posting to Social Media",
        description: "Sharing article to Facebook and LinkedIn...",
      });

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/post-to-social-media`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ 
            article_id: id 
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to post to social media");
      }

      const postedTo = result.posted_to || [];
      const errors = result.errors || [];

      if (postedTo.length > 0) {
        toast({
          title: "✅ Posted Successfully",
          description: `Posted to ${postedTo.join(', ')}${errors.length > 0 ? `. Some errors: ${errors.join('; ')}` : ''}`,
        });
        
        // Refresh article to show updated social status
        if (id) {
          await fetchArticle(id);
        }
      } else {
        throw new Error(errors.join('; ') || "Failed to post to any platform");
      }
    } catch (error: any) {
      console.error('Error posting to social media:', error);
      toast({
        title: "❌ Post Failed",
        description: error.message || "Failed to post to social media",
        variant: "destructive",
      });
    } finally {
      setPostingToSocial(false);
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

      // Preserve table structure when saving
      let contentToSave = formData.content;
      
      // Function to preserve table HTML structure
      const preserveTableStructure = (html: string): string => {
        // Check if content has tables
        const tableCount = (html.match(/<table[^>]*>/gi) || []).length;
        if (tableCount === 0) return html;
        
        // Ensure all tables are properly closed
        const tableCloseCount = (html.match(/<\/table>/gi) || []).length;
        let fixedHtml = html;
        if (tableCount > tableCloseCount) {
          // Add missing closing tags
          for (let i = 0; i < tableCount - tableCloseCount; i++) {
            fixedHtml += '</tbody></table>';
          }
        }
        
        // Ensure proper table structure - check for tbody/thead
        const tables = fixedHtml.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
        for (const table of tables) {
          const hasTbody = /<tbody[^>]*>/i.test(table);
          const hasThead = /<thead[^>]*>/i.test(table);
          const hasTbodyClose = /<\/tbody>/i.test(table);
          const hasTheadClose = /<\/thead>/i.test(table);
          
          // If table has content but missing tbody wrapper, preserve as-is
          // (Some tables might not have explicit tbody, which is valid HTML)
        }
        
        return fixedHtml;
      };
      
      if (!isSourceView && quillRef.current) {
        // Get content from Quill and ensure tables are preserved
        const quill = quillRef.current.getEditor();
        if (quill) {
          const quillContent = quill.root.innerHTML;
          // Check if tables exist in original but are broken in Quill
          const tablesInOriginal = (formData.content.match(/<table[^>]*>/gi) || []).length;
          const tablesInQuill = (quillContent.match(/<table[^>]*>/gi) || []).length;
          
          // If Quill broke the tables, use original content instead
          if (tablesInOriginal > 0 && tablesInQuill < tablesInOriginal) {
            console.warn('Quill broke table structure, using original content');
            contentToSave = preserveTableStructure(formData.content);
          } else {
            // Use Quill content but preserve table structure
            contentToSave = preserveTableStructure(quillContent);
          }
        }
      } else {
        // In source view, just preserve table structure
        contentToSave = preserveTableStructure(contentToSave);
      }

      const articleData = {
        ...formData,
        content: contentToSave,
        status: status || formData.status,
        author_id: user.id,
        updated_at: new Date().toISOString()
      };

      let result;
      
      if (id) {
        // Update existing
        const { error: updateError } = await supabase
          .from('articles')
          .update(articleData)
          .eq('id', id);
        if (updateError) throw updateError;

        // If this is an English article, sync featured image to all translations
        if (formData.language === 'en' && formData.translation_id) {
          const { error: translationUpdateError } = await supabase
            .from('articles')
            .update({
              featured_image: formData.featured_image,
              featured_image_alt: formData.featured_image_alt
            })
            .eq('translation_id', formData.translation_id)
            .neq('id', id); // Don't update the English article itself
          
          if (translationUpdateError) {
            console.error('Error updating translation featured images:', translationUpdateError);
            // Don't throw - main article save succeeded, just log the error
          }
        }
      } else {
        // Create new
        const { data: newArticle, error: insertError } = await supabase
          .from('articles')
          .insert([articleData])
          .select()
          .single();
        if (insertError) throw insertError;
        result = newArticle;
      }

      const action = status ? (status === 'published' ? 'published' : 'saved as draft') : 'saved';
      toast({
        title: "Success",
        description: `Article ${action} successfully`,
      });
      
      // Only navigate away if publishing, otherwise stay on page for continued editing
      if (status === 'published') {
        navigate('/dashboard/blog');
      } else if (!id && result) {
        // If it's a new article and we just saved it, navigate to edit page with the new ID
        navigate(`/dashboard/blog/edit/${result.id}`);
      }
      // If updating existing article without status change, stay on page
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

  // Toggle Source View
  const toggleSourceView = () => {
    setIsSourceView(!isSourceView);
  };

  // Table handler for ReactQuill - creates a properly formatted table
  const tableHandler = useCallback(() => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;

    const range = quill.getSelection();
    const index = range ? range.index : quill.getLength();

    // Create a well-formatted table using classes that are styled in our CSS
    const tableHTML = `
      <table class="editor-table">
        <thead>
          <tr>
            <th>Column 1</th>
            <th>Column 2</th>
            <th>Column 3</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Row 1, Cell 1</td>
            <td>Row 1, Cell 2</td>
            <td>Row 1, Cell 3</td>
          </tr>
          <tr>
            <td>Row 2, Cell 1</td>
            <td>Row 2, Cell 2</td>
            <td>Row 2, Cell 3</td>
          </tr>
        </tbody>
      </table>
      <p><br></p>
    `;
    
    quill.clipboard.dangerouslyPasteHTML(index, tableHTML);
    // Move cursor after the table
    quill.setSelection(index + tableHTML.length);
  }, []);

  // Add tooltips to Quill toolbar
  useEffect(() => {
    if (isSourceView) return; // Don't run if in source view

    const timer = setTimeout(() => {
      const toolbar = document.querySelector('.ql-toolbar');
      if (toolbar) {
        const tooltips: Record<string, string> = {
          'ql-header': 'Heading Level',
          'ql-bold': 'Bold (Ctrl+B)',
          'ql-italic': 'Italic (Ctrl+I)',
          'ql-underline': 'Underline (Ctrl+U)',
          'ql-strike': 'Strikethrough',
          'ql-blockquote': 'Blockquote',
          'ql-list[value="ordered"]': 'Numbered List',
          'ql-list[value="bullet"]': 'Bullet List',
          'ql-indent[value="-1"]': 'Decrease Indent',
          'ql-indent[value="+1"]': 'Increase Indent',
          'ql-link': 'Insert Link',
          'ql-image': 'Insert Image from Library',
          'ql-video': 'Insert Video',
          'ql-table': 'Insert Comparison Table',
          'ql-clean': 'Remove Formatting',
          'ql-align': 'Text Alignment',
          'ql-color': 'Text Color',
          'ql-background': 'Background Color',
          'ql-code-block': 'Code Block',
          'ql-script[value="sub"]': 'Subscript',
          'ql-script[value="super"]': 'Superscript'
        };

        Object.entries(tooltips).forEach(([className, text]) => {
          const buttons = toolbar.querySelectorAll(`.${className}`);
          buttons.forEach(btn => {
            (btn as HTMLElement).setAttribute('title', text);
          });
        });

        // Special case for dropdowns (pickers)
        const pickers = toolbar.querySelectorAll('.ql-picker');
        pickers.forEach(picker => {
          if (picker.classList.contains('ql-header')) picker.setAttribute('title', 'Heading Level');
          if (picker.classList.contains('ql-color')) picker.setAttribute('title', 'Text Color');
          if (picker.classList.contains('ql-background')) picker.setAttribute('title', 'Background Color');
          if (picker.classList.contains('ql-align')) picker.setAttribute('title', 'Text Alignment');
        });
      }
    }, 500); // Small delay to ensure Quill is rendered

    return () => clearTimeout(timer);
  }, [loading, isSourceView]);

  // Track if we've already fixed tables to prevent infinite loops
  const [tablesFixed, setTablesFixed] = useState(false);
  
  // Preserve table HTML when content is loaded into Quill (only once on initial load)
  useEffect(() => {
    if (!quillRef.current || !formData.content || loading || isSourceView || tablesFixed) return;

    const quill = quillRef.current.getEditor();
    if (!quill) return;

    // Wait for Quill to initialize
    const timer = setTimeout(() => {
      // Check if content contains tables
      const hasTables = formData.content.includes('<table') && formData.content.includes('</table>');
      if (!hasTables) {
        setTablesFixed(true);
        return;
      }

      // Get current Quill content
      const currentContent = quill.root.innerHTML;
      
      // Check if tables are missing or broken in Quill
      const tablesInOriginal = (formData.content.match(/<table[^>]*>/gi) || []).length;
      const tablesInQuill = (currentContent.match(/<table[^>]*>/gi) || []).length;
      
      // If tables are missing or broken, re-insert the content using dangerouslyPasteHTML
      if (tablesInOriginal > 0 && (tablesInQuill === 0 || tablesInQuill < tablesInOriginal)) {
        console.log('Tables detected in content but missing in Quill, re-inserting with dangerouslyPasteHTML...');
        // Clear and re-insert content to preserve table structure
        quill.clipboard.dangerouslyPasteHTML(0, formData.content, 'user');
        setTablesFixed(true);
      } else {
        setTablesFixed(true);
      }
    }, 500); // Small delay to ensure Quill is ready

    return () => clearTimeout(timer);
  }, [formData.content, loading, isSourceView, tablesFixed]);

  // Reset tablesFixed when article ID changes
  useEffect(() => {
    setTablesFixed(false);
  }, [id]);

  const quillModules = useMemo(() => {
    // Get Quill instance to register custom table button
    const Quill = (ReactQuill as any).Quill || (window as any).Quill;
    
    if (Quill) {
      // Register table icon
      const icons = Quill.import('ui/icons');
      if (icons && !icons.table) {
        icons.table = '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="12" x="3" y="3"></rect><line class="ql-stroke" x1="9" x2="9" y1="3" y2="15"></line><line class="ql-stroke" x1="3" x2="15" y1="9" y2="9"></line></svg>';
      }
    }

    return {
      toolbar: {
        container: [
          [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ 'list': 'ordered' }, { 'list': 'bullet' }],
          [{ 'script': 'sub' }, { 'script': 'super' }],
          [{ 'indent': '-1' }, { 'indent': '+1' }],
          [{ 'align': [] }],
          ['link', 'image', 'video', 'table'],
          [{ 'color': [] }, { 'background': [] }],
          ['clean']
        ],
        handlers: {
          image: imageHandler,
          table: tableHandler
        }
      },
      clipboard: {
        // Preserve table HTML when pasting/loading
        matchVisual: false,
      },
    };
  }, [imageHandler, tableHandler]);

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
            {id && formData.status === 'published' && formData.slug && (
              <>
                <Button
                  variant="outline"
                  onClick={handlePostToSocialMedia}
                  disabled={postingToSocial}
                  className="flex items-center gap-2"
                >
                  {postingToSocial ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                  Post to Social
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open(`/${formData.language}/blog/${formData.slug}`, '_blank', 'noopener,noreferrer')}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  View Article
                </Button>
              </>
            )}
            <Button 
              variant="outline" 
              onClick={() => handleSave()}
              disabled={saving}
              className="flex items-center gap-2"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
            <Button 
              variant="outline" 
              onClick={() => handleSave('draft')}
              disabled={saving}
            >
              Save as Draft
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
                  <div className="flex items-center justify-between">
                    <Label>Content</Label>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={toggleSourceView}
                      className="h-8 gap-2 text-xs text-muted-foreground hover:text-primary"
                      title={isSourceView ? "Switch to Visual Editor" : "Switch to HTML Source View"}
                    >
                      {isSourceView ? (
                        <>
                          <Eye className="h-3 w-3" />
                          Visual Editor
                        </>
                      ) : (
                        <>
                          <Code className="h-3 w-3" />
                          HTML Source
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="h-[600px] pb-12 blog-editor-container">
                    {isSourceView ? (
                      <Textarea
                        value={formData.content}
                        onChange={(e) => handleChange('content', e.target.value)}
                        className="h-full font-mono text-sm p-4 resize-none focus-visible:ring-1"
                        placeholder="Paste or write your HTML code here..."
                      />
                    ) : (
                      <ReactQuill 
                        ref={quillRef}
                        theme="snow" 
                        value={formData.content} 
                        onChange={(value) => handleChange('content', value)}
                        modules={quillModules}
                        className="h-full"
                      />
                    )}
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
                    <div className="flex gap-2">
                      {/* Fix Links Button - Show for English articles with translation_id */}
                      {formData.translation_id && formData.language === 'en' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={fixingLinks || !id}
                          onClick={handleFixLinks}
                          title="Fix blog post links in all translations of this article and automatically save them"
                        >
                          {fixingLinks ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Link className="h-3 w-3 mr-1" />
                          )}
                          Fix Links
                        </Button>
                      )}
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
                            onClick={() => {
                              // Open in new tab with proper security flags
                              // Authentication session is shared via localStorage across same-origin tabs
                              window.open(`/dashboard/blog/edit/${t.id}`, '_blank', 'noopener,noreferrer');
                            }}
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

