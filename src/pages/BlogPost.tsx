import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Calendar, Clock, ArrowLeft } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import SEOMeta from "@/components/SEOMeta";

interface Article {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  language: string;
  featured_image: string;
  featured_image_alt?: string;
  status: string;
  meta_title: string;
  meta_description: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  translation_id?: string;
}

const BlogPost = () => {
  const { lang, slug } = useParams();
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [hreflangLinks, setHreflangLinks] = useState<Array<{ lang: string; url: string }>>([]);
  const currentLang = lang || i18n.language || 'en';

  useEffect(() => {
    if (slug) {
      fetchArticle();
    }
  }, [slug, currentLang]);

  const fetchArticle = async () => {
    try {
      setLoading(true);
      
      // 1. Fetch the current article
      const { data: currentArticle, error } = await supabase
        .from('articles')
        .select('*')
        .eq('slug', slug)
        .eq('language', currentLang)
        .eq('status', 'published')
        .single();

      if (error) throw error;
      setArticle(currentArticle);

      // 2. Fetch translations (siblings with same translation_id)
      if (currentArticle?.translation_id) {
        const { data: translations } = await supabase
          .from('articles')
          .select('language, slug')
          .eq('translation_id', currentArticle.translation_id)
          .eq('status', 'published')
          .neq('id', currentArticle.id); // Exclude current article

        if (translations) {
          const baseUrl = window.location.origin;
          
          // Create links for translations
          const links = translations.map(t => ({
            lang: t.language,
            url: `${baseUrl}/${t.language}/blog/${t.slug}`
          }));

          // Add current article to the list as well (self-referencing hreflang is required)
          links.push({
            lang: currentLang,
            url: `${baseUrl}/${currentLang}/blog/${currentArticle.slug}`
          });

          setHreflangLinks(links);
        }
      }
    } catch (error) {
      console.error('Error fetching article:', error);
      navigate(`/${currentLang}/blog`); // Redirect to index if not found
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="pt-32 pb-16 container-custom mx-auto px-4">
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="h-8 w-32 bg-gray-100 rounded animate-pulse" />
            <div className="h-12 w-3/4 bg-gray-100 rounded animate-pulse" />
            <div className="h-96 w-full bg-gray-100 rounded animate-pulse" />
            <div className="space-y-4">
              <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
              <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
              <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!article) return null;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": article.title,
    "image": article.featured_image ? [article.featured_image] : [],
    "datePublished": article.created_at,
    "dateModified": article.updated_at || article.created_at,
    "author": [{
        "@type": "Person",
        "name": "MicronsHub Team",
        "url": "https://micronshub.com" 
    }],
    "publisher": {
        "@type": "Organization",
        "name": "MicronsHub",
        "logo": {
            "@type": "ImageObject",
            "url": "https://micronshub.com/logo.png"
        }
    },
    "description": article.meta_description || article.excerpt || ""
  };

  return (
    <div className="min-h-screen bg-white">
      <SEOMeta 
        title={`${article.meta_title || article.title} | Microns Hub`}
        description={article.meta_description || article.excerpt}
        ogImage={article.featured_image}
        ogType="article"
        hreflangLinks={hreflangLinks.length > 0 ? hreflangLinks : undefined}
        disableDefaultHreflang={hreflangLinks.length > 0}
      />
      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      </Helmet>
      
      <article className="pt-32 pb-16">
        <div className="container-custom mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <Button 
              variant="ghost" 
              className="mb-8 pl-0 hover:pl-0 hover:bg-transparent hover:text-primary transition-colors"
              onClick={() => navigate(`/${currentLang}/blog`)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t('blog_back_to_blog', 'Back to Blog')}
            </Button>

            <div className="space-y-6 mb-8">
              <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                <span className="flex items-center">
                  <Calendar className="h-4 w-4 mr-1" />
                  {format(new Date(article.created_at), 'MMMM dd, yyyy')}
                </span>
                {/* Add reading time calculation here if desired */}
                <span className="flex items-center">
                  <Clock className="h-4 w-4 mr-1" />
                  {Math.max(1, Math.ceil(article.content.replace(/<[^>]*>/g, '').split(' ').length / 200))} min read
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 leading-tight">
                {article.title}
              </h1>
            </div>

            {article.featured_image && (
              <div className="mb-10 rounded-xl overflow-hidden shadow-md">
                <img 
                  src={article.featured_image} 
                  alt={article.featured_image_alt || article.title} 
                  className="w-full h-auto object-cover"
                />
              </div>
            )}

            <div 
              className="prose prose-lg prose-blue max-w-none"
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
          </div>
        </div>
      </article>
    </div>
  );
};

export default BlogPost;
