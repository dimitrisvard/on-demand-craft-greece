import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';

type SubjectValue =
  | 'quote'
  | 'technical'
  | 'partnership'
  | 'support'
  | 'other';

interface FormState {
  name: string;
  company: string;
  email: string;
  phone: string;
  subject: SubjectValue | '';
  message: string;
  website: string;
}

const EMPTY: FormState = {
  name: '',
  company: '',
  email: '',
  phone: '',
  subject: '',
  message: '',
  website: '',
};

const MIN_MESSAGE = 20;
const MAX_MESSAGE = 5000;
const MAILTO = 'info@micronshub.eu';

function buildMailto(state: FormState): string {
  const subjectLabel =
    {
      quote: 'Quote request',
      technical: 'Technical question',
      partnership: 'Partnership',
      support: 'Support',
      other: 'Other',
    }[state.subject as SubjectValue] || 'Inquiry';

  const subject = `${subjectLabel} — ${state.name || 'New inquiry'}`;
  const lines = [
    `Name: ${state.name}`,
    state.company ? `Company: ${state.company}` : '',
    `Email: ${state.email}`,
    state.phone ? `Phone: ${state.phone}` : '',
    '',
    state.message,
  ].filter(Boolean);
  return `mailto:${MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

const ContactForm: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setState((p) => ({ ...p, [name]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Honeypot: bots often fill every field. Real users never touch this one.
    if (state.website.trim() !== '') {
      setSuccess(true);
      setState(EMPTY);
      return;
    }

    if (state.message.trim().length < MIN_MESSAGE) {
      setError(
        t(
          'contact_form_error_short_message',
          `Please describe your inquiry in at least ${MIN_MESSAGE} characters.`,
        ) as string,
      );
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: state.name,
          company: state.company,
          email: state.email,
          phone: state.phone,
          subject: state.subject,
          message: state.message,
          action: 'email',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setSuccess(true);
      setState(EMPTY);
      toast({
        title: t('contact_form_success_title', 'Message sent') as string,
        description: t(
          'contact_form_success_desc',
          "Thanks — we'll respond within one working day.",
        ) as string,
      });
      try {
        (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.(
          'event',
          'contact_form_submit_success',
        );
      } catch {
        /* analytics optional */
      }
    } catch (err) {
      // Fall back to mailto so the user can still reach us.
      const mailto = buildMailto(state);
      setError(
        t(
          'contact_form_error_fallback',
          "We couldn't send your message right now. Click here to email us directly.",
        ) as string,
      );
      if (typeof window !== 'undefined') window.location.href = mailto;
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="bg-white rounded-lg shadow-lg border border-gray-100 p-8 md:p-10">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 bg-brand-light p-3 rounded-full">
            <CheckCircle2 className="h-6 w-6 text-brand-teal" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-brand-dark mb-2">
              {t('contact_form_success_title', 'Message sent')}
            </h3>
            <p className="text-brand-dark/80 leading-relaxed">
              {t(
                'contact_form_success_desc',
                "Thanks — we'll respond within one working day.",
              )}
            </p>
            <button
              type="button"
              onClick={() => setSuccess(false)}
              className="mt-6 text-brand-primary font-medium hover:underline"
            >
              {t('contact_form_send_another', 'Send another message')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-100 p-8 md:p-10">
      <h2 className="text-2xl md:text-3xl font-bold mb-6 text-brand-dark">
        {t('contact_send_message', 'Send us a message')}
      </h2>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 mb-6 text-sm text-red-700">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {/* Honeypot — visually hidden but reachable by bots */}
        <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px]">
          <label>
            Website
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={state.website}
              onChange={onChange}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-brand-dark mb-1"
            >
              {t('contact_form_name', 'Full name')} *
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              value={state.name}
              onChange={onChange}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>
          <div>
            <label
              htmlFor="company"
              className="block text-sm font-medium text-brand-dark mb-1"
            >
              {t('contact_form_company', 'Company')}
            </label>
            <input
              id="company"
              name="company"
              type="text"
              value={state.company}
              onChange={onChange}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-brand-dark mb-1"
            >
              {t('contact_form_email', 'Email')} *
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={state.email}
              onChange={onChange}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>
          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-brand-dark mb-1"
            >
              {t('contact_form_phone', 'Phone')}
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={state.phone}
              onChange={onChange}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="subject"
            className="block text-sm font-medium text-brand-dark mb-1"
          >
            {t('contact_form_subject', 'Subject')} *
          </label>
          <select
            id="subject"
            name="subject"
            required
            value={state.subject}
            onChange={onChange}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-white"
          >
            <option value="" disabled>
              {t('contact_form_subject_placeholder', 'Select a subject')}
            </option>
            <option value="quote">
              {t('contact_form_subject_quote', 'Quote request')}
            </option>
            <option value="technical">
              {t('contact_form_subject_technical', 'Technical question')}
            </option>
            <option value="partnership">
              {t('contact_form_subject_partnership', 'Partnership')}
            </option>
            <option value="support">
              {t('contact_form_subject_support', 'Support')}
            </option>
            <option value="other">
              {t('contact_form_subject_other', 'Other')}
            </option>
          </select>
        </div>

        <div>
          <label
            htmlFor="message"
            className="block text-sm font-medium text-brand-dark mb-1"
          >
            {t('contact_form_message', 'Message')} *
          </label>
          <textarea
            id="message"
            name="message"
            required
            minLength={MIN_MESSAGE}
            maxLength={MAX_MESSAGE}
            rows={6}
            value={state.message}
            onChange={onChange}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-primary focus:border-transparent resize-y"
            placeholder={t(
              'contact_form_message_placeholder',
              'Tell us about your part, volume, tolerances, timeline…',
            ) as string}
          />
          <p className="mt-1 text-xs text-brand-muted">
            {state.message.length} / {MAX_MESSAGE}
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full text-lg font-bold py-3 inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin mr-2" />
              {t('contact_form_sending', 'Sending…')}
            </>
          ) : (
            t('contact_form_submit', 'Send message')
          )}
        </button>

        <p className="text-xs text-brand-muted flex items-center">
          <AlertCircle size={14} className="mr-1" />
          {t(
            'contact_form_response_time',
            'We typically respond within one working day.',
          )}
        </p>
      </form>
    </div>
  );
};

export default ContactForm;
