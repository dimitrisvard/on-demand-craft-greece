import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Facebook, Linkedin, AlertTriangle, ExternalLink, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface SocialPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string;
  articleTitle: string;
  articleSlug: string;
  articleLanguage: string;
  articleExcerpt: string;
  articleContent: string;
  articleFeaturedImage?: string;
  translationId?: string;
  postedToFacebook?: boolean;
  postedToLinkedin?: boolean;
  socialPostedAt?: string;
  onPostSuccess: () => void;
}

// Strip HTML and get plain text
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Generate a social excerpt
function generateExcerpt(excerpt: string, content: string, title: string): string {
  if (excerpt && excerpt.trim()) return excerpt.trim();
  if (content) {
    const plainText = stripHtml(content);
    if (plainText.length > 300) {
      const truncated = plainText.substring(0, 300);
      const lastSentence = truncated.lastIndexOf('.');
      const lastSpace = truncated.lastIndexOf(' ');
      const cutAt = lastSentence > 200 ? lastSentence + 1 : lastSpace > 0 ? lastSpace : 300;
      return truncated.substring(0, cutAt) + '...';
    }
    return plainText;
  }
  return title;
}

const SocialPostDialog: React.FC<SocialPostDialogProps> = ({
  open,
  onOpenChange,
  articleId,
  articleTitle,
  articleSlug,
  articleLanguage,
  articleExcerpt,
  articleContent,
  articleFeaturedImage,
  translationId,
  postedToFacebook,
  postedToLinkedin,
  socialPostedAt,
  onPostSuccess,
}) => {
  const { toast } = useToast();
  const [posting, setPosting] = useState(false);
  const [postToFacebook, setPostToFacebook] = useState(true);
  const [postToLinkedin, setPostToLinkedin] = useState(true);
  const [customText, setCustomText] = useState("");
  const [englishArticle, setEnglishArticle] = useState<any>(null);
  const [loadingEnglish, setLoadingEnglish] = useState(false);
  const [charCount, setCharCount] = useState(0);

  const MAX_CHARS = 3000; // LinkedIn limit

  // Fetch English version when dialog opens
  useEffect(() => {
    if (open) {
      fetchEnglishVersion();
    }
  }, [open, articleId, translationId]);

  const fetchEnglishVersion = async () => {
    // If already English, use current article data
    if (articleLanguage === 'en') {
      const excerpt = generateExcerpt(articleExcerpt, articleContent, articleTitle);
      setCustomText(excerpt);
      setCharCount(excerpt.length);
      setEnglishArticle(null);
      return;
    }

    // Try to find English translation
    if (translationId) {
      setLoadingEnglish(true);
      try {
        const { data, error } = await supabase
          .from('articles')
          .select('id, title, slug, excerpt, content, featured_image, language')
          .eq('translation_id', translationId)
          .eq('language', 'en')
          .single();

        if (!error && data) {
          setEnglishArticle(data);
          const excerpt = generateExcerpt(data.excerpt || '', data.content || '', data.title);
          setCustomText(excerpt);
          setCharCount(excerpt.length);
          return;
        }
      } catch (err) {
        console.error('Error fetching English version:', err);
      } finally {
        setLoadingEnglish(false);
      }
    }

    // Fallback to current article
    const excerpt = generateExcerpt(articleExcerpt, articleContent, articleTitle);
    setCustomText(excerpt);
    setCharCount(excerpt.length);
  };

  const handleTextChange = (value: string) => {
    setCustomText(value);
    setCharCount(value.length);
  };

  const handlePost = async () => {
    const selectedPlatforms: string[] = [];
    if (postToFacebook) selectedPlatforms.push('facebook');
    if (postToLinkedin) selectedPlatforms.push('linkedin');

    if (selectedPlatforms.length === 0) {
      toast({
        title: "No platform selected",
        description: "Please select at least one platform to post to.",
        variant: "destructive",
      });
      return;
    }

    setPosting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("User not authenticated");

      toast({
        title: "Posting to Social Media",
        description: `Sharing article to ${selectedPlatforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' and ')}...`,
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
            article_id: articleId,
            platforms: selectedPlatforms,
            custom_text: customText || undefined,
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
          title: "Posted Successfully",
          description: `Posted to ${postedTo.join(', ')}${errors.length > 0 ? `. Some errors: ${errors.join('; ')}` : ''}`,
        });
        onPostSuccess();
        onOpenChange(false);
      } else {
        throw new Error(errors.join('; ') || "Failed to post to any platform");
      }
    } catch (error: any) {
      console.error('Error posting to social media:', error);
      toast({
        title: "Post Failed",
        description: error.message || "Failed to post to social media",
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  };

  const hasBeenPosted = postedToFacebook || postedToLinkedin;
  const siteUrl = import.meta.env.VITE_SITE_URL || 'https://www.micronshub.eu';
  const previewUrl = englishArticle
    ? `${siteUrl}/en/blog/${englishArticle.slug}`
    : `${siteUrl}/en/blog/${articleSlug}`;
  const featuredImage = englishArticle?.featured_image || articleFeaturedImage;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Share to Social Media
          </DialogTitle>
          <DialogDescription>
            Preview and customize your social media post before sharing.
          </DialogDescription>
        </DialogHeader>

        {/* Re-post warning */}
        {hasBeenPosted && (
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">Already posted</p>
              <p className="text-xs text-amber-700 mt-1">
                This article was shared on{' '}
                {[
                  postedToFacebook && 'Facebook',
                  postedToLinkedin && 'LinkedIn',
                ].filter(Boolean).join(' and ')}
                {socialPostedAt && ` on ${new Date(socialPostedAt).toLocaleDateString()}`}.
                Posting again will create a duplicate post.
              </p>
            </div>
          </div>
        )}

        {/* English version notice */}
        {articleLanguage !== 'en' && (
          <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-lg p-3">
            {englishArticle ? (
              <>Using English version of this article for the social media post.</>
            ) : (
              <>No English translation found. Using the {articleLanguage.toUpperCase()} version as fallback.</>
            )}
          </div>
        )}

        {/* Featured image preview */}
        {featuredImage && (
          <div className="rounded-lg overflow-hidden border bg-muted">
            <img
              src={featuredImage}
              alt="Featured image"
              className="w-full h-40 object-cover"
            />
          </div>
        )}
        {!featuredImage && (
          <div className="rounded-lg border border-dashed bg-muted/50 p-6 flex items-center justify-center text-muted-foreground text-sm">
            <ImageIcon className="h-4 w-4 mr-2" />
            No featured image — social posts perform better with images
          </div>
        )}

        {/* Post text editor */}
        <div className="space-y-2">
          <Label>Post Text</Label>
          {loadingEnglish ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading English version...</span>
            </div>
          ) : (
            <>
              <Textarea
                value={customText}
                onChange={(e) => handleTextChange(e.target.value)}
                rows={6}
                placeholder="Enter the text to share on social media..."
                className="resize-y"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {charCount > MAX_CHARS ? (
                    <span className="text-red-500 font-medium">
                      {charCount}/{MAX_CHARS} characters (exceeds LinkedIn limit)
                    </span>
                  ) : (
                    <>{charCount}/{MAX_CHARS} characters</>
                  )}
                </span>
                <span className="text-muted-foreground">
                  Hashtags will be auto-generated by AI
                </span>
              </div>
            </>
          )}
        </div>

        {/* Article link preview */}
        <div className="text-sm bg-muted/50 border rounded-lg p-3 space-y-1">
          <p className="font-medium text-foreground">
            {englishArticle?.title || articleTitle}
          </p>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            {previewUrl}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Platform selection */}
        <div className="space-y-3">
          <Label>Post to</Label>
          <div className="flex flex-col gap-3">
            <div className="flex items-center space-x-3">
              <Checkbox
                id="post-facebook"
                checked={postToFacebook}
                onCheckedChange={(checked) => setPostToFacebook(checked as boolean)}
              />
              <Label
                htmlFor="post-facebook"
                className="flex items-center gap-2 cursor-pointer font-normal"
              >
                <Facebook className="h-4 w-4 text-blue-600" />
                Facebook
                {postedToFacebook && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    Already posted
                  </Badge>
                )}
              </Label>
            </div>
            <div className="flex items-center space-x-3">
              <Checkbox
                id="post-linkedin"
                checked={postToLinkedin}
                onCheckedChange={(checked) => setPostToLinkedin(checked as boolean)}
              />
              <Label
                htmlFor="post-linkedin"
                className="flex items-center gap-2 cursor-pointer font-normal"
              >
                <Linkedin className="h-4 w-4 text-blue-700" />
                LinkedIn
                {postedToLinkedin && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    Already posted
                  </Badge>
                )}
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={posting}>
            Cancel
          </Button>
          <Button
            onClick={handlePost}
            disabled={posting || (!postToFacebook && !postToLinkedin) || charCount > MAX_CHARS}
            className="flex items-center gap-2"
          >
            {posting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                Share Now
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SocialPostDialog;
