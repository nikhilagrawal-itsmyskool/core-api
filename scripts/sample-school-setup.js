const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { generateShortUuid } = require('./generate-uuid');
const { generateSchoolAndEmployee } = require('./actual-school-setup');
const { loadConfig, createPool, runSqlFile, runSqlString } = require('./run-sql');

const PROMPTS_FILE = path.join(__dirname, 'school-prompts.json');
const VALID_STAGES = ['local', 'dev', 'qa', 'prod'];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function loadSavedPrompts() {
  if (fs.existsSync(PROMPTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function savePrompts(schoolCode, prompts) {
  const allPrompts = loadSavedPrompts();
  allPrompts[schoolCode] = prompts;
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(allPrompts, null, 2), 'utf8');
}

function deletePrompts(schoolCode) {
  const allPrompts = loadSavedPrompts();
  if (allPrompts[schoolCode]) {
    delete allPrompts[schoolCode];
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(allPrompts, null, 2), 'utf8');
  }
}

function generateClassInserts(schoolUuid, classes, createdByUserId) {
  const inserts = [];
  classes.forEach(className => {
    const classUuid = generateShortUuid(12);
    inserts.push({
      uuid: classUuid,
      name: className,
      code: className,
      insert: `insert into class (uuid, name, code, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${classUuid}', '${className}', '${className}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`
    });
  });
  return inserts;
}

function generateStudentInserts(schoolUuid, classes, academicYearUuid, createdByUserId) {
  const students = [];
  const studentClassInserts = [];
  
  // Generate mobile numbers 8373919551-70 (20 numbers)
  const mobileNumbers = [];
  for (let i = 51; i <= 70; i++) {
    mobileNumbers.push(`83739195${i}`);
  }
  
  classes.forEach(classData => {
    // Create 2 students for each class
    for (let i = 1; i <= 2; i++) {
      const studentUuid = generateShortUuid(12);
      const admissionNumber = generateShortUuid(12);
      const studentName = `${classData.name} Student ${i}`;
      
      // Assign mobile number using random index between 0 and 19
      const randomIndex = Math.floor(Math.random() * 20);
      const mobileNumber = mobileNumbers[randomIndex];
      
      const studentInsert = `insert into student (uuid, admission_number, name, gender, dob, family_unique_number, father_mobile, father_whatsapp, school_id, createdby_userid, created_at, updatedby_userid, updated_at)
values ('${studentUuid}', '${admissionNumber}', '${studentName}', null, null, '${mobileNumber}', '${mobileNumber}', '${mobileNumber}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;

      students.push({ uuid: studentUuid, name: studentName, familyUniqueNumber: mobileNumber, insert: studentInsert });
      
      // Create student_class entry
      const studentClassUuid = generateShortUuid(12);
      const studentClassInsert = `insert into student_class (uuid, student_id, academic_year_id, class_id, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${studentClassUuid}', '${studentUuid}', '${academicYearUuid}', '${classData.uuid}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;
      
      studentClassInserts.push(studentClassInsert);
    }
  });
  
  return { students, studentClassInserts };
}

function generateRoleInserts(schoolUuid, createdByUserId) {
  const roles = [
    { code: 'god', name: 'God' },
    { code: 'admin', name: 'Admin' },
    { code: 'class-teacher', name: 'Class Teacher' },
    { code: 'transport-incharge', name: 'Transport Incharge' },
    { code: 'medical-incharge', name: 'Medical Incharge' },
    { code: 'teacher', name: 'Teacher' }
  ];
  
  return roles.map(role => {
    const roleUuid = generateShortUuid(12);
    return {
      uuid: roleUuid,
      code: role.code,
      name: role.name,
      insert: `insert into role (uuid, name, code, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${roleUuid}', '${role.name}', '${role.code}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`
    };
  });
}

function generateEmployeeInserts(schoolUuid, count, createdByUserId) {
  const employees = [];
  
  // Generate family_unique_numbers 8373919591-99 (9 numbers)
  const familyUniqueNumbers = [];
  for (let i = 91; i <= 99; i++) {
    familyUniqueNumbers.push(`83739195${i}`);
  }
  
  // Track used indices to ensure no duplicates
  const usedIndices = new Set();
  
  for (let i = 1; i <= count; i++) {
    const employeeUuid = generateShortUuid(12);
    const employeeNumber = generateShortUuid(12);
    const employeeName = `Employee ${i}`;
    
    // Select a random index that hasn't been used yet
    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * 9);
    } while (usedIndices.has(randomIndex));
    
    usedIndices.add(randomIndex);
    const familyUniqueNumber = familyUniqueNumbers[randomIndex];
    
    const employeeInsert = `insert into employee (uuid, employee_number, name, family_unique_number, mobile, whatsapp, school_id, createdby_userid, created_at)
values ('${employeeUuid}', '${employeeNumber}', '${employeeName}', '${familyUniqueNumber}', '${familyUniqueNumber}', '${familyUniqueNumber}', '${schoolUuid}', '${createdByUserId}', now());`;

    employees.push({ uuid: employeeUuid, name: employeeName, familyUniqueNumber: familyUniqueNumber, insert: employeeInsert });
  }
  return employees;
}

function generateEmployeeRoleInserts(schoolUuid, employees, roles, firstEmployeeUuid, createdByUserId) {
  const inserts = [];
  
  // Assign roles to Employee 1-5
  const roleAssignments = [
    { employeeIndex: 0, roleCode: 'admin' },
    { employeeIndex: 1, roleCode: 'class-teacher' },
    { employeeIndex: 2, roleCode: 'transport-incharge' },
    { employeeIndex: 3, roleCode: 'medical-incharge' },
    { employeeIndex: 4, roleCode: 'teacher' }
  ];
  
  roleAssignments.forEach(assignment => {
    const role = roles.find(r => r.code === assignment.roleCode);
    if (role && employees[assignment.employeeIndex]) {
      const employeeRoleUuid = generateShortUuid(12);
      const insert = `insert into employee_role (uuid, employee_id, role_id, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${employeeRoleUuid}', '${employees[assignment.employeeIndex].uuid}', '${role.uuid}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;
      inserts.push(insert);
    }
  });
  
  // Assign god role to first employee (Itsmyskool Admin)
  const godRole = roles.find(r => r.code === 'god');
  if (godRole && firstEmployeeUuid) {
    const employeeRoleUuid = generateShortUuid(12);
    const insert = `insert into employee_role (uuid, employee_id, role_id, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${employeeRoleUuid}', '${firstEmployeeUuid}', '${godRole.uuid}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;
    inserts.push(insert);
  }
  
  return inserts;
}

function generateEmployeeLoginInsert(employeeUuid, username, password, displayName, schoolUuid, createdByUserId) {
  const loginUuid = generateShortUuid(12);
  return `insert into employee_login (uuid, username, password, display_name, school_id, createdby_userid, created_at, updatedby_userid, updated_at)
values ('${loginUuid}', '${username}', '${password}', '${displayName}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;
}

function generateStudentLoginInserts(students, password, schoolUuid, createdByUserId) {
  // Build a map of family_unique_number -> first student's name (for display_name)
  const familyToFirstStudentName = new Map();
  students.forEach(s => {
    if (!familyToFirstStudentName.has(s.familyUniqueNumber)) {
      familyToFirstStudentName.set(s.familyUniqueNumber, s.name);
    }
  });

  // Get unique family_unique_numbers - only one login per family
  const uniqueFamilyNumbers = [...new Set(students.map(s => s.familyUniqueNumber))];

  return uniqueFamilyNumbers.map(familyNumber => {
    const loginUuid = generateShortUuid(12);
    const displayName = familyToFirstStudentName.get(familyNumber);
    return `insert into student_login (uuid, username, password, display_name, school_id, createdby_userid, created_at, updatedby_userid, updated_at)
values ('${loginUuid}', '${familyNumber}', '${password}', '${displayName}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;
  });
}

function generateRollbackSql(schoolUuid, tables) {
  return tables.map(table => {
    if (table === 'school') {
      return `delete from school where uuid = '${schoolUuid}';`;
    }
    return `delete from ${table} where school_id = '${schoolUuid}';`;
  }).join('\n');
}

async function main() {
  let pool = null;

  try {
    // Show menu
    console.log('\n=== Sample School Setup ===\n');

    // Ask for stage first
    const stageInput = await question(`Select stage (${VALID_STAGES.join('/')}): `);
    const stage = stageInput.trim().toLowerCase();
    if (!VALID_STAGES.includes(stage)) {
      console.error(`Error: Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`);
      process.exit(1);
    }

    // Load config and connect to DB
    console.log(`\nLoading ${stage} configuration...`);
    const config = loadConfig(stage);
    console.log(`Connecting to ${config.POSTGRES_ENDPOINT || config.POSTGRES_HOST}/${config.POSTGRES_DATABASE}...`);
    pool = createPool(config);

    // Test connection
    await pool.query('SELECT 1');
    console.log('Database connection successful.\n');

    // Check for saved prompts
    const savedPrompts = loadSavedPrompts();
    const savedSchoolCodes = Object.keys(savedPrompts);

    let schoolName, schoolCode, employeeName, employeePassword, studentPassword;
    let isRecreate = false;

    if (savedSchoolCodes.length > 0) {
      console.log('Saved school configurations:');
      savedSchoolCodes.forEach((code, i) => {
        console.log(`  ${i + 1}. ${code} (${savedPrompts[code].schoolName})`);
      });
      console.log(`  ${savedSchoolCodes.length + 1}. Create new school`);

      const choice = await question('\nSelect an option (enter number): ');
      const choiceNum = parseInt(choice.trim(), 10);

      if (choiceNum > 0 && choiceNum <= savedSchoolCodes.length) {
        // Selected existing school - load saved prompts
        const selectedCode = savedSchoolCodes[choiceNum - 1];
        const saved = savedPrompts[selectedCode];
        schoolName = saved.schoolName;
        schoolCode = saved.schoolCode;
        employeeName = saved.employeeName;
        employeePassword = saved.employeePassword;
        studentPassword = saved.studentPassword;

        // Check if files exist
        const sanitizedCode = schoolCode.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        const basicSetupPath = path.join(__dirname, '../modules/db', `${sanitizedCode}-setup.sql`);
        const additionalDataPath = path.join(__dirname, '../modules/db', `${sanitizedCode}-setup-additional-data.sql`);
        const basicRollbackPath = path.join(__dirname, '../modules/db', `${sanitizedCode}-setup-rollback.sql`);
        const additionalRollbackPath = path.join(__dirname, '../modules/db', `${sanitizedCode}-setup-additional-data-rollback.sql`);

        const filesExist = fs.existsSync(basicSetupPath) || fs.existsSync(additionalDataPath);

        if (filesExist) {
          console.log(`\nSchool "${schoolName}" (${schoolCode}) already has setup files.`);
          console.log('\nAction: Delete and Recreate');

          const confirm = await question('\nProceed with delete and recreate? (yes/no): ');
          if (confirm.trim().toLowerCase() !== 'yes') {
            console.log('\nOperation cancelled.');
            process.exit(0);
          }

          // Run rollback SQL files against database
          console.log('\nRunning rollback SQL...');
          if (fs.existsSync(additionalRollbackPath)) {
            await runSqlFile(pool, additionalRollbackPath);
          }
          if (fs.existsSync(basicRollbackPath)) {
            await runSqlFile(pool, basicRollbackPath);
          }

          // Delete existing files
          console.log('\nDeleting existing files...');
          [basicSetupPath, additionalDataPath, basicRollbackPath, additionalRollbackPath].forEach(filePath => {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`  Deleted: ${path.basename(filePath)}`);
            }
          });

          isRecreate = true;
          console.log(`\nRecreating files for: ${schoolName} (${schoolCode})`);
        } else {
          console.log(`\nCreating files for saved configuration: ${schoolName} (${schoolCode})`);
        }
      }
    }

    // If not using saved prompts, ask for new values
    if (!schoolName) {
      // Prompt for school name
      schoolName = await question('Enter school name: ');
      if (!schoolName.trim()) {
        console.error('Error: School name cannot be empty');
        process.exit(1);
      }

      // Prompt for school code
      schoolCode = await question('Enter school code: ');
      if (!schoolCode.trim()) {
        console.error('Error: School code cannot be empty');
        process.exit(1);
      }

      // Check if this school code already has files
      const sanitizedCode = schoolCode.trim().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const basicSetupPath = path.join(__dirname, '../modules/db', `${sanitizedCode}-setup.sql`);

      if (fs.existsSync(basicSetupPath)) {
        console.error(`\nError: School code "${schoolCode}" already has setup files.`);
        console.error('Run the script again and select the existing school to delete and recreate.');
        process.exit(1);
      }

      // Prompt for employee name
      employeeName = await question('Enter employee name: ');
      if (!employeeName.trim()) {
        console.error('Error: Employee name cannot be empty');
        process.exit(1);
      }

      // Prompt for default passwords
      employeePassword = await question('Enter default employee password (hint: Itsmyskool@123): ');
      if (!employeePassword.trim()) {
        console.error('Error: Employee password cannot be empty');
        process.exit(1);
      }

      studentPassword = await question('Enter default student password (hint: Itsmyskool@123): ');
      if (!studentPassword.trim()) {
        console.error('Error: Student password cannot be empty');
        process.exit(1);
      }

      // Save the prompts for future use
      savePrompts(schoolCode.trim(), {
        schoolName: schoolName.trim(),
        schoolCode: schoolCode.trim(),
        employeeName: employeeName.trim(),
        employeePassword: employeePassword.trim(),
        studentPassword: studentPassword.trim()
      });
      console.log(`\nPrompts saved to ${PROMPTS_FILE}`);
    }

    // Generate files
    const sanitizedCode = schoolCode.trim().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const basicSetupFileName = `${sanitizedCode}-setup.sql`;
    const basicSetupPath = path.join(__dirname, '../modules/db', basicSetupFileName);

    // Generate school and first employee (Itsmyskool Admin)
    const { schoolUuid, employeeUuid, schoolInsert, employeeInsert } = generateSchoolAndEmployee(
      schoolName,
      schoolCode,
      employeeName
    );

    // Generate employee_login for first employee
    const firstEmployeeLoginInsert = generateEmployeeLoginInsert(
      employeeUuid,
      '8373919559',  // family_unique_number from actual-school-setup.js
      employeePassword.trim(),
      employeeName.trim(),  // display_name from employee name
      schoolUuid,
      '0'
    );

    // Write basic setup file (school + employee + employee_login)
    const basicSetupContent = schoolInsert + '\n\n' + employeeInsert + '\n\n' + firstEmployeeLoginInsert + '\n';
    fs.writeFileSync(basicSetupPath, basicSetupContent, 'utf8');
    console.log(`\nBasic setup file created: ${basicSetupPath}`);

    // Generate and write basic setup rollback file
    const basicRollbackFileName = `${sanitizedCode}-setup-rollback.sql`;
    const basicRollbackPath = path.join(__dirname, '../modules/db', basicRollbackFileName);
    const basicRollbackContent = generateRollbackSql(schoolUuid, ['employee_login', 'employee', 'school']);
    fs.writeFileSync(basicRollbackPath, basicRollbackContent + '\n', 'utf8');
    console.log(`Basic rollback file created: ${basicRollbackPath}`);

    // Generate academic year
    const academicYearUuid = generateShortUuid(12);
    // Note: Using 2026-03-31 as end date for 2025-26 academic year (runs Apr 2025 to Mar 2026)
    const academicYearInsert = `insert into academic_year (uuid, name, code, start_date, end_date, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${academicYearUuid}', '2025-26', '2025-26', '2025-04-01', '2026-03-31', '${schoolUuid}', '${employeeUuid}', now(), null, null);`;

    // Generate classes: Nursery, LKG, UKG, I-A, I-B, II-A, II-B, ... XII-A, XII-B
    const classNames = [
      'Nursery-A', 'Nursery-B', 'LKG-A', 'LKG-B', 'UKG-A', 'UKG-B',
      'I-A', 'I-B', 'II-A', 'II-B', 'III-A', 'III-B', 'IV-A', 'IV-B',
      'V-A', 'V-B', 'VI-A', 'VI-B', 'VII-A', 'VII-B', 'VIII-A', 'VIII-B',
      'IX-A', 'IX-B', 'X-A', 'X-B', 'XI-A', 'XI-B', 'XII-A', 'XII-B'
    ];
    
    const classes = generateClassInserts(schoolUuid, classNames, employeeUuid);
    const classInserts = classes.map(c => c.insert);

    // Generate students (2 per class) and student_class entries
    const { students, studentClassInserts } = generateStudentInserts(schoolUuid, classes, academicYearUuid, employeeUuid);
    const studentInserts = students.map(s => s.insert);

    // Generate roles
    const roles = generateRoleInserts(schoolUuid, employeeUuid);
    const roleInserts = roles.map(r => r.insert);

    // Generate 5 additional employees
    const additionalEmployees = generateEmployeeInserts(schoolUuid, 5, employeeUuid);
    const additionalEmployeeInserts = additionalEmployees.map(e => e.insert);

    // Generate employee_role assignments
    const employeeRoleInserts = generateEmployeeRoleInserts(
      schoolUuid,
      additionalEmployees,
      roles,
      employeeUuid,
      employeeUuid
    );

    // Generate employee_login for additional employees
    const additionalEmployeeLoginInserts = additionalEmployees.map(emp =>
      generateEmployeeLoginInsert(emp.uuid, emp.familyUniqueNumber, employeePassword.trim(), emp.name, schoolUuid, employeeUuid)
    );

    // Generate student_login for all students
    const studentLoginInserts = generateStudentLoginInserts(students, studentPassword.trim(), schoolUuid, employeeUuid);

    // Combine all sample data SQL statements
    const sampleDataContent = [
      academicYearInsert,
      '',
      ...classInserts,
      '',
      ...studentInserts,
      '',
      ...studentLoginInserts,
      '',
      ...studentClassInserts,
      '',
      ...roleInserts,
      '',
      ...additionalEmployeeInserts,
      '',
      ...additionalEmployeeLoginInserts,
      '',
      ...employeeRoleInserts,
      ''
    ].join('\n');

    // Generate output filename for sample data
    const sampleDataFileName = `${sanitizedCode}-setup-additional-data.sql`;
    const sampleDataPath = path.join(__dirname, '../modules/db', sampleDataFileName);

    // Write sample data file
    fs.writeFileSync(sampleDataPath, sampleDataContent, 'utf8');
    console.log(`\nSample data file created: ${sampleDataPath}`);

    // Generate and write sample data rollback file
    const sampleDataRollbackFileName = `${sanitizedCode}-setup-additional-data-rollback.sql`;
    const sampleDataRollbackPath = path.join(__dirname, '../modules/db', sampleDataRollbackFileName);
    const sampleDataRollbackContent = generateRollbackSql(schoolUuid, [
      'employee_role',
      'employee_login',
      'employee',
      'role',
      'student_login',
      'student_class',
      'student',
      'class',
      'academic_year'
    ]);
    fs.writeFileSync(sampleDataRollbackPath, sampleDataRollbackContent + '\n', 'utf8');
    console.log(`Sample data rollback file created: ${sampleDataRollbackPath}`);
    console.log(`\nGenerated:`);
    console.log(`- 1 school (in ${basicSetupFileName})`);
    console.log(`- 1 employee + 1 employee_login (in ${basicSetupFileName})`);
    console.log(`- 1 academic year`);
    console.log(`- ${classes.length} classes`);
    console.log(`- ${students.length} students`);
    console.log(`- ${studentLoginInserts.length} student_login entries (unique family numbers)`);
    console.log(`- ${students.length} student_class entries`);
    console.log(`- ${roles.length} roles`);
    console.log(`- 5 additional employees`);
    console.log(`- 5 additional employee_login entries`);
    console.log(`- ${employeeRoleInserts.length} employee_role assignments`);
    console.log(`\nRollback files:`);
    console.log(`- ${basicRollbackFileName}`);
    console.log(`- ${sampleDataRollbackFileName}`);

    // Execute SQL files against database
    console.log('\n--- Executing SQL against database ---');
    await runSqlFile(pool, basicSetupPath);
    await runSqlFile(pool, sampleDataPath);
    console.log('\nSetup complete! School data has been inserted into the database.');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
    rl.close();
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, deletePrompts, loadSavedPrompts };

