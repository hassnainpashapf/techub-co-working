// Phase 28: Password policy — min 8 chars, 1 uppercase, 1 number.
function validatePassword(pw) {
  const errors = [];
  if (!pw || typeof pw !== 'string' || pw.length < 8) {
    errors.push('Password kam az kam 8 characters ka hona chahiye.');
  }
  if (pw && !/[A-Z]/.test(pw)) {
    errors.push('Password me kam az kam 1 capital letter (A-Z) hona chahiye.');
  }
  if (pw && !/[0-9]/.test(pw)) {
    errors.push('Password me kam az kam 1 number (0-9) hona chahiye.');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validatePassword };
