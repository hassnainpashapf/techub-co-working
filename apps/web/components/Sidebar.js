'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

// Fobework-style sidebar — exact match to reference design
const ICONS = {
  overview: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  ),
  workspaces: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
  ),
  team: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  investor: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
  ),
  school: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  ),
  launchpad: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
  ),
  message: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  ),
  support: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>
  ),
  insights: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4c2.5.5 4 2.5 4 5a5 5 0 0 1-2 4v2a2 2 0 0 1-2 2h-1"/><path d="M12 2a4 4 0 0 0-4 4C5.5 6.5 4 8.5 4 11a5 5 0 0 0 2 4v2a2 2 0 0 0 2 2h1"/><path d="M12 2v3"/><circle cx="12" cy="13" r="1.5"/></svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  ),
  chevronRight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  ),
  chevUpDown: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 9 12 5 16 9"/><polyline points="8 15 12 19 16 15" opacity="0.4"/></svg>
  ),
  shield: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
  ),
};

const NAV_MAIN = [
  { key: 'overview', label: 'Overview', path: '/dashboard', icon: 'overview' },
  {
    key: 'workspaces', label: 'Workspaces', path: '/spaces', icon: 'workspaces',
    children: [
      { label: 'Discover Booking', path: '/discover' },
      { label: 'Booking History', path: '/bookings' },
      { label: 'Requests', path: '/bookings/requests' },
      { label: 'Recurring', path: '/bookings/recurring' },
      { label: 'Booking Calendar', path: '/bookings/calendar' },
      { label: 'Floor Plan', path: '/spaces/floorplan' },
      { label: 'Ride Sharing', path: '/rides' },
    ],
  },
  { key: 'team', label: 'Team', path: '/users', icon: 'team',
    children: [
      { label: 'Team Members', path: '/users' },
      { label: 'Attendance', path: '/attendance' },
      { label: 'Scan QR', path: '/attendance/scan' },
      { label: 'Check-in Desk', path: '/reception/checkin' },
      { label: 'Mobile', path: '/mobile' },
      { label: 'Shifts', path: '/staff/shifts' },
    ],
  },
  { key: 'investor', label: 'Investor', path: '/finance', icon: 'investor',
    children: [
      { label: 'Finance Overview', path: '/finance' },
      { label: 'Billing & Invoices', path: '/billing' },
      { label: 'Recurring Invoices', path: '/billing/recurring' },
      { label: 'Dunning', path: '/billing/dunning' },
      { label: 'FX Gain/Loss', path: '/finance/fx' },
      { label: 'Payroll', path: '/payroll' },
      { label: 'Petty Cash', path: '/finance/petty-cash' },
      { label: 'Budgets', path: '/finance/budgets' },
      { label: 'Tax Reports', path: '/reports/tax' },
      { label: 'AR Aging', path: '/reports/ar-aging' },
      { label: 'Inventory & Assets', path: '/inventory' },
      { label: 'Facility Assets', path: '/assets' },
      { label: 'Printing', path: '/printing' },
      { label: 'Documents & Credits', path: '/documents' },
      { label: 'Refunds', path: '/refunds' },
      { label: 'Reports', path: '/reports' },
      { label: 'Custom Reports', path: '/reports' },
      { label: 'Report Builder', path: '/reports/builder' },
      { label: 'Scheduled Reports', path: '/reports/scheduled' },
      { label: 'Locations', path: '/investor/locations' },
      { label: 'P&L Statement', path: '/investor/pnl' },
      { label: 'Forecast', path: '/investor/forecast' },
      { label: 'Projections', path: '/investor/projections' },
      { label: 'KPI Dashboards', path: '/dashboards' },
      { label: 'Churn Analysis', path: '/reports/churn' },
      { label: 'Expense Trends', path: '/finance/trends' },
      { label: 'Accounting Export', path: '/finance/accounting-export' },
    ],
  },
  { key: 'school', label: 'School', path: '/members', icon: 'school',
    children: [
      { label: 'Members', path: '/members' },
      { label: 'Companies', path: '/companies' },
      { label: 'Leads', path: '/leads' },
      { label: 'Import Members', path: '/members/import' },
      { label: 'Membership Plans', path: '/plans' },
      { label: 'Referrals', path: '/referrals' },
    ],
  },
  { key: 'launchpad', label: 'Launchpad', path: '/tasks', icon: 'launchpad',
    children: [
      { label: 'Tasks', path: '/tasks' },
      { label: 'Tickets', path: '/tickets' },
      { label: 'Maintenance', path: '/maintenance' },
      { label: 'Maintenance Requests', path: '/maintenance-requests' },
      { label: 'Visitors', path: '/visitors' },
      { label: 'Parking', path: '/parking' },
      { label: 'Mail & Packages', path: '/mail' },
      { label: 'Lost & Found', path: '/lost-found' },
      { label: 'Housekeeping', path: '/housekeeping' },
      { label: 'WiFi Vouchers', path: '/wifi' },
      { label: 'Events', path: '/events' },
      { label: 'Organizer Dashboard', path: '/events/dashboard' },
      { label: 'Ticket Scanning', path: '/events/scan' },
      { label: 'NPS Surveys', path: '/surveys' },
      { label: 'Reminders', path: '/reminders' },
    ],
  },
  { key: 'message', label: 'Message', path: '/reminders', icon: 'message' },
  { key: 'forms', label: 'Forms & Surveys', path: '/forms', icon: 'message',
    roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'All Forms', path: '/forms' },
    ],
  },
  { key: 'intelligence', label: 'Intelligence', path: '/intelligence', icon: 'insights',
    roles: ['ceo', 'admin', 'super_admin', 'manager'] },
  { key: 'access', label: 'Access', path: '/access', icon: 'shield',
    roles: ['ceo', 'admin', 'super_admin', 'manager', 'ops'],
    children: [
      { label: 'Access Dashboard', path: '/access' },
      { label: 'Doors & Access Points', path: '/access/doors' },
      { label: 'Day Passes', path: '/access/passes' },
    ],
  },
  { key: 'accessdesk', label: 'Access Desk', path: '/access/desk', icon: 'shield',
    roles: ['ceo', 'admin', 'super_admin', 'manager', 'ops', 'receptionist'] },
  { key: 'comms', label: 'Communication', path: '/comms', icon: 'message',
    roles: ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops'],
    children: [
      { label: 'Communication Hub', path: '/comms' },
      { label: 'Team Inbox', path: '/comms/inbox' },
      { label: 'SMS Campaigns', path: '/comms/sms' },
    ],
  },
  { key: 'feedback', label: 'Feedback', path: '/feedback', icon: 'message', roles: ['ceo', 'admin', 'manager', 'super_admin'] },
  { key: 'announcements', label: 'Announcements', path: '/announcements', icon: 'message', roles: ['ceo', 'admin', 'manager', 'super_admin'] },
  { key: 'legal', label: '⚖️ Legal & Compliance', path: '/legal', icon: 'shield',
    roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Legal Dashboard', path: '/legal' },
      { label: '📄 Contract Templates', path: '/legal/templates' },
      { label: 'Policy Documents', path: '/legal/policies' },
      { label: 'Compliance', path: '/legal/compliance' },
      { label: 'Incident Reports', path: '/legal/incidents' },
    ],
  },
  { key: 'utilities', label: '⚡ Utilities', path: '/utilities', icon: 'workspaces',
    roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Utilities Dashboard', path: '/utilities' },
      { label: '🔌 Utility Meters', path: '/utilities/meters' },
      { label: '🌱 Green Initiatives', path: '/utilities/green' },
    ],
  },
  { key: 'academy', label: '🎓 Academy', path: '/academy', icon: 'school',
    roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Academy Dashboard', path: '/academy' },
      { label: '📚 Courses', path: '/academy/courses' },
      { label: '🗺️ Learning Paths', path: '/academy/paths' },
      { label: '🎤 Workshops', path: '/academy/workshops' },
    ],
  },
  { key: 'success', label: '🌱 Member Success', path: '/success', icon: 'team',
    roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Success Dashboard', path: '/success' },
      { label: '🚀 Onboarding', path: '/success/onboarding' },
    ],
  },
  { key: 'concierge', label: '🛎️ Concierge', path: '/concierge', icon: 'message',
    roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Concierge Dashboard', path: '/concierge' },
      { label: '🧾 Service Catalog', path: '/concierge/services' },
      { label: '📋 Staff Board', path: '/concierge/board' },
    ],
  },
  { key: 'lockers', label: '🔐 Lockers', path: '/lockers/dashboard', icon: 'workspaces',
    roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Locker Dashboard', path: '/lockers/dashboard' },
      { label: '📦 Inventory', path: '/lockers' },
      { label: '🗺️ Map', path: '/lockers/map' },
    ],
  },
];

// Limited nav for member-portal users — own data only
const NAV_MEMBER = [
  { key: 'portal', label: 'My Portal', path: '/portal', icon: 'overview' },
  { key: 'myqr', label: 'My QR', path: '/portal/qr', icon: 'overview' },
  { key: 'mybookings', label: 'My Bookings', path: '/bookings', icon: 'workspaces' },
  { key: 'myinvoices', label: 'My Invoices', path: '/billing', icon: 'investor' },
  { key: 'mytickets', label: 'My Tickets', path: '/tickets', icon: 'launchpad' },
  { key: 'mydocs', label: 'My Documents', path: '/documents', icon: 'school' },
  { key: 'myfeedback', label: 'Feedback', path: '/portal/feedback', icon: 'message' },
  { key: 'mybadges', label: 'Badges', path: '/portal/badges', icon: 'investor' },
  { key: 'myperks', label: 'Perks', path: '/portal/perks', icon: 'investor' },
  { key: 'mypolls', label: 'Polls', path: '/portal/polls', icon: 'team' },
  { key: 'mymessages', label: 'Messages', path: '/portal/messages', icon: 'message' },
  { key: 'mycafe', label: 'Café', path: '/portal/cafe', icon: 'workspaces' },
  { key: 'myaccess', label: 'My Access', path: '/portal/access', icon: 'shield' },
  { key: 'myusage', label: 'My Usage', path: '/portal/usage', icon: 'investor' },
  { key: 'events', label: 'Events', path: '/portal/events', icon: 'team' },
  { key: 'marketplace', label: 'Marketplace', path: '/portal/marketplace', icon: 'launchpad' },
  { key: 'directory', label: 'Directory', path: '/portal/directory', icon: 'team' },
  { key: 'loyalty', label: 'Loyalty', path: '/portal/loyalty', icon: 'investor' },
  { key: 'referrals', label: 'Referrals', path: '/portal/referrals', icon: 'message' },
  { key: 'maintenance', label: 'Maintenance', path: '/portal/maintenance', icon: 'launchpad' },
  { key: 'printing', label: 'Printing', path: '/portal/printing', icon: 'investor' },
  { key: 'lostfound', label: 'Lost & Found', path: '/portal/lost-found', icon: 'launchpad' },
  { key: 'myacademy', label: '🎓 Academy', path: '/portal/academy', icon: 'school' },
  { key: 'myconcierge', label: '🛎️ Concierge', path: '/portal/concierge', icon: 'message' },
  { key: 'mylockers', label: '🔐 Lockers', path: '/portal/lockers', icon: 'workspaces' },
];

const NAV_OTHERS = [
  { key: 'messages', label: 'Messages', path: '/messages', icon: 'message' },
  { key: 'community', label: 'Community', path: '/community/celebrations', icon: 'team', chevron: true, roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Celebrations', path: '/community/celebrations' },
      { label: 'Perks & Benefits', path: '/community/perks' },
      { label: 'Polls', path: '/community/polls' },
      { label: 'Newsletters', path: '/community/newsletters' },
      { label: 'Engagement', path: '/community/engagement' },
    ],
  },
  { key: 'saas', label: 'SaaS Admin', path: '/saas-admin', icon: 'settings', chevron: true, roles: ['super_admin'],
    children: [
      { label: 'Overview', path: '/saas-admin' },
      { label: 'Plans', path: '/saas-admin/plans' },
      { label: 'Tenant Onboarding', path: '/admin/onboarding' },
      { label: 'Tenants', path: '/admin/tenants' },
    ],
  },
  { key: 'marketing', label: 'Marketing', path: '/marketing/campaigns', icon: 'message', chevron: true, roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Email Campaigns', path: '/marketing/campaigns' },
      { label: 'SMS Campaigns', path: '/marketing/sms' },
    ],
  },
  { key: 'developers', label: 'Developers', path: '/developers/api-docs', icon: 'settings', chevron: true, roles: ['ceo', 'admin', 'super_admin'],
    children: [
      { label: 'API Docs', path: '/developers/api-docs' },
      { label: 'API Usage', path: '/developers/usage' },
    ],
  },
  { key: 'sales', label: 'Sales', path: '/sales/leads', icon: 'investor', chevron: true, roles: ['ceo', 'admin', 'super_admin', 'manager', 'receptionist'],
    children: [
      { label: 'Sales Dashboard', path: '/sales/dashboard' },
      { label: 'Leads', path: '/sales/leads' },
      { label: 'Pipeline', path: '/sales/pipeline' },
      { label: 'Tours', path: '/sales/tours' },
      { label: 'Quotations', path: '/sales/quotations' },
      { label: 'Import Leads', path: '/sales/leads/import' },
      { label: 'Lost Analysis', path: '/sales/lost-analysis' },
      { label: 'Waiting List', path: '/sales/waiting-list' },
    ],
  },
  { key: 'procurement', label: 'Procurement', path: '/procurement/dashboard', icon: 'investor', chevron: true, roles: ['ceo', 'admin', 'super_admin', 'manager', 'finance'],
    children: [
      { label: 'Dashboard', path: '/procurement/dashboard' },
      { label: 'Vendors', path: '/procurement/vendors' },
      { label: 'Purchase Orders', path: '/procurement/purchase-orders' },
      { label: 'Goods Receiving', path: '/procurement/receiving' },
      { label: 'Vendor Bills', path: '/procurement/bills' },
      { label: 'Vendor Payments', path: '/procurement/payments' },
      { label: 'Vendor Contracts', path: '/procurement/contracts' },
    ],
  },
  { key: 'cafe', label: 'Cafeteria', path: '/cafe/dashboard', icon: 'support', chevron: true, roles: ['ceo', 'admin', 'super_admin', 'manager', 'finance'],
    children: [
      { label: 'Dashboard', path: '/cafe/dashboard' },
      { label: 'Menu', path: '/cafe/menu' },
      { label: 'Kitchen Display', path: '/cafe/kitchen' },
      { label: 'Meal Plans', path: '/cafe/meal-plans' },
    ],
  },
  { key: 'compliance', label: 'Compliance', path: '/compliance/documents', icon: 'settings', chevron: true, roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Documents', path: '/compliance/documents' },
    ],
  },
  { key: 'hr', label: 'HR', path: '/hr/dashboard', icon: 'team', chevron: true, roles: ['ceo', 'admin', 'super_admin', 'manager'],
    children: [
      { label: 'Dashboard', path: '/hr/dashboard' },
      { label: 'Employees', path: '/hr/employees' },
      { label: 'Attendance', path: '/hr/attendance' },
      { label: 'Leaves', path: '/hr/leaves' },
      { label: 'Overtime', path: '/hr/overtime' },
      { label: 'Performance Reviews', path: '/hr/reviews' },
      { label: 'Advances & Loans', path: '/hr/advances' },
      { label: 'Onboarding', path: '/hr/onboarding' },
      { label: 'Exits & Offboarding', path: '/hr/exits' },
    ],
  },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings', chevron: true,
    children: [
      { label: 'General', path: '/settings' },
      { label: 'Branding', path: '/settings/branding' },
      { label: 'Email', path: '/settings/email' },
      { label: 'SMS', path: '/settings/sms' },
      { label: 'WhatsApp', path: '/settings/whatsapp' },
      { label: 'Webhooks', path: '/settings/webhooks' },
      { label: 'Slack', path: '/settings/integrations/slack' },
      { label: 'Google Calendar', path: '/settings/calendar' },
      { label: 'API Keys', path: '/settings/api-keys' },
      { label: 'Notifications', path: '/settings/notifications' },
      { label: 'Jobs', path: '/settings/jobs' },
      { label: 'Subscription', path: '/settings/subscription' },
      { label: 'Cache', path: '/settings/cache' },
      { label: 'Audit Logs', path: '/settings/audit-logs' },
      { label: 'Import', path: '/settings/import' },
      { label: 'Email Templates', path: '/settings/email-templates' },
      { label: 'Payment Gateways', path: '/settings/gateways' },
      { label: 'Sessions', path: '/settings/sessions' },
      { label: 'Security', path: '/settings/security' },
      { label: 'System Health', path: '/settings/system-health' },
      { label: 'Backups', path: '/settings/backups' },
      { label: 'Booking Rules', path: '/settings/booking-rules' },
      { label: 'White Label', path: '/settings/white-label' },
      { label: 'Automation', path: '/settings/automation' },
      { label: 'AI Settings', path: '/settings/ai' },
      { label: 'Currency', path: '/settings/currency' },
    ],
  },
  { key: 'support', label: 'Support', path: '/reports', icon: 'support' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [openMenu, setOpenMenu] = useState('workspaces');
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      setCurrent(p);
      if (p.startsWith('/discover') || p.startsWith('/bookings') || p.startsWith('/rides') || p.startsWith('/spaces')) {
        setOpenMenu('workspaces');
      } else if (p.startsWith('/users') || p.startsWith('/attendance') || p.startsWith('/reception') || p.startsWith('/mobile')) {
        setOpenMenu('team');
      } else if (p.startsWith('/finance') || p.startsWith('/billing') || p.startsWith('/reports')) {
        setOpenMenu('investor');
      } else if (p.startsWith('/members')) {
        setOpenMenu('school');
      } else if (p.startsWith('/tasks') || p.startsWith('/reminders')) {
        setOpenMenu('launchpad');
      }
    }
  }, []);

  if (!user) return null;

  const isActive = (path) => current === path || current.startsWith(path + '/');
  const isChildActive = (children) => children?.some((c) => isActive(c.path));

  const renderItem = (item) => {
    const active = isActive(item.path) || isChildActive(item.children);
    const expanded = openMenu === item.key;
    return (
      <div key={item.key} className="relative">
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[#0f766e]" />
        )}
        <a
          href={item.path}
          onClick={item.children ? (e) => { e.preventDefault(); setOpenMenu(expanded ? '' : item.key); } : undefined}
          className={`flex items-center gap-3 pl-5 pr-3.5 py-2.5 rounded-xl text-[14px] transition-all duration-200 group ${
            active
              ? 'text-[#0f766e] font-bold bg-teal-50'
              : 'text-gray-800 hover:text-gray-900 hover:bg-gray-100 font-bold'
          }`}
        >
          <span className={`transition-all ${active ? 'text-[#0f766e]' : 'text-gray-500 group-hover:text-gray-700'}`}>
            {ICONS[item.icon]}
          </span>
          <span className="flex-1">{item.label}</span>
          {(item.children || item.chevron) && (
            <span className={`transition-transform duration-200 ${active ? 'text-teal-600' : 'text-gray-400 group-hover:text-gray-500'}`}>
              {item.children ? (expanded ? ICONS.chevron : ICONS.chevronRight) : ICONS.chevron}
            </span>
          )}
        </a>
        {item.children && expanded && (
          <div className="mt-1 ml-3 rounded-xl bg-gray-50 border border-gray-100 p-1.5 space-y-0.5 animate-[fadeSlideIn_0.25s_ease-out]">
            {item.children.map((child) => {
              const childActive = isActive(child.path);
              return (
                <a
                  key={child.path}
                  href={child.path}
                  className={`block px-3.5 py-2 rounded-lg text-[13.5px] transition-all duration-200 ${
                    childActive
                      ? 'text-teal-800 font-bold bg-teal-50'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100 font-semibold'
                  }`}
                >
                  {child.label}
                </a>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-[248px] shrink-0 bg-white flex flex-col min-h-screen border-r border-gray-200 relative">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#134e4a] flex items-center justify-center text-white text-lg font-extrabold">
          T
        </div>
        <div>
          <p className="text-gray-900 text-[15px] font-bold tracking-tight leading-tight">Techub</p>
          <p className="text-gray-400 text-[11px] font-medium tracking-wide">CO-WORKING</p>
        </div>
      </div>

      {/* User card */}
      <div className="px-4 mb-4 relative">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center gap-3 px-3 py-2.5 w-full text-left rounded-xl bg-gray-50 border border-gray-200 hover:border-teal-300 transition-all duration-200 group"
        >
          <span className="relative shrink-0">
            <span className="w-10 h-10 rounded-full bg-[#134e4a] flex items-center justify-center text-white text-sm font-bold overflow-hidden">
              {(user.name || user.email || 'U').charAt(0).toUpperCase()}
            </span>
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-gray-900 text-[14px] font-semibold truncate">{user.tenantName || 'Techub Studio'}</p>
            <p className="text-gray-500 text-[12px] capitalize">{(user.role || 'admin').replace(/_/g, ' ')}</p>
          </div>
          <span className="text-gray-400 group-hover:text-gray-600 transition-colors">{ICONS.chevUpDown}</span>
        </button>
        {showUserMenu && (
          <div className="absolute left-4 right-4 top-full mt-1 rounded-xl bg-white border border-gray-200 shadow-xl p-1.5 z-50 animate-[fadeSlideIn_0.2s_ease-out]">
            <button
              onClick={() => { logout(); window.location = '/login'; }}
              className="w-full text-left px-3.5 py-2 rounded-lg text-[13.5px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3.5 space-y-1 overflow-y-auto pb-4">
        {user.role === 'member' ? (
          <>
            <p className="px-3.5 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">My Space</p>
            {NAV_MEMBER.map(renderItem)}
          </>
        ) : (
          <>
            <p className="px-3.5 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Main</p>
            {NAV_MAIN.filter((i) => !i.roles || i.roles.includes(user.role)).map(renderItem)}
            <p className="px-3.5 pt-5 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Others</p>
            {NAV_OTHERS.filter((i) => !i.roles || i.roles.includes(user.role)).map(renderItem)}
          </>
        )}
      </nav>

      {/* Upgrade promo card — Fobework style */}
      <div className="px-4 pb-5">
        <div className="rounded-2xl p-4 border border-teal-200 bg-teal-50">
          <ul className="space-y-1.5 mb-3">
            {['Unlimited features', 'Unlimited workspaces', 'Cancel Anytime'].map((t) => (
              <li key={t} className="flex items-center gap-2 text-[12.5px] text-teal-800">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {t}
              </li>
            ))}
          </ul>
          <button
            onClick={() => (window.location.href = '/settings/subscription')}
            className="w-full px-3 py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#134e4a] hover:bg-[#0f766e] transition-colors"
          >
            Upgrade Now
          </button>
        </div>
      </div>
    </aside>
  );
}
