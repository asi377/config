export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class InsufficientQuotaError extends AppError {
  constructor() {
    super('Insufficient quota in the data pool', 400);
  }
}

export class SubscriptionExpiredError extends AppError {
  constructor() {
    super('Subscription has expired', 400);
  }
}

export class SubscriptionSuspendedError extends AppError {
  constructor() {
    super('Subscription is suspended', 400);
  }
}

export class SubscriptionNotActiveError extends AppError {
  constructor() {
    super('Subscription is not active', 400);
  }
}

export class SharedPaymentNotPendingError extends AppError {
  constructor() {
    super('Subscription is not pending shared payment', 400);
  }
}

export class MaxSubLinksReachedError extends AppError {
  constructor(max) {
    super(`Maximum sub-links (${max}) reached for this plan`, 400);
  }
}

export class UserAlreadyPaidError extends AppError {
  constructor() {
    super('User has already completed their payment', 400);
  }
}

export class UserNotInSharedPaymentError extends AppError {
  constructor() {
    super('User is not part of this shared payment', 400);
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(balance, required) {
    super(`Insufficient wallet balance. Available: ${balance}, Required: ${required}`, 400);
  }
}
