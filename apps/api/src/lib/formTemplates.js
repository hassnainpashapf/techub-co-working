// Phase 47 Track 6/10: Form Templates Library.
// 8 ready-made form templates — clone karke CustomForm draft banaya jata hai
// (route: routes/form-templates.js). Field types Track 1 schema se:
// text, textarea, number, date, select, multiselect, radio, checkbox,
// file, rating, email, phone.
// Koi migration nahi — seed data lib me hai.

let _n = 0;
const f = (type, label, opts = {}) => ({ id: `f${++_n}`, type, label, required: !!opts.required, ...opts });

function reset() { _n = 0; }

const TEMPLATES = {
  'membership-application': {
    key: 'membership-application',
    title: 'Membership Application',
    description: 'Naye member ki application — personal info, plan pasand, aur documents.',
    category: 'Membership',
    fields() { reset(); return [
      f('text', 'Poora naam', { required: true, placeholder: 'e.g. Ali Raza' }),
      f('email', 'Email', { required: true }),
      f('phone', 'Phone / WhatsApp', { required: true }),
      f('text', 'Company / Organization', { placeholder: 'Agar freelancer hain to khaali chhorein' }),
      f('select', 'Kaunsa plan chahiye?', { required: true, options: ['Hot Desk', 'Dedicated Desk', 'Private Office', 'Virtual Office', 'Day Pass'] }),
      f('date', 'Kab se join karna hai?', { required: true }),
      f('multiselect', 'Kin facilities ki zaroorat hai?', { options: ['Meeting Room', 'Printing', 'Locker', 'Parking', 'Mail Handling', 'Cafeteria'] }),
      f('textarea', 'Kuch aur batana chahein?', { placeholder: 'Team size, special requirements...' }),
      f('file', 'CNIC / ID ki copy', { required: true }),
    ]; },
  },
  'event-feedback': {
    key: 'event-feedback',
    title: 'Event Feedback',
    description: 'Event ke baad attendees se feedback — rating + comments.',
    category: 'Events',
    fields() { reset(); return [
      f('text', 'Aapka naam', { required: true }),
      f('email', 'Email'),
      f('rating', 'Event ko kitne stars dein ge?', { required: true }),
      f('radio', 'Speaker/content kaisa laga?', { required: true, options: ['Bohat acha', 'Acha', 'Theek tha', 'Behtar ho sakta tha'] }),
      f('radio', 'Kya aap aglay event me aayein ge?', { required: true, options: ['Zaroor', 'Shayad', 'Nahi'] }),
      f('textarea', 'Kya behtar ho sakta tha?', { placeholder: 'Aapki raaye...' }),
    ]; },
  },
  'maintenance-request': {
    key: 'maintenance-request',
    title: 'Maintenance Request',
    description: 'Member/staff ki taraf se repair ya maintenance ki darkhwast.',
    category: 'Facility',
    fields() { reset(); return [
      f('text', 'Aapka naam', { required: true }),
      f('select', 'Location', { required: true, options: ['Lobby', 'Meeting Room A', 'Meeting Room B', 'Hot Desk Area', 'Private Offices', 'Kitchen/Cafeteria', 'Washrooms', 'Parking', 'Other'] }),
      f('select', 'Issue ki type', { required: true, options: ['Electrical', 'Plumbing', 'AC / Heating', 'Furniture', 'Internet / WiFi', 'Cleaning', 'Other'] }),
      f('radio', 'Kitni urgent hai?', { required: true, options: ['Normal', 'Urgent — kaam ruk gaya hai'] }),
      f('textarea', 'Masla tafseel se likhein', { required: true, placeholder: 'Kya kharab hai, kab se hai...' }),
      f('file', 'Photo (agar ho)', {}),
    ]; },
  },
  'visitor-preregistration': {
    key: 'visitor-preregistration',
    title: 'Visitor Pre-registration',
    description: 'Mehmaan ki visit se pehle registration — reception fast check-in ke liye.',
    category: 'Visitors',
    fields() { reset(); return [
      f('text', 'Visitor ka naam', { required: true }),
      f('phone', 'Visitor ka phone', { required: true }),
      f('text', 'Kis se milna hai? (Host)', { required: true, placeholder: 'Member ya staff ka naam' }),
      f('date', 'Visit ki date', { required: true }),
      f('select', 'Visit ka maqsad', { required: true, options: ['Meeting', 'Tour', 'Interview', 'Delivery', 'Event', 'Other'] }),
      f('textarea', 'Note (optional)', {}),
    ]; },
  },
  'job-application': {
    key: 'job-application',
    title: 'Job Application',
    description: 'Staff hiring ke liye application form — CV upload ke sath.',
    category: 'HR',
    fields() { reset(); return [
      f('text', 'Poora naam', { required: true }),
      f('email', 'Email', { required: true }),
      f('phone', 'Phone', { required: true }),
      f('select', 'Kis position ke liye?', { required: true, options: ['Receptionist', 'Community Manager', 'Operations', 'Finance', 'Barista / Cafeteria', 'Cleaner', 'Other'] }),
      f('number', 'Tajurba (saal)', { placeholder: '0' }),
      f('textarea', 'Apne baare me mukhtasir', { required: true }),
      f('file', 'CV upload karein (PDF)', { required: true }),
    ]; },
  },
  'tour-booking': {
    key: 'tour-booking',
    title: 'Tour Booking',
    description: 'Space ka tour book karne ke liye public form — lead banata hai.',
    category: 'Sales',
    fields() { reset(); return [
      f('text', 'Aapka naam', { required: true }),
      f('email', 'Email', { required: true }),
      f('phone', 'Phone / WhatsApp', { required: true }),
      f('date', 'Tour ki date', { required: true }),
      f('select', 'Waqt', { required: true, options: ['Subah 10-12', 'Dopahar 12-3', 'Shaam 3-6'] }),
      f('select', 'Kis me dilchaspi hai?', { required: true, options: ['Hot Desk', 'Dedicated Desk', 'Private Office', 'Virtual Office', 'Event Space'] }),
      f('number', 'Kitne logon ke liye?', { placeholder: '1' }),
    ]; },
  },
  'complaint-form': {
    key: 'complaint-form',
    title: 'Complaint Form',
    description: 'Member ki shikayat — support ticket jaisa flow.',
    category: 'Support',
    fields() { reset(); return [
      f('text', 'Aapka naam', { required: true }),
      f('email', 'Email', { required: true }),
      f('select', 'Shikayat kis baare me hai?', { required: true, options: ['Billing', 'Internet / WiFi', 'Cleanliness', 'Noise', 'Staff behaviour', 'Booking issue', 'Other'] }),
      f('radio', 'Kitni serious hai?', { required: true, options: ['Normal', 'Urgent'] }),
      f('textarea', 'Tafseel likhein', { required: true }),
      f('checkbox', 'Kya hum aap se rabta kar sakte hain?', {}),
    ]; },
  },
  'nps-survey': {
    key: 'nps-survey',
    title: 'NPS Survey',
    description: 'Net Promoter Score — member kitna recommend karega?',
    category: 'Engagement',
    fields() { reset(); return [
      f('rating', '0-10: Aap Techub ko dost ko recommend karein ge?', { required: true }),
      f('radio', 'Sab se achi cheez kya hai?', { options: ['Community', 'Location', 'Facilities', 'Staff', 'Price', 'Events'] }),
      f('textarea', 'Ek cheez jo hum behtar kar sakte hain?', {}),
      f('text', 'Naam (optional)', {}),
    ]; },
  },
};

function listTemplates() {
  return Object.values(TEMPLATES).map(t => ({
    key: t.key,
    title: t.title,
    description: t.description,
    category: t.category,
    fieldCount: t.fields().length,
  }));
}

function getTemplate(key) {
  return TEMPLATES[key] || null;
}

module.exports = { TEMPLATES, listTemplates, getTemplate };
