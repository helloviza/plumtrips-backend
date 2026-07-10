/**
 * Standardized application error.
 * Lets controllers do: throw new ApiError(404, 'Coupon not found')
 * and have the centralized error handler format the response consistently.
 */
class ApiError extends Error {
  statusCode: number;
  success: false;
  errors: unknown[];

  constructor(statusCode: number, message: string, errors: unknown[] = []) {
    super(message);
    this.statusCode = statusCode;
    this.success = false;
    this.errors = errors; // array of field-level or case-level validation messages
    Error.captureStackTrace(this, this.constructor);
  }
}

export default ApiError;