http header
sls-offline-authorizer-override={"principalId": "123", "context": {"type": "Trainer"}}
npx serverless offline start --config serverless.yml --httpPort 3000 --lambdaPort 3002 --noPrependStageInUrl --noAuth --prefix auth --stage dev --aws-profile dev-itsmyskool-nikhil.agrawal

npx serverless print --config serverless.yml --stage dev --aws-profile dev-itsmyskool-nikhil.agrawal