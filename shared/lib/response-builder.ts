import { ApiCallback, ApiResponse, ErrorResponseBody } from './api.interfaces';
import { ErrorCode } from './error-codes';
import {
  BadRequestResult,
  BusinessErrorResult,
  ConfigurationErrorResult,
  ErrorResult,
  ForbiddenResult,
  InternalServerErrorResult,
  NotFoundResult,
} from './errors';
import { HttpStatusCode } from './http-status-codes';

/**
 * Contains helper methods to generate a HTTP response.
 */
export class ResponseBuilder {
  public static badRequest(code: string, description: string, callback: ApiCallback): void {
    const errorResult: BadRequestResult = new BadRequestResult(code, description);
    ResponseBuilder._returnAs<BadRequestResult>(errorResult, HttpStatusCode.BadRequest, callback);
  }

  public static BusinessError(error: BusinessErrorResult, callback: ApiCallback): void {
    ResponseBuilder._returnAs<BusinessErrorResult>(error, HttpStatusCode.BadRequest, callback);
  }

  public static unauthorizedRequest(code: string, description: string, callback: ApiCallback): void {
    const errorResult: BadRequestResult = new BadRequestResult(code, description);
    ResponseBuilder._returnAs<BadRequestResult>(errorResult, HttpStatusCode.Unauthorized, callback);
  }

  public static configurationError(code: string, description: string, callback: ApiCallback): void {
    const errorResult: ConfigurationErrorResult = new ConfigurationErrorResult(code, description);
    ResponseBuilder._returnAs<ConfigurationErrorResult>(errorResult, HttpStatusCode.ConfigurationError, callback);
  }

  public static forbidden(code: string, description: string, callback: ApiCallback): void {
    const errorResult: ForbiddenResult = new ForbiddenResult(code, description);
    ResponseBuilder._returnAs<ForbiddenResult>(errorResult, HttpStatusCode.Forbidden, callback);
  }

  public static internalServerError(error: Error, callback: ApiCallback): void {
    console.error('Some internal server error occurred: ', error);
    const errorResult: InternalServerErrorResult = new InternalServerErrorResult(ErrorCode.GeneralError, 'Sorry...');
    ResponseBuilder._returnAs<InternalServerErrorResult>(errorResult, HttpStatusCode.InternalServerError, callback);
  }

  public static notFound(code: string, description: string, callback: ApiCallback): void {
    const errorResult: NotFoundResult = new NotFoundResult(code, description);
    ResponseBuilder._returnAs<NotFoundResult>(errorResult, HttpStatusCode.NotFound, callback);
  }

  public static handleError(error: Error, callback: ApiCallback): void {
    if (error instanceof BusinessErrorResult) {
      ResponseBuilder.BusinessError(error, callback);
    } else {
      console.error(error);
      ResponseBuilder.badRequest(ErrorCode.GeneralError, error.message, callback);
    }
  }

  public static ok<T>(result: T, callback: ApiCallback): void {
    ResponseBuilder._returnAs<T>(result, HttpStatusCode.Ok, callback);
  }

  public static returnHtml<T>(result: string, callback: ApiCallback, ): void {
    const response: ApiResponse = {
      body: result,
      headers: {
        'Access-Control-Allow-Origin': '*', // This is required to make CORS work with AWS API Gateway Proxy Integration.
        'Content-Type': 'text/html',
      },
      statusCode: HttpStatusCode.Ok,
    };
    if(process.env.LOG_LEVEL == 'info')
    {
      console.log(`Created response: `, HttpStatusCode.Ok, JSON.stringify(response));
    }
    callback(undefined, response);    
  }

  /**
   * Handles HTTP 302 Redirect response.
   * @param {string} location - The URL to which the client should be redirected.
   * @param {ApiCallback} callback - The callback function to return the response.
   */
  public static redirect(location: string, callback: ApiCallback): void {
    const response: ApiResponse = {
      body: '',  // No body for a redirect
      headers: {
        'Location': location,
        'Access-Control-Allow-Origin': '*',
      },
      statusCode: HttpStatusCode.Found
    };    
 
    callback(undefined, response);
  }  

  private static _returnAs<T>(result: T, statusCode: number, callback: ApiCallback): void {
    const bodyObject: ErrorResponseBody | T = result instanceof ErrorResult ? { error: result } : result;
    const response: ApiResponse = {
      body: JSON.stringify(bodyObject),
      headers: {
        'Access-Control-Allow-Origin': '*', // This is required to make CORS work with AWS API Gateway Proxy Integration.
      },
      statusCode,
    };
    if(process.env.LOG_LEVEL == 'info')
    {
      console.log(`Created response: `, statusCode, JSON.stringify(response));
    }
    callback(undefined, response);
  }
}
