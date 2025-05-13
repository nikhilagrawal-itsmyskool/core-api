import { ErrorCode } from '../../shared/lib/error-codes';
import { BusinessErrorResult } from '../../shared/lib/errors';

export class SampleService {
  public get(queryParams: any): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      console.log(`This is log message`);
      console.info(`This is info message`);
      console.debug(`This is debug message`);
      console.warn(`This is warn message`);
      console.error(`This is error message`);
      if (queryParams.value === '1') {
        reject(
          new BusinessErrorResult(
            ErrorCode.BusinessError,
            'Mandatory 15 mins break after 2 hour sessions business validation failed.',
          ),
        );
      } else if (queryParams.value === '2') {
        reject(new Error('Mandatory 15 mins break after 2 hour sessions business validation failed.'));
      }
      resolve('hi');
    });
  }
}

export const SampleServices = new SampleService();
