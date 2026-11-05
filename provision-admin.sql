-- Promote the existing Supabase Auth account to administrator.
-- Run this once in the Supabase SQL Editor after creating the account in
-- Authentication -> Users. This does not create or change the account password.
DO $$
DECLARE
    admin_auth_user auth.users%ROWTYPE;
BEGIN
    SELECT *
    INTO admin_auth_user
    FROM auth.users
    WHERE lower(email) = lower('smnthchrstnrgld@gmail.com')
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Supabase Auth account found for %', 'smnthchrstnrgld@gmail.com';
    END IF;

    UPDATE public.users
    SET role = 'ADMIN',
        id_number = 'ADMIN-001',
        full_name = 'ADMIN',
        email = admin_auth_user.email
    WHERE auth_user_id = admin_auth_user.id;

    IF NOT FOUND THEN
        INSERT INTO public.users (auth_user_id, id_number, full_name, email, role)
        VALUES (
            admin_auth_user.id,
            'ADMIN-001',
            'ADMIN',
            admin_auth_user.email,
            'ADMIN'
        );
    END IF;
END;
$$;
