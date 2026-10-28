-- Partner records matching the prototype's sample data (ids p1–p6), so partner
-- users map onto the existing demo workspaces.
insert into public.partners (id, name, code, contact_name, email, phone, city, country, website, status, tier, branches, commission_rate) values
  ('p1', 'Horizon Edu Consultants',  'HEC', 'Meera Krishnan', 'meera@horizonedu.in',      '+91 98470 21234', 'Kochi',     'India',     'horizonedu.in',     'Active',     'Platinum', '{Kochi,Trivandrum,Calicut}', 15),
  ('p2', 'BrightPath Overseas',      'BPO', 'Rahul Verma',    'rahul@brightpath.co',      '+91 99860 44120', 'Bengaluru', 'India',     'brightpath.co',     'Active',     'Gold',     '{Bengaluru,Mysuru}',         12),
  ('p3', 'Global Scholars Hub',      'GSH', 'Fatima Sheikh',  'fatima@globalscholars.ae', '+971 50 214 8890','Dubai',     'UAE',       'globalscholars.ae', 'Active',     'Gold',     '{Dubai,Sharjah}',            12),
  ('p4', 'Pinnacle Study Abroad',    'PSA', 'Anand Pillai',   'anand@pinnaclestudy.in',   '+91 94470 88213', 'Chennai',   'India',     'pinnaclestudy.in',  'Active',     'Silver',   '{Chennai}',                  10),
  ('p5', 'Nexus Education Partners', 'NEP', 'Sanjana Rao',    'sanjana@nexusedu.lk',      '+94 77 412 6620', 'Colombo',   'Sri Lanka', 'nexusedu.lk',       'Onboarding', 'Silver',   '{Colombo}',                  10),
  ('p6', 'EduBridge Global',         'EBG', 'Daniel Joseph',  'daniel@edubridge.np',      '+977 980 112 4455','Kathmandu','Nepal',     'edubridge.np',      'Active',     'Gold',     '{Kathmandu,Pokhara}',        12)
on conflict (id) do nothing;

-- After creating users in Supabase → Authentication → Users, assign their roles:
--
--   insert into public.profiles (id, role, partner_id, full_name)
--   select id, 'admin', null, 'Aisha Rahman' from auth.users where email = 'admin@ssiglobal.com';
--
--   insert into public.profiles (id, role, partner_id, full_name)
--   select id, 'partner', 'p1', 'Meera Krishnan' from auth.users where email = 'meera@horizonedu.in';
--
-- Users without a profile row cannot sign in to the CRM (including via Google).
