// Phase 27 Track 4: Central notification event names.
// Sab tracks (SMS, WhatsApp, preferences) isi list se names lein
// taake event names har jagah same hon.

const NOTIFICATION_EVENTS = [
  'booking.confirmed',
  'booking.cancelled',
  'payment.received',
  'invoice.created',
  'ticket.updated',
  'visitor.checkin',
  'announcement',
];

const NOTIFICATION_CHANNELS = ['email', 'sms', 'whatsapp', 'inapp', 'push'];

const NOTIFICATION_EVENT_LABELS = {
  'booking.confirmed': 'Booking confirmed',
  'booking.cancelled': 'Booking cancelled',
  'payment.received': 'Payment received',
  'invoice.created': 'Invoice created',
  'ticket.updated': 'Ticket updated',
  'visitor.checkin': 'Visitor check-in',
  announcement: 'Announcements',
};

const NOTIFICATION_CHANNEL_LABELS = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  inapp: 'In-App',
  push: 'Push',
};

module.exports = {
  NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
};
