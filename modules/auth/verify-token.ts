const jwt = require('jsonwebtoken');

export class AuthResponseDto {
  principalId: string;
  policyDocument: any;
  context: any;
}

export const generatePolicy = (decoded, effect, resource) => {
  const authResponse: AuthResponseDto = new AuthResponseDto();
  authResponse.principalId = decoded.id;
  if (effect && resource) {
    const policyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Action: ['execute-api:Invoke'],
          Effect: effect,
          Resource: resource,
        },
      ],
    };

    //set Context which will be pass to lambda function
    authResponse.context = { type: decoded.type, role: decoded.role, mobile: decoded.mobile };
    authResponse.policyDocument = policyDocument;
  }
  return authResponse;
};

export class VerifyToken {
  public auth(event, _context, callback) {
     
    const bearerToken = event.authorizationToken;

    if (!bearerToken) {
      return callback('Error: Invalid token'); // Return a 500 Invalid token response
    }

    const token = bearerToken.replace('Bearer ', '').trim();

    // verifies secret and checks exp
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
      console.log('error in jwt verify: '+JSON.stringify(err));
        return callback('Unauthorized');
      }
      if (!decoded || decoded.auth !== process.env.JWT_MAGIC_KEY) {
        return callback('Unauthorized');
      }

      // if everything is good, save to request for use in other routes
      return callback(null, generatePolicy(decoded, 'Allow', '*'));
    });
  }
}

export const handler = new VerifyToken();
export const auth = handler.auth;
