-- An earlier draft of this import (source "CourseFinder export (University of East Anglia)") packed
-- several columns into combined text. Clear only those generated values so each column can be
-- stored in its own field below; any other value is left as it is.
update public.courses set
  course_requirement   = case when course_requirement like '%Course page: http%' then null else course_requirement end,
  english_requirement  = case when english_requirement ~ '^IELTS \S+ \(no band less than' then null else english_requirement end,
  academic_requirement = regexp_replace(academic_requirement, E'\nBacklogs accepted: [^\n]*$', ''),
  scholarship          = case when scholarship like 'Available · average %' then null else scholarship end
where source = 'CourseFinder export (University of East Anglia)';
update public.universities set notes = null
where source = 'CourseFinder export (University of East Anglia)' and notes like 'Webometrics World Ranking%';
