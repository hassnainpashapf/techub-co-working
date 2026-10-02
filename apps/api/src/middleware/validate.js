// validateBody: run a zod schema over req.body.
// On ZodError → 400 {error:{message:'Validation failed', details: issues}}.
const { ZodError } = require('zod');

function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: { message: 'Validation failed', details: err.issues },
        });
      }
      return next(err);
    }
  };
}

module.exports = { validateBody };
