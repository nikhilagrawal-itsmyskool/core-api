-- VARCHAR Length Guidelines:
-- Short codes/IDs: 16, 32, 64 (powers of 2)
-- Phone numbers: 20 (E.164 format: +[country][number], max 15 digits + formatting)
-- Email addresses: 255 (RFC 5321 standard max is 254, round to 255)
-- Person names: 128 (covers most international names)
-- UUIDs as strings: 36 (standard UUID format)
-- Short text/enums: 64, 128
-- Medium text: 256, 512
-- Long text: 1024, 2048
-- URLs: 2048 (common web standard)
--
-- General rule: Use powers of 2 (16, 32, 64, 128, 256, 512, 1024, 2048)
-- or follow industry standards (email=255, phone=20, UUID=36)

create table school (
    uuid varchar(12) PRIMARY KEY,
    name VARCHAR(128),
    code VARCHAR(16),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_school_code on school (code);

create table academic_year (
    uuid varchar(12) PRIMARY KEY,
    name VARCHAR(128),
    code VARCHAR(16),
    start_date DATE,
    end_date DATE,
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_academic_year_code_school_id on academic_year (code, school_id);

create table class (
    uuid varchar(12) PRIMARY KEY,
    name VARCHAR(128),
    code VARCHAR(16),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_class_code_school_id on class (code, school_id);

CREATE TABLE student (
    uuid varchar(12) PRIMARY KEY,
    admission_number VARCHAR(32) UNIQUE,
    name VARCHAR(128),
    gender CHAR(1),
    dob DATE,
    family_unique_number VARCHAR(20),
    father_mobile VARCHAR(20),
    father_whatsapp VARCHAR(20),
    father_email VARCHAR(255),
    mother_mobile VARCHAR(20),
    mother_whatsapp VARCHAR(20),
    mother_email VARCHAR(255),
    guardian_mobile VARCHAR(20),
    guardian_whatsapp VARCHAR(20),
    guardian_email VARCHAR(255),
    communication_preference VARCHAR(64),
    old_admission_number VARCHAR(32),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_student_admission_number_school_id on student (admission_number, school_id);

create table student_class (
    uuid varchar(12) PRIMARY KEY,
    student_id VARCHAR(12),
    academic_year_id VARCHAR(12),
    class_id VARCHAR(12),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_student_class_student_id_academic_year_id_class_id_school_id on student_class (student_id, academic_year_id, class_id, school_id);

create table role (
    uuid varchar(12) PRIMARY KEY,
    name VARCHAR(128),
    code VARCHAR(32),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_role_code_school_id on role (code, school_id);

create table employee (
    uuid varchar(12) PRIMARY KEY,
    employee_number VARCHAR(32),
    name VARCHAR(128),
    gender CHAR(1),
    dob DATE,
    family_unique_number VARCHAR(20),
    mobile VARCHAR(20),
    whatsapp VARCHAR(20),
    email VARCHAR(255),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_employee_employee_number_school_id on employee (employee_number, school_id);
create unique index idx_employee_family_unique_number_school_id on employee (family_unique_number, school_id);

create table employee_role (
    uuid varchar(12) PRIMARY KEY,
    staff_id VARCHAR(12),
    role_id VARCHAR(12),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create table student_login (
    uuid varchar(12) PRIMARY KEY,
    username VARCHAR(128),
    password VARCHAR(128),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_student_login_username_school_id on student_login (username, school_id);

create table student_login_history (
    uuid varchar(12) PRIMARY KEY,
    student_login_id VARCHAR(12),
    login_time TIMESTAMP(0),
    logout_time TIMESTAMP(0),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0)
);

create table employee_login (
    uuid varchar(12) PRIMARY KEY,
    username VARCHAR(128),
    password VARCHAR(128),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0),
    updatedby_userid varchar(12),
    updated_at TIMESTAMP(0)
);

create unique index idx_employee_login_username_school_id on employee_login (username, school_id);

create table employee_login_history (
    uuid varchar(12) PRIMARY KEY,
    employee_login_id VARCHAR(12),
    login_time TIMESTAMP(0),
    logout_time TIMESTAMP(0),
    school_id VARCHAR(12),
    createdby_userid varchar(12),
    created_at TIMESTAMP(0)
);