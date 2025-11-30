const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { generateShortUuid } = require('./generate-uuid');

let rl = null;

function question(prompt) {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function generateSchoolAndEmployee(schoolName, schoolCode, employeeName) {
  // Generate UUIDs
  const schoolUuid = generateShortUuid(12);
  const employeeUuid = generateShortUuid(12);
  const employeeNumber = generateShortUuid(12);

  // Create SQL statements
  const schoolInsert = `insert into school (uuid, name, code, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${schoolUuid}', '${schoolName.trim()}', '${schoolCode.trim()}', '0', now(), null, null);`;

  const employeeInsert = `insert into employee (uuid, employee_number, name, family_unique_number, school_id, createdby_userid, created_at) 
values ('${employeeUuid}', '${employeeNumber}', '${employeeName.trim()}', '8373919559', '${schoolUuid}', '0', now());`;

  return {
    schoolUuid,
    employeeUuid,
    schoolInsert,
    employeeInsert
  };
}

async function main() {
  try {
    // Prompt for school name
    const schoolName = await question('Enter school name: ');
    if (!schoolName.trim()) {
      console.error('Error: School name cannot be empty');
      process.exit(1);
    }

    // Prompt for school code
    const schoolCode = await question('Enter school code: ');
    if (!schoolCode.trim()) {
      console.error('Error: School code cannot be empty');
      process.exit(1);
    }

    // Prompt for employee name
    const employeeName = await question('Enter employee name: ');
    if (!employeeName.trim()) {
      console.error('Error: Employee name cannot be empty');
      process.exit(1);
    }

    const { schoolUuid, employeeUuid, schoolInsert, employeeInsert } = generateSchoolAndEmployee(
      schoolName,
      schoolCode,
      employeeName
    );

    // Combine SQL statements
    const sqlContent = schoolInsert + '\n\n' + employeeInsert + '\n';

    // Generate output filename based on school code
    const sanitizedCode = schoolCode.trim().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const outputFileName = `${sanitizedCode}-setup.sql`;
    const outputPath = path.join(__dirname, '../modules/db', outputFileName);

    if (fs.existsSync(outputPath)) {
      console.error(`\nError: School has already been setup. File exists: ${outputPath}`);
      console.error('Please use a different school code or delete the existing file.');
      process.exit(1);
    }    
    // Write to file
    fs.writeFileSync(outputPath, sqlContent, 'utf8');

    console.log(`\nSQL file generated successfully: ${outputPath}`);
    console.log(`\nGenerated SQL:\n${sqlContent}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, generateSchoolAndEmployee };

