const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { generateShortUuid } = require('./generate-uuid');
const { generateSchoolAndEmployee } = require('./actual-school-setup');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
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
      
      students.push({ uuid: studentUuid, insert: studentInsert });
      
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
    
    employees.push({ uuid: employeeUuid, name: employeeName, insert: employeeInsert });
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
      const insert = `insert into employee_role (uuid, staff_id, role_id, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${employeeRoleUuid}', '${employees[assignment.employeeIndex].uuid}', '${role.uuid}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;
      inserts.push(insert);
    }
  });
  
  // Assign god role to first employee (Itsmyskool Admin)
  const godRole = roles.find(r => r.code === 'god');
  if (godRole && firstEmployeeUuid) {
    const employeeRoleUuid = generateShortUuid(12);
    const insert = `insert into employee_role (uuid, staff_id, role_id, school_id, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('${employeeRoleUuid}', '${firstEmployeeUuid}', '${godRole.uuid}', '${schoolUuid}', '${createdByUserId}', now(), null, null);`;
    inserts.push(insert);
  }
  
  return inserts;
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

    // Check if basic setup file already exists
    const sanitizedCode = schoolCode.trim().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const basicSetupFileName = `${sanitizedCode}-setup.sql`;
    const basicSetupPath = path.join(__dirname, '../modules/db', basicSetupFileName);
    
    if (fs.existsSync(basicSetupPath)) {
      console.error(`\nError: School has already been setup. File exists: ${basicSetupPath}`);
      console.error('Please use a different school code or delete the existing file.');
      process.exit(1);
    }

    // Generate school and first employee (Itsmyskool Admin)
    const { schoolUuid, employeeUuid, schoolInsert, employeeInsert } = generateSchoolAndEmployee(
      schoolName,
      schoolCode,
      employeeName
    );

    // Write basic setup file (school + employee)
    const basicSetupContent = schoolInsert + '\n\n' + employeeInsert + '\n';
    fs.writeFileSync(basicSetupPath, basicSetupContent, 'utf8');
    console.log(`\nBasic setup file created: ${basicSetupPath}`);

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

    // Combine all sample data SQL statements
    const sampleDataContent = [
      academicYearInsert,
      '',
      ...classInserts,
      '',
      ...studentInserts,
      '',
      ...studentClassInserts,
      '',
      ...roleInserts,
      '',
      ...additionalEmployeeInserts,
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
    console.log(`\nGenerated:`);
    console.log(`- 1 school (in ${basicSetupFileName})`);
    console.log(`- 1 employee (in ${basicSetupFileName})`);
    console.log(`- 1 academic year`);
    console.log(`- ${classes.length} classes`);
    console.log(`- ${students.length} students`);
    console.log(`- ${students.length} student_class entries`);
    console.log(`- ${roles.length} roles`);
    console.log(`- 5 additional employees`);
    console.log(`- ${employeeRoleInserts.length} employee_role assignments`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main };

