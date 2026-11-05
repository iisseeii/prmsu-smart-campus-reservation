-- Atomically save a faculty decision and adjust stock for approved requests.
-- The server invokes this with its private Supabase service-role client.
CREATE OR REPLACE FUNCTION public.process_reservation_decision(
    p_reservation_id VARCHAR(20),
    p_status VARCHAR(20),
    p_remarks TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    reservation_row public.reservations%ROWTYPE;
    updated_rows INTEGER;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('Approved', 'Rejected') THEN
        RAISE EXCEPTION 'Decision must be Approved or Rejected'
            USING ERRCODE = '23514';
    END IF;

    IF p_remarks IS NULL OR length(btrim(p_remarks)) = 0 OR length(p_remarks) > 2000 THEN
        RAISE EXCEPTION 'Faculty remarks are required and must be 2000 characters or fewer'
            USING ERRCODE = '23514';
    END IF;

    SELECT *
    INTO reservation_row
    FROM public.reservations
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF reservation_row.status <> 'Pending' THEN
        RAISE EXCEPTION 'This reservation has already been processed'
            USING ERRCODE = '23514';
    END IF;

    IF p_status = 'Approved' THEN
        UPDATE public.equipment
        SET available_qty = available_qty - reservation_row.qty,
            status = CASE
                WHEN status = 'Maintenance' THEN status
                WHEN available_qty - reservation_row.qty = 0 THEN 'Depleted'
                ELSE 'Available'
            END
        WHERE id = reservation_row.equipment_id
          AND available_qty >= reservation_row.qty;

        GET DIAGNOSTICS updated_rows = ROW_COUNT;
        IF updated_rows = 0 THEN
            RAISE EXCEPTION 'Insufficient stock available to approve this reservation'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE public.reservations
    SET status = p_status,
        remarks = btrim(p_remarks)
    WHERE id = reservation_row.id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.process_reservation_decision(VARCHAR, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_reservation_decision(VARCHAR, VARCHAR, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_reservation_decision(VARCHAR, VARCHAR, TEXT) TO service_role;
