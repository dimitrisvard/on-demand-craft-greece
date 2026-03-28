import { useState } from 'react';
import { Bell, FileText, Package, MessageSquare, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Notification {
  id: string;
  type: 'quote_update' | 'order_status' | 'message' | 'dfm_warning';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'quote_update',
    title: 'Quote Updated',
    message: 'Your quote for CNC Bracket Assembly has been revised with new pricing.',
    timestamp: '2 minutes ago',
    read: false,
  },
  {
    id: '2',
    type: 'dfm_warning',
    title: 'DFM Warning',
    message: 'Part "Housing Cover" has 2 manufacturability issues that need attention.',
    timestamp: '15 minutes ago',
    read: false,
  },
  {
    id: '3',
    type: 'order_status',
    title: 'Order Status Changed',
    message: 'Order #MH-4021 has moved to "In Production".',
    timestamp: '1 hour ago',
    read: false,
  },
  {
    id: '4',
    type: 'message',
    title: 'New Message',
    message: 'Your supplier responded to your question about surface finish options.',
    timestamp: '3 hours ago',
    read: true,
  },
  {
    id: '5',
    type: 'order_status',
    title: 'Order Shipped',
    message: 'Order #MH-3987 has been shipped. Tracking number available.',
    timestamp: '1 day ago',
    read: true,
  },
];

const notificationIcons: Record<Notification['type'], React.ReactNode> = {
  quote_update: <FileText className="h-4 w-4 text-blue-500" />,
  order_status: <Package className="h-4 w-4 text-green-500" />,
  message: <MessageSquare className="h-4 w-4 text-purple-500" />,
  dfm_warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
};

const NotificationPanel = () => {
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const [isOpen, setIsOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-5 w-5 items-center justify-center rounded-full p-0 text-[10px]">
            {unreadCount}
          </Badge>
        )}
      </Button>

      {isOpen && (
        <>
          {/* Backdrop to close panel */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-lg border bg-background shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1 px-2 py-1 text-xs text-muted-foreground"
                  onClick={markAllAsRead}
                >
                  <Check className="h-3 w-3" />
                  Mark all as read
                </Button>
              )}
            </div>

            {/* Notification list */}
            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No notifications
                </div>
              ) : (
                notifications.map((notification) => (
                  <button
                    key={notification.id}
                    className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                      !notification.read ? 'bg-muted/30' : ''
                    }`}
                    onClick={() => markAsRead(notification.id)}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {notificationIcons[notification.type]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {notification.title}
                        </span>
                        {!notification.read && (
                          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {notification.message}
                      </p>
                      <span className="mt-1 block text-[11px] text-muted-foreground/70">
                        {notification.timestamp}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="border-t px-4 py-2 text-center">
              <Button
                variant="link"
                size="sm"
                className="h-auto text-xs"
              >
                View all notifications
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationPanel;
