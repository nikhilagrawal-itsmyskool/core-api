node --version
v22.21.0

npm --version
10.9.4

# Serverless
```bash
$env:AWS_PROFILE = 'prod-itsmyskool-nikhil.agrawal'
& "H:\github\itsmyskool\core-api\node_modules\.bin\serverless.cmd" deploy --stage prod --verbose --region ap-south-1
& "H:\github\itsmyskool\core-api\node_modules\.bin\serverless.cmd" create_domain --stage prod --region ap-south-1
```

# Module start/stop
node scripts/local/start-module.js timetable --stage prod --kill
node scripts/local/kill-ports.js --timetable --stage prod

# CPSAT with out starting local gateway at port 6000
```bash
-- Powershell #1
node scripts/local/cpsat-dump-worker.js --port 6031
-- Powershell #2
$env:CPSAT_S3_BUCKET='prod-itsmyskool-cpsat'; $env:AWS_PROFILE='prod-itsmyskool-nikhil.agrawal'; $env:AWS_REGION='ap-south-1'
node scripts/local/cpsat-import-worker.js --port 6031
-- WSL
uv run /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/poller.py
```

# Import xlsx solution to a run id folder
```bash
uv run /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/import_excel_solution.py --run-dir /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/vgbevigu1fa1/ --xls /mnt/h/Time\ Table\ 2026-27.xlsx --dry-run

uv run /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/import_excel_solution.py --run-dir /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/vgbevigu1fa1/ --xls /mnt/h/Time\ Table\ 2026-27.xlsx --force

uv run /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/render_pdf.py --run-dir /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/vgbevigu1fa1/

Copy the provided xlsx
```
# Copy the files to bucket location:
```bash
export AWS_PROFILE=prod-itsmyskool-nikhil.agrawal
aws sts get-caller-identity
cd /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/vgbevigu1fa1
aws s3 cp timetable.pdf  s3://prod-itsmyskool-cpsat/runs/vgbevigu1fa1/timetable.pdf  --profile prod-itsmyskool-nikhil.agrawal --region ap-south-1
aws s3 cp timetable.xlsx s3://prod-itsmyskool-cpsat/runs/vgbevigu1fa1/timetable.xlsx --profile prod-itsmyskool-nikhil.agrawal --region ap-south-1
```

# CPSAT with local gateway at port 6000
node scripts/local/cpsat-dump-worker.js --port 6000
node scripts/local/cpsat-import-worker.js --port 6000
uv run /mnt/h/github/itsmyskool/core-api/modules/timetable/cpsat/poller.py


