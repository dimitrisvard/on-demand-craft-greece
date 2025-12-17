CREATE TABLE IF NOT EXISTS public.user_emails (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT,
    content TEXT,
    folder TEXT NOT NULL DEFAULT 'inbox',
    read BOOLEAN DEFAULT FALSE,
    starred BOOLEAN DEFAULT FALSE,
    labels TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error TEXT
);

ALTER TABLE public.user_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own emails"
    ON public.user_emails
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own emails"
    ON public.user_emails
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own emails"
    ON public.user_emails
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own emails"
    ON public.user_emails
    FOR DELETE
    USING (auth.uid() = user_id);

