import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Calendar, Clock, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import SEOMeta from "@/components/SEOMeta";

interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  featured_image: string;
  featured_image_alt?: string;
  created_at: string;
  language: string;
}

const BlogIndex = () => {
  const { lang } = useParams();
  const { i18n, t } = useTranslation();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const currentLang = lang || i18n.language || 'en';

  useEffect(() => {
    fetchArticles();
  }, [currentLang]);

  const fetchArticles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('articles')
        .select('id, title, slug, excerpt, featured_image, featured_image_alt, created_at, language')
        .eq('language', currentLang)
        .eq('status', 'published')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error) {
      console.error('Error fetching articles:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <SEOMeta 
        title={`${t('blog_title', 'Latest Updates')} | Microns Hub`}
        description={t('blog_subtitle', 'Latest news, updates, and insights from Microns Hub about manufacturing, engineering, and precision parts.')}
        ogType="website"
      />
      
      <div className="pt-24 pb-16">
        <div className="container-custom mx-auto px-4">
          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold tracking-tight mb-4">
              {t('blog_title', 'Latest Updates')}
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t('blog_subtitle', 'Insights, news, and technical articles about manufacturing and engineering.')}
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[1, 2, 3].map((n) => (
                <div key={n} className="bg-gray-100 rounded-lg h-96 animate-pulse" />
              ))}
            </div>
          ) : articles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {articles.map((article) => (
                <Link 
                  key={article.id} 
                  to={`/${currentLang}/blog/${article.slug}`}
                  className="group flex flex-col bg-white border rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-300"
                >
                  {article.featured_image ? (
                    <div className="h-48 overflow-hidden">
                      <img 
                        src={article.featured_image} 
                        alt={article.featured_image_alt || article.title} 
                        className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  ) : (
                    <div className="h-48 bg-gray-100 flex items-center justify-center">
                      <span className="text-gray-400">{t('blog_no_image', 'No Image')}</span>
                    </div>
                  )}
                  
                  <div className="flex-1 p-6 flex flex-col">
                    <div className="flex items-center text-sm text-muted-foreground mb-3">
                      <Calendar className="h-4 w-4 mr-1" />
                      {format(new Date(article.created_at), 'MMM dd, yyyy')}
                    </div>
                    
                    <h2 className="text-xl font-bold mb-3 group-hover:text-primary transition-colors">
                      {article.title}
                    </h2>
                    
                    <p className="text-muted-foreground line-clamp-3 mb-4 flex-1">
                      {article.excerpt}
                    </p>
                    
                    <div className="flex items-center text-primary font-medium mt-auto">
                      {t('blog_read_more', 'Read More')} 
                      <ChevronRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-lg text-muted-foreground">{t('blog_no_articles', 'No articles found in this language.')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlogIndex;
