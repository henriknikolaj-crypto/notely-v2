update public.profiles
set quota = 2,
    quota_renew_at = now() + interval '7 days'
where id = '43563077-b620-448f-ad0c-a9899747e812'::uuid;
