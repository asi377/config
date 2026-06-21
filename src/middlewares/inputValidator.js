import { ValidationError } from '../shared/errors.js';

export default function inputValidator(schema) {
  return (req, _res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = field.includes('.')
        ? field.split('.').reduce((o, k) => o?.[k], req.body)
        : req.body?.[field];

      for (const rule of rules) {
        if (rule.required && (value === undefined || value === null || value === '')) {
          errors.push(`${field} is required`);
          break;
        }

        if (value === undefined || value === null || value === '') continue;

        if (rule.type === 'string' && typeof value !== 'string') {
          errors.push(`${field} must be a string`);
          break;
        }

        if (rule.type === 'number') {
          const num = Number(value);
          if (isNaN(num)) {
            errors.push(`${field} must be a number`);
            break;
          }
          if (rule.min !== undefined && num < rule.min) {
            errors.push(`${field} must be at least ${rule.min}`);
            break;
          }
          if (rule.max !== undefined && num > rule.max) {
            errors.push(`${field} must be at most ${rule.max}`);
            break;
          }
        }

        if (rule.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`${field} must be a boolean`);
          break;
        }

        if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) {
          errors.push(`${field} must be at least ${rule.minLength} characters`);
          break;
        }

        if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
          errors.push(`${field} must be at most ${rule.maxLength} characters`);
          break;
        }

        if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
          errors.push(`${field} has an invalid format`);
          break;
        }

        if (rule.enum && !rule.enum.includes(value)) {
          errors.push(`${field} must be one of: ${rule.enum.join(', ')}`);
          break;
        }
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError(errors.join('; ')));
    }

    next();
  };
}
