-- =========================================================================
-- PRMSU College of Engineering - Smart Campus Equipment & Lab Reservation
-- PostgreSQL / Supabase Relational Database Schema & Seed Data
-- =========================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    id_number VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('STUDENT', 'INSTRUCTOR', 'ADMIN')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. EQUIPMENT TABLE
CREATE TABLE IF NOT EXISTS equipment (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    total_qty INT NOT NULL CHECK (total_qty >= 0),
    available_qty INT NOT NULL CHECK (available_qty >= 0),
    lab_location VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'Available' CHECK (status IN ('Available', 'Maintenance', 'Depleted')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. RESERVATIONS TABLE
CREATE TABLE IF NOT EXISTS reservations (
    id VARCHAR(20) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    equipment_id VARCHAR(20) REFERENCES equipment(id) ON DELETE CASCADE,
    qty INT NOT NULL CHECK (qty > 0),
    reservation_date DATE NOT NULL,
    time_slot VARCHAR(50) NOT NULL,
    purpose TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Completed')),
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category);

-- Create a student profile after Supabase Auth creates an account.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.users (auth_user_id, id_number, full_name, email, role)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data ->> 'id_number', ''),
            'USER-' || UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', ''), 1, 12))
        ),
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), SPLIT_PART(NEW.email, '@', 1)),
        NEW.email,
        'STUDENT'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.sync_auth_user_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.users SET email = NEW.email WHERE auth_user_id = NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.sync_auth_user_email();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.users TO authenticated;
DROP POLICY IF EXISTS "Users can read their own profile" ON public.users;
CREATE POLICY "Users can read their own profile"
    ON public.users FOR SELECT
    TO authenticated
    USING (auth_user_id = (SELECT auth.uid()));

-- Remove only the two legacy demo profiles; Supabase Auth now owns accounts.
DELETE FROM public.users
WHERE auth_user_id IS NULL
  AND ((email = 'samantha@prmsu.edu.ph' AND id_number = '2023-10492')
    OR (email = 'rosete@prmsu.edu.ph' AND id_number = 'FAC-2015-08'));

-- =========================================================================
-- SEED DATA (PRMSU Computer Engineering Hardware Assets)
-- =========================================================================

-- Seed Equipment Inventory
INSERT INTO equipment (id, name, category, total_qty, available_qty, lab_location, status) VALUES
('EQ-101', 'Digital Storage Oscilloscope 100MHz', 'Testing Tools', 8, 6, 'Embedded Systems Lab', 'Available'),
('EQ-102', 'PIC16F877A Microcontroller Trainer Kit', 'Microcontrollers', 15, 12, 'Hardware Lab 2', 'Available'),
('EQ-103', '8051 Microcontroller Evaluation Board', 'Microcontrollers', 10, 8, 'Hardware Lab 1', 'Available'),
('EQ-104', 'Digital Logic Gate Experimenter Kit', 'Logic Circuits', 20, 18, 'Digital Circuits Lab', 'Available'),
('EQ-105', 'ESP32 IoT Development Node Kit', 'IoT & Edge', 25, 20, 'Embedded Systems Lab', 'Available'),
('EQ-106', 'Handheld True-RMS Digital Multimeter', 'Testing Tools', 30, 25, 'General COE Lab', 'Available')
ON CONFLICT (id) DO NOTHING;
