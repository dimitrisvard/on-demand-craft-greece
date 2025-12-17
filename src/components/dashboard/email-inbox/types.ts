export interface Email {
  id: string;
  sender: string;
  senderEmail: string;
  subject: string;
  preview: string;
  content: string;
  date: string;
  read: boolean;
  starred: boolean;
  folder: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam';
  labels: string[];
  attachments?: { name: string; size: string; type: string }[];
}

export type FolderId = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam';

