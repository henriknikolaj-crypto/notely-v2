update public.profiles
set plan = 'free'
where id = '43563077-b620-448f-ad0c-a9899747e812'::uuid;
-- Alternativt:
-- update public.profiles set plan='pro' where id = '43563077-b620-448f-ad0c-a9899747e812'::uuid;
-- update public.profiles set plan='basic' where id = '43563077-b620-448f-ad0c-a9899747e812'::uuid;
