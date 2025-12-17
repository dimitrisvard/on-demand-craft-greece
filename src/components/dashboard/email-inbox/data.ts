import { Email } from './types';

export const mockEmails: Email[] = [
  {
    id: '1',
    sender: 'Alice Smith',
    senderEmail: 'alice@example.com',
    subject: 'Project Update: Q4 Goals',
    preview: 'Hi team, I wanted to share the progress on our Q4 goals...',
    content: `Hi team,

I wanted to share the progress on our Q4 goals. We are currently on track to exceed our targets by 15%.

Here is the breakdown:
- Sales: +20%
- Marketing: +10%
- Development: On schedule

Let's keep up the great work!

Best,
Alice`,
    date: '2023-10-25T09:30:00Z',
    read: false,
    starred: true,
    folder: 'inbox',
    labels: ['work', 'important'],
  },
  {
    id: '2',
    sender: 'Bob Johnson',
    senderEmail: 'bob@example.com',
    subject: 'Lunch next week?',
    preview: 'Hey, are you free for lunch next Tuesday?',
    content: `Hey,

Are you free for lunch next Tuesday? I found this new Italian place nearby.

Let me know!

Cheers,
Bob`,
    date: '2023-10-24T12:15:00Z',
    read: true,
    starred: false,
    folder: 'inbox',
    labels: ['personal'],
  },
  {
    id: '3',
    sender: 'Support Team',
    senderEmail: 'support@saas.com',
    subject: 'Your ticket #12345 has been resolved',
    preview: 'Dear user, your support ticket regarding login issues...',
    content: `Dear user,

Your support ticket #12345 regarding login issues has been resolved.

If you continue to experience issues, please reply to this email.

Thanks,
Support Team`,
    date: '2023-10-23T15:45:00Z',
    read: true,
    starred: false,
    folder: 'inbox',
    labels: ['updates'],
  },
  {
    id: '4',
    sender: 'Me',
    senderEmail: 'me@example.com',
    subject: 'Draft: Marketing Proposal',
    preview: 'Proposal for the new marketing campaign...',
    content: 'Proposal for the new marketing campaign starting in January...',
    date: '2023-10-26T10:00:00Z',
    read: true,
    starred: false,
    folder: 'drafts',
    labels: [],
  },
  {
    id: '5',
    sender: 'Me',
    senderEmail: 'me@example.com',
    subject: 'Meeting Notes',
    preview: 'Attached are the notes from today\'s meeting.',
    content: 'Attached are the notes from today\'s meeting.',
    date: '2023-10-22T16:20:00Z',
    read: true,
    starred: false,
    folder: 'sent',
    labels: ['work'],
  },
];

