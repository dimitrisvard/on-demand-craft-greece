import { useState } from 'react';
import { Phone, Mail, MapPin, Clock, Check, AlertCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import CTASection from '../components/CTASection';
import { useTranslation } from 'react-i18next';

const Contact = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormState(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formState),
      });

      if (!response.ok) {
        throw new Error('Failed to send email');
      }

      setSubmitSuccess(true);
      toast({
        title: "Success!",
        description: "Your message has been sent successfully.",
      });
      
      // Reset form after success
      setTimeout(() => {
        setFormState({
          name: '',
          email: '',
          phone: '',
          subject: '',
          message: ''
        });
        setSubmitSuccess(false);
      }, 3000);
      
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pt-16">
      {/* Hero Section */}
      <section className="relative py-24 bg-gray-900">
        <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ 
          backgroundImage: "url('https://images.unsplash.com/photo-1534536281715-e28d76689b4d?auto=format&fit=crop&w=1920&q=80')",
        }} />
        
        <div className="container-custom relative z-10 text-white">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              {t('contact_hero_title', 'Contact Us')}
            </h1>
            <p className="text-lg md:text-xl mb-8 text-white/80">
              {t('contact_hero_subtitle', 'Have questions about our services? Ready to start a project? Our team is here to help.')}
            </p>
          </div>
        </div>
      </section>

      {/* Contact Info Section */}
      <section className="py-20">
        <div className="container-custom">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div className="lg:col-span-1">
              <h2 className="text-3xl font-bold mb-6">{t('contact_get_in_touch', 'Get In Touch')}</h2>
              <p className="text-gray-600 mb-8">
                {t('contact_get_in_touch_desc', 'Have a question or want to discuss your manufacturing needs? Reach out to us through any of the contact methods below.')}
              </p>
              
              <div className="space-y-6">
                <div className="flex items-start">
                  <div className="bg-brand-light p-3 rounded-full mr-4">
                    <MapPin className="h-6 w-6 text-brand-teal" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{t('contact_office_location', 'Office Location')}</h3>
                    <p className="text-gray-600">{t('contact_address', 'Kosti Fragkouli 3, Heraklion Greece 71414')}</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="bg-brand-light p-3 rounded-full mr-4">
                    <Mail className="h-6 w-6 text-brand-teal" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{t('contact_email_us', 'Email Us')}</h3>
                    <p className="text-gray-600">{t('contact_email', 'info@micronshub.eu')}</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="bg-brand-light p-3 rounded-full mr-4">
                    <Phone className="h-6 w-6 text-brand-teal" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{t('contact_call_us', 'Call Us')}</h3>
                    <p className="text-gray-600">{t('contact_phone')}</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="bg-brand-light p-3 rounded-full mr-4">
                    <Clock className="h-6 w-6 text-brand-teal" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{t('contact_business_hours', 'Business Hours')}</h3>
                    <p className="text-gray-600">{t('contact_hours_weekdays', 'Monday - Friday: 9:00 AM - 6:00 PM')}</p>
                    <p className="text-gray-600">{t('contact_hours_weekend', 'Saturday - Sunday: Closed')}</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-lg p-8 border border-gray-100">
                <h2 className="text-2xl font-bold mb-6">{t('contact_send_message', 'Send Us a Message')}</h2>
                
                {submitSuccess ? (
                  <div className="text-center py-8">
                    <div className="inline-flex items-center justify-center bg-green-100 p-3 rounded-full mb-4">
                      <Check size={24} className="text-green-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-800 mb-2">{t('contact_form_success_title', 'Message Sent!')}</h3>
                    <p className="text-gray-600">{t('contact_form_success_message', "We'll get back to you as soon as possible.")}</p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="name">
                          {t('contact_form_name', 'Full Name')}
                        </label>
                        <input
                          type="text"
                          id="name"
                          name="name"
                          value={formState.name}
                          onChange={handleInputChange}
                          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                          {t('contact_form_email', 'Email Address')}
                        </label>
                        <input
                          type="email"
                          id="email"
                          name="email"
                          value={formState.email}
                          onChange={handleInputChange}
                          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                          required
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="phone">
                          {t('contact_form_phone', 'Phone Number')}
                        </label>
                        <input
                          type="tel"
                          id="phone"
                          name="phone"
                          value={formState.phone}
                          onChange={handleInputChange}
                          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="subject">
                          {t('contact_form_subject', 'Subject')}
                        </label>
                        <select
                          id="subject"
                          name="subject"
                          value={formState.subject}
                          onChange={handleInputChange}
                          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                          required
                        >
                          <option value="" disabled>{t('contact_form_subject_placeholder', 'Select a subject')}</option>
                          <option value="quote">{t('contact_form_subject_quote', 'Request a Quote')}</option>
                          <option value="info">{t('contact_form_subject_info', 'General Information')}</option>
                          <option value="support">{t('contact_form_subject_support', 'Technical Support')}</option>
                          <option value="partnership">{t('contact_form_subject_partnership', 'Partnership Opportunities')}</option>
                          <option value="other">{t('contact_form_subject_other', 'Other')}</option>
                        </select>
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="message">
                        {t('contact_form_message', 'Message')}
                      </label>
                      <textarea
                        id="message"
                        name="message"
                        value={formState.message}
                        onChange={handleInputChange}
                        rows={6}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                        required
                        placeholder={t('contact_form_message_placeholder', 'Please describe your inquiry...')}
                      />
                    </div>
                    
                    <div className="flex items-start">
                      <div className="flex items-center h-5">
                        <input
                          id="privacy"
                          type="checkbox"
                          className="focus:ring-brand-teal h-4 w-4 text-brand-teal border-gray-300 rounded"
                          required
                        />
                      </div>
                      <div className="ml-3 text-sm">
                        <label htmlFor="privacy" className="font-medium text-gray-700">
                          {t('contact_form_privacy', 'I agree to the')} <a href="#" className="text-brand-teal hover:underline">{t('footer_privacy', 'Privacy Policy')}</a> {t('contact_form_privacy_consent', 'and consent to being contacted regarding my inquiry.')}
                        </label>
                      </div>
                    </div>
                    
                    <button
                      type="submit"
                      className="w-full btn-primary py-3 flex justify-center items-center"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          {t('contact_form_sending', 'Sending...')}
                        </>
                      ) : t('contact_form_submit', 'Send Message')}
                    </button>
                    
                    <div className="text-xs text-gray-500 flex items-center">
                      <AlertCircle size={14} className="mr-1" />
                      {t('contact_form_response_time', 'We typically respond to all inquiries within 24 hours.')}
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* Map Section */}
      <section className="py-12">
        <div className="container-custom">
          <h2 className="text-3xl font-bold mb-8">{t('contact_location_title', 'Our Location')}</h2>
          <div className="rounded-lg overflow-hidden h-96 border border-gray-200 shadow-md">
            <iframe
              title="Microns Hub Location"
              width="100%"
              height="100%"
              frameBorder="0"
              src={`https://www.google.com/maps/embed/v1/place?q=35.331197,25.089428&key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&zoom=15`}
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <CTASection />
    </div>
  );
};

export default Contact;
