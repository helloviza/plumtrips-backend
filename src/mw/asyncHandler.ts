import {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ParamsDictionary,
} from 'express-serve-static-core';
import { ParsedQs } from 'qs';

type AsyncRouteHandler<
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = ParsedQs,
  Locals extends Record<string, unknown> = Record<string, unknown>
> = (
  req: Request<P, ResBody, ReqBody, ReqQuery, Locals>,
  res: Response<ResBody, Locals>,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async route handler so any thrown/rejected error is
 * automatically forwarded to Express's error-handling middleware
 * instead of crashing the process or requiring try/catch everywhere.
 *
 * Generic over params/body/query/locals so the specific Request<>
 * shape declared by each controller (e.g. Request<{ id: string }>)
 * is preserved instead of being widened to the default ParamsDictionary.
 */
const asyncHandler =
  <
    P = ParamsDictionary,
    ResBody = unknown,
    ReqBody = unknown,
    ReqQuery = ParsedQs,
    Locals extends Record<string, unknown> = Record<string, unknown>
  >(
    fn: AsyncRouteHandler<P, ResBody, ReqBody, ReqQuery, Locals>
  ): RequestHandler<P, ResBody, ReqBody, ReqQuery, Locals> =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export default asyncHandler;