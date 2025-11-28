import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Calendar, Clock, ArrowLeft } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface Article {
  id: string;
  title: string;
  content: string;
  featured_image: string;
  created_at: string;
  meta_title: string;
  meta_description: string;
  author: {
    email: string;
  };
}

const BlogPost = () => {
  const { lang, slug } = useParams();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const currentLang = lang || i18n.language || 'en';

  useEffect(() => {
    if (slug) {
      fetchArticle();
    }
  }, [slug, currentLang]);

  const fetchArticle = async () => {
    try {
      setLoading(true);
      // Note: we're not selecting author yet as it requires a join that might not be set up
      // Simplification for now: just getting article data
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('slug', slug)
        .eq('language', currentLang)
        .eq('status', 'published')
        .single();

      if (error) throw error;
      setArticle(data);
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

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{article.meta_title || article.title} | Microns Hub</title>
        <meta name="description" content={article.meta_description || ""} />
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
              Back to Blog
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
                  alt={article.title} 
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
