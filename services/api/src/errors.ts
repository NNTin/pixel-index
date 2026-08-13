/**
 * One error envelope for the whole API.
 *
 * Every error response — thrown deliberately by a route, raised by Fastify's
 * own schema validation, or an unhandled exception — comes out shaped the
 * same way, so a frontend or a third-party integration writes one error
 * handler rather than one per endpoint:
 *
 *   { "error": "<machine-readable code>", "message": "<human-readable text>" }
 *
 * A validation failure additionally carries `issues`, in exactly the shape
 * `@pixel-index/layout-core`'s validators already return
 * (`{ code, path, message }[]`), so #8's submission endpoint can hand a
 * `ValidationResult` straight to `ApiError.validation()` with no translation
 * layer.
 */

import type { ValidationIssue } from '@pixel-index/layout-core';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly issues?: ValidationIssue[];

  constructor(statusCode: number, code: string, message: string, issues?: ValidationIssue[]) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (issues) this.issues = issues;
  }

  static validation(issues: ValidationIssue[], message = 'Validation failed.'): ApiError {
    return new ApiError(422, 'validation_error', message, issues);
  }

  static notFound(message = 'Not found.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  static forbidden(message = 'Forbidden.'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static unauthorized(message = 'Authentication required.'): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, 'conflict', message);
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, 'bad_request', message);
  }
}

/**
 * The body of every error response this API produces. Exported so a test can
 * read `response.json<EnvelopeBody>().error` and be told at compile time when
 * it misspells the field, rather than comparing `undefined` to a string and
 * passing.
 */
export interface EnvelopeBody {
  error: string;
  message: string;
  issues?: ValidationIssue[];
}

function envelope(code: string, message: string, issues?: ValidationIssue[]): EnvelopeBody {
  return { error: code, message, ...(issues ? { issues } : {}) };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(envelope(error.code, error.message, error.issues));
    }

    // Fastify's own request schema validation (route-level `schema.body` etc.).
    if (error.validation) {
      return reply
        .code(400)
        .send(envelope('bad_request', error.message || 'The request could not be validated.'));
    }

    // @fastify/rate-limit throws a plain error with statusCode 429 already set.
    if (error.statusCode === 429) {
      return reply.code(429).send(envelope('rate_limited', error.message));
    }

    if (error.statusCode === 413) {
      return reply.code(413).send(envelope('payload_too_large', 'Request body is too large.'));
    }

    // Anything else is unexpected: log the real error, but never leak internals
    // to the client.
    request.log.error({ err: error }, 'unhandled error');
    const statusCode =
      error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    const message = statusCode < 500 ? error.message : 'Something went wrong.';
    return reply.code(statusCode).send(envelope(statusCode < 500 ? 'bad_request' : 'internal_error', message));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply
      .code(404)
      .send(envelope('not_found', `No route for ${request.method} ${request.url}`));
  });
}
