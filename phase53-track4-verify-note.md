# Phase 53 Track 4 — Public Verify Page (integration note for coordinator)

## API
`GET /api/certificates/verify/:code` — **public, no login**. Response:
```json
{ "ok": true, "valid": true, "certificate": {
  "id": "...", "code": "...",
  "memberName": "Ali Raza",
  "courseTitle": "Barista Basics",
  "organization": "Techub",
  "issuedAt": "2026-10-04T..."
} }
```
Invalid cases: `valid:false` + `reason` (`bad-signature` | `malformed` | `not-found` | `tenant-mismatch`).

## Suggested page: `/academy/verify/[code]` (public, login ke baghair)
- URL se code uthao → `fetch(`${API}/api/certificates/verify/${code}`)`
- valid → green "Verified" badge + certificate details (name, course, org, date)
- invalid → red "Certificate verify nahi ho saka" + reason
- Certificate PDF me yehi URL printed hai (`FRONTEND_URL/academy/verify/:code`), is liye ye route live hona chahiye.
- Share button (WhatsApp/copy link) optional.
- Ye page Track 6 (member academy portal) ya frontend coordinator ke pas jaye — ye sirf note hai, is track me frontend page nahi banaya.
