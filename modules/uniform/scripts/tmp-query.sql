select uuid, name from student where school_id = (select uuid from school where code = 'SS1') limit 5;
